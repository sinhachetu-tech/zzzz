# Multi-Service Migration — Master Notes

**Status: Phases 0–5 SHIPPED and verified. `tsc --noEmit` = EXIT 0.**

**Phase 4 shipped:** `Lead` is now a real entity, not a LoanCase stage.
`/api/leads` (CRUD), `/api/leads/[id]/convert` (transactional lead→case, idempotent),
`leads` in `/api/state` with duplicate hint + revenue masking, store
`createLead/updateLead/deleteLead/convertLead`, a fully rewritten Leads view
(`views/leads.tsx`) reading the Lead table, `scripts/migrate-legacy-leads.cjs`
(2 legacy rows migrated, 41 cases untouched, idempotent), and `client/register`
now creates a Lead instead of a throwaway case.

**Phase 4 required one schema change:** `ClientSession.caseId` is now NULLABLE
(`prisma/phase4_leads.sql`, 3 statements, applied + verified). This is what
unblocked everything — a lead-only registrant has a session and a Client row but
no case, which is exactly what registration used to fake.

Next: **Phase 6 — client profiling depth** (assets/liabilities/address/KYC), then
Phase 7 (reporting by facility).

### Phase 5 — journeys are per service line (SHIPPED)

**The decision that shaped it:** mortgage is the ONLY line whose process is
actually written down. So the other five get their structure reserved and are
labelled **"coming soon"** — NOT filled with invented stages.

- MORTGAGE: 12 stages, set active
- The other 5: inactive set named `<Line> journey — coming soon`, **0 stages**
- Verified: **0 stages with no set**, 41 cases untouched

**`stagesForServiceLine()` is the ONE scoping rule** — every caller uses it.
Duplicating that join per component is exactly how a will ends up rendering
"Valuation". A null line resolves to MORTGAGE, which keeps all existing cases
rendering exactly as before.

**Bringing a line live needs no migration and no code change:** add its first
stage in Admin → Workflow → Stages; the API flips `StageSet.active` and
`isJourneyConfigured` starts returning true by itself.

Two bugs caught here:
- The seed's first attempt sent `notes` to `StageSet`, which has no such column —
  so the "coming soon" marker now lives in the set **name**, which is what an
  admin actually reads.
- `stagesForServiceLine` originally had a narrow return type that stripped
  `steps`/`sopJson`/`commsJson`. Made generic; the `as never` cast that hid it
  is gone.

This file is the durable record. `CODEBASE.md` holds the architecture truth; this
holds the *plan*, the *reasoning*, and the *open threads*.

---

## 1. The original problem

HFMC was built as a **mortgage-only** case tracker. The firm is actually a
consultancy: mortgage + golden visa + wills & legal + insurance + real estate +
business setup. The data model had **no way to express "which line of business"**
at all. Everything — stages, document rules, SLA, reporting, commission — was
mortgage-shaped, so a golden-visa case would have been forced through
"Valuation" and handed a mortgage document checklist.

The user's framing (4 IDs) was: **Client → Lead → Facility → Case**.

### Where the original framing was right, and where it needed adjusting

The instinct (a person-anchor plus a service concept) was **correct**. Three
adjustments were made:

1. **"Facility" was doing two jobs.** The user said "facility id means all the
   service we provide" *and* "case id where different product of that service be
   served". Those are two different layers. Final shape:
   **ServiceLine (what kind of business) → Product (the specific offering) →
   Engagement/Case (one procedure).**
   e.g. `MORTGAGE` (line) → `MORT-FIRST` (product) → case HFMC-0187.

2. **Do NOT rename or re-key `LoanCase`.** 83 files reference `caseId`, 33 use
   `db.loanCase`. The table keeps its name; `serviceLineId`/`productId` were
   **added**. Every phase is additive.

3. **Lead ≠ a duplicate of Client.** A lead is *an expression of interest that may
   not yet be a person we know*. It can resolve to zero or one `Client`.

### THE PLACEMENT RULE (the single most important rule in this migration)

- Asked once per human → **`Client`**
- Asked once per procedure → **the Engagement** (`LoanCase`)
- Specific to one service line → **that line's own table**
- Asked per bank → **the bank leg** (a sibling `LoanCase` on `parentCaseId`)
- **Never add service-specific columns to `Lead`.**

Why it matters: every sprawl risk in this codebase comes from putting a field on
the wrong entity. If `Lead` ever grows a `propertyValue` column, it has become a
Case in all but name and we are back to square one.

---

## 2. Target model

```
Client  ── the human. KYC, address, demographics, income, assets, liabilities.
  │        Never re-asked (Client.personJson + person-sheet.ts).
  │
  ├── Lead       ── expression of interest. serviceLineId REQUIRED.
  │                May resolve to zero or one Client.
  │
  └── Engagement ── LoanCase: ONE procedure through ONE product.
        ├── serviceLineId → ServiceLine
        │     MORTGAGE | GOLDEN_VISA | INSURANCE | WILLS_LEGAL
        │     | REAL_ESTATE | BUSINESS_SETUP
        ├── productId → Product  (MORT-FIRST | GV-10 | WIL-DRAFT | …)
        └── Bank legs ── siblings on parentCaseId. ONLY where
                         ServiceLine.bankRaced = true (today: mortgage only)
```

**Bank legs are a COMPETITIVE SET, not parallel work.** The user's own words:
*"many pre-approvals, one FOL, one loan taken."* So `legStatus` exists because
`caseStatus: "Lost"` means **"we lost the business"** — which is NOT what happened
to the Emirates leg when Mashreq won. Losing a bank race is the expected outcome
of shopping a deal around, not a failure.
---

## 3. Phase log — what shipped

### Phase 0 — Audit (`scripts/audit-bank-legs.mjs`, READ-ONLY)

**Hypothesis:** nothing in any write path ever closes a sibling bank leg. When
FOL wins at Mashreq, the Emirates leg stays `Active`, keeps accruing commission
and sits in the pipeline forever = phantom money.

**Result: 0 phantom legs.** The bug is REAL in code but **latent** — the DB holds
41 cases, mostly seed/demo data (one row's customer is literally `sfsfsf`).
9 legacy rows still list several banks on one row; 1 genuine 3-leg engagement
exists (HFMC-0910, AED 4.5M, all 3 legs Active).

**Decision:** fix the mechanism before the first real multi-bank deal. No data
repair needed.

### Phase 1 — Schema spine (additive only)

Created `ServiceLine`, `Product`, `Lead`, `StageSet`.
Added `serviceLineId`/`productId` to `LoanCase`; `serviceLineId` to
`DocRule`/`SlaRule`/`CommTemplate`; `stageSetId` to `StageItem`; and
`legStatus`/`decidedAt`/`decidedById` to `LoanCase` (Phase 2 groundwork shipped
ahead of time).

**Verified in DB:** 4/4 tables, 9/9 columns, 4/4 FKs, LoanCase=41 Client=52
intact.

**Seeded** 6 service lines + 24 products. `bankRaced: true` on **MORTGAGE only** —
it gates the entire leg machinery.

**Backfilled** all rows to MORTGAGE. `productId` deliberately left NULL — null
means "not classified yet", and a wrong product is worse than none.

**UI delivered:** Admin → Workflow → Service lines (full CRUD via
`/api/service-lines`), worklist service filter (persisted **by code, not id** so
it survives a DB rebuild), `ServiceLineChip` (renders nothing while only one line
is active — a "Mortgage" chip on every row is noise).

### Phase 2 — Bank-leg outcomes (the money fix)

`legStatus` = `Active | Won | LostRace | Declined | Withdrawn`.

**The invariant is enforced in the write path**, not left to discipline:
`PATCH /api/cases/:id` with `legStatus:"Won"` closes every still-Active sibling
as `LostRace` (reason `Lost race — won at <bank>`) with an Activity row each, and
**rejects a second winner** with a 400.

**`dedupeEngagements` retired** (now `@deprecated`, kept so importers compile).
It GUESSED via `client+amount+created-day`; `engagementsOnly()` (parent rows only)
is deterministic. The old key would also collapse two same-day golden-visa
applications for one client — it only ever worked because mortgages are big and
rare.

**Parent row was NOT demoted.** It still doubles as the first bank's leg, because
every existing link, document and case number points at it. `legsOf()` includes
the parent as a contestant; only MONEY paths treat parents as engagements.

### Phase 3 — Client-scoped portal sessions

`ClientSession.clientId` = real identity. `caseId` = the anchor they logged in on.

**Why it had to land before Phase 4:** a lead-only registrant has no case to log
in with. Without this, Phase 4 is impossible.

**`clientOwnsCase(me, caseId)` is THE access check** — every client route must
call it, never compare case ids. Three tiers: anchor → same-`clientId` sibling →
narrow LEGACY fallback. **A row WITH a `clientId` never falls through to name
matching** — otherwise a shared family phone exposes one member's documents to
another.

`chat-auth.ts` had a duplicate copy of the sibling rule → now delegates.
`siblingCaseIds()` had a latent bug: it omitted the anchor case from its own list,
so a device registered against the anchor could miss staff push replies.

---

## 3b. Phase 4 — the real `Lead` table (SHIPPED)

A lead is no longer a `LoanCase` while `stage === "Lead"`. It is its own entity.

**Four rules enforced server-side in `/api/leads`:**
1. `serviceLineId` is REQUIRED — without it "how many leads do we have?" is
   unanswerable across six service lines.
2. `firstContactedAt` stamps on the FIRST transition away from "New", once only.
   The SLA clock measures human contact, not arrival.
3. A converted lead cannot be un-converted — the case it became is live work.
4. `Lost` ≠ `Invalid`; conflating them understates the conversion rate.

Also: deleting a lead that became a case is refused (it is the only record of where
the business came from), and a product from a different service line is rejected.

**`/api/leads/[id]/convert`** is one transaction and idempotent — a double-click
returns the same case, not a second one. `syncCaseClients` runs outside it because
it does its own read-modify-write and must not hold the case row locked.

**Migration:** `scripts/migrate-legacy-leads.cjs` created 2 Lead rows pointing back
at their existing cases. The LoanCase rows were **left completely alone** — they may
already have documents or a Phase 3 session. Re-running reported "already have a
Lead: 2" (idempotent).

### Three real bugs Phase 4 surfaced
- **`StageItem` has no `serviceLineId`** — it is scoped via `stageSetId`. A naive
  query would throw at runtime.
- **The mortgage journey's first stage is literally `"Lead"`** — a converted case
  would land back in the funnel it just left, and the Leads list would show it twice.
  The convert route now skips a stage named "Lead".
- **`ClientSession.caseId` was required**, which is *why* registration had to invent
  a throwaway LoanCase. Made nullable in `prisma/phase4_leads.sql`.

**`amountMatters` in `lead-readiness.ts`:** only `bankRaced` lines (mortgage) need a
loan figure to convert. Without this, a golden-visa or will lead sits permanently
"not ready" for a number that does not apply to it.

---

## 4. Open threads / things to remember

### ⚠️ NEVER run `prisma migrate dev` on this database
No migration history (`prisma/migrations` has no `migration_lock.toml` — the DB was
built with `db push`). `migrate dev` reports drift and offers to **reset the public
schema, losing all data**. This was tried and aborted.

Safe path: `node scripts/gen-sql.cjs` (generates additive SQL from a live-DB diff,
**fails if any destructive statement appears**) → review → `node scripts/apply-sql.cjs
--apply <file>.sql` (verifies every object the file mentions exists).

### ⚠️ Uncommitted changes that are NOT mine
`git status` shows chat files modified in the working tree (`ChatBubble/ChatDrawer/
ChatPanel`, `chat/inbox`, `chat/[caseId]/{messages,upload,heartbeat}`) plus whole
new directories `src/app/api/staff-chat/`, `src/components/staff-chat/`,
`prisma/staff_chat.sql`. None of that is part of the multi-service migration —
**commit selectively.**

### ⚠️ Tooling in the working tree
`scripts/_run.cjs` runs a command and writes output + an `EXITn` marker to
`tool-results/<label>.txt`. `scripts/dump-lines.cjs <file> --verify` reports
`COMPLETE exit=N` vs `INCOMPLETE` — **use it, because this session's shell kills
long commands and leaves ZERO-BYTE files that look like a clean pass.**
An empty tsc output is NOT evidence of success until the exit marker is present.
---

## 5. Remaining phases

**Phase 5 — per-facility workflow (the load-bearing one).**
`StageSet` → `StageItem` → `StageStep` becomes per-service-line; `registry.ts`
becomes `journeyFor(serviceLineId)`; `DocRule.serviceLineId` as a condition axis;
Admin stages tab becomes per-line tabs. Golden visa ≈ `Documents → Application →
Visa issued → Emirates ID` — shares ZERO vocabulary with FOL booking.
`LEGACY_MAP` must keep the 5 mortgage labels resolving.

**Phase 6 — Client profiling depth.** Address, assets, liabilities, KYC. Declared
in `person-sheet.ts` (one line per field), NOT hardcoded JSX. Assets/liabilities
are repeating → child tables, not JSON, so they can be totalled for net worth.

**Phase 7 — Reporting by facility.** Facility switcher on dashboard + reports;
commission engine facility-aware. **Outstanding from Phase 2:** a Reports-level
service-line breakdown — the worklist filter and chip exist, the reports split
does not.

---

## 8. FINAL PLAN — Phases A–E (agreed after Phase 5)

> Written while still in plan mode, so compaction could have lost it. This section
> is the authoritative spec for everything below Phases 0–5.

### The ID layer (settled — do not relitigate)

| Layer | Question it answers | Example |
|---|---|---|
| `Client` | Who is this human? | CLT-0041 Ahmed R. |
| `Lead` | Are they interested yet? | L-12 |
| `ServiceLine` (**facility**) | What kind of business? | GOLDEN_VISA |
| `Product` | Which specific offering? | GV-10 |
| `LoanCase` | What is actually happening? | HFMC-0187 |
| `CaseParty` | Who holds which role on this case? | CoBorrower |

**"Facility id OR case id?" — not a choice.** A case always carries BOTH. A facility
alone can't identify work (40 golden visas share one facility); `caseId` is what goes
on a document.

### THE BOUNDARY RULE (prevents all future sprawl)

> **Would this still be true about Ahmed in three years, on a completely different
> service?** Yes → `Client`. Only true while a deal is running → the case.

- `Client` = demographics, KYC, contact, income, assets, liabilities. **Nothing else.**
- `Client.personJson` = LATEST KNOWN TRUTH about the human.
- `Case.profileJson` = SNAPSHOT AS FILED for that one engagement.
- "Co-borrower" is a **role on the link**, never a fact about the person.

### Phase A — `CaseParty` table — ✅ **SHIPPED**
`{ id, caseId, clientId, role, sortOrder }`, `role` ∈ CoBorrower | CoApplicant |
Guarantor. Backfill one row per existing `secondPartyClientId`; that column keeps
working (nothing drops). Safe path: `gen-sql.cjs` → review → `apply-sql.cjs --apply`.

**Applied.** `prisma/phase5_case_parties.sql` = 6 statements, purely additive
(1 table, 3 indexes, 2 FKs). Backfilled 1 row (`HFMC-0906`, mirrors the legacy
column); re-running reports 0 pending. **Row counts identical before and after —
41 cases, 52 clients, 2 leads, 6 lines, 12 stages — so the migration was inert.**
`tsc --noEmit` PASS (exit 0).

`caseParties` ships in `/api/state`, **filtered to `visibleCaseIds`** like
`vaultDocs`. Store selectors `partiesOfCase` / `partiesOfClient` / `roleOnCase`.

**Still read-only.** No write path yet — that is Phase B. `roleOnCase` falls back to
`secondPartyClientId` for any case the backfill has not reached.

### Phase B — "Add co-borrower / co-applicant" button — ✅ **API SHIPPED, UI PENDING**
Search existing Clients by name / phone / EID / email, or create a new one. Reuses
`client-master.ts` unchanged (EID unique → phone+name → **never phone alone**;
families share numbers). `coApplicantName` becomes derived from the linked Client
instead of typed free text — a guarantor is currently invisible to the person view.

**API done.** `/api/cases/[id]/parties` GET/POST/PATCH/DELETE. `syncLegacySlot`
re-derives `secondPartyClientId` inside every transaction. `coApplicantName` is
derived in `/api/state` (column kept as fallback). `tsc --noEmit` PASS.
`scripts/phase5-test-parties.cjs` 6/6.

**✅ UI NOW SHIPPED.** `src/components/case/CaseParties.tsx`, mounted in
`case-detail.tsx` beside `PersonSheetCard`: role select + remove per party, an
"Add co-borrower / co-applicant" button, and a search-or-create modal over the
client master. Each party keeps their own data sheet. `clients.tsx` now counts
engagements from `caseParties` as well, so a second co-applicant is no longer
invisible on their own record. `tsc --noEmit` PASS.

### Phase C — Open-case flow
Pick service line → pick product → resolve client → open. Forces the segregation at
the moment it matters instead of bolting a service line on afterwards.

### Phase D — Person screen (READ-ONLY query, stores nothing)
Personal record + their open cases across all service lines. "Active facilities" is
not a field — it's the answer to "which of this person's cases are open right now?".
If it ever needs to STORE something, that goes in a separate table, never on `Client`.

### Phase E — Assets in the person sheet
Deposits / investments / property / vehicles / other / total, keyed to the registry
keys that already exist in `form-fields.ts`. No migration. Repeating rows (3 mortgages
instead of mortgage1/mortgage2) deliberately deferred.

### Decided ordering: A → B → C → D → E
A alone is inert (a role with no way to add one does nothing) so A+B is the working
unit. A is the only risky step — do it before anything cosmetic. D before E because D
is what makes the model *pay off*. E last: independent, separable, no migration.

### GUARDRAIL — a lead is NEVER marked "won" when a case books
Lead→`Converted` = qualified, file opened (day 1). Case→`Booked` = loan completed
(month 4). If a lead inherits "won" from its case, funnel conversion silently becomes
a booking rate and every converted-but-fell-through lead reads as a win.
**The lead's story ends at conversion.** "Did this lead make money?" is a *join*
(`lead.caseId → case.caseStatus`), never a column.

### Rejected alternative for Phase E (recorded so it isn't rebuilt later)
Child tables `ClientAsset` / `ClientLiability` were considered for net-worth
reporting. Deferred because they break the one-line-per-field property that makes
`person-sheet.ts` work, and need a migration. Revisit when net worth across the
client base is actually needed.

---

## 9. ⭐ THE NEXT BIG THING — departments, read-across, and the shared vault

> Agreed in discussion, **not yet built**. This is the spec to build from.

### 9.1 The gap: visibility has no "what do you deal in" axis
Today `RoleFlags.scope` is `all | team | own` — that answers **"who are you"**.
There is **no "what do you deal in" dimension**. Consequence: a Wills person on
`scope: all` currently sees **every mortgage case in the firm**. They open a will and
land in someone else's FOL booking. This is a bigger deal than the doc vault.

### 9.2 DECIDED — read across, write local (with an admin setting)
Not full walls. **Why: a will must account for debts.** If the Wills team cannot see
that Ahmed has a 4.5M mortgage running, they write a will that leaves his family
inheriting a property with a live charge on it. That is the most common way wills
go wrong, and it is not hypothetical.

| | Own line | Other lines, SAME client | Other clients |
|---|---|---|---|
| Wills / Golden visa / etc. | full edit | **read only** | invisible |

Shape: `Designation` gains **`serviceLineIds`** — "which lines do you work" — layered
on top of the existing `scope`. Two axes, not a rewrite. It also means a mortgage
officer can pick up a golden visa case without a second login, which a hard wall
prevents. Admin → Designations gets the toggle.

**Still open:** is even *seeing* another department's cases commercially sensitive?
If yes, the debt-in-a-will problem returns and needs a different answer — probably
an explicit "client's financial position" summary the Wills team can read without
opening the mortgage file at all. **Ask the user before building.**

### 9.3 The doc vault — THREE TIERS, not one shared list
"One global vault per client where services share" is half right, and **the wrong
half is dangerous.**

**Tier 1 — Person documents: genuinely shared, no caveats.** Emirates ID, passport,
visa, Emirates ID card, proof of address, salary/employment letter. These belong to
*the human*, not to a service — a golden visa and a mortgage need the same passport
scan.
> ⚠️ **CORRECTION (verified 2026-10-10): `ClientDocument` DOES NOT EXIST.** An earlier
> draft of this file claimed it "already exists" — **that was wrong.** The only document
> model today is **`CaseDocument`, which is hard-`caseId`-scoped with `onDelete:
> Cascade`** (`schema.prisma:1175`). So Tier 1 must be **BUILT**, and the "reuse what's
> there" plan for it is void. The `Client` model itself is complete and correct
> (`personJson` answer sheet) — it is the *documents* that have no person-level home.
> **Phase G is a real build with a migration**, not a wiring job.

**Tier 2 — Asset documents: shared between services about the SAME asset.** Title
deed, SPA, NOC. Ahmed's villa is referenced by his mortgage, by a real-estate sale,
*and by his will* (assets get bequeathed). One copy, three services referencing it.
**DEFERRED** — ship 1 and 3 first, see whether anyone actually asks.

**Tier 3 — Case documents: MUST NEVER be shared.** Bank submission forms, valuation
reports, FOL/booking docs, visa application receipts. A bank has no business seeing a
golden visa application; an immigration authority has no business seeing a mortgage
valuation. **Mixing these is a compliance incident, not a tidiness problem.**

**Practical UI:** on a case, the vault shows a **"Documents already on file for this
client"** panel (Tier 1) with one-click *attach to this case*. Nobody re-uploads a
passport four times; nothing dangerous leaks sideways.

### 9.4 Workflows — one per line, authored by the owning department
Structure already exists (Phase 5). The five non-mortgage lines sit empty, labelled
"coming soon". Mechanism already exists: **Admin → Workflow → Stages, tab per line,
add a stage → the line goes live, no migration, no code change.**

**The missing piece is ownership, and it's a business decision:** each department
should author its own stages, because a golden visa pipeline written by the mortgage
team will be wrong.

**Open question:** do departments share stages, or does every line need its own?
Insurance and wills may both be short document-heavy flows. If six near-identical
pipelines is the worry, a **"clone this line's stages"** button would save real pain.
Ask before building.

### 9.5 Build WILLS FIRST — and here's why
A will is the only service that reads a person's **entire** picture: assets,
liabilities, dependants, existing policies, property in a foreign jurisdiction. It is
assembled almost entirely from data already held across other services.

If the client master is right, the Wills team opens a client and the screen already
shows assets, outstanding mortgages across every service, spouse/dependants, existing
wills. If the model is wrong, they re-key all of it by hand every time.

**So: Wills first, not because it is the biggest business — because it is the one
that proves the model.**

### 9.6 Where this slots into the A–E roadmap
Phase 9.2 (**service-line scoping on `Designation`**) is the **prerequisite** for
anything departmental, and should be built **before** switching on a second line —
otherwise turning on Golden Visa instantly exposes every mortgage case to whoever
picks it up. Order:

```
Phase C  Open-case flow          (pick line → product → resolve client)
Phase D  Person screen           (read-only query; makes read-across useful)
Phase F  Service-line scoping    ⭐ Designation.serviceLineIds + Admin toggle
         → then switch on the second line
Phase G  Client document vault   (Tier 1 "already on file for this client" panel)
Phase E  Assets in person sheet  (feeds the will — assets + liabilities)
Phase H  Wills line goes live    (its stages + its cases)
Phase 7  Reporting by facility  (split pipeline/revenue/win-rate by line)
```
**Phase F before "go live"** is the important ordering. Phases C and D are safe to
build first and make the rest coherent.

### 9.7 Open questions — ask BEFORE building 9.2 / 9.4
1. **Is seeing another department's cases commercially sensitive?** If yes, read-across
   is not enough and Wills needs a read-only "financial position" summary instead.
2. **Do departments share stages, or does every line get its own?** (clone button?)
3. **Who authors each department's stages** — do they fill in Admin themselves?
4. **Does Tier 2 (asset documents) actually earn its keep**, or is Tier 1 + 3 enough?

### 9.7b USER ANSWERS (2026-10-10) — decisions locked
1. **"No, it's not [commercially sensitive] — there should be read."** → READ-ACROSS
   CONFIRMED. `Designation.serviceLineIds` + read-only-other-line is the design; no
   financial-position summary workaround needed.
2. *(was confused on shared-vs-per-line stages — resolved by asking him to choose.)*
3. **YES — segregate by department, with department heads, made in Admin now.** He also
   confirmed the existing `team` field (Dubai / Abu Dhabi / Management) is an **OFFICE**,
   not a department, and wants departments named Mortgage, Wills, etc. → §10.
4. **SKIP Tier 2 as a distinct tier** — "it should be shareable when needed, means all
   can be shareable but be marked as whose department it belongs, or is it sharable to
   all departments." → §10.4 collapses the three tiers into ONE marked vault.

---

## 10. ⭐ REVISED DESIGN — departments, offices, and one shared vault

> Supersedes parts of §9. Follows from his answers above.

### 10.1 OFFICE (geography) ≠ DEPARTMENT (what we sell) — currently conflated
Today `User.team` is a **free-text string**, and `admin.tsx:35` hardcodes
`const TEAMS = ["Management", "Dubai", "Abu Dhabi"]`. That is an **OFFICE**, and the
word "team" is doing two unrelated jobs. Meanwhile "which service line do you work" is
**not modelled on the user at all**.

**Keep them as two separate fields. Do NOT merge them.**

| | Field | Values | Answers |
|---|---|---|---|
| **Office** | `User.team` (existing) | Dubai / Abu Dhabi / Management | *Where* you sit |
| **Department** | `User.serviceLineId` → `ServiceLine` | Mortgage / Wills / Golden visa… | *What* you sell |

A person is **one department, one office**: a Wills officer in the Dubai office. Pairing
them as "Dubai-Wills" would need re-picking every hire and would break when someone moves
office — which is normal. **Wrong answer waiting to happen; don't build it.**

**The linkage already exists:** `ServiceLine` *is* the department. No new table needed —
`User.serviceLineId Int?` is the whole addition.

### 10.2 Department heads
`ServiceLine.headUserId Int?` → `User`. A head is *informational*: who to ask, and it
enables "Wills dept — 4 staff, 12 open cases" in Admin. It is **not** an access control —
access comes from `Designation.serviceLineIds` (10.3), because one designation can span
lines (e.g. "Management" sees everything) and one user can in principle cover two lines.

### 10.3 Read-across, write local — the two axes
`Designation` gains **`serviceLineIds String @default("[]")`** (JSON array of codes —
same convention as `DocRule.applicableBank`, so it matches house style). Empty = **all
lines** (legacy behaviour, and what Super/Admin get).

Resolution order in `visibleCases()`:
1. super/admin, or empty `serviceLineIds` → **all lines** (unchanged from today)
2. otherwise → cases whose `serviceLineId` is in the set, **plus** cases belonging to a
   client this user already touches (that's the read-across that keeps the will honest)
3. then the existing office/ownership scope applies as it does now

**Write access is separate: visible ≠ editable.** A new `canEditCase(user, flags, theCase)`
requires the line to be in the user's set too. Read-across without an edit-lock is the
same mistake as giving everyone the login.

### 10.4 ONE vault, department-marked — Q4 collapses the three tiers
He wants everything shareable but **labelled with its owning department**, and flagged
shareable-to-all or shared. That is **better than my three-tier proposal** and simpler:

**`ClientDocument` (NEW)** — person-level, the real global vault:
- `clientId`, `title`, `category` (KYC / Income / Asset / Property / Other)
- `serviceLineId Int?` — **which department produced it** (null = firm-wide)
- `sharing String @default("Team")` — `All | Team | Department`
- storage fields mirroring `CaseDocument` (`fileName/fileType/fileSize/fileData/
  storageKey/compressedKey/selectedVersion/driveFileId`) so R2/Drive/versions behave
  identically
- `expiryDate`, `uploadedById`, `verifiedById`, `status`

**`CaseDocument` gets `clientDocumentId Int?`** — the "attach to this case" pointer. Same
shape as the proven `CaseParty`/`copiedFromId` pattern: **one file, many rows.**

Result: **one vault per client**, browsable by department, where a passport scan is
uploaded **once** and attached to the mortgage, the golden visa and the will — while a
bank valuation stays visibly *the mortgage department's* and can be marked `Team`-only.

**`sharing` is a real control, not decoration.** `Team` (default) = owning department +
admins. `All` = any staff may read/attach. **The default matters:** `Team`, so a new
document is never accidentally firm-wide.

### 10.5 Dashboard / Clients / Leads — global, with department tabs
He asked whether these are global and whether each service tab shows only its own cases.
Answer: **global lists with a department tab filter, not separate pages.**

- **Dashboard** — KPI cards and charts stay **global** (the firm wants total pipeline),
  each gaining a department breakdown/filter. Suppressed while only one line is active
  (same rule as the existing `ServiceLineChip`).
- **Clients** — genuinely **global, and must NOT be filtered**: one person, all services.
  Filtering clients by department would hide half a human's history and break read-across.
- **Leads** — global, filtered by `Lead.serviceLineId` (already exists from Phase 4).
- **Cases** — the one that really is per-department; the worklist filter already exists.

### 10.6 Revised build order
```
F  Department on User + Designation.serviceLineIds + ServiceLine.headUserId  ⭐ gating
   → read-across resolution + canEditCase (edit lock)
G  ClientDocument vault (migration) + CaseDocument.clientDocumentId
H  Admin restructure: Departments tab, global-vs-service settings
I  Dashboard / Clients / Leads department tabs
C  Open-case flow   (pick department → product → client)
D  Person screen    (read-only)
E  Assets in person sheet
J  Wills line goes live (stages authored by the Wills dept head)
```
**F first, always.** Switching on a second department before F exists exposes every case
to whoever picks it up. **G before H** — the Admin Departments tab is where sharing is
configured, so the model must exist first.

### 10.7 New open question created by Q4
**Who owns a document's department — the uploader, or the case it came from?** E.g. the
Wills team attaches a *bank valuation* from the mortgage file to read it. Re-stamp it as
"Wills", or leave it "Mortgage · shared"? **Recommendation: keep the ORIGINAL owning
department and record the attachment as the usage event** — a valuation re-labelled
"Wills" would misstate its provenance. **Ask him.**

### 9.8 ⚠️ NOT VERIFIED — check these before trusting the Phase A–B work
- **ESLint never completed.** A runner was built (`scripts/lint.cjs`) but produced no
  output three times in this environment. **Run `npx eslint src` yourself.**
  `tsc --noEmit` passed (exit 0) after every Phase A–B change.
- **The PowerShell console corrupted badly** (PSReadLine
  `ArgumentOutOfRangeException`; at one point it mangled its own working directory to
  `Desktop\Users\Lenovo\Desktop\zzzz`). **Open a fresh terminal.**
- **The dev server is STOPPED** — killed during the Prisma regen. Restart with
  `npm run dev`. The client IS generated (`caseParty`, `serviceLine`, `lead`,
  `stageSet` all verified present).
- **4 `ZZ*` clients remain** (ids 16, 19, 20, 21 — created 2026-09-14/16 by an
  EARLIER session, unreferenced). Totals are **52 clients / 41 cases = baseline**,
  so Phase A–B left nothing behind. The cleanup script correctly REFUSED to delete
  them. Left alone deliberately.
- **Uncommitted files that are NOT mine**: `src/components/chat/*`,
  `src/components/staff-chat/*`, `src/app/api/chat/*`,
  `src/lib/chat-auth.ts`, `src/app/api/state/route.ts`, `prisma/staff_chat.sql`.
  **Commit selectively.**

---

## 6. Key numbers to sanity-check
- 41 LoanCase rows, 52 Client rows, 3 ClientSession rows, 6 service lines,
  24 products, 0 cases without a service line.
- Legacy always-MORTGAGE backfill: 0 unassigned confirmed.

---

## 7. Decisions the user made (do not relitigate)

1. **Beaten bank legs stay visible**, greyed/collapsed under the winning parent,
   with a "Lost race" chip — *not* deleted and *not* hidden. Reason: the losing
   bank's valuation history matters for the buyout in two years.
2. **Parent case = the product-level record; children = bank legs.** The full
   "demote the parent" restructure was deliberately NOT done — every existing link
   and case number points at the parent, so it stays the first bank's leg.
3. **Product classification stays null** for existing cases — never guess.

### Environment gotchas hit this session
- `prisma generate` fails with EPERM while the dev server runs (it holds
  `query_engine-windows.dll.node`). Kill the dev server first, or run generate
  before starting it.
- The PowerShell/PSReadLine console corrupted repeatedly under long commands
  (`ArgumentOutOfRangeException: topActual value was -N`). Symptom: long commands
  produce no captured output and expected files never appear. Recovery: `cls`,
  short commands, or redirect output to a file and read it.
- **A killed command leaves a ZERO-BYTE output file that looks like a clean pass.**
  This nearly caused me to report "typecheck green" on a run that never executed.
  Always check for the exit marker: `node scripts/dump-lines.cjs <file> --verify`
  prints `COMPLETE exit=N` vs `INCOMPLETE`.
- **`node scripts/_run.cjs <command> <label>`** — the command comes FIRST. Passing
  them the other way round silently wrote the command as the filename.
- The editor's `insert_line` corrupted a 490-line JSX build twice (dropped and
  duplicated tags). For files that size, build from separate `partN` files and
  concatenate with a script — auditable and repeatable.
- TypeScript cannot narrow `me.caseId` (a parameter property) across `await`s.
  Copy it to a `const anchorId` first.

### Flow ordering that matters
Prisma schema change → `prisma generate` → code. Forgetting `generate` yields
"property X does not exist in type ClientSessionCreateInput" errors that look like
logic bugs but are just a stale client.
**New report:** Reports → "Bank win rate" by bank. **Declines excluded from the
denominator** — a bank saying no is not a bank we lost to.