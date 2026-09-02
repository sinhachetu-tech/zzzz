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
