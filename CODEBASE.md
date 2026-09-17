# HFMC Codebase Map

Plain-English guide to every code file, for humans and AI assistants.
**Rule: after any code change, update the relevant entry here in the same commit.**
(Keeps AI sessions short — an assistant can read this one file instead of exploring 160+ files.)

---

## What this app is

HFMC — a UAE mortgage brokerage case tracker. Three portals:

1. **Team portal** (`/`) — dashboard (analytics), leads, cases (worklist), Case 360, tasks, bulletin, calculator, reports, admin.
2. **Client portal** (`/client`) — clients log in with case number + phone last-4; see timeline, upload documents, register as new leads.
3. **Agent/partner portal** (`/agent`) — partners log in with a password; see their referred cases.

**The funnel:** Website registration or manual add → `Lead` stage (Leads tab, qualify + assign owner) → `Convert` → WhatsApp Group Creation → pipeline stages → Closed/Lost. Every case belongs to one **Client** (person); every engagement (mortgage, future buyout, insurance) links to the same client record.

## Key concepts (read before touching the data layer)

- **Client portal app-shell**: bottom tab bar (mobile) / top pills (desktop) — Journey, Docs, My Details, More. **My Details** = the client's own data sheet (identity/contact/employment/income/liabilities) that saves via `/api/client/profile` (session-bound), stamps `profileClientVerifiedAt` (staff sees "client verified" in Case 360 People) and refreshes the Client master. Advisor = `advisorId` on the case (assignable in Case 360 People; falls back to owner). Services tab previews Wills/Insurance/Property management.
- **Client portal = one login, all bank journeys**: a per-bank split creates sibling cases sharing the client's `clientId`; `/api/client/state` returns the whole engagement list and serves `?caseId=` switches only when the requested case shares that client (403 otherwise; legacy no-clientId rows match on customer+phone). The dashboard shows a journey switcher (bank + case + stage chips); stage/documents stay per bank journey.
- **Document storage is dual-path**: new uploads go to **Cloudflare R2** (`src/lib/r2.ts`, storageKey + compressedKey on CaseDocument; compress endpoint; `scripts/migrate-docs-to-r2.mjs` migrates legacy rows); rows with null storageKey still read from legacy Postgres bytes. `manageDocs` designation permission gates upload/verify/waive/delete. Admin → Storage configures the bucket (`.env`: R2_*).

- **Client master vs case profile.** `Client` = the person (KYC: EID unique > passport > phone+name; phone alone never merges). `profileJson` on each case = the applicant's snapshot *as filed* on that engagement. Saving a case profile refreshes the client master (fills gaps, never erases).
- **Co-borrower vs co-applicant** (`src/lib/case-profile.ts`): co-borrower incomes are pooled into affordability (DBR); co-applicant is title/KYC only. Both get their own Client row.
- **Fees live in two places:** `FeeRule` table = government/transfer fees (per emirate × txn type, universal). `BankProduct.feesJson` = bank charges (processing, pre-approval, early/partial settlement, valuation) — parsed/computed by `src/lib/bank-fees.ts`.
- **Fees/insurance coverage**: 85 bank products decoded; 76 carry structured feesJson/insuranceJson (scripts/sync-fees-from-axes.mjs backfills from raw axes; rerun after new imports). Products without tenorYears use the 25-year UAE norm for indicative EMIs.
- **Decision flags in the profile** (goldenVisa, islamicOnly) flow into proposals as pricing/product notes — extend these before adding one-off free-text fields.
- **Projected revenue without phantom totals**: per-bank splits each show their own commission (bank ratePct − channel cut − partner share), but consolidated numbers count every engagement once. `dedupeEngagements` (domain.ts) keys client+amount+created-day for KPIs; Reports → "Projected revenue" shows each bank scenario per client, best-case per engagement, and the excluded double-count explicitly.
- **Multiple banks at creation = one case per bank** (each bank runs its own journey/RM/TAT); the per-bank RMs come from the bank's saved contacts. Case numbers sequence from max existing (deletions no longer collide).
- **Effective-dated rate lines (the Finacle pattern)**: each quote in pricingJson carries effectiveFrom/effectiveTo (blank = always valid; 2099-12-31 = open). "Revise rate" in the quote editor copies the line with from=today and closes the old line the day before — a monthly 1bp change never touches the whole product. resolveQuote filters by an `on` date (engine + calculator fetch pass today; overlapping lines: latest effective-from wins). Rollback = "re-apply" as a new dated line, never a toggle. The calculator's stress field infers: spread filled -> follow-on + spread; else the direct ROI box; both empty -> follow-on. Follow-on accepts EIBOR+spread OR any direct ROI ("any ROI (direct)" option).
- **Whole-product versioning is RETIRED** (rate lines carry their own dates now). The editor's history table remains read-only housekeeping: view/delete old snapshot rows. Engine/calculator/proposal logic is untouched — it always selected the row valid today; the retirement only removed the *creation* UI. Channels hold RM contacts too (ChannelsTab editor); Add-lead's channel RM picker reads the channel's contacts. Nothing is hardcoded: the match engine AND the calculator fetch select the current version by the same rule (skip future-effective, skip expired, max version per product identity) — a new bank/product/version filed in Admin is automatically usable everywhere, no code change.
- **Calculator deal shape**: emirate + transaction type + property/finance values seed the Transfer-fees tab; client picker searches the Client master (name/mobile/email/EID); rate scenario section computes DBR 1·2·3 (intro / follow-on / stress) with fixed-vs-variable tabs and optional engine fetch from any bank product. **Assessment rate stays MANUAL** (typed in section 05 + load factor / manual stress in Advanced) — exactly as the original design; the scenario section and DBR dials are display-only, with an optional "Use stress (X%)" button that copies the figure only when clicked. **Eligibility working** preview panel = proposal-style printable sheet with all three DBR stages. Engine fetch tries 3y → other tenors → day-1 variable (was 3y-only, which is why only DIB fetched), keeps the product's full quote list, and **re-resolves on tenure change**: switching the fixed-term dropdown pulls that tenor's filed rate, or blanks it with a 'not filed' toast — no stale figures from a previous bank/product. **Picking a bank auto-selects its product** via a two-pass walk (strict axis match first, relaxed-with-warning only if nothing strict resolves); clearing the bank clears every fetched figure; only **approved** products are offered (drafts never fetch — approve them in Admin).
- **Tenure is age-capped at disbursement, in MONTHS**: profile carries DOB (+ `processingMonths`, default 3) → eligible tenure months = (bank maturity-age cap − age at application) × 12 − processing months, capped by the product tenor. Shown in the proposal per bank ("Eligible tenure: N months") and traced in the inspector. Bank maturity caps live in `BankProduct.maxAgeSalaried/maxAgeSelfEmp` (harvested from the hfmcqewn data; 70 default). Products without DOB fall back to manual age.
- **Rate-quote provenance**: quotes were built from three sources — deterministic rateTable parsing, DIB/ENBD raw axes, and the **curated hfmcqewn engine** (github.com/chetans-hfmc/hfmcqewn, reconciled via `scripts/reconcile-from-old-engine.mjs` with a 55-item conflict list awaiting human validation). FIXED quotes may carry `variableAfter` {basis, marginPct, floorPct} — the follow-on recipe; the schedule uses it for the after-intro/stress rates.
- **Roadmap from the old engine (hfmcqewn)**: tiered conflict resolution (promos/exceptions override base rates with precedence + effective dates), ltvMatrix by residency × property-count (first vs second property), and Findings/Remediation explainability — adopt when the engine validation demands them.
- **EIBOR table drives pricing live**: bank-match/proposals read `EiborRate` at run time — updating the ticker (ON/1W/1M/3M/6M/1Y, with effective date + editor stamp) reprices everything instantly. No auto-feed exists; editing is a deliberate manual ritual.
- **Leads are never silently destroyed**: "Lost" keeps the record with a reason (`lostReason`); hard delete exists only for admin/super to remove accidental creations.
- **Bank products are versioned** (draft → approved) and feed the **bank-match eligibility engine** → proposals (saved snapshots, draft → sent → won/lost).
- **Everything reaches the UI through one payload:** `GET /api/state` → Zustand store `useHfmcStore` (`src/lib/client-store.ts`). Mutations call an API route, then re-hydrate. There is **no URL routing** — `route` is store state; views render in `src/app/page.tsx` inside `Shell`.
- **Documents live in Cloudflare R2, not the database** (`src/lib/r2.ts`). Bucket is private; the API hands the browser a 15-minute presigned URL, so bytes never stream through the server. The `@aws-sdk/client-s3` package is only the S3 *protocol* client that Cloudflare documents for R2 — storage is 100% Cloudflare. Env-driven (`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`, read once at start-up → restart after editing): **blank keys fall back to the legacy Postgres-bytes path (4 MB cap), so the app never breaks before credentials exist.** Admin → Storage shows which key is missing, a "Copy .env block" button, vault counts, and a live **Test connection** probe (writes/reads/deletes a throwaway object).
- **Two versions of every file, human-decided** (`/api/documents/:id/compress`): upload keeps the pristine original (bank-submission grade, never touched); "Compress" builds a separate preview copy with **sharp** (images: 2000px long edge + q72) or **pdf-lib** (PDFs: object-stream re-save — modest, because scans are already compressed). Compression never auto-selects; the team sees the real saving and picks which one downloads via `selectedVersion` (`CaseDocument.selectedVersion`, chips in Doc Vault). A "compressed" file bigger than the original is discarded rather than stored. Requires R2 — the legacy blob column can't hold a second version.
- **Document writes are permission-gated** by `Designation.manageDocs` (upload / verify / reject / waive / compress / delete; `requireDocManager` in `domain.ts`, admin+super always pass). Clients can only upload to their own case's documents flagged `clientCanUpload`, and only view `visibleToClient` ones — one shared `GET /api/documents/:id/file` route serves staff and clients with those checks.

## File tree (annotated)

```
├─ prisma/schema.prisma        All DB tables (User, Designation, LoanCase, Client, Task,
│                              Activity, Instruction, Bulletin, BankItem, BankProduct,
│                              EiborRate, Proposal, DocRule, CaseDocument, FeeRule, …)
├─ scripts/backfill-clients.js One-off: created Client rows for pre-existing cases
├─ scripts/migrate-docs-to-r2.mjs  One-off: move legacy in-database files to R2
│                              (`node scripts/migrate-docs-to-r2.mjs --dry-run` first)
├─ src/data/seed/*.json        Master/demo data (banks, products, doc rules, fee rules, users…)
├─ src/lib/                    ★ Pure logic — no React
│  ├─ db.ts                    Prisma client singleton
│  ├─ auth.ts                  Team sessions (cookie), currentUser(), flagsFor(role)
│  ├─ client-auth.ts           Client-portal sessions (case number + phone last-4)
│  ├─ agent-auth.ts            Agent/partner sessions
│  ├─ types.ts                 All DTO types shared by API + UI (LoanCase, ClientDto, …)
│  ├─ ser.ts                   Serializers: Prisma row → DTO (serCase, serClient, …)
│  ├─ client-store.ts          Zustand store: state snapshot, Route type, all mutations
│  ├─ domain.ts                Visibility scoping (team/own), SLA escalation, role flags
│  ├─ format.ts                Money/date formatting, derived case status, commission calc
│  ├─ case-profile.ts          ★ CaseProfile shape (primary/property/second-party),
│  │                           co-borrower vs co-applicant affordability pooling
│  ├─ client-master.ts         ★ Client identity resolution & master sync
│  │                           (resolveClient, syncCaseClients, matchClientByPhoneName)
│  ├─ mortgage.ts              MPBF calculator engine (pure)
│  ├─ calc.ts                  Affordability engine (pure)
│  ├─ bank-pricing.ts          Rate quotes: intro/follow-on/stress EMI math
│  ├─ bank-fees.ts             ★ Bank fee parsers + calculators (processing, pre-approval,
│  │                           early/partial settlement, insurance, total cost of finance)
│  ├─ bank-match.ts            Match-engine server logic (eligibility per bank product)
│  ├─ bank-rules-taxonomy.ts   Axis-name taxonomy for decoding bank workbooks
│  ├─ bank-rules-seed-data.ts  Decoded rate-card data for seeding
│  ├─ quote-parser.ts          Deterministic rate-card text → quote drafts (confidence flags)
│  ├─ vault.ts                 Doc Vault rule engine: profile vectors → per-case checklist
│  ├─ r2.ts                    ★ Cloudflare R2 storage: r2Configured, r2Put/Get/Delete,
│  │                           presigned GET URLs (15 min), docKey() layout
│  ├─ email-match.ts           Fuzzy email subject → case matcher
│  ├─ graph.ts                 Microsoft Graph mailbox reader (app-only auth)
│  └─ seed.ts                  Seeds DB from src/data/seed/*.json (idempotent)
├─ src/app/
│  ├─ page.tsx                 Team portal root: login gate + Shell + view by store route
│  ├─ layout.tsx, manifest.ts  App shell, PWA manifest
│  ├─ proposal/page.tsx        Print-ready bank comparison page (public link)
│  ├─ client/                  Client portal (login, dashboard, store)
│  ├─ agent/                   Agent portal (login, dashboard, store)
│  └─ api/                     One folder per endpoint (route.ts each):
│     ├─ state/                ★ GET — the single hydration payload for the team portal
│     ├─ auth/  client/  agent/  Login/logout/register for the three portals
│     ├─ cases/                POST create; [id]/ PATCH update (+tasks/ POST)
│     ├─ client/register/      Portal self-registration → Lead-stage case (+ warm prefill
│     │                        for returning clients)
│     ├─ bank-match/           POST — run eligibility across bank products
│     ├─ proposals/            POST save, PATCH status
│     ├─ documents/            Ad-hoc add; PATCH (edits, verify/reject/waive,
│     │                        selectedVersion) / DELETE (+ R2 object cleanup);
│     │                        [id]/upload multipart → R2; [id]/file preview &
│     │                        download (presigned 302); [id]/compress preview copy
│     ├─ case-updates/         Daily MIS notes
│     ├─ bulletin/ instructions/ tasks/  CRUD + replies
│     ├─ email/inbound|poll|unmatched/   Mailbox webhook + review queue
│     ├─ calculator/save/      Save affordability checks
│     ├─ admin/                Generic admin CRUD (kind + payload)
│     └─ ai/ advisor|insights|doc-read/  LLM endpoints (advisor, case copilot, doc reader)
├─ src/components/
│  ├─ views/                   ★ The actual screens (see per-file index below)
│  ├─ hfmc/ui.tsx              Design system: Modal, Chip, Avatar, Seg, buttons
│  ├─ hfmc/bits.tsx            Composite widgets (WaButtons, CommissionPanel, BankChips…)
│  ├─ hfmc/charts.tsx          Tiny chart components (Spark, donut, bars)
│  ├─ hfmc/toaster.tsx         Toast host
│  ├─ icons.tsx                All inline SVG icons
│  └─ providers.tsx, sw-register.tsx  Theme provider, PWA service-worker registration
└─ worklog.md                  Historical build log (chronological; append-only)
```

## Per-file index: `src/components/views/`

| File | What it does (plain English) |
|---|---|
| `login.tsx` | Team login screen with demo seats |
| `shell.tsx` | App frame: **collapsible left panel** — 228px ↔ 68px icon rail driven by `useCollapsibleSidebar` (pin in `localStorage["hfmc.sidebar"]`, auto-collapses under 1180px, chevrons in the header *and* the brand row; collapsed = icon-only nav with tooltips, badge dots, compact SLA tile), view container fades once per route then settles (inner cascades suppressed — `.view-in`/`.settled`), no backdrop blur (opaque rail/header/nav, solid drawer scrim for WebView scroll perf), mobile drawer/bottom nav, **NewLeadModal** ("Add lead" — busy-guarded dynamic Create lead/case submit, repeat-client banner), **EIBOR ticker + editor modal** (daily ritual; permission = designation `editEibor`), nav items, SLA widget; mobile FAB is role-aware (speed dial: Add lead + New directive for task-issuing roles, direct Add lead for staff) |
| `dashboard.tsx` | Analytics: KPIs, **pipeline-by-stage funnel**, **my tasks due today**, latest activity, leads-waiting card, why-pending/waiting-for, owner load, today's directives |
| `cases.tsx` | **Cases tab — the pipeline worklist**: filter/search/sort table of all non-lead cases, click a row → Case 360 |
| `proposals.tsx` | **Proposal pipeline report** (rendered inside Reports, not a nav tab): all saved proposals across cases with status (draft/sent/won/lost), CSV export. Creation lives in Case 360: Run match → Generate |
| `leads.tsx` | Lead-stage funnel: filter, assign owner, **Qualify profile**, **Convert to case**, **Lost** (reason kept on record), **Delete** (admin only — accidental creations) |
| `case-detail.tsx` | ★ **Case 360**: header + stage pipeline; tabs = Lead & Applicant Profile / Daily MIS / Tasks / Documents / Banks & proposal / Activity; right rail = MIS, Pre-approval, FOL, AI copilot, **ClientFileCard** (client file + other engagements), commission, people |
| `case-profile-editor.tsx` | 3-tab structured profile editor (Primary incl. EID/passport KYC, Property & Finance, Co-borrower/Co-applicant). Saves `profileJson` via case PATCH |
| `daily-mis.tsx` | Daily status note panel (writes CaseUpdate) |
| `doc-vault.tsx` | Per-case document checklist (upload, verify, reject, waive, edit, delete — all gated by `manageDocs`), plus **View / Download** (presigned links), **Compress** (builds the preview copy, shows the real saving) and a send-as **original / compressed** chip pair per uploaded file |
| `bank-match.tsx` | BankMatchPanel: inputs (pre-filled from profile) → eligibility results → select → save proposal. **Rate-type selector**: Best available / Fixed-for-term (1-5y or best-of-all) / Flexible EIBOR-linked. Decision flags from the profile (Golden Visa, Sharia-only) surface here |
| `proposal-history.tsx` | Saved proposals list with status transitions + print link |
| `calculator.tsx` | Full MPBF calculator + AI Mortgage Advisor + AI Document Reader panels |
| `tasks.tsx` | Task queue across visible cases |
| `bulletin.tsx` | Morning Bulletin directives (issue, complete, drop, carry, replies) |
| `reports.tsx` | Reports: pipeline by stage, source mix, bank win rate, commission export, SLA |
| `emails.tsx` | Unmatched-email review queue + recent email log |
| `admin.tsx` | Admin: teammates, designations, banks (+products/fees editor — opens **full-screen** with "← Back to pricing"; quote rows include follow-on recipes), partners, channels, stages, masters, SLA, doc rules, fee rules, **Storage** (R2 key status + copy-env block + live connection probe + vault counts + Google Drive mirror status). The shared `Modal` component (hfmc/ui.tsx) has a `full` variant for workspace-sized editors, and all modals render through a **React portal to document.body** — without it, `fixed` overlays inside transformed ancestors (anim-fade-up cards, backdrop-blur bars) anchor to that ancestor and open "below or above" the content |
| `proposal-history.tsx`/`daily-mis.tsx` | (also embedded inside Case 360 tabs) |

## "I want to change X — which files?"

| Task | Files to touch |
|---|---|
| Add/alter a pipeline stage or master list | `src/data/seed/*.json` (data) or Admin UI; logic in `src/lib/domain.ts` |
| Case fields (new column) | `prisma/schema.prisma` → `db:push` → `src/lib/ser.ts` (serCase + PrismaCase type) → `src/lib/types.ts` → UI (usually `case-detail.tsx`) |
| Client identity / merge rules | `src/lib/client-master.ts` (single source of truth) |
| Profile fields / co-borrower math | `src/lib/case-profile.ts` + `case-profile-editor.tsx`; persistence flows through case PATCH |
| Bank eligibility & versioned pricing rules | `BankProduct` columns (`version`, `effectiveDate`, `expiryDate` defaulting to `2099-12-31`) + `src/lib/bank-match.ts` (resolves active version) + admin editor in `admin.tsx` (supports "+ Save as New Version (Next Month)") |
| Fees (bank) | `src/lib/bank-fees.ts` + `feesJson` on products (Admin → Bank products) |
| Fees (government/transfer) | `FeeRule` rows via Admin → Fee rules; shown in Calculator |
| Document storage (R2 keys, connection test) | `.env` (four `R2_*` values) → restart; status/probe UI in Admin → Storage (`src/app/api/admin/storage/route.ts`); storage client in `src/lib/r2.ts` |
| Google Drive archive (independent store) | `src/lib/drive.ts` (service-account JWT, find-or-create `{CASE-NO — Customer}/{Category}` folders, upload); wired in the upload route (best-effort, never blocks/fails uploads, app never deletes from Drive); three `GOOGLE_DRIVE_*` env values + probe in Admin → Storage |
| Document preview / download / compression | `src/app/api/documents/[id]/file/route.ts`, `[id]/compress/route.ts`; UI in `views/doc-vault.tsx` (team) and `app/client/dashboard.tsx` (client) |
| Who may touch documents | `Designation.manageDocs` (Admin → Designations toggle) + `requireDocManager` in `src/lib/domain.ts` |
| Move old database files to R2 | `scripts/migrate-docs-to-r2.mjs --dry-run`, then without the flag |
| Daily EIBOR update | Click the header ticker (needs designation `editEibor` or admin) — paste the CBUAE row verbatim (`Date  O/N  1W  1M  3M  6M  1Y  Value Date`, tab/comma separated) or type rates; publish date shows "as on" in the band, value date = effective; "Last edited" shows the true edit instant in the viewer's timezone; 6-decimal precision everywhere |
| New API endpoint | new `src/app/api/<name>/route.ts`; expose to UI via `state/route.ts` + `client-store.ts` |
| Proposal workflow | creation = Case 360 → Banks & proposal tab (Run match → Generate → Print/CSV); follow-up reporting = Reports → Proposal pipeline |
| Add RMs/contacts for a bank or partner | Admin → Banks / Partners → Edit → contact rows (name/phone/email/role, multiple). Add-lead modal auto-offers these as RM pickers; per-bank split assigns each case its RM |
| Test a product's calculation | Proposal page → **Product inspector**: pick bank + product, see every field the engine used (client inputs, bank policy, quote + source, EIBOR, computed intermediates). Missing fields show as "—" with the default applied — that's a data-gap detector |
| File follow-on rates (after fixed term) | Admin → Bank Rules → Edit product → quote row → "then [tenor] EIBOR +" + margin + floor. The engine computes after-intro/stress from it; without it the intro rate wrongly repeats after the fixed term |
| New screen/nav item | view in `src/components/views/`, add Route in `client-store.ts`, item in `shell.tsx` navItems, render in `page.tsx` |
| Left panel collapse behaviour | `src/hooks/use-collapsible-sidebar.ts` (rule: user pin > viewport), rail widths + `collapsed` markup in `shell.tsx`, `.nav-rail`/`.side-shell` in `globals.css` |
| text/contrast, hover, motion, shadows | tokens in `globals.css` `:root`/`[data-theme="dark"]` (ink-faint is AA-tuned; hover tiered + touch-guarded; prefers-reduced-motion kill-switch lives there); route-settle logic in `shell.tsx` (`viewRef`, no state) |
| Client portal | `src/app/client/*` + `src/app/api/client/*` |
| Email integration | `src/lib/graph.ts` (read), `src/lib/email-match.ts` (match), `src/app/api/email/*` |
| AI features | `src/app/api/ai/*` (advisor, insights=copilot, doc-read) |

## Performance notes

- **All store mutations re-hydrate in the background** (`get().hydrate().catch()` fire-and-forget) — the UI toasts/responds instantly; lists refresh a beat later. Don't re-add `await get().hydrate()` after mutations: with the DB far away it stalls every save for seconds.
- **DB region matters**: the Supabase project was created in Seoul (ap-northeast-2) — a single trivial query took ~2.5s from India/UAE. Migrating the project to Mumbai (ap-south-1) is the single biggest speed win available (Supabase dashboard → project migration; backup first).

## Maintenance rules

1. **Update this file in the same commit as any code change.**
2. Schema changes: `npx prisma db push` then `npx prisma generate` (no migrations folder — db push workflow).
3. **After a schema push / prisma generate, restart the dev server** — a stale server process keeps the old Prisma client in memory and `/api/state` 500s (symptoms: blank pipeline, missing Admin tab, no flags). Kill the PID on port 3000 (`netstat -ano | grep :3000`) and `npm run dev` again.
4. Verify with `npx tsc --noEmit` and `npx eslint .` before handing off.
5. **Storage keys are read once at start-up** — after editing any `R2_*` value in `.env`, restart the server or the app keeps using the old (or absent) credentials. Admin → Storage → "Test connection" proves the pasted keys work end-to-end.
6. Append narrative work to `worklog.md`; keep structural truth here.

## Roadmap (planned — in the owner's words, kept so plans survive sessions)

1. **Bank/pricing engine validation (now)** — run 1-2 days of real-file comparisons
   (engine eligibility + EMIs vs actual bank pre-approvals), sharpen missed rules.
2. **Document storage → Cloudflare R2: DONE** (private bucket, presigned links,
   preview/download, optional compressed copy, `manageDocs` permission, Admin →
   Storage with a live connection probe, one-off migration script). Remaining:
   paste the four `R2_*` keys and run `scripts/migrate-docs-to-r2.mjs` to move
   any files still sitting in the database. **Google Drive: DONE as an
   INDEPENDENT archive store** (`src/lib/drive.ts`) — when the three
   `GOOGLE_DRIVE_*` env values are set, every upload is additionally copied into
   Drive's auto-created `{CASE-NO — Customer}/{Category}` folder tree; deleting
   in the app never deletes there, Drive never touches R2, and extra files can
   be dumped into the folders by hand. It is still never the live store (no
   expiring links — clients are always served through R2/the app).
3. **Stage-by-stage SOP digitization** — for each pipeline stage: what happens,
   what communication goes out (to client/bank), stage-specific checklists.
4. **Transaction-specific branches** — e.g. a buyout adds its own steps to the
   standard flow; the stage pipeline should adapt per transaction type.
5. **Auto-fill bank application forms** — use the structured client profile +
   bank product data to pre-fill bank forms (design exists with the owner).

Ops rules at publish: GitHub = code backup (push every session); Mumbai Supabase
= sacred production DB; a free second Supabase project = rehearsal DB for big
structural changes; backup before any schema push.
