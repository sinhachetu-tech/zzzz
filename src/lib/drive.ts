// Google Drive archive — an INDEPENDENT storage target, NOT a mirror of R2.
// When configured (env-driven), every uploaded file is additionally copied into
// a per-case folder tree under one shared Drive folder:
//   {root}/{CASE-NO — Customer}/{KYC|Income|…}/{file}
// The app never deletes from Drive (deleting a document here leaves the archive
// copy), and nothing that happens in Drive affects the Cloudflare R2 objects —
// the two stores are fully independent; extra files can be dropped into the
// folders by hand anytime. Auth is a Google Cloud service account: a JWT
// (RS256, signed with node:crypto) exchanged for an access token — no SDK.
import crypto from "node:crypto";

const CLIENT_EMAIL = process.env.GOOGLE_DRIVE_CLIENT_EMAIL ?? "";
const PRIVATE_KEY_RAW = process.env.GOOGLE_DRIVE_PRIVATE_KEY ?? "";
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID ?? "";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** True when all three Drive env vars are present — gates the archive step. */
export function driveConfigured(): boolean {
  return !!(CLIENT_EMAIL && PRIVATE_KEY_RAW && ROOT_FOLDER_ID);
}

// Private keys are pasted with literal \n escapes — restore real newlines.
function privateKey(): string {
  return PRIVATE_KEY_RAW.includes("\\n") ? PRIVATE_KEY_RAW.replace(/\\n/g, "\n") : PRIVATE_KEY_RAW;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const assertion = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.createSign("RSA-SHA256").update(assertion).sign(privateKey()).toString("base64url");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${assertion}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Drive auth failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function driveFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await accessToken();
  return fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
}

function escapeQuery(name: string): string {
  return name.replace(/'/g, "\\'");
}

// find-or-create cache — one Drive list call per (parent, name) per process
const folderCache = new Map<string, string>();

/** find-or-create a subfolder of parentId by name; returns its folder id. */
async function ensureFolder(parentId: string, name: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  const hit = folderCache.get(cacheKey);
  if (hit) return hit;
  const q = encodeURIComponent(
    `'${escapeQuery(parentId)}' in parents and name = '${escapeQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`
  );
  const list = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`);
  if (!list.ok) throw new Error(`Drive list failed (${list.status}): ${(await list.text()).slice(0, 200)}`);
  const found = ((await list.json()) as { files: { id: string }[] }).files[0];
  if (found) {
    folderCache.set(cacheKey, found.id);
    return found.id;
  }
  const create = await driveFetch("/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!create.ok) throw new Error(`Drive folder create failed (${create.status}): ${(await create.text()).slice(0, 200)}`);
  const made = (await create.json()) as { id: string };
  folderCache.set(cacheKey, made.id);
  return made.id;
}

/** Upload bytes as {name} under parentId (multipart/related). Returns fileId. */
async function uploadFile(parentId: string, name: string, mimeType: string, bytes: Buffer): Promise<string> {
  const boundary = `hfmc-${crypto.randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await driveFetch("/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { id: string }).id;
}

/**
 * Archive one uploaded file into the Drive folder tree, creating the
 * "{caseNumber} — {customer}" case folder and the category subfolder on demand.
 */
export async function driveArchiveFile(input: {
  caseNumber: string;
  customer: string;
  category: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ fileId: string }> {
  const caseFolder = await ensureFolder(ROOT_FOLDER_ID, `${input.caseNumber} — ${input.customer}`.slice(0, 120));
  const catFolder = await ensureFolder(caseFolder, input.category || "Uncategorised");
  const fileId = await uploadFile(catFolder, input.fileName, input.mimeType, input.bytes);
  return { fileId };
}

/** "Test connection": create a probe folder in the root, list it back, delete it. */
export async function driveTestConnection(): Promise<{ steps: Record<string, boolean> }> {
  const name = `_hfmc-probe-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
  const steps: Record<string, boolean> = { write: false, read: false, delete: false };
  const id = await ensureFolder(ROOT_FOLDER_ID, name);
  steps.write = true;
  const q = encodeURIComponent(`'${escapeQuery(ROOT_FOLDER_ID)}' in parents and name = '${name}' and trashed = false`);
  const list = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`);
  if (list.ok) {
    const hit = ((await list.json()) as { files: { id: string }[] }).files[0];
    steps.read = !!hit;
  }
  const del = await driveFetch(`/drive/v3/files/${id}`, { method: "DELETE" });
  if (del.ok) steps.delete = true;
  folderCache.delete(`${ROOT_FOLDER_ID}/${name}`);
  return { steps };
}