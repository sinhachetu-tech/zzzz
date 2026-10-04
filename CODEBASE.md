# HFMC Codebase Map

Plain-English guide to every code file, for humans and AI assistants.
**Rule: after any code change, update the relevant entry here in the same commit.**
(Keeps AI sessions short — an assistant can read this one file instead of exploring 160+ files.)

---

## What this app is

HFMC — a UAE **consultancy**: mortgage brokerage **plus** golden-visa assistance, wills & legal, insurance, real estate and business setup. Three portals:

1. **Team portal** (`/`) — dashboard (analytics), leads, cases (worklist), Case 360, tasks, bulletin, calculator, reports, admin.
2. **Client portal** (`/client`) — clients log in with case number + phone last-4; see timeline, upload documents, register as new leads.
3. **Agent/partner portal** (`/agent`) — partners log in with a password; see their referred cases.

**The funnel:** Website registration or manual add → `Lead` stage (Leads tab, qualify + assign owner) → `Convert` → WhatsApp Group Creation → pipeline stages → Closed/Lost. Every case belongs to one **Client** (person); every engagement (mortgage, future buyout, insurance) links to the same client record.

## THE PLACEMENT RULE (read this before adding any field)

The app grew mortgage-first and then had to absorb five more service lines. Every
sprawl risk in this codebase comes from putting a field on the wrong entity, so
the rule is worth stating once:

- **Asked once per human → `Client`.** KYC, address, demographics, income, assets, liabilities. A returning customer is never re-asked (that is what `Client.personJson` + `src/lib/person-sheet.ts` are for).
- **Asked once per procedure → the Engagement** (`LoanCase`, table name deliberately unchanged). Mortgage LTV, property details, a will's beneficiaries, a visa's file number.
- **Specific to one service line → that service line's own table.**
- **Asked per bank → the bank leg** (a sibling `LoanCase` on `parentCaseId`). LTV per bank, that bank's RM, that bank's reference.
- **Never add service-specific columns to `Lead`.** A lead knows who, how to reach them, what they want and roughly how much. The moment `Lead` grows a `propertyValue` or a `visaType` column it has become a Case in all but name.

## Multi-service architecture (Phase 1 of the service-line migration)

```
Client  ── the human (KYC, address, income, assets, liabilities)
  ├── Lead        ── an expression of interest; may resolve to zero or one Client
  └── Engagement  ── LoanCase: ONE procedure through ONE product
        ├── serviceLineId → ServiceLine  (MORTGAGE | GOLDEN_VISA | INSURANCE |
        │                                  WILLS_LEGAL | REAL_ESTATE | BUSINESS_SETUP)
        ├── productId     → Product      (MORT-FIRST | GV-10 | WIL-DRAFT | …)
        └── Bank legs     ── siblings on parentCaseId, ONLY for service lines with
                             bankRaced = true (today: mortgage only)
```

- **`ServiceLine`** = what kind of business (`prisma/schema.prisma`). `code` is the stable contract used in code + backfills — never rename one, add a new one. **`bankRaced` is the load-bearing flag**: a multi-bank application is a competitive race with exactly one winner; a will has no legs.
- **`Product`** = the specific offering within a line. This layer was missing and the old vocabulary conflated the two.
- **`StageSet` → `StageItem` → `StageStep`** is now per-service-line. Before this, `StageItem` was global and the 5 mortgage stages were hardcoded in `src/lib/workflow/registry.ts`, so every case of every service had to walk the mortgage pipeline. A golden visa will run `Documents → Application → Visa issued → Emirates ID` — it shares zero vocabulary with FOL booking. `LEGACY_MAP` keeps the 5 mortgage labels resolving.
- **`DocRule.serviceLineId` / `SlaRule.serviceLineId` / `CommTemplate.serviceLineId`** exist for the same reason: the property/transaction/residency axes on `DocRule` are all mortgage vocabulary, so without this axis a will would be handed a mortgage checklist.
- **`Lead.serviceLineId` is REQUIRED** — a consultancy selling six services cannot answer "how many leads do we have?" without it. `Lead.firstContactedAt` (not `createdAt`) starts the SLA clock, because the metric a manager wants is "leads going quiet", not "leads arriving long ago". `status` distinguishes `Lost` (real interest, didn't convert) from `Invalid` (spam/wrong number/duplicate) — conflating them understates conversion rate.
- **Bank legs are a competitive set, not parallel work** (Phase 2). `LoanCase.legStatus` = `Active | Won | LostRace | Declined | Withdrawn` exists because `caseStatus: Lost` means "we lost the business", which is NOT what happened to the Emirates leg when Mashreq won. Many pre-approvals, one FOL, one loan taken.
- **`scripts/audit-bank-legs.mjs` (read-only)** measures the legacy damage from the absence of `legStatus`. Phase 0 result: 0 phantom legs, 9 unsplit legacy rows — so the gap was latent, not yet costing money.

### Migration scripts (all additive, dry-run by default)

| Script | Purpose |
|---|---|
| `scripts/audit-bank-legs.mjs` | READ-ONLY. Reports legs still live on a won deal, >1 booked leg, wonBank conflicts, unsplit legacy rows. `--json` for machine output |
| `scripts/phase1-gen-sql.cjs` | Regenerates `prisma/phase1_service_lines.sql` by diffing the LIVE db against the datamodel, and fails if any destructive statement appears |
| `scripts/phase1-apply.cjs` | Applies that SQL via `prisma db execute`, then verifies tables/columns/FKs and that row counts are unchanged |
| `scripts/seed-service-lines.cjs` | Seeds the 6 service lines + 24 products. Idempotent (`ON CONFLICT DO NOTHING` on `code`) |
| `scripts/backfill-service-line.cjs` | Assigns every existing row to MORTGAGE + creates the "Mortgage journey" StageSet. Never guesses `productId` (null = "not classified yet") |

> ⚠️ **Do NOT run `prisma migrate dev` against this database.** There is no
> migration history (`prisma/migrations` has no `migration_lock.toml` — the DB was
> created with `prisma db push`), so migrate dev reports drift and offers to
> **reset the public schema**, which drops every table and loses all data. Use the
> diff + `prisma db execute` path instead (see `scripts/phase1-gen-sql.cjs`).

## Key concepts (read before touching the data layer)

- **Client portal login**: full-screen Dubai skyline (public/dubai-login.jpg, Unsplash license) with a slow Ken Burns drift; SOLID theme-aware form card + chips (no transparency — readability over glass); photo brightened (brightness 1.16 / saturate 1.22) with a light edge vignette; floating theme toggle (light/dark) on login AND in the portal header.
- **Client portal app-shell**: bottom tab bar (mobile) / top pills (desktop) — Journey, Docs, My Details, More. **My Details** = the client's own data sheet (identity/contact/employment/income/liabilities) that saves via `/api/client/profile` (session-bound), stamps `profileClientVerifiedAt` (staff sees "client verified" in Case 360 People) and refreshes the Client master. Advisor = `advisorId` on the case (assignable in Case 360 People; falls back to owner). The Journey tab's advisor card ("Your dedicated advisor" + Ask) shows the admin-paired name+WhatsApp — see the pairing rule under Portal settings below — and the More tab reuses it. Services tab previews Wills/Insurance/Property management.
- **Client portal = one login, all bank journeys**: a per-bank split creates sibling cases sharing the client's `clientId`; `/api/client/state` returns the whole engagement list and serves `?caseId=` switches only when the requested case shares that client (403 otherwise; legacy no-clientId rows match on customer+phone). The dashboard shows a journey switcher (bank + case + stage chips); stage/documents stay per bank journey.
- **Agent portal = 5-tab app-shell** (home / add lead / my leads / tools / profile; store route, no URL routing — same pattern as team portal). **Tools are UAE-universal only** (`src/lib/agent-mortgage.ts`): CBUAE LTV matrix (nationality × property count × big-ticket, minus txn deductions), 50% DBR, 5% card-limit repayment, age-capped tenure — deliberately NOT the staff engine (no products/quotes/policy overrides); sliders, not forms. Partner profile fields live on `PartnerItem` (email/phone/about/expertise/iban+verified/licenseNo+verified/avatarData); editing IBAN/licence resets the verified stamp for the finance team to re-verify. `/api/agent/rates` sanity-bounds quotes to 0.5–15% so mis-parsed engine rows never reach agents. Account delete = soft (`active=false`); referred cases and commission history are retained by the team.
- **Portal settings are admin-decided** (`AppSetting` key-value table, `src/lib/portal-settings.ts`, Admin → Workflow → Portal settings): `clientPortalAdvisorId` = the advisor a client sees when their case has none (falls back case advisor → this setting → case owner), `clientFacingUserId` = the **senior staff member whose name + WhatsApp PAIR fronts every client's advisor card** (juniors run files, seniors take the calls), `clientPortalWhatsapp` = free-text fallback number when no facing staff is picked and the case advisor has no number, `agentDeskUserId` = the staff member fronting the agent desk card (falls back to legacy `agentDeskName`/`agentDeskPhone` free text; empty hides the button). `/api/admin/settings` (GET any teammate, PUT admin/super).
- **Staff WhatsApp + the client "Ask" card — name and number are ALWAYS one paired pair from a single staff record** (never a mixed "junior name + senior number"). Each staffer's number lives on `User.phone` (editable in Admin → Teammates). The client portal advisor card resolves in `/api/client/state`: ① the case's assigned advisor — but only if they have a `User.phone` (juniors without numbers are auto-masked) → ② the admin-picked `clientFacingUserId` senior → ③ default advisor/owner (with phone) → ④ `clientPortalWhatsapp` free-text fallback. The card shows the resolved person's name AND their number. Agent desk card uses the same pairing via `agentDeskUserId`. Per-case fronting = assign the senior as the case's advisor (New Case modal "Client-facing advisor" or Case 360 → People); `/api/cases` POST and PATCH accept `advisorId`.
- **Backup 1 / Backup 2 = leave continuity, and the assignment IS the authorization.** `LoanCase.backup1Id`/`backup2Id` (picked in the New Case modal — B2 excludes B1's pick, both exclude the owner — and editable in Case 360 → People, admin/owner/super). `visibleCases()` in `src/lib/domain.ts` includes backups at every scope, so a backup can open and fully work the file the moment they're assigned (no handover step); everything they do is logged under their own `userId` (stage transitions, activities, case updates). Reports → "Backup coverage" table lists every visible file with Owner / B1 / B2 / coverage chip (fully / partly / no backup), uncovered-first, with CSV export.
- **Qualify round-trip + quick proposal**: `serCase` DID NOT serialize `profileJson` — saves landed in the DB but every read dropped them, so the qualify editor (Leads modal AND Case 360) reopened empty. Fixed in `ser.ts`; `updateCase` in the store now throws on `!res.ok` instead of toasting success on failure. The qualify editor itself ends with a **Generate proposal** block (below the decision flags): it saves the profile, runs `/api/bank-match` with exactly the captured inputs, shows the ranked shortlist with checkboxes, and hands off to the print-ready `/proposal` page — no need to retype anything in Case 360 → Banks & proposal. Proposal lifecycle statuses mean: draft = generated/not shared, sent = with the client (date-stamped, counts in the "awaiting client" chip), won/lost = outcome (feeds Reports → Proposal pipeline).
- **Document storage is dual-path**: new uploads go to **Cloudflare R2** (`src/lib/r2.ts`, storageKey + compressedKey on CaseDocument; compress endpoint; `scripts/migrate-docs-to-r2.mjs` migrates legacy rows); rows with null storageKey still read from legacy Postgres bytes. `manageDocs` designation permission gates upload/verify/waive/delete. Admin → Storage configures the bucket (`.env`: R2_*).
- **Google Drive archive targets My Drive OR a Shared Drive** (`src/lib/drive.ts`). `GOOGLE_DRIVE_IMPERSONATE` picks the mode: blank = plain service account (Shared Drive — add the SA to the drive as *Content manager*); set to a Workspace mailbox = domain-wide-delegation impersonation, which is **required for a personal My Drive** because a bare service account has 0 bytes of quota there (`storageQuotaExceeded`). The `sub` claim is added to the RS256 JWT only when impersonating. All Drive calls carry `supportsAllDrives=true` (+ `includeItemsFromAllDrives` on `files.list`) so one code path serves both spaces. `driveTestConnection()` reads the root folder's `driveId` — absent ⇒ My Drive — and the Admin → Storage panel reports which space it resolved to plus the owner, so a misconfigured target is visible instead of silent.

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
- **Microsoft Graph (Outlook send-mail) — delegated per-user**: each staff connects their own Outlook (`GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_REDIRECT_URI` in `.env`). PKCE auth code flow → tokens stored per User (`graphAccessToken`, `graphRefreshToken`, `graphTokenExpiresAt`, `graphConnectedAt`). Admin consents once for org; user clicks "Connect Outlook" once. Email sent via `POST /api/graph/send` with vault doc attachments (R2 → base64 → Graph `fileAttachment`). Appears in user's Sent Items. Requires `Mail.Send` delegated permission on app registration.
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
│  │                           co-borrower vs co-applicant affordability pooling,
                           canonical property classification fields + backfill/sanitize
│  ├─ client-master.ts         ★ Client identity resolution & master sync
│  │                           (resolveClient, syncCaseClients, matchClientByPhoneName)
│  ├─ mortgage.ts              MPBF calculator engine (pure)
│  ├─ agent-mortgage.ts        Agent-portal tools: UAE-universal (CBUAE) LTV/DBR/
│  │                           tenure/EMI/cash-to-close math — sliders-friendly
│  ├─ portal-settings.ts       AppSetting read/write: client-portal default advisor,
│  │                           client-facing senior (name+number pair), agent-desk
│  │                           staff + free-text fallbacks (admin-decided)
│  ├─ notification-settings.ts ★ Read/write all notification & email-provider config
│  │                           from AppSetting (email provider, channel toggles per
│  │                           audience, event triggers, chat retention, sound)
│  ├─ email.ts                 Outbound email sender — supports Resend (API) and
│  │                           SMTP (nodemailer). Never throws; reads admin config.
│  │                           Includes chatEmailHtml() for chat notification emails
│  ├─ calc.ts                  Affordability engine (pure)
│  ├─ bank-pricing.ts          Rate quotes: multi-axis sets (txns/segments/residency/
│  │                           employment/nationality/emirates/FTV bands), specificity
│  │                           ranking, intro/follow-on/stress EMI math
│  ├─ bank-fees.ts             ★ Bank fee parsers + calculators (processing incl. slabs +
│  │                           early/partial settlement, insurance, total cost of finance)
│  ├─ bank-match.ts            Match-engine server logic (eligibility per bank product,
                           Tier-4 promotion overlay, multi-axis quote resolution)
│  ├─ bank-rules-taxonomy.ts   Axis-name taxonomy + applicability sets + property-
│  │                           classification enums + fixed-year expansion
│  ├─ bank-rules-seed-data.ts  Decoded rate-card data for seeding
│  ├─ quote-parser.ts          Deterministic rate-card text → quote drafts (year-range
│  │                           expansion, multi-txn context, FTV bands, confidence flags)
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
│  ├─ agent/                   Agent portal: login + 5-tab app-shell (home /
│  │                           addlead / leads / tools / profile) + store route
│  └─ api/                     One folder per endpoint (route.ts each):
│     ├─ state/                ★ GET — the single hydration payload for the team portal
│     ├─ auth/  client/  agent/  Login/logout/register for the three portals
│     │                         (agent/ also: profile PATCH, password POST,
│     │                         account DELETE (soft), rates GET)
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
│     │  ├─ notification-settings/ GET/PUT notification & email config
│     │  ├─ devices/           GET all registered PWA devices, DELETE revoke
│     │  └─ chat-purge/        POST manual message purge (retention-based)
│     ├─ me/notification-prefs/ GET/PUT personal notification preferences
│     └─ ai/ advisor|insights|doc-read/  LLM endpoints (advisor, case copilot, doc reader)
├─ src/components/
│  ├─ views/                   ★ The actual screens (see per-file index below)
│  ├─ case/                    Case 360 modular components (CaseCommandBar, CaseTabBar,
│  │                           StageRail, OverflowMenu, CaseDetailsSheet, ProfileStrip,
│  │                           CollectPanel, StageDrawer, StageFields, ContactBits,
│  │                           CommButton, stage-parts (exports `CaseTab` union — the
│  │                           canonical tab type; always import from here, never
│  │                           re-declare the union), useStageLive)
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
| `shell.tsx` | App frame: **collapsible left panel** — 228px ↔ 68px icon rail driven by `useCollapsibleSidebar` (pin in `localStorage["hfmc.sidebar"]`, auto-collapses under 1180px, chevrons in the header *and* the brand row; collapsed = icon-only nav with tooltips, badge dots, compact SLA tile), view container fades once per route then settles (inner cascades suppressed — `.view-in`/`.settled`), no backdrop blur (opaque rail/header/nav, solid drawer scrim for WebView scroll perf), mobile drawer/bottom nav, **NewLeadModal** ("Add lead" — busy-guarded dynamic Create lead/case submit, repeat-client banner), **EIBOR ticker + editor modal** (daily ritual; permission = designation `editEibor`), nav items, SLA widget; mobile FAB is role-aware (speed dial: Add lead + New directive for task-issuing roles, direct Add lead for staff). The **New Case modal** captures who fronts the file at intake: **Client-facing advisor** (senior shown on the client's Ask card → `advisorId`) and **Backup 1 / Backup 2** (leave coverage → `backup1Id`/`backup2Id`; B2 excludes B1's pick, both exclude the owner) |
| `dashboard.tsx` | **Role-based home**: frontline designations (label containing SPO/VRM, incl. Team Leaders) get a **My Day** strip first — greeting, overdue/due-today/new-lead counts, their own open tasks by exact due instant with inline Open + ✓ Done (`completeTask`); everyone else goes straight to the analytics: KPIs, **pipeline-by-stage funnel**, **my tasks due today**, latest activity, leads-waiting card, why-pending/waiting-for, owner load, today's directives |
| `cases.tsx` | **Cases tab — the pipeline worklist**: saved-view pills (My overdue / High value >1M / No action 3d+ / Unassigned + Clear ×), filter/search/sort, filters persisted to `localStorage["hfmc.casesFilters"]`, click a row → Case 360. Below `sm` the 10-column table is replaced by a **card list** (no horizontal scroll) |
| `proposals.tsx` | **Proposal pipeline report** (rendered inside Reports, not a nav tab): all saved proposals across cases with status (draft/sent/won/lost), CSV export. Creation lives in Case 360: Run match → Generate |
| `leads.tsx` | Lead-stage funnel: filter, assign owner, **SLA age chip** (⏱ mint <24h / amber 1–3d / coral 3d+, stale-first ordering so the oldest un-nudged lead is on top), **Qualify profile**, **Convert to case**, **Lost** (reason kept on record), **Delete** (admin only — accidental creations) |
| `case-detail.tsx` | ★ **Case 360** — **restructured** to one header / one stage line / four tabs. Reading order: (1) **`CaseCommandBar`** (`.case-stickybar`) — the ONLY place identity appears: back, case no, state/status/stage chips, customer, amount/banks/owner/VRM, icon-only contact actions (call / WhatsApp / email), folded secondary chips, opened-date + SLA, **one primary button whose label is the top-ranked blocker** from `src/lib/case-blockers.ts`, ghost Task / Move / Details, an `OverflowMenu` holding Bank match, Vault, Chat, Activity, Set outcome and Delete (coral + rule-separated), and a single blocker strip naming what is owed. (2) **`StageRail`** — one line (`Stage 3/5 · Valuation · VRM ›`), reached/current/upcoming dots, SLA chip, prev/next buttons; the current stage opens `StageDrawer.tsx` (Now / To-do / Procedure / Actions), mounted here so it is reachable from every tab. (3) **`CaseTabBar`** — four primaries + `More`: **Now** (nudge-for-the-overdue-task + Tasks with waitingFor quick-filter chips All/Client/Bank/Internal/Urgent + Instructions + Daily MIS) / **Client** (ProfileStrip + `CaseProfileEditor` + the bank-application data sheet — one person, one tab) / **Documents** (`CollectPanel` + `DocVault`) / **Money** (`BankMatchPanel`, `ProposalHistory`, `CommissionPanel`, stage-conditional Pre-approval + FOL, `MisPanel` bank tracking); **Chat** and **Activity** are real tabs reached through `More`. **Tab state lives in the URL hash** (`#/documents`; read in the state initialiser, written with `replaceState`, `hashchange` honoured) so refresh, Back and shareable links all work. **`CaseDetailsSheet`** replaces the old persisted 340px inspector: a right slide-over (one `Details` button, Esc / scrim / ✕, body scroll locked) with People / Client / Assistant groups; `PeoplePanel` owns owner, VRM, bank RM, co-applicant, advisor, backups, partner and the client channel overrides. **No `localStorage["hfmc.caseInspectorOpen"]` any more.** |
| `case-profile-editor.tsx` | 3-tab structured profile editor (Primary incl. EID/passport KYC, Property & Finance, Co-borrower/Co-applicant) supporting external `initialTab` deep-linking with a **numbered progress stepper** above the tabs (amber = current, mint ✓ = done). Property tab = **5 plain-language classification questions** (property type, conditional commercial subtype, status→separate stage+construction, dealing-with, existing mortgage) writing canonical dims to profileJson + case row. Saves `profileJson` via case PATCH |
| Admin → Banks & rates → product → Pricing quotes | Quote rows carry a collapsible **"applies to" multi-axis editor** (transactions, STL/NSTL, residency, employment, financeType, loanKind, segments, emirates, nationality ALLOW/DENY lists) + FTV ≤/> band inputs + full tenor list (1-20y). Blank axes = matches all — the same sets semantics the engine resolves with |
| `daily-mis.tsx` | Daily status note panel (writes CaseUpdate) |
| `doc-vault.tsx` | Per-case document checklist (upload, verify, reject, waive, edit, delete — all gated by `manageDocs`), plus **View / Download** (presigned links), **Compress** (builds the preview copy, shows the real saving) and a send-as **original / compressed** chip pair per uploaded file. **New**: multi-select with bulk actions — **Merge to PDF** (drag-to-reorder visual modal, originals preserved), **Convert to PDF** (inline JPG→PDF conversion on image rows, replaces file in vault), **Download as ZIP** (for email attachment). |
| `bank-match.tsx` | BankMatchPanel: inputs (pre-filled from profile) → eligibility results → select → save proposal. PROMO BADGES (🎉 + dates tooltip) on any result the Tier-4 overlay discounted. **Rate-type selector**: Best available / Fixed-for-term (1-7/10/15/20y or best-of-all-terms) / Flexible EIBOR-linked. Decision flags from the profile (Golden Visa, Sharia-only) surface here |
| `proposal-history.tsx` | Saved proposals list with status transitions + print link |
| `calculator.tsx` | Full MPBF calculator + AI Mortgage Advisor + AI Document Reader. **Three-ROI model**: ROI 1 intro/fixed (payable), ROI 2 follow-on (payable), ROI 3 stress (qualification only, never payable) — the engine qualifies at `MAX(ROI 1/2/3)` so DBR 3 sits on the ceiling by construction. Headline is **MAX ELIGIBLE = MIN(DBR, LTV)**, finance sought printed as a reference. Buttons: `View` (`/calc-print`), `Export Excel` (9-sheet workbook with live PV/PMT/MIN formulas), `Print / Save PDF` (`?print=1`). The form mirrors to `localStorage["hfmc_calc_form"]` and re-seeds in the `useState` initialisers. **Reset** button clears to a truly blank state via `blankInput()` (src/lib/mortgage.ts) — property value, requested amount, rate, and DOB all empty/zero. **Virtual DBR at requested amount**: when `maxEligible = 0` (current DBR > 50%), the three dials show virtual DBR at the client's requested finance amount (e.g., DBR 1 = 48%, DBR 2 = 49%, DBR 3 = 51%) so advisors can see the per-ROI impact even when no eligibility exists. Official DBR on `maxEligible` shown in amber for reference. Print view and Excel export include virtual DBRs. |
| `tasks.tsx` | Task queue across visible cases |
| `bulletin.tsx` | Morning Bulletin directives (issue, complete, drop, carry, replies) |
| `reports.tsx` | Reports hub. **Head command** card (scope `all` / admin / super only): SLA breaches, no-action 7d+, stale leads with drill rows (Open case, inline lead reassign via `updateCase`) + **Morning brief** (copies a WhatsApp summary). **Business volume** — interactive monthwise/yearwise chart: year selector (derived from case data), Booked/Pipeline/Commission metric × AED/Count unit toggles, 12 CSS bars with hover titles, click-to-drill case list, YoY %, best month, **Board-pack CSV**. **New insight cards**: Lost analysis (reason × count/value), Lead funnel (fresh/aging/stale + jump to Leads), Team pulse (per-team live/overdue/booked volume), Revenue forecast (pipeline net × historic hit rate, revenue roles only). Plus the originals: pipeline by stage, source mix, bank win rate, commission export, SLA, proposal pipeline, partner roster, **Backup coverage** (every visible file with Owner / Backup 1 / Backup 2 / fully-partly-no chip, uncovered-first, CSV export — pairs the leave-continuity workflow). View preference persists to `localStorage["hfmc.volumeView"]` |
| `emails.tsx` | Unmatched-email review queue + recent email log |
| `admin.tsx` | Admin: teammates, designations, banks (+products/fees editor — opens **full-screen** with "← Back to pricing"; quote rows include follow-on recipes), **Promotions** (Tier-4 override campaigns: product + rate discount bps + processing-fee override + valuation waiver + dates, never touches base pricing), partners, channels, stages, masters, SLA, doc rules, fee rules, **Storage** (R2 key status + copy-env block + live connection probe + vault counts + Google Drive mirror status), **Notifications** (email provider config — Resend or SMTP, channel toggles per audience staff/client/agent, per-event triggers, chat retention mode + manual purge, sound config), **Devices** (registered PWA device list with type/browser/push/owner + revoke). Two-level nav: GROUPS row on top (Team & Access, Marketplace, Workflow, Docs & Fees, Settings), tabs within. The shared `Modal` component (hfmc/ui.tsx) has a `full` variant for workspace-sized editors, and all modals render through a **React portal to document.body** — without it, `fixed` overlays inside transformed ancestors (anim-fade-up cards, backdrop-blur bars) anchor to that ancestor and open "below or above" the content. **API envelope rule**: `/api/admin/notification-settings` returns `{ settings }` and `/api/admin/devices` returns `{ devices }` — the tabs MUST unwrap them (`d.settings ?? d`, `Array.isArray(d) ? d : d.devices`), otherwise every toggle reads `undefined` (shows OFF) and Save appears to work but persists nothing. Toggles only change local state — a **dirty flag** (`saved` snapshot vs current cfg) shows "unsaved changes" and enables the Save button, so a tick is never mistaken for a save. Helpers `NotifToggle`/`NotifInput` are module-level on purpose (in-render component defs trip react-hooks/static-components) |
| `proposal-history.tsx`/`daily-mis.tsx` | (also embedded inside Case 360 tabs) |

## "I want to change X — which files?"

| Task | Files to touch |
|---|---|
| Add/alter a pipeline stage or master list | `src/data/seed/*.json` (data) or Admin UI; stage behaviour in `src/lib/workflow/` (registry + stages/*) — DB owns labels/order, code owns keys/sub-steps/gates |
| Case-360 journey / stage drawer / transfer branch | `src/lib/workflow/registry.ts` + `stages/*.ts`, UI in `src/components/case/` (StageRail, StageDrawer, stage-parts, useStageLive, CommButton) |
| "What is blocking this case?" / the header's primary CTA | `src/lib/case-blockers.ts` (`computeCaseBlockers` — pure projection of tasks, documents, instructions, data-sheet gaps and today's update, ranked; **stores nothing**, so it cannot drift from the tab bodies). Consumed by `CaseCommandBar` (primary button label + blocker strip) and `case-detail.tsx` (the overdue-task nudge link). Each blocker carries the `CaseTab` that can clear it. |
| **Task completion feels slow** | `src/lib/client-store.ts` — `completeTask` / `reopenTask` / `deleteTask` are the ONLY mutations that patch local Zustand state instead of calling `hydrate()`. They apply optimistically on click, reconcile with the `task` the PATCH already returns, and **now throw on failure** (every caller has a `catch` + error toast). `reconcileTask(id)` re-reads one row to roll back a rejected write. `/api/state` returns every case, doc, chat message and product, so re-hydrating to tick one checkbox froze the UI for the whole workspace round-trip. A trailing `hydrate()` still runs off the critical path to pick up side effects (the activity row). In Case 360 the tick is one click; the ✎ beside it opens the optional-note modal. |
| WhatsApp/email/call wording per stage | `CommTemplate` table (seeded from `src/data/seed/commTemplates.json`, create-if-missing by key) + Admin → Docs & Fees → **Templates** CRUD; exposed via `/api/state` as `commTemplates`; stage files hold only template keys; `src/lib/workflow/comms/render.ts` fills `{{vars}}` (missing → —) |
| Case fields (new column) | `prisma/schema.prisma` → `db:push` → `src/lib/ser.ts` (serCase + PrismaCase type) → `src/lib/types.ts` → UI (usually `case-detail.tsx`) |
| Stage-timeline capture (valuation/FOL/settlement dates, DDA) | `LoanCase.valuationInitiatedDate, inspectionDate, valuationReportDate, folConversionDate, folSignedDate, ddaActive, liabilityLetterDate, settlementDate, transferDate, titleDeedDate` → captured inline by `src/components/case/StageFields.tsx` (writes via case PATCH). The API blocks `folSignedDate` unless `folConversionDate` exists (4.1 → 4.4 rule). Drawer ticks read these fields first, daily-note sniffing is the fallback (~detected) |
| Client identity / merge rules | `src/lib/client-master.ts` (single source of truth) |
| Property classification (human questions → canonical dims) | `src/lib/case-profile.ts` (canonical fields + `backfillCanonicalProperty` + `sanitizeCanonicalProperty`) → LoanCase row columns (validated in cases PATCH: subtype NULL unless COMMERCIAL, UNKNOWN never guessed) → profile editor Property tab (5 plain questions, conditional commercial subtype, stage≠construction) |
| Promotions / bonanzas (Tier-4 overlay) | `Promotion` model (never touches base pricing, date-self-expiring) + `bank-match.ts` overlay (rate bps cut on intro only, PF override, valuation waiver, `promo` surfaced on match results) + Admin → Marketplace → Promotions |
| Bank eligibility & versioned pricing rules | `BankProduct` columns (`version`, `effectiveDate`, `expiryDate` defaulting to `2099-12-31`) + `src/lib/bank-match.ts` (resolves active version) + admin editor in `admin.tsx` (supports "+ Save as New Version (Next Month)") |
| Fees (bank) | `src/lib/bank-fees.ts` + `feesJson` on products (Admin → Bank products). `processingFeePct/Aed` accept an optional loanAmount so **slabbed schedules** resolve; `componentSplit` prices buyout+equity per-portion |
| Fees (government/transfer) | `FeeRule` rows via Admin → Fee rules; shown in Calculator |
| Document storage (R2 keys, connection test) | `.env` (four `R2_*` values) → restart; status/probe UI in Admin → Storage (`src/app/api/admin/storage/route.ts`); storage client in `src/lib/r2.ts` |
| Google Drive archive (independent store) | `src/lib/drive.ts` (service-account JWT, find-or-create `{CASE-NO — Customer}/{Category}` folders, upload); wired in the upload route (best-effort, never blocks/fails uploads, app never deletes from Drive); three `GOOGLE_DRIVE_*` env values + probe in Admin → Storage |
| Document preview / download / compression | `src/app/api/documents/[id]/file/route.ts`, `[id]/compress/route.ts`; UI in `views/doc-vault.tsx` (team) and `app/client/dashboard.tsx` (client) |
| Document merge to PDF (drag-to-reorder) | `src/app/api/documents/merge/route.ts` (POST — merges multiple docs into one PDF using pdf-lib); UI in `doc-vault.tsx` (multi-select → bulk bar → visual reorder modal with ↑/↓/remove) |
| Image to PDF conversion (inline) | `src/app/api/documents/[id]/convert-to-pdf/route.ts` (POST — sharp + pdf-lib); UI in `doc-vault.tsx` (per-image "→ PDF" button, replaces file in vault) |
| Bulk download as ZIP for email | `src/app/api/documents/download-zip/route.ts` (POST — creates ZIP via jszip); `src/app/api/documents/zip-file/route.ts` (GET — serves ZIP); UI in `doc-vault.tsx` (single ZIP button in bulk bar) |
| Microsoft Graph (Outlook send-mail) — connect/send | `src/app/api/graph/auth/connect|callback|disconnect|status/route.ts`, `src/app/api/graph/send/route.ts`; `src/lib/graph.ts` (PKCE, token refresh, sendMail); User model stores tokens; client-store: `graphConnect`, `graphSendMail` |
| Who may touch documents | `Designation.manageDocs` (Admin → Designations toggle) + `requireDocManager` in `src/lib/domain.ts` |
| Move old database files to R2 | `scripts/migrate-docs-to-r2.mjs --dry-run`, then without the flag |
| Merge documents with visual reorder | Select checkboxes in Doc Vault → "Merge to PDF" → drag-to-reorder modal (`doc-vault.tsx` MergeModal) |
| Convert JPG to PDF inline | Per-image "→ PDF" button in Doc Vault row (`doc-vault.tsx` onConvertImageToPdf) |
| Send vault docs via Outlook (Graph) | User connects once (`/api/graph/auth/connect`) → select docs → "Send via Outlook" → enters recipients → sends from their mailbox |
| Microsoft Graph delegated auth setup | `.env`: `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_REDIRECT_URI`; Entra ID app: `Mail.Send` delegated + admin consent |
| Daily EIBOR update | Click the header ticker (needs designation `editEibor` or admin) — paste the CBUAE row verbatim (`Date  O/N  1W  1M  3M  6M  1Y  Value Date`, tab/comma separated) or type rates; publish date shows "as on" in the band, value date = effective; "Last edited" shows the true edit instant in the viewer's timezone; 6-decimal precision everywhere |
| New API endpoint | new `src/app/api/<name>/route.ts`; expose to UI via `state/route.ts` + `client-store.ts` |
| Proposal workflow | creation = Case 360 → **Money** tab (Run match → Generate → Print/CSV); follow-up reporting = Reports → Proposal pipeline |
| Role-based home (My Day vs analytics) | `dashboard.tsx` — `isFrontline` is derived from the designation label containing `spo`/`vrm`; the strip renders before the analytics grid and reuses `completeTask` + `nav` |
| Business volume chart (months, metrics, YoY, drill, CSV) | `reports.tsx` — `volBuckets`/`volVal`/`volYearTotal` in the main component, rendered in the "Business volume" `ReportCard`; `downloadCSV` for the board pack; preference in `localStorage["hfmc.volumeView"]`. Buckets build from `visibleCases()` so scoping is automatic. **Booked months use `closedDate ?? updatedAt`** — add a real `bookedAt` column (schema → `ser.ts` → `types.ts`) for exact month attribution |
| Head command alerts + Morning brief | `reports.tsx` → `HeadCommand()` (self-contained: recomputes escalations via `computeEscalations`, no-action via `caseStatusOf`, stale leads via `ageDays`) — gated by `isHead` = `flags.super \|\| flags.admin \|\| flags.scope === "all"` |
| Saved worklist views (Cases) | `cases.tsx` — `SAVED_VIEWS` array + `activeView`; persistence in `localStorage["hfmc.casesFilters"]` |
| Global search + keyboard shortcuts | `shell.tsx` (⌘/Ctrl+K toggle, single-key map, `?` help modal) + `command-bar.tsx` (Recent group in `localStorage["hfmc.recentCases"]`) |
| Virtual DBR at requested amount (when maxEligible = 0) | `src/lib/mortgage.ts` — `virtualDbrAtRequested1/2/3` fields + calculation; `calculator.tsx` dials auto-switch; `src/app/calc-print/page.tsx` table + verdict; `src/lib/calc-xlsx.ts` Working + What-if sheets; `src/lib/calc-print-model.ts` WhatIfRow type |
| Three-ROI qualification (intro / follow-on / stress) | `src/lib/mortgage.ts` — `MortgageInput.roi1Pct/roi1Years/roi2Pct/roi3Pct`; `computeMortgage` qualifies at `MAX(ROI 1/2/3)` and returns `roi`, `qualifyingRate`, `qualifyingBindsRoi`, `maxEligible`, `emi1/2/3`, `dbr1/2/3`. UI and print READ these; nothing recomputes them. `roi1Pct`/`roi2Pct`/`roi3Pct` travel with `calcInput` in `calculator.tsx` |
| MAX ELIGIBLE vs final MPBF | `maxEligible` = `MIN(DBR capacity, LTV capacity)` — the client's ask is NOT a cap. `finalMpbf` still applies the requested cap for backward compatibility. Headline, trail and What-if gains all use `maxEligible` |
| Printed assessment / View / Print | `src/app/calc-print/page.tsx` (reads `localStorage["hfmc_calc_print"]`, `?print=1` auto-prints, `Summary | Full` toggle) + `src/lib/calc-print-model.ts` (pure document assembler: amortisation + obligation What-if with gains bolded/promoted, `noGain` when LTV binds) + `amortizationYears` in `mortgage.ts` |
| Excel workbook | `src/lib/calc-xlsx.ts` — 9 sheets; **Working** uses live `PV`/`PMT`/`MIN`/`FLOOR` formulas against B4..B12 inputs; Amortisation sheets are monthly on ROI 1 → ROI 2 and a stressed ROI 3 variant |
| Add RMs/contacts for a bank or partner | Admin → Banks / Partners → Edit → contact rows (name/phone/email/role, multiple). Add-lead modal auto-offers these as RM pickers; per-bank split assigns each case its RM |
| Test a product's calculation | Proposal page → **Product inspector**: pick bank + product, see every field the engine used (client inputs, bank policy, quote + source, EIBOR, computed intermediates). Missing fields show as "—" with the default applied — that's a data-gap detector |
| File follow-on rates (after fixed term) | Admin → Bank Rules → Edit product → quote row → "then [tenor] EIBOR +" + margin + floor. The engine computes after-intro/stress from it; without it the intro rate wrongly repeats after the fixed term |
| New screen/nav item | view in `src/components/views/`, add Route in `client-store.ts`, item in `shell.tsx` navItems, render in `page.tsx` |
| Left panel collapse behaviour | `src/hooks/use-collapsible-sidebar.ts` (rule: user pin > viewport), rail widths + `collapsed` markup in `shell.tsx`, `.nav-rail`/`.side-shell` in `globals.css` |
| text/contrast, hover, motion, shadows | tokens in `globals.css` `:root`/`[data-theme="dark"]` (ink-faint is AA-tuned; hover tiered + touch-guarded; prefers-reduced-motion kill-switch lives there); route-settle logic in `shell.tsx` (`viewRef`, no state) |
| **UI polish system (spacing/radius/type floor/touch targets)** | `globals.css` — **radius ladder** `--r-xs…--r-xl` (4/6/8/12/16px; the old `--radius: 0.625rem` is unused — use the ladder), **spacing ladder** `--sp-1…--sp-6` (4px base; pick from these instead of freehand `space-y-2.5`/`gap-3.5`), **type floor = 10.5px** (no `text-[9px]`/`9.5px`/`10px` anywhere in `src/`), **`@media (pointer: coarse)` block** grows `.btn`/`.btn-sm`/`.chip`/`.nav-item`/inputs to real touch targets without touching desktop density, and `html { -webkit-text-size-adjust: 100% }` stops iOS PWA inflating small type. `--ink-faint` was darkened (light `#55677c`) / lightened (dark `#9ab6b3`) to pay for the larger labels. |
| **Tab strips (ONE primitive)** | `.tabs` / `.tabs-item` (+ `.active`, `.tabs-flush`, `.tabs-scroll`) in `globals.css` — active tab = raised pill + amber underline, replacing the old faint 0.09-alpha tint. Every tab strip uses it: `Seg` in `src/components/hfmc/ui.tsx` (admin's 2 nav levels), client + agent portal pills, `SegGroup` in `agent/dashboard.tsx`, `DocActionRow.tsx` workspace switcher, and the `STATE_TABS` filter in `views/cases.tsx`. **New tab strips must use `.tabs`**, not a hand-rolled pill/chip row. |
| **KPI tiles (ONE primitive)** | `.kpi` / `.kpi-label` / `.kpi-value` / `.kpi-sub` (+ `.kpi-plain`, `.kpi-accent`) in `globals.css` — replaces ~10 hand-rolled label/value/sub boxes that each had their own size. Used by `StatCard` in `agent/dashboard.tsx` and the data-quality strip in `admin.tsx`. Values use tabular figures + ellipsis so long AED amounts can't stretch a tile. **New stat tiles must use `.kpi`.** |
| **Modals / overlays (ONE primitive)** | `.modal-scrim` + `.modal-pop` in `globals.css` — 8+ hand-rolled scrims had drifted (alpha .45/.72/.74/.8, blur 3/4/none). Now used by `Modal` in `src/components/hfmc/ui.tsx`, `ConfirmModal` in `bits.tsx`, and the StageDrawer in `views/case-detail.tsx`. `.modal-pop` also gives the reserved deep overlay shadow an actual consumer (the dark `--shadow` comment had referenced a class that never existed). **New dialogs must use these**, not `fixed inset-0` + inline rgba. Side drawers (StageShell) keep their own right-edge layout, not this scrim. |
| **Theme cross-fade** | `startViewTransition` wrap in `ThemeToggle` (`src/components/hfmc/ui.tsx`), feature-detected with a plain-swap fallback; duration set by `::view-transition-old/new(root)` in `globals.css` inside `prefers-reduced-motion: no-preference`. Makes light↔dark cross-fade surfaces and borders, not just body bg. |
| **Numeric legibility / a11y** | `tabular-nums` forced on `.mono`, `.tbl td/th`, `.kpi-value` in `globals.css` (money/rate columns no longer wobble); `.tbl tbody tr:focus-visible` ring so keyboard users don't lose their row; `[id]/:target { scroll-margin-top: 72px }` so sticky headers can't cover an anchor target. |
| **Dark rail tokens** | `.side-dark` is a SECOND SELECTOR on the `[data-theme="dark"]` rule in `globals.css` (was a 24-line copy-paste of 20 tokens). Only `--shadow: none` is overridden for the rail, so it can never drift from dark mode. |
| **Loading feedback** | `.progress-bar` in `globals.css`, rendered by `Shell` from the store's `loading` flag (`src/lib/client-store.ts`) — that flag was set by every `hydrate()` but never read by any component, so a post-save refresh looked like a frozen screen. The `!loaded` first paint is now a layout-shaped `.skeleton` (rail + header + KPI/table blocks) in `src/app/page.tsx` instead of a lone spinner, so the page doesn't jump when the workspace arrives. `.skeleton` had been dead CSS until this. |
| **Motion system (framer-motion, used sparingly)** | `framer-motion` was an unused dependency; it is now wired in at exactly one place — `MotionProvider` in `src/components/hfmc/motion.tsx`, mounted app-wide from `src/components/providers.tsx`. It uses **`LazyMotion` + `domMax`** and **`MotionConfig reducedMotion="user"`** (which makes framer drop layout/transform animation for reduced-motion users automatically — the CSS kill-switch cannot do that for JS-driven motion). **Measured cost: ~57 KB gzip on the initial payload of every page** (chunks `06ngr1_*.js` 44 KB + `3rmyff81*.js` 13 KB); total shipped client JS is ~607 KB gzip. NOTE: because `MotionProvider` sits in the root layout it is **eager on every route — `LazyMotion` defers the feature bundle but NOT the initial import.** A pure-CSS tab indicator would cost 0 KB; only keep framer if more of its capabilities (AnimatePresence exits, drag) get used. **Rules: use `m.*` not `motion.*`; new framer animation must be non-essential polish.** |
| **Tab strips (one component + sliding pill)** | `Tabs` in `src/components/hfmc/ui.tsx` — the single tab component for the whole app. The active highlight is a framer `layoutId` shared-layout animation (`.tabs-pill` in `globals.css`) that glides between tabs; `layoutId` is scoped per instance with `useId()` so admin's two strips never animate each other. `Seg` is a thin wrapper. Used by: admin (2 levels via `Seg`), client + agent portal pills, `SegGroup`, `CaseTabBar` workspace switcher (`flush` + `scroll`), and the `STATE_TABS` filter in `views/cases.tsx`. `.tabs-item.active` still paints its own background + underline, so the pill is an upgrade over a working baseline, never the only affordance. **New tab strips must use `<Tabs>`.** |
| **KPI count-up** | `KpiValue` in `src/components/hfmc/ui.tsx` — cubic ease-out on rAF, same easing as `useCountUp` in `charts.tsx`. Animates on **first paint only**, then snaps on later value changes (the store re-hydrates on every save, and a tile re-counting from zero each time reads as a glitch). It **honours `prefers-reduced-motion`** via the local `prefersReducedMotion()` helper — a rAF loop is JS, so the CSS kill-switch cannot stop it. On later value changes it uses the render-time state-adjustment pattern, NOT a `setState` in the effect, which would trip `react-hooks/set-state-in-effect`. Used by the dashboard KPI strip, admin data-quality tiles, and the agent's two count tiles (money tiles stay static — they arrive pre-formatted via `fmtMoney`). |

| **Long-list rendering budget** | `content-visibility: auto` + `contain-intrinsic-size` on `.tbl tbody tr` / `.card-row-vc` in `globals.css` (placeholder sizes stop scrollbar jump). Checked in the browser for find-in-page and sticky `<th>` on the Cases table. `will-change` is applied to **only** `.progress-bar` and `.skeleton` — the two things that animate unbounded; broad `will-change` costs memory and can slow the WebView. |
| **`postinstall` runs `prisma generate`** | `package.json` has `"postinstall": "prisma generate"`. **Do not remove it.** Prisma 6.19 changed where the generated client is written (`node_modules/@prisma/client` rather than `node_modules/.prisma/client`). Without a regenerate, the app loads a stale client that demands a `prisma://` URL and every DB call fails with `P6001: the URL must start with the protocol prisma://` — login 500s and `/api/state` 500s, while the page itself still renders 200 (so it looks like an auth bug, not a DB one). Fix: `npx prisma generate`, then **restart the dev server and delete `.next`** — Turbopack caches module resolution, so regenerating files on disk is not enough while a server is already running. |
| **Dev server vs build** | `next build` and `next dev` share `.next` and will clobber each other. **Stop the dev server before building.** Multiple `next dev` instances can also pile up on port 3000; check with `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` filtering on `next` + the project path, and kill leftovers before starting a fresh one. |
| **Greeting (ONE helper)** | `greetingFor(name)` in `src/lib/format.ts` returns `Hello, {firstName} 👋` and falls back to `there`. It exists because the greeting had drifted into **four** shapes: the staff dashboard showed a bare `Hello 👋` for SPOs, `Good morning, {name} 👋` for VRMs and **nothing at all** for managers (the whole block was gated behind `isFrontline`), and the agent portal had a fifth variant split across two lines. Staff dashboard uses it inside the My Day card for frontline and in a plain heading for managers; agent hero uses it above the full name. The **client** portal (`src/app/client/dashboard.tsx`) still uses its own `Good morning/afternoon/evening` wording — deliberately separate client-facing copy, not a bug. **Never re-inline a greeting; call `greetingFor`.** |
| **Client portal: document checklist** | `DocUploadCards` in `src/app/client/dashboard.tsx` groups pending docs into three labelled sections instead of one flat list: **"Holding up your case"** (rejected — the only ones the client can clear, coral-bordered, filled coral CTA), **"With the bank — nothing needed from you"** (uploaded, read-only), and **"Still to upload"**. A progress bar sits under the `n/m done` counter (`role="progressbar"`). The grouping is the point: previously every pending doc looked equally urgent, so the client couldn't tell what was actually blocking them. |
| **Client portal: milestone moment** | `.milestone` / `.milestone-seal` in `globals.css`, rendered in `JourneyTab` from `latestMilestone` — the newest `stageTransitions` entry, **only if it's under 48h old**. A soft mint glow + popping seal tick. Deliberately NOT confetti: this is a regulated broker's client portal and the house reserves confetti for a real deal close in the calculator. Derived from the transition (not a stored flag), so reloading never replays it as a nag. |
| **Deliberately NOT built in the client portal** | The "Next Action" card and the cross-bank rate/EMI comparison were both proposed and **declined by the user** — staff hold different intentions/reasons per case and don't want to expose them to the client. The live two-way chat and direct document sharing already exist and were left untouched. No client-side ETA either (a missed date destroys more trust than no date). |
| **"Ask us" label on the client chat** | `ChatBubble.tsx` renders a text pill next to the floating bubble for `userRole === "CLIENT"` only. An icon-only floating button is a convention, not a label — clients don't all map a speech-bubble glyph to "ask a question". The pill sits LEFT of the bubble so it reads as its label. **It is NOT a one-way door** (an earlier boolean version hid it forever after one click — that defeated the point). It hides only while the client is actively using chat and **re-appears** when: the chat was last opened >14 days ago (`localStorage["hfmc.chatLabelHiddenAt"]` holds a timestamp, not a flag), or the advisor has sent an **unread message** — the exact moment they most need to find the bubble. Staff/agent bubbles never show it. Read with **`useSyncExternalStore`** (server snapshot `false`) — do NOT revert to `useEffect` + `setState`: that trips `react-hooks/set-state-in-effect` and causes a hydration flash. |





| **Print output** | `@media print` block in `globals.css` — re-declares the light palette as CSS-variable overrides (so dark mode prints white-on-black-white without touching the live theme), hides app chrome (`.side-shell`, `.bottom-nav`, `.modal-scrim`, `.tabs`, `.case-stickybar`), and sets `.tbl thead { display: table-header-group }` so long report tables repeat their header row on every page. `/calc-print` and `/proposal` have their own A4 rules and are unaffected. |


| Client portal | `src/app/client/*` + `src/app/api/client/*` |
| Agent portal (tabs, tools, profile) | `src/app/agent/*` + `src/app/api/agent/*` + rules in `src/lib/agent-mortgage.ts` |
| Portal settings (default advisor, client/agent-facing staff pairs, fallback numbers) | `src/lib/portal-settings.ts` + `src/app/api/admin/settings/route.ts` + PortalTab in `admin.tsx` |
| Notification settings (email provider, channel toggles, event triggers, chat retention) | `src/lib/notification-settings.ts` + `src/lib/email.ts` + `src/app/api/admin/notification-settings/route.ts` + `src/app/api/admin/devices/route.ts` + `src/app/api/admin/chat-purge/route.ts` + `src/app/api/me/notification-prefs/route.ts` + NotificationsTab/DevicesTab in `admin.tsx` |
| Notification chain (push → email per audience) | `src/lib/push.ts` (`sendNotificationChain`), `src/lib/notification-settings.ts` (reads config), `src/lib/email.ts` (sends email) |
| Staff WhatsApp numbers + who fronts client/agent portals | `User.phone` (Admin → Teammates form in `admin.tsx`); resolution in `/api/client/state` (advisor card pair) + `/api/agent/state` (desk pair); per-case fronting via `advisorId` in `/api/cases` + New Case modal + Case 360 People |
| Backup 1/2 (leave coverage) | `LoanCase.backup1Id`/`backup2Id` (schema) → pickers in New Case modal (`shell.tsx`) + Case 360 People (`case-detail.tsx`); authorization = `visibleCases()` in `src/lib/domain.ts`; report card in `reports.tsx` ("Backup coverage") |
| Email integration | `src/lib/graph.ts` (read), `src/lib/email-match.ts` (match), `src/app/api/email/*` |
| Microsoft Graph (Outlook send-mail) | `src/lib/graph.ts` (delegated auth + sendMail), `src/app/api/graph/auth/*` (connect/callback/disconnect/status), `src/app/api/graph/send/route.ts`; User model stores `graphAccessToken`, `graphRefreshToken`, `graphTokenExpiresAt`, `graphConnectedAt`; PKCE auth code flow; per-user tokens → email sent from their mailbox |
| AI features | `src/app/api/ai/*` (advisor, insights=copilot, doc-read) |
| **PWA / Native App Feel** | `src/app/manifest.ts` (splash screens, shortcuts), `src/app/globals.css` (no pull-to-refresh, no tap highlight, safe-area insets, skeleton utility), `src/components/views/shell.tsx` (bottom-nav + FAB safe-area classes), `src/lib/haptics.ts` (vibration API wrapper + `useHaptic()` hook), `public/splash-*.png` (6 generated splash screens) |
| **Mobile HMR Fix** | `next.config.ts` → `allowedDevOrigins` for LAN IP websocket connections |
| **Lead Details Editing** | `src/components/views/leads.tsx` — "Edit Details" button + `EditCaseDetailsModal` for portal/agent leads (banks, advisor, backups, submission type, transaction type, MIS fields) |
| **Real-time Live Chat & Floating Bubble** | `src/components/chat/ChatBubble.tsx`, `ChatDrawer.tsx`, `ChatPanel.tsx` (SSE + 8s polling fallback, WhatsApp-style sent/received/seen ticks, XHR upload progress + filename, View + staff Save-to-Vault per attachment); endpoints `src/app/api/chat/[caseId]/messages` (SSE + POST), `heartbeat` (sibling-aware client auth), `upload`, `attachments/[docId]/save`, and `src/app/api/chat/inbox` (staff inbox opens the clicked CLIENT/AGENT thread); `src/lib/chat-auth.ts` (sibling-journey access so staff→client reaches every bank journey); Case 360 full Chat tab in `CaseTabBar.tsx` + `case-detail.tsx`; mounted in `src/app/page.tsx` and `src/app/client/dashboard.tsx` |
| **PWA Installation & Smart Prompt Banner** | `src/components/pwa/PwaInstallBanner.tsx` (device-type suppression logic, beforeinstallprompt, iOS Safari guide; has 1 pre-existing set-state-in-effect lint); endpoint `src/app/api/pwa/installed/route.ts` tracking `UserDevice` rows |
| **Web Push (VAPID) & Audio Chimes** | `src/lib/push.ts` (web-push sender + notification chain: push → email per admin config; `sendNotificationChain()` orchestrator for audience-aware delivery), `src/lib/chime.ts` (Web Audio API synthetic notification tone), `public/sw.js` (push + click handlers), `src/app/api/push/subscribe` + `vapid-key` routes |
| **Doc Vault Inline Rename & Category Pills** | `src/components/views/doc-vault.tsx` (`displayName` inline input, category filter pills with badge counts, category reassignment dropdown); database `displayName` & `source` on `CaseDocument` |
| **Case 360 Notification Channel Overrides** | `src/components/views/case-detail.tsx` (People card: WhatsApp / Push / Email 3-tier toggles); stored in `LoanCase.notificationOverrides` |

## Performance notes

- **All store mutations re-hydrate in the background** (`get().hydrate().catch()` fire-and-forget) — the UI toasts/responds instantly; lists refresh a beat later. Don't re-add `await get().hydrate()` after mutations: with the DB far away it stalls every save for seconds.
- **DB region matters**: the Supabase project was created in Seoul (ap-northeast-2) — a single trivial query took ~2.5s from India/UAE. Migrating the project to Mumbai (ap-south-1) is the single biggest speed win available (Supabase dashboard → project migration; backup first).
- **Mobile HMR via LAN**: `allowedDevOrigins` in `next.config.ts` permits websocket connections from private IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x, *.local) so the dev server works on mobile over Wi-Fi without constant reloads.

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
