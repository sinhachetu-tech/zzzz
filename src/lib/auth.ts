// Cookie-session auth for HFMC. Lightweight (demo-grade), server-side.
import { cookies } from "next/headers";
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

export async function login(email: string, password: string): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const u = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!u || !u.active) return { ok: false, error: "No active user with that email." };
  if (u.password !== password) return { ok: false, error: "Wrong password — try again." };
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
    await db.session.deleteMany({ where: { id: sid } }).catch(() => {});
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
    await db.session.delete({ where: { id: sid } }).catch(() => {});
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
}

const SUPER_FLAGS: RoleFlags = { scope: "all", issueTasks: true, admin: true, super: true };

export async function flagsFor(user: SessionUser): Promise<RoleFlags> {
  if (user.role === "Super Admin") return SUPER_FLAGS;
  const d = await db.designation.findUnique({ where: { name: user.role } });
  if (!d) return { scope: "own", issueTasks: false, admin: false, super: false };
  return { scope: d.scope as RoleFlags["scope"], issueTasks: d.issueTasks, admin: d.admin, super: d.super };
}

export async function canManageAll(user: SessionUser): Promise<boolean> {
  const f = await flagsFor(user);
  return f.super || f.admin;
}
