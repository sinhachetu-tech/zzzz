// Cookie-session auth for HFMC. Server-side sessions, bcrypt password
// verification, and a simple in-memory login throttle.
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "./db";
import type { User } from "./types";

export const SESSION_COOKIE = "hfmc_session";
const SESSION_TTL_DAYS = 7;

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: string;
  team: string;
}

function toSessionUser(u: {
  id: number; name: string; email: string; role: string; team: string; active: boolean; password: string; createdAt: Date;
}): SessionUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role, team: u.team };
}

// simple in-memory login throttle: 5 failures per email per 15 minutes
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
function loginThrottled(email: string): boolean {
  const rec = loginAttempts.get(email);
  if (!rec || rec.resetAt < Date.now()) return false;
  return rec.count >= 5;
}
function recordFailure(email: string) {
  const rec = loginAttempts.get(email);
  if (!rec || rec.resetAt < Date.now()) loginAttempts.set(email, { count: 1, resetAt: Date.now() + 15 * 60_000 });
  else rec.count++;
}

export async function login(email: string, password: string): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const key = email.trim().toLowerCase();
  if (loginThrottled(key)) return { ok: false, error: "Too many attempts — wait 15 minutes." };
  const u = await db.user.findUnique({ where: { email: key } });
  if (!u || !u.active) return { ok: false, error: "No active user with that email." };
  // transparent migration: plaintext (legacy seed) hashes get upgraded on first login
  const hash = u.password.startsWith("$2") ? u.password : await bcrypt.hash(u.password, 10);
  const okPw = await bcrypt.compare(password, hash);
  if (!okPw) {
    recordFailure(key);
    return { ok: false, error: "Wrong password — try again." };
  }
  if (hash !== u.password) {
    await db.user.update({ where: { id: u.id }, data: { password: hash } }).catch(() => { });
  }
  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000);
  await db.session.create({ data: { id: sid, userId: u.id, expiresAt } });
  const store = await cookies();
  store.set(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { ok: true, user: toSessionUser(u) };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE)?.value;
  if (sid) {
    await db.session.deleteMany({ where: { id: sid } }).catch(() => { });
    store.delete(SESSION_COOKIE);
  }
}

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const session = await db.session.findUnique({ where: { id: sid }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: sid } }).catch(() => { });
    return null;
  }
  if (!session.user.active) return null;
  return toSessionUser(session.user);
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new Error("UNAUTHORIZED");
  return u;
}

/* ---------- role flags (designation-driven, mirrors original logic) ---------- */

export interface RoleFlags {
  scope: "all" | "team" | "own";
  issueTasks: boolean;
  admin: boolean;
  super: boolean;
  viewRevenue: boolean;
  editEibor: boolean; // may update the daily EIBOR benchmark table (granted per designation)
  manageDocs: boolean; // may upload/verify/reject/waive/delete/compress vault documents
}

const SUPER_FLAGS: RoleFlags = { scope: "all", issueTasks: true, admin: true, super: true, viewRevenue: true, editEibor: true, manageDocs: true };

export async function flagsFor(user: SessionUser): Promise<RoleFlags> {
  if (user.role === "Super Admin") return SUPER_FLAGS;
  const d = await db.designation.findUnique({ where: { name: user.role } });
  if (!d) return { scope: "own", issueTasks: false, admin: false, super: false, viewRevenue: false, editEibor: false, manageDocs: true };
  return {
    scope: d.scope as RoleFlags["scope"], issueTasks: d.issueTasks, admin: d.admin, super: d.super,
    viewRevenue: d.viewRevenue, editEibor: (d as unknown as { editEibor?: boolean }).editEibor ?? false,
    manageDocs: (d as unknown as { manageDocs?: boolean }).manageDocs ?? true,
  };
}

export async function canManageAll(user: SessionUser): Promise<boolean> {
  const f = await flagsFor(user);
  return f.super || f.admin;
}
