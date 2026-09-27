// Microsoft Graph reader for the HFMC shared mailbox.
//
// App-only (client credentials) auth: the app reads the shared mailbox
// directly — no user interaction, no forwarding rule, no third party.
//
// Flow:
//   1. POST to /token with client_id + client_secret + .default scope → access_token
//   2. GET /users/{mailbox}/mailFolders/inbox/messages?$filter=isRead eq false
//   3. For each message: run matchEmail() → EmailLog/UnmatchedEmail, then markRead
//
// Env vars needed in .env:
//   GRAPH_CLIENT_ID      — Azure AD app registration client ID
//   GRAPH_TENANT_ID      — Azure AD tenant (Directory) ID
//   GRAPH_CLIENT_SECRET  — client secret value (not the secret ID)
//   GRAPH_MAILBOX        — shared mailbox email, e.g. "group@hfmc.ae"

export interface GraphMessage {
  id: string;
  subject: string;
  from: { emailAddress: { address: string; name?: string } };
  receivedDateTime: string;
  internetMessageId?: string;
  webLink?: string;
}

interface GraphConfig {
  clientId: string;
  tenantId: string;
  clientSecret: string;
  mailbox: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function config(): GraphConfig | null {
  const c = {
    clientId: process.env.GRAPH_CLIENT_ID,
    tenantId: process.env.GRAPH_TENANT_ID,
    clientSecret: process.env.GRAPH_CLIENT_SECRET,
    mailbox: process.env.GRAPH_MAILBOX,
  };
  if (!c.clientId || !c.tenantId || !c.clientSecret || !c.mailbox) return null;
  return c as GraphConfig;
}

export function isGraphConfigured(): boolean {
  return config() !== null;
}

async function getToken(cfg: GraphConfig): Promise<string> {
  // Reuse token if it has >60s of life left
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph token failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

/** List unread messages from the shared inbox. */
export async function listUnread(limit = 50): Promise<GraphMessage[]> {
  const cfg = config();
  if (!cfg) throw new Error("Graph not configured");
  const token = await getToken(cfg);
  const mailbox = encodeURIComponent(cfg.mailbox);
  const url =
    `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/inbox/messages` +
    `?$filter=isRead eq false` +
    `&$select=id,subject,from,receivedDateTime,internetMessageId,webLink` +
    `&$top=${limit}` +
    `&$orderby=receivedDateTime desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph list failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return (data.value ?? []) as GraphMessage[];
}

/** Mark a message as read so the next poll skips it. */
export async function markRead(messageId: string): Promise<void> {
  const cfg = config();
  if (!cfg) throw new Error("Graph not configured");
  const token = await getToken(cfg);
  const mailbox = encodeURIComponent(cfg.mailbox);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    }
  );
  if (!res.ok) {
    // non-fatal — the message will just be picked up again next poll,
    // and dedup by messageId will prevent double-processing.
  }
}

export function senderOf(m: GraphMessage): string {
  return m.from?.emailAddress?.address ?? "unknown@unknown";
}

/* ==================== DELEGATED SEND MAIL (per-user Outlook) ==================== */

export interface GraphUserToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  userId: number;    // your CRM user ID
  email: string;     // user's UPN/email
}

export interface SendMailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  attachments?: SendMailAttachment[];
  saveToSentItems?: boolean;
}

export interface SendMailAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // base64
}

/** Check if delegated Graph is configured (client ID + secret + redirect URI) */
export function isGraphDelegatedConfigured(): boolean {
  return !!(process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET && process.env.GRAPH_REDIRECT_URI);
}

/** Get Microsoft login URL for delegated auth (auth code flow + PKCE) */
export function getGraphAuthUrl(state: string, pkceChallenge: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID!,
    response_type: "code",
    redirect_uri: process.env.GRAPH_REDIRECT_URI!,
    response_mode: "query",
    scope: "https://graph.microsoft.com/Mail.Send offline_access User.Read",
    state,
    code_challenge: pkceChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

/** Exchange auth code for tokens (with PKCE verifier) */
export async function exchangeGraphCode(code: string, pkceVerifier: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; idToken?: string }> {
  const body = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID!,
    client_secret: process.env.GRAPH_CLIENT_SECRET!,
    code,
    redirect_uri: process.env.GRAPH_REDIRECT_URI!,
    grant_type: "authorization_code",
    code_verifier: pkceVerifier,
  });
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph token exchange failed (${res.status}): ${err}`);
  }
  return res.json();
}

/** Refresh access token using refresh token */
export async function refreshGraphToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID!,
    client_secret: process.env.GRAPH_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: "https://graph.microsoft.com/Mail.Send offline_access User.Read",
  });
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph token refresh failed (${res.status}): ${err}`);
  }
  return res.json();
}

/** Get user profile from Graph (to confirm email/UPN) */
export async function getGraphUserProfile(accessToken: string): Promise<{ id: string; mail: string; userPrincipalName: string; displayName: string }> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph user profile failed (${res.status}): ${err}`);
  }
  return res.json();
}

/** Send mail via Graph with attachments (base64) */
export async function sendMailGraph(accessToken: string, input: SendMailInput): Promise<void> {
  const message: Record<string, unknown> = {
    subject: input.subject,
    body: {
      contentType: "HTML",
      content: input.bodyHtml,
    },
    toRecipients: input.to.map((addr) => ({ emailAddress: { address: addr } })),
    ccRecipients: input.cc?.map((addr) => ({ emailAddress: { address: addr } })) ?? [],
    bccRecipients: input.bcc?.map((addr) => ({ emailAddress: { address: addr } })) ?? [],
    attachments: input.attachments?.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    })) ?? [],
  };

  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: input.saveToSentItems ?? true }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph sendMail failed (${res.status}): ${err}`);
  }
}

/** Helper: fetch file from R2 and return base64 */
export async function getFileBase64FromR2(storageKey: string): Promise<{ base64: string; contentType: string } | null> {
  const { r2Configured, r2Get } = await import("./r2");
  if (!r2Configured()) return null;
  try {
    const got = await r2Get(storageKey);
    const base64 = Buffer.from(got.body).toString("base64");
    return { base64, contentType: got.contentType || "application/octet-stream" };
  } catch {
    return null;
  }
}

/* ==================== PKCE helpers (server-side only) ==================== */

const pkceStore = new Map<string, { verifier: string; userId: number; expiresAt: number }>();

/** Generate PKCE challenge/verifier pair */
export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.getRandomValues(new Uint8Array(32));
  const verifierB64 = Buffer.from(verifier).toString("base64url");
  const cryptoMod = require("crypto");
  const challenge = cryptoMod.createHash("sha256").update(verifierB64).digest("base64url");
  return { verifier: verifierB64, challenge };
}

/** Store PKCE verifier with state for callback */
export function storePKCE(state: string, verifier: string, userId: number) {
  pkceStore.set(state, { verifier, userId, expiresAt: Date.now() + 10 * 60 * 1000 }); // 10 min
}

/** Get and consume stored PKCE verifier */
export function consumePKCE(state: string) {
  const entry = pkceStore.get(state);
  if (entry) pkceStore.delete(state);
  return entry;
}
