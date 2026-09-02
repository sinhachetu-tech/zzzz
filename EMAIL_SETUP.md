# Outlook email integration — setup guide

The HFMC tracker reads your shared Outlook mailbox directly via Microsoft Graph.
No Postmark, no Mailgun, no forwarding rule — the app polls the mailbox every
60 seconds, runs a fuzzy matcher on each new email, and auto-links it to a case
or queues it for review.

## What you need from Azure / Microsoft 365 admin

### 1. App registration (already created)

- **App name:** Graph TypeScript quick start
- **Client ID:** `64e8f3d9-444f-4f65-9f8e-eee80acf0b56`

### 2. Add API permissions

In Azure Portal → App registrations → your app → API permissions:

1. Click **Add a permission** → Microsoft Graph → **Application permissions**
2. Add: **Mail.Read** and **Mail.ReadWrite**
3. Click **Grant admin consent** for your tenant (a green tick must appear)

### 3. Create a client secret

In your app → **Certificates & secrets** → New client secret:

1. Give it a description (e.g. "HFMC tracker")
2. Set expiry (24 months is fine)
3. Copy the **Value** (not the Secret ID) — this goes in `GRAPH_CLIENT_SECRET`

### 4. Get your Tenant ID

In Azure Portal → App registrations → your app → Overview → **Directory (tenant) ID** — copy this.

### 5. The shared mailbox address

The email of the group inbox where bank/client emails are already CC'd
(e.g. `group@hfmc.ae`). This must be a real mailbox in your M365 tenant —
either a shared mailbox or a licensed user.

## Fill in .env

```env
GRAPH_CLIENT_ID=64e8f3d9-444f-4f65-9f8e-eee80acf0b56
GRAPH_TENANT_ID=<paste from step 4>
GRAPH_CLIENT_SECRET=<paste the secret Value from step 3>
GRAPH_MAILBOX=group@hfmc.ae
CRON_SECRET=<any long random string — for the automated cron>
```

## How it runs

- **Manual:** open the Emails tab → click **Poll Outlook now**. Runs once, shows a toast with the result.
- **Automated:** hit `GET /api/email/poll?secret=<CRON_SECRET>` every 60 seconds. On Vercel use Vercel Cron; otherwise any scheduler (`cron`, systemd timer, or even a `setInterval` in a mini-service).

## What the matcher does

For each unread email in the inbox:

- Splits the subject on `-`, `|`, `/`, `:` and tokenizes it (with stop-word filtering)
- Scores every **open** case by Jaccard similarity of customer name tokens
- Checks for known UAE bank aliases in the subject (ENBD, ADCB, FAB, DIB, Mashreq, HSBC, …)
- **Confident match** (customer ≥ 0.6 AND a bank): creates an EmailLog + an auto Task on the case (due +2 business days), marks the email read.
- **Partial / no match:** creates an UnmatchedEmail (with a best-guess caseId if there is one), marks the email read. Shows up in the **Needs review** queue on the Emails tab.
- **Dedup:** by `internetMessageId` — a message processed once is never processed again, even if it gets marked unread.

No email body is ever stored — only subject, sender, direction (bank/client/internal), and a deep link back to Outlook.
