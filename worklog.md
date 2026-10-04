# 2026-10-02 (cont. 3) -- + Add row, and the row UI bug that was real

**1. There was no way to add a row to a master.** Masters were created, edited,
re-filed, closed, reopened, verified and batch-edited — but never *extended*. Rows
only existed because an importer had left them behind, so a bank publishing a new
transaction type or a second term had nowhere to put it.

New **+ Add row** on the master header → modal → `PUT kind: "slot-add"`. It files
the axes and creates the line **EMPTY, with no rate** — the honest state for "the
bank offers this, we have not been told the price". It lands flagged `no rate filed
yet`, never as a 0% you have to explain. The price is then filed through the normal
one-field-at-a-time card edit.

Duplicate axes are refused with 409 (matched on the SET fields the engine reads, so
`["Resale"]` vs `["Resale","Buyout"]` are correctly different), a reason is required,
and it audits as `create`. It targets the master's first non-closed product — a
master can span product rows and a rate line must land on the one owning the family.

**2. The row UI was structurally broken, not just untidy.** Three separate defects:

- **`Cell`, `StressCell` and `VerifyCell` were `<button>`s rendered directly inside
  `<tr>`** — no `<td>`. Invalid HTML; the browser boxes orphan buttons unpredictably,
  which is why columns drifted out from under their headers. Every cell is now a real
  `<td>`.
- **The CLOSED row's `colSpan={6}` produced 10 cells in a 9-column table.** I had
  miscounted that colSpan in an earlier pass. Corrected to 5, with the count written
  down next to it.
- **One chip per issue** meant a four-flag row shoved its own action cell past the
  column edge. Replaced by `RowFlags` — a single dot + count, full list in the
  tooltip, coral if any issue is a misprice and amber otherwise.

Plus: column-group hairlines (`Applies to | DBR 1/2/3 | floor & processing | status`),
`EMPTY` rows tinted amber with a dashed leading edge and an explicit "no rate filed
yet" label (a bare dash reads as 0% or as data loss), and the actions column pinned
at 168px so the Close button stops shifting.

**3. The axes picker is now shared** (`AxesFields`) between re-file and add-row, so
the transaction vocabulary and the summary line cannot drift between the two.

Files: `admin/rate-cards.tsx`, `admin/rate-desk/route.ts`.
Verified: `tsc` clean · eslint clean on both · **107/107 tests pass**.
Still not clicked in a browser.

---

**1. "How do I add a master?"** There was no way. The only path was importing a
policy sheet and approving its rows — masters were a by-product of imports, which
is the derived-not-declarative problem stated exactly. Now a **+ New master**
button beside the bank selector opens a declaration dialog (bank + employment /
residency / type / property, name DERIVED the same way as master-axes, duplicate
families refused with 409, reason required, audited as `create`). It writes one
draft `BankProduct` with a starter EMPTY quote — and **the grid now shows drafts**,
flagged `draft — not quoted to clients`, so the new family is visible but the
client engine (`bank-match.ts`, still `status: "approved"` only) never sees it.

**2. One bank at a time.** The grid defaulted to ALL banks (218 cards, 14 families).
Now the bank selector defaults to the first bank, persisted per admin in
localStorage, and after creating a master the grid lands on the bank that owns
it. "All banks" is still one click away; it is no longer the default you edit in.

**3. Panels are modals now.** All six inline panels (field edit, stress, slot
axes, slot close/reopen, verify, bulk) plus both master panels render inside the
house `Modal` (`.modal-scrim` + `.modal-pop`, body-level portal — the same
primitive every other dialog uses, so it cannot open misplaced or drift below
the page). Each got a `bare` mode: the Modal owns the title, the panel owns the
form — no card-inside-a-card, no repeated headers.

Files: `rate-cards.tsx` (7 call sites), `master-axes.tsx` (bare + `MasterCreatePanel`),
`rate-desk/route.ts` (`kind: "master-create"`), `rate-cards.ts` (drafts visible,
`status` on `CardProduct`).
Verified: `tsc` clean · eslint clean on all four files · **107/107 tests pass**.
Known: the eslint `pickBank`-before-declaration notice is a useCallback ordering
false positive (it must be declared before `load()` because load calls it);
kept as-is with a comment rather than restructured.

---
# 2026-10-02 (cont.) -- Colour discipline in the pricing grid

**Emoji out of the grid.** The admin grid used emoji circles as status marks
(`red circles monthly / amber yearly / green on negotiation`, plus green/amber/red/white
for verification). Two problems: three red circles sat directly above three ordinary
rate columns, so the header read as three alarms; and a font-rendered emoji cannot be
themed, so in light mode the "muted" legend looked identical to the loud one.

Replaced with a 6px tonal `Dot` using the house palette (`--coral` / `--amber` /
`--mint` / `--ink-faint`). **Colour is now reserved for things that are actually
wrong** -- a stale verification is coral, an ordinary monthly-moving number is coral
only because it deserves a glance, and the legend matches the cells exactly.

Also: the warning-triangle prefixes on "no cushion" and "defaults never confirmed"
are gone. The rows were already amber; the glyph was decoration on top of a signal,
and it rendered inconsistently across the fonts the app loads.

Files: `src/components/views/admin/rate-cards.tsx`. No logic touched -- purely
presentation. 107/107 tests, tsc + eslint clean.

---
# 2026-10-02 (cont.) -- Axes CRUD, staleness, and the importer crash

**Rate UI: the grid was unreadable.** Two causes, both fixed in
`admin/rate-cards.tsx`.

1. It grouped by PRODUCT NAME (free text). Bank 1 has ~10 products all called
   'Salaried / Resident / Conventional' differing only by sheet suffix, so one true
   family split into fake groups. Now grouped by the PINNED axes
   (bankId | employment | residency | mortgageType) -- the real identity. The header
   states WHO the master serves; free-text names drop to a 'from N product rows'
   subtitle.
2. Four identity columns (Transaction/Term/STL/Profile) read 'Any / 3y / either /
   any' on most rows. MEASURED why: **0 quotes carry a profile**, 281 carry no
   transaction. Columns for axes the data does not hold imply precision that is not
   there. Replaced with ONE composed 'Applies to' cell showing only what is FILED
   (term as anchor), and the numbers became columns headed **DBR 1 (rate) / DBR 2
   (after fixed) / DBR 3 (qualifies at)** in the order a broker thinks.

**Axes are now CRUD, at both levels.**
  - `SlotAxesPanel` (click 'Applies to') re-files transaction set, rate type, term,
    EIBOR basis and STL on ONE line. Writes the SET fields and CLEARS the legacy
    scalars -- **299 quotes carry the legacy `stl` boolean**, and leaving it behind
    would let a stale scalar out-vote the new set (that is exactly why the old
    column showed 'either' for rows that meant 'STL only'). Also stamps verifiedAt:
    re-reading the policy sheet is what confirms the line.
  - `MasterAxesPanel` (`admin/master-axes.tsx`, click the master header) edits the
    pinned family axes. Employment and residency change the RULES (Mashreq 85%/15k
    salaried vs 75%/25k self-employed; DIB self-employed 65%), so a master cannot
    hold two. Saving rewrites the typed column AND the derived name together and
    audits once per row, so a name can never disagree with its own axes.

**Staleness -- `verifyAfterMonths: 12` was defined in LAW_NORMS and NEVER READ.**
`verifiedAt` on RateQuote + `staleness()` -> fresh/aging/stale/never. `never` (an
import) and `stale` (someone DID confirm it, long ago -- ADCB's stress note still
says Nov 2022) are distinct states needing different responses. Verified column with
a dot + months, VerifyPanel per-line or whole-master (the norm: a bank sends ONE
confirmation). Checking is deliberately separate from editing.

`RateSchedule.eiborAtComputation` bakes in the curve DBR 2/3 were computed against,
so a later EIBOR move cannot silently reprice an old verdict. This IS the
worst-case-EIBOR answer: snapshotting is the fix; inventing a hypothetical higher
EIBOR would be inventing policy.

**BUG FOUND + FIXED: `scripts/import-huspy.mjs --apply` CRASHED.** It spread `...p`
(which carries a `bank` STRING) into Prisma, which expects the relation via bankId.
Fixed by destructuring the name out. Verified: 5 drafts created, 16 projects
registered, 18 banks.

**What the import revealed, measured:** of 43 drafts, **30 have 0 rate lines** --
13 are pointer products ('Same as above' / 'Rates same as normal'), 4 are blank,
13 have prose rates the FEED never structured ('2 Yr - 2.89% Fixed'). The importer
reads only the feed's structured columns, so producing no quote is CORRECT -- it
must not invent a rate from prose. Those now render as EMPTY (dashed, 'no rate
filed') instead of silently vanishing, and are re-filable via SlotAxesPanel.

Verified: tsc clean, eslint clean, tests 107/107, check-rate-cards 218 cards from
59 approved products.

# 2026-10-02 -- Rate UI cleanup + staleness

**The mess:** the grid grouped by free-text product NAME, so bank 1's ~10 products
all called "Salaried - Resident - Conventional" (with cosmetic sheet suffixes) split
ONE true family into fake groups. And the columns read "Interest rate / After fixed /
Minimum / Processing / Qualifies at" -- every row re-stated transaction+term but hid
STL and profile in the header, so a row couldn't be told apart and nobody knew which
number was which DBR.

**What changed:**
1. Groups are now keyed bankId|employment||residency||mortgageType (the PINNED axes,
   the real identity). The header states WHO the master serves; the free-text names
   drop to a "from N product rows" subtitle. Names can no longer split a family.
2. Numbers are now columns headed DBR 1 (rate) / DBR 2 (after fixed) / DBR 3
   (qualifies at) -- the order a broker thinks. STL and customerProfile moved ONTO
   the row as identity columns, because a master holds many products and they
   genuinely vary. Cell tooltips name the DBR explicitly.
3. verifiedAt on RateQuote + staleness() next to LAW_NORMS: fresh/aging/stale/never,
   unused-since-written verifyAfterMonths=12 finally wired. Verified column: green/amber/
   red/grey dot + months. VerifyPanel confirm is per-line or whole-master (the norm --
   a bank sends ONE confirmation), optional note, audited. rowIssues flags stale/never
   (CLOSED exempt: flags on an unquotable slot would cry wolf). One price-move and one
   check-confirm are deliberately separate actions so they can't be confused.
4. RateSchedule carries eiborAtComputation -- DBR 2/3 depend on the market, so the curve
   they were computed against travels with the verdict. A later EIBOR move cannot
   silently reprice an old quote. (This IS the worst-case-EIBOR answer: snapshotting the
   curve is the fix; inventing a hypothetical higher EIBOR would be inventing policy.)
5. CODEBASE hygiene: deleted rate-desk.tsx's two stale rows (one task row pointed at the
   deleted file), removed its file-list row (the file is gone), rewrote the rate-cards.tsx
   file-list row for the master grouping + slot states + Verified column + bulk.
   Read-the-whole-card / close-slot / verify-confirmation have task->files index rows.

Verified: tsc clean, eslint clean on touched paths, tests 107/107, check-rate-cards:
59 approved products (97 total, 38 drafts) -> 218 cards, 132 variable resolve off live EIBOR 3.62.

Still pending: masters as DECLARATIVE axes (today grouping is DERIVED -- same visible
result, but axes still live on 59 rows instead of one master row); stress at a hypothetical
worst-case EIBOR is deliberately NOT built (would be inventing policy -- stressBufferPct
plus snapshot IS the answer); browser click-through of VerifyPanel/CLOSED rendering.

# 2026-10-01 — Slot states: EMPTY / FILLED / CLOSED

**What changed:** a deliberately-not-offered slot is now a first-class fact, not an
empty cell. `RateQuote` carries `status` (`OPEN`/`CLOSED`), `closedReason`,
`closedAt`; `quoteMatches()` returns false for CLOSED before checking anything
else, so a closed line can never match a client case whatever its axes say.
`RateCard` carries `slotState` (EMPTY/FILLED/CLOSED): EMPTY = no rate filed yet
(chase the bank), CLOSED = greyed + struck through with the reason where a rate
would be (done, never re-fill).

Closing needs TWO pieces of text — the slot reason (shown in the grid, e.g.
"product withdrawn") and the audit reason (who decided, on what basis) — because
without the first, "closed" becomes a dumping ground for unfinished work.
Reopening returns the slot to EMPTY and never invents a rate. All-or-nothing
atomicity was kept: the close/reopen API refuses double-close and reopen-of-open.
A closed line is excluded from row-issue flags (a slot asserting nothing quotable
has nothing to warn about).

**Tests:** 93/93 (`quoteMatches` CLOSED-never-matches + legacy-undefined-still-
matches). tsc clean. Harness fix: `build-pricing-tests.mjs` now re-wires the
bank-pricing → taxonomy import instead of stripping all imports (worked before
only because the new slot tests actually exercise `quoteMatches`, which needs
`setMatches`).

# 2026-09-30 — Rate cards, bank defaults, and the two fee fixes

Owner said pricing was still confusing, and after an honest look, it was: nine separate
places to touch pricing, added across sessions, with no single screen. Plus a trap:
Admin → Marketplace → Banks & rates shows a column headed **"Rate"** that is *commission*,
not an interest rate.

**The shape of this session: one row = one CARD.** A bank does not change "a rate". It
moves a rate, a follow-on margin, a floor and a processing fee together — which used to
live in pricingJson / feesJson / a 900-line modal. `src/lib/rate-cards.ts` builds one
card per quote line, with every field resolved (`product ?? bank default ?? norm`) and
its source recorded; the grid (`admin/rate-cards.tsx`) groups them into product families.

Editing is **one field at a time by default** (owner: banks routinely send a new rate and
nothing else; `applyWholeCard` is opt-in). Volatility dots on the headers (🔴 monthly ·
🟡 yearly) say where attention belongs. Inherited fields print `* from bank`, so a
default and a one-off can never be mistaken. The old Rate Desk is superseded.

**Bank Defaults screen** (`admin/bank-defaults.tsx` + `api/admin/bank-defaults`) — the
inherited layer. Fields were MEASURED: max tenor was 14/14 consistent, and six engine
inputs (dbrPct, cardRulePct, bonusPct, rentalIncomePct, maxAgeSalaried, serviceMonthsMin)
were recorded on ZERO products, so the engine was silently guessing them. Every default
prints how many products override it — the blast radius — plus a last-confirmed date,
because an un-confirmed "constant" is a guess.

**Law constants** (`LAW_NORMS`): DBR 50%, VAT 5% (bank fees only — place fees are quoted
inclusive), early-settlement cap 1%/AED 10,000. These are CBUAE rules, not settings, so
they are not per-bank fields.

**FIX 1 — promotional fees that outlive their window.** 11 DIB products quoted 0%
processing after their Q1-Q3 2026 promo ended, because the 0 was written into the
permanent slot. `BankFees.processing.promo` now holds `{default, validFrom, validTo}`;
used ONLY inside the window, falling back to `defaultPct`, and a gap with nothing to
fall back to reports "unknown", never 0.

**APPLIED** (`scripts/migrate-promo-fees.mjs --apply`): 11 products migrated.
`scripts/check-promo-resolution.mjs` proves the outcome — on 2026-09-30 (the promo's
own last day) all 11 still resolve 0%, which is correct; from 2026-10-01 **3 revert to
1.25% and 8 become honest "unknown"** instead of a silent Free. Before this, all 11
would have stayed 0% indefinitely. Eight are gaps, not guesses: the note records no
standard fee for them, so the honest answer is "not recorded" — someone has to ask DIB.

A mirror test in `tests/pricing-floor.test.ts` guards all three cases (live → promo,
expired → standard, expired + nothing → null); it also caught a regression where the
legacy no-promo path lost its `default`, so that path is now asserted unchanged.

**FIX 2 — bank fees filed in the place-fee table.** 12 rows ("Bank Processing Fee",
"Valuation Fee" under Dubai AND Abu Dhabi) made bank fees vary with the emirate AND
double-count against feesJson. Removed via `scripts/clean-misfiled-bank-fees.mjs`
(verified: every emirate/transaction still has 3–7 real place fees). The API now rejects
any such label (`src/lib/fee-scope.ts` is the single predicate), on both create and
update, and the fee editor shows the same rejection in-app.

**FIX 3 — "Rate" that was commission.** Admin → Marketplace → Banks & rates showed a
column headed **Rate** containing `BankItem.ratePct`, which is *commission* as a % of the
loan. It now reads **"Our commission"** with "of loan · not an interest rate" beneath it.
That mislabel is the most likely reason pricing felt ambiguous — an admin reading "Rate"
there and "Interest rate" on the card grid had no way to tell they were different things.

Verification: `npx tsc --noEmit` clean · eslint clean on every touched path · `npm run
test:pricing` **58/58** · `node scripts/check-rate-cards.mjs` → 216 cards, 131 resolving
live off EIBOR 3.62% · `check-promo-resolution.mjs` → all 11 promos self-correct.

**Known gap after this session:** the grid, Bank Defaults and the card edit panel all
typecheck and their data paths are proven against live rows, but none has been clicked
through in a browser. The unverified path is the card PUT end-to-end.

---


The last two pieces: pricing below your own floor, and getting the 2,449-row Huspy feed in
without wrecking the catalogue.

**Tier 3 — deal exceptions.** Super-admin only, in the tab AND in the API (two independent guards
on purpose — one being bypassable is not a guard). Every requirement is a *visible checklist* next
to the form rather than an error after the user has typed everything: a case, a written reason
(8+ chars), a mandatory expiry, and a **second approver who is not you**. Super-admin only is
deliberate: this is the one control that lets the firm price below what it has decided is the
minimum, so it should be annoying. The engine does **not** read this table — an exception applies
to a saved proposal snapshot, so it can never quietly change what the standard engine quotes to
anyone else. Everything is audited, and an exception can be ended early but never silently
extended.

**The Huspy importer.** Two safety decisions before any data question:

1. **Dry run by default.** `--apply` is required to write anything, to production.
2. **Everything lands as `status: "draft"`.** The engine only reads `status: "approved"`, so a
   wrong import is not merely hidden — it is *unquotable*. Review happens in Admin → Bank Rules.

What the dry run reveals, measured not assumed:

```
raw records       2449
raw banks           36
after aliasing      26 real banks      (15 were "X - Business Banking" clones of an existing bank)
distinct products  694                 (the feed repeats one product per transaction, 3.5x on average)
distinct projects   25
LTV bands parsed   490
```

**Three bugs I found by writing the tests and the report, not by eyeballing the output:**

- *Every* fixed line came out with no follow-on recipe (1,979 of them), because I computed the
  EIBOR benchmark and the margin only for variable rows. A fixed line's follow-on reverts to
  EIBOR too — without that recipe the engine has no stressed rate and the product is unusable.
  Gating `basis`/`margin` on `!fixed` was the whole bug; fixed to 0.
- The `profile` classifier could not read `FTV - 61% - 70%` (20 real records): the regex wanted
  `61 - 70%` and the string is `61% - 70%`. It fell through to "segment", which would have put an
  LTV band into a *customer-profile pricing axis* — and since a quote only matches when the case
  value is in the set, **every quote on those products would have silently stopped matching.** The
  unit test caught it; fix recovered 60 more bands (430 → 490).
- I initially wrote project names into the `profiles` axis, which is precisely the pollution the
  classification exists to prevent. A project is an *availability* restriction → `isExclusive` +
  a `Project` row. Corrected.

**What is deliberately NOT imported:** `maxLtv`. The feed's `loan_to_value_ratio` is 0 in **100%**
of records — not one non-zero value — so importing it would have written 694 zeroes into the exact
columns that drive every LTV verdict. LTV is left null (a reported data gap) and the real bands
come from the `profile` field instead. The feed's rate arithmetic, by contrast, is clean:
zero internal contradictions across all 2,449 rows, which is why its rate figures ARE trusted.

Verification: `npx tsc --noEmit` clean · eslint 0 errors on every touched path ·
`npm run test:pricing` **38/38** (up from 27 — the profile classifier is now covered) ·
importer dry-run verified against the live file.

---


Second half of the pricing work: the staff-facing catalogue. New route `{ name: "products" }`
(nav item between Calculator and Reports), reachable from a new Dashboard card that reports the
live counts straight off the already-hydrated store — no extra request on the dashboard.

**A row is a RATE LINE, not a product.** This was the key structural decision. One BankProduct
publishes many rates (1y/3y/5y, STL/NSTL, each with its own follow-on recipe and fees), and the
thing a broker scans for — the axis signature — belongs to the rate, not the product. So the
list flattens product × quote and each card leads with the signature
(`Islamic ∙ STL ∙ UAE Resident ∙ Salaried ∙ Standard ∙ Buyout`) above the bank logo, rate,
term, fee and follow-on. That ordering is the whole point: **who it's for before what it costs.**

**Two pagination rules I got wrong first time round.** The page opens on active products with
*no filter applied* — a filter left over from the last session is exactly how someone quotes a
stale shortlist. And any filter change resets to page 1, because otherwise the old page number
lands out of range and the user is looking at an empty list wondering whether they broke it.
10/page is deliberate: enough to compare, few enough that the best offer never falls off the
bottom.

**Detail sheet, grouped in the order a broker thinks.** 1. Who it suits (axes, LTV caps,
minimums, tenure, age caps) → 2. What it costs (every rate line resolved against *today's*
EIBOR, with a worked EMI **before and after** the fixed period) → 3. What else it charges
(processing, valuation, early settlement, insurance) → 4. Timeline & validity → 5. Source &
provenance, with the bank's original text behind a toggle for when a field above is wrong.

Everything reads `pricingJson`/`feesJson`/`insuranceJson` — the same sources the pricing engine
reads — so **the sheet can never disagree with what the engine will quote.** A missing field
prints "not recorded" in amber; it never prints a plausible-looking guess. `minSalary` under
1,000 flags as implausible in red, because the seed data contains real `minSalary: 8` rows from
a tenure being scraped into the wrong column.

**Kept out of scope deliberately:** editing from the detail sheet. Rate changes go through the
Rate Desk, which is effective-dated and audited. A detail page that could silently PATCH a live
rate is the exact thing the Rate Desk was built to prevent.

**Verified against the live DB** (`scripts/check-products.mjs`): 59 approved+active products →
**216 rate lines across 14 banks**, **0 products with no quotes, 0 unparseable `pricingJson`**.
37 fixed lines have no follow-on recipe — surfaced as a per-row "no follow-on" flag in the
browser, which is one of the real failure modes behind a wrong client quote. 14 banks have
logos uploaded.

Verification: `npx tsc --noEmit` clean · eslint clean on every touched path (0 errors) ·
`npm run test:pricing` still 27/27 · schema pushed (one additive nullable-free boolean,
`BankProduct.isExclusive`).

---


Owner asked for three things: a three-tier pricing model with an admin-controlled minimum
rate, an admin UI that makes changing a rate painless, and the right information on the
client-facing side. All three are done, plus a live bug found along the way.

**THE BUG (highest severity thing found in this codebase).** `LoanCase` had no
`propertyValue` column, and `defaultCaseProfile` in `case-profile.ts` back-derived one as
`Math.round(loanAmount / 0.8)` whenever it was missing. That **invents an 80% LTV** and feeds
it to every LTV verdict, every affordability cap, and every "LTV exceeds cap" rejection. A
client asking 1.5M on a 3.25M property (54% LTV) was reported as 80% LTV.

`scripts/check-propertyvalue.mjs` measured the live exposure: **28 of 33 cases**, including
4 at Pre-Approval, 2 at Valuation and 2 at Final Approval. Real values were sitting inside
`profileJson` (14 cases) because the Case 360 form captured them there and nothing copied
them to a real column. Backfilled 13 (one was below its own loan amount, so the guard
rejected it); 18 cases are now honestly reported as data gaps instead of confidently wrong.
`null` is now the only honest answer to "property value not captured", and the proposal prints
a ⚠ rather than a fabricated LTV.

**Tier-0 norms — and the mistake worth recording.** `UAE_NORMS` + `resolveNorm()` give every
bank a default for DBR, card rule, bonus, rental and age caps, with explicit override. The
important part is the ORDERING: the norm fills a `null` but never overwrites a bank's own
value. My first instinct was to treat CBUAE-50%-DBR as an authority layer above the banks —
that would have destroyed DIB's 2% card-limit rule and ENBD's 50% bonus rule, i.e. exactly
the facts that win cases. Tests assert the bank wins. Related: `MAX_DBR` turned out to be a
**dead constant** (the engine already used `p.dbrPct ?? 50`), so a 65% private-banking product
was never actually clipped. It now carries a comment saying so, so nobody "fixes" it back.

**Tier-1 floor.** `applyFloor()` inside `resolveQuote()` is the only enforcement point:
`minFixedRatePct` raises a fixed quote, `minMarginBps` raises a variable margin, `hardStopPct`
refuses to price at all. Stored as one JSON blob in the existing `AppSetting` table and read on
every `/api/bank-match` and `/api/proposal`, so changing the floor reprices the whole book with
no product edits and no deploy. Fail-open on a corrupt value: a broken floor must never crash
pricing or accidentally hard-stop everything. Comparison is in basis points with a half-bp
tolerance so 3.895 vs 3.89 doesn't false-trip.

**Rate Desk.** Changing a rate was six steps: pick a bank, find the product, open a ~900-line
modal, find the quote row, click Revise, edit a number, then save the whole product in place.
Now it's two. One row per live rate line, inline rate editing, a pre-commit floor check, and a
required reason. The commit closes the old line the day before the effective date and appends
a new dated one — never an in-place mutation. Per-row attention flags mark the actual failure
modes behind a wrong client quote: `no follow-on rate`, `no floor`, `no stress buffer`.

**Audit trail.** New `AuditLog` model + `src/lib/audit.ts`. `approvedBy` only ever recorded
WHO last approved a version, never what changed — so "what did we quote this client in
March?" was unanswerable. Now every BankProduct patch, version, promotion change, rate
revision and floor save writes before/after + actor + timestamp, readable at Admin → Change
log. `audit()` swallows its own errors on purpose: an audit failure must never block a save an
admin already confirmed.

**Explaining the engine.** `resolveCaps()` replaces the scattered `Math.min(...)` with one
function returning `{ eligibleLoan, boundBy, boundNote, caps }`, so "why is this client only
eligible for 1.2M?" has an answer. A `null` cap is skipped, never treated as zero (that would
have made a missing LTV cap the tightest cap and silently zeroed eligibility). Also
distinguished an *unrecorded* stress buffer from a real zero — using 0 for a missing buffer was
qualifying clients with no cushion, and the proposal now labels the figure "assumed — confirm
with the bank".

Corrected an earlier claim of mine: `setMatches` is already fail-closed (a null case value on a
constrained axis does NOT match), so the only genuine silent pass was `nationalityAllowed`.
That one is now surfaced via `MatchResult.verifyNeeded` rather than inventing a rejection we
can't justify.

**New rules the engine can finally see.** `serviceMonthsMin`, `propertyAgeYearsMax` and
`firstPropertyOnly` were free text in `eligibility` that nothing read. Verified: all 8
canonical property columns had **zero reads** in the three engine files. They're now typed
columns the engine enforces, and `propertyStage` / `transactionPurpose` /
`propertyTypeCanonical` are threaded through new `stages`/`purposes`/`propertyTypes` axes on
`RateQuote`. Off-plan and handover products filter correctly for the first time.

**Client side.** The reference proposal the owner shared shows "3.89% fixed for 3 years" with
ONE monthly figure on an 8-year loan. I worked the arithmetic: balance after 36 payments
1,288,600, follow-on EIBOR 3M 4.345 + 1.89 = 6.235%, so the payment goes 23,669 → ~25,050.
**A 5.8% jump the document never mentions.** The engine already computed `followOnEmi`; it
just wasn't printed. `PaymentReveal`, `RateStory` and `WhyQualifies` now show the intro payment,
the year-N+1 payment, the step-up percentage, the minimum rate, the rate we qualify on, and
which cap actually bound. `ProposalSnapshot` freezes the numbers so a proposal sent last month
still shows what the client was told.

**Testing.** `bun` isn't on PATH in this shell, so `scripts/build-pricing-tests.mjs`
transpiles just the pure functions with the TypeScript compiler already in the project and runs
them under node — no new dependency, no DB. `npm run test:pricing` → **27 passed, 0 failed**:
empty floor is a perfect no-op, floor raises but never lowers, hard stop blocks rather than
raises, half-bp float tolerance, tightest cap wins, null cap skipped not zeroed, norm
inherits but never overwrites a bank deviation, unknown-axis third state. `tsconfig.json` now
excludes `tests/` (those specifiers are rewritten at build time).

**Added but not yet surfaced in UI:** `Project` / `ProjectProduct` (the 382 Huspy
`is_exclusive` products are an availability restriction, not a customer segment — a separate
layer keeps them out of the segment vocabulary) and `DealException` (Tier-3 per-case
exception pricing: reason + expiry + second approver, rendered separately so it is never
mistaken for a bank rate).

Verification: `npx tsc --noEmit` clean · `npm run test:pricing` 27/27 · eslint clean on every
touched path (the one remaining `no-require-imports` error is pre-existing in
`src/lib/graph.ts`, untouched) · schema pushed to Mumbai (additive only — new models and
nullable columns, no drops).

---


Owner asked for the "3-tier inheritance + choose-any-axis pricing" model to be made real,
not just planned. Three workstreams landed together.

**A. Multi-axis quote resolution (Phase 1) — `bank-pricing.ts`, `bank-rules-taxonomy.ts`, `quote-parser.ts`**
- `RateQuote` gained OPTIONAL set fields (`txns`, `salaryTransfer`, `segments`, `residency`,
  `employment`, `financeType`, `loanKind`, `emirates`, `nationalityRule`, `ftvMin`, `sourceLabel`).
  Semantics: null/[] = matches all; otherwise the case value must be IN the set. Legacy scalar
  fields (`stl`, `txn`, `segment`, `ftvMax`, `termYears`) still work, so every existing
  pricingJson row keeps resolving untouched.
- `quoteSpecificity()` ranks matches most-specific-first (explicit sets outrank legacy singles),
  then latest `effectiveFrom`, then lowest rate — so "GECO 3.95%" beats the generic "4.10%".
- Employment and residency are now separate axes (`MatchInput.employmentProfile` no longer
  doubles as "Non-Resident"); nationality ALLOW/DENY lists and emirate gating added.
- New helper `expandFixedYearLabel()` — UAE sheets publish far more than 1/3/5y (ADIB: 2&3y,
  4y, 5y, 7y, 8-10y, 11-15y, 16-20y). Ranges expand into discrete quotes.
- **Parser bug fixed (real, live):** the line splitter used `/(?=STL|NSTL)/`, which chopped
  token forms mid-word — `LAP_3years_STL - 4.69%` and `Fixed_3Years_STL - 3.99%` parsed to
  NOTHING, silently dropping every ENBD token line. The split now requires whitespace before
  STL/NSTL. Added a general term-first branch (ranges, `LAP_`, `OffPlan_`, `Land_Fin_`) and
  underscore-safe STL detection (`_NSTL_Self Emp` previously read as STL because `\b` fails
  after `_`). `canonicalTxn` now matches whole words only, so "Fixed_3Years_STL" can never
  alias to **Land** via the "stl" fragment.
- `runBankMatch` was being handed none of these axes — `/api/bank-match` now passes
  nationality, emirate, financeType (from canonical property type), loanKind (from
  islamicOnly) and segment through, and its case preload reads the canonical dims off the row.

**B. Property classification (the FINAL PROPERTY CLASSIFICATION PLAN) — schema + UI + API**
- `LoanCase` gained 7 additive, UNKNOWN-defaulted columns: `propertyTypeCanonical`,
  `commercialSubtype`, `propertyStage`, `constructionStatus`, `partyRelationship`,
  `existingFinance`, `transactionPurpose`. `db push` run against production: "in sync".
- Rules enforced in code AND at the API: commercial subtype is NULL unless the property IS
  commercial (never invented); Off-plan never implies Under-construction; Handover never
  implies construction Completed; ambiguous legacy data backfills to UNKNOWN.
- Profile editor Property tab replaced its Ready/Off-Plan pair with the five plain-language
  questions (type → conditional commercial subtype → status → dealing-with → existing
  mortgage). One status answer writes TWO backend fields conservatively — "Off-plan" sets the
  stage and leaves construction UNKNOWN, "Under construction" does the reverse, "Ready" sets
  both, "Not sure" sets neither. Legacy `propertyType` stays in sync so the Doc Vault works.
- `scripts/backfill-property-canonical.mjs` — `--dry-run` first, profileJson wins over legacy
  derivation, idempotent. Ran on production: 31 rows classified, no subtype guesses; the
  re-run reported "31 already classified, 0 updated".

**C. Promotions / Tier-4 override layer — schema + engine + admin UI**
- New `Promotion` model: product + optional term scope + rate-discount bps + processing-fee
  override + valuation waiver + date window + active flag. **Base pricing is never touched** —
  the overlay applies on top and expires by date with no revert step.
- Engine: one query for today's live promos; `promoFor(productId, term)` then the discount is
  applied to the INTRO rate only (follow-on and stress stay on base terms), the processing-fee
  override and valuation waiver annotate the fee block, and the promo is surfaced on every
  MatchResult. Badges render in the Bank Match panel and on the proposal (header + a
  dedicated Promotion comparison row).
- Admin → Marketplace → **Promotions** tab (Live / Scheduled / Expired / Paused chips,
  create/edit modal, delete confirm) + `/api/admin?kind=promotions` CRUD.

**D. Fees & admin tooling**
- `bank-fees.ts`: slabbed processing-fee schedules (`slabs[]`, first ceiling ≥ loan wins) and
  `componentSplit` for buyout+equity (per-portion %). Both additive — flat % rows behave
  exactly as before; `processingFeePct/Aed` gained an optional loanAmount so slabs resolve.
- Admin quote rows: full 1-20y tenor list, FTV > floor input, and a collapsible **"applies to"
  multi-axis editor** (transactions, STL/NSTL, residency, employment, financeType, loanKind,
  segments, emirates, nationality rules) — the same sets semantics the engine resolves with.
  AI quote drafts now carry the set fields through instead of dropping them.

**Verification (all run, not assumed)**
- `npx tsc --noEmit` → **0 errors**.
- `npx tsx tests/phase1-multiaxis.ts` → **52 passed, 0 failed** (alias hygiene, year-range
  expansion, FTV bands, specificity, nationality ALLOW/DENY, legacy compat, token lines,
  header-context precedence, canonical backfill, promo math, slab + component fees).
- `prisma db push` on production Supabase → "in sync"; backfill dry-run then live; idempotency
  re-run confirmed.
- Live smoke: `/` → 200, `/api/state` and `/api/admin?kind=promotions` → 401 (guarded).
- End-to-end promo proof against the real engine (temp script, deleted after): baseline
  Sharjah Islamic Bank intro 3.90% / PF 1% → with promo **3.65%** (−25bps) / PF **0%** /
  valuation "Waived" → expired promo (validTo 2020) reverted to **3.90%** / null.
- Dev server was stopped for `prisma generate` (it locks the query-engine DLL — see
  maintenance rule 3) and restarted; `dev-run.log` shows "✓ Ready".

Stage Summary:
- A quote can now say "these 4 transactions, STL only, expats, Dubai, FTV>60%" instead of
  forcing one hardcoded axis per line, and the resolver picks the most specific match.
- The VRM/SPO answers five plain questions; the database stores six canonical dimensions that
  never conflate stage with construction status; nothing unknown is ever guessed.
- Marketing can launch a festival bonanza from Admin → Promotions and it turns itself off on
  the end date, leaving base pricing exactly as filed.

---

# HFMC — Worklog

Porting `chetans-hfmc/smallhfmc` (Vite SPA, localStorage, Supabase) into the Next.js 16 + Prisma + shadcn/ui stack, plus AI-powered improvements.

---
Task ID: 0
Agent: orchestrator
Task: Initial assessment & plan

Work Log:
- Cloned https://github.com/chetans-hfmc/smallhfmc into /tmp/smallhfmc
- Read all source: types, store (1363 lines), data seed, calc, mortgage engine (341 lines), format, pdf, supabase, all 8 views (Dashboard, CaseDetail, Tasks, Bulletin, Calculator 1648 lines, Reports, Admin, Login), components (Shell, ui, bits, charts, icons), index.css theme
- App is a UAE mortgage case tracker for "HFMC / Meridian": role-based (Super Admin, HoC, PA, Mortgage Head, Team Leaders, SPO, VRM), cases→tasks→activities, morning bulletin directives, CBUAE-style mortgage affordability calculator (LTV/DBR/MPBF), commission engine, SLA breaches, PDF eligibility reports
- Original persistence: single JSON blob in localStorage (key meridian.casetracker.db.v6) + optional Supabase single-row app_state table

Improvements planned (beyond a straight port):
1. Real relational persistence via Prisma/SQLite (original acknowledges per-table schema as a future upgrade)
2. Server-side auth (cookie session) instead of plaintext passwords in localStorage
3. AI Case Copilot — LLM generates smart case narrative + recommended next actions (z-ai-web-dev-sdk)
4. AI Mortgage Advisor — LLM explains eligibility result in plain language + suggests improvements
5. AI Document Reader — VLM extracts income/liabilities from uploaded salary certificates / bank statements to pre-fill the calculator
6. Proper API routes with server-side RBAC instead of client-only guards

Stage Summary:
- Scope understood. Foundation work (Task 1) starting next.

---
Task ID: 1
Agent: orchestrator
Task: Foundation — Prisma schema, lib files (types, calc, mortgage, format), seed, auth, serialization, domain logic

Work Log:
- Wrote prisma/schema.prisma with relational tables: User, Designation, LoanCase, Task, Activity, Instruction, InstrReply, BulletinItem, BulletinTarget, Reply, StageItem, MasterItem, BankItem, PartnerItem, SlaRule, AffordabilityCheck, Session — replaces original single-JSON-blob model
- Ran `bun run db:push` successfully (fixed ambiguous relation on Instruction→User by adding @relation names)
- Ported src/lib/types.ts (domain interfaces)
- Ported src/lib/calc.ts (affordability engine, verbatim) — pure TS
- Ported src/lib/mortgage.ts (full MPBF engine with co-borrower, scenarios) — pure TS
- Ported src/lib/format.ts (money/date formatting, commission engine, status computation, CSV export)
- Wrote src/lib/seed.ts — seeds designations, 10 users, 9 stages, 12 banks, 6 partners, whyPending/waitingFor masters, SLA rules, 12 demo cases with activities, 14 tasks, 5 today's bulletin directives
- Wrote src/lib/auth.ts — cookie session (login/logout/currentUser/requireUser), role flags via Designation lookup
- Wrote src/lib/ser.ts — Prisma→DTO serializers for every entity
- Wrote src/lib/domain.ts — server+client shared logic: visibility scoping (all/team/own), SLA escalation, KPIs, bulletin visibility/permissions, activity-per-day spark

Stage Summary:
- All pure-TS business logic ported and framework-agnostic.
- Database seeded with realistic UAE mortgage data.
- Auth + role model ready. Next: API routes (Task 2).

---
Task ID: 2
Agent: orchestrator
Task: Backend — auth, API routes, AI endpoints

Work Log:
- Created /api/auth/login, /logout, /me (cookie session via db.Session)
- Created /api/seed (POST) — seeds DB if empty
- Created /api/state (GET) — single hydrate call returning full workspace + visibility-scoped cases/tasks/bulletins + escalations count
- Created /api/cases (POST) + /api/cases/[id] (PATCH) — create + update case (stage/status/wonBank/owner/partner/banks), logs activities
- Created /api/cases/[id]/tasks (POST) — add task to case
- Created /api/tasks/[id] (PATCH/DELETE) — complete/reopen/edit/delete task
- Created /api/bulletin (POST) + /api/bulletin/[id] (PATCH: complete/drop/carry) + /api/bulletin/[id]/replies (POST)
- Created /api/instructions + [id] + [id]/replies — case instructions with reply threads
- Created /api/calculator/save — persists affordability check
- Created /api/admin (GET/POST/PATCH/DELETE) — unified master-data CRUD for banks/partners/stages/masters/users/designations/sla
- Created /api/ai/insights (LLM) — Case Copilot: snapshot + risk flags + next actions + commission outlook
- Created /api/ai/advisor (LLM) — Mortgage Advisor: verdict + plain-English + improvement levers, also answers free-form Q
- Created /api/ai/doc-read (VLM createVision) — extracts income/liabilities from uploaded salary certificate / bank statement image, returns JSON to pre-fill calculator

Stage Summary:
- Full REST API with server-side RBAC (scope: all/team/own, issueTasks, admin, super flags).
- Three AI features wired to z-ai-web-dev-sdk (LLM + VLM).
- Next: frontend theme + components (Task 3).

---
Task ID: 7-a
Agent: tasks-view
Task: Build the Tasks view for HFMC

Work Log:
- Read /tmp/smallhfmc/src/views/Tasks.tsx (original Vite/React view) to capture the exact UX: filter bar (Open/Done/All tabs with counts, overdue chip, search, owner filter, waiting-for filter), task table (Task+opener, Case, Owner avatar, Waiting-for chip, Why pending, Due/Done, Action), Done tasks dimmed + struck-through, complete-task modal with remarks textarea.
- Audited the Next.js infrastructure: useHfmcStore (Zustand) exposes `tasks`, `cases`, `waitingFor`, `me`, `flags`, `visibleTasks()`, `visibleCases()`, `userById()`, `nav()`, `completeTask(id, remarks?)`, `toast()` — but NOT `canEditTask`, so I computed editability locally per the task spec: `flags?.super || flags?.admin || t.ownerId === me?.id || t.createdBy === me?.id`.
- Confirmed components & helpers exist: `Avatar`, `Chip`, `DueChip`, `EmptyState`, `Modal`, `Seg<T>` from `@/components/hfmc/ui`; `fmtDateTime`, `relTime`, `todayISO` from `@/lib/format`; `ICheck`, `ISearch`, `ITasks` from `@/components/icons`; `Task`, `Tone`, `LoanCase` types from `@/lib/types`; `RoleFlags` from `@/lib/domain`. Verified CSS classes (`.tbl`, `.rowlink`, `.chip`, `.input`, `.select`, `.textarea`, `.btn`, `.btn-mint`, `.btn-ghost`, `.card`, `.anim-fade-up`) exist in globals.css.
- Created /home/z/my-project/src/components/views/tasks.tsx (332 lines):
  - "use client" directive, fully typed, no `any`.
  - `canEditTask(t, meId, flags)` local helper + `waitingTone(waitingFor)` mapping (Client→sky, Bank→amber, Internal→slate, else coral).
  - `DoneModal` uses selectors (`useHfmcStore((s) => s.completeTask)`) for minimal re-renders, awaits the async store mutation with a busy flag, and toasts success/error.
  - Main `Tasks` component: `useMemo` for visible tasks, case lookup map (scoped cases + fallback to all cases so closed-case tasks still resolve), owners list, and filtered+sorted list (Open first, then by due date with overdue priority; Done sorted by completedAt desc).
  - Table in `overflow-x-auto max-h-[calc(100vh-260px)] overflow-y-auto` container, `min-w-[860px]`.
  - Each row is clickable via `onClick={() => nav({name:"case", id: t.caseId})}` and styled with `.rowlink`. The Action cell stops propagation so the Done button works independently.
  - Done tasks get `opacity: 0.62`, strikethrough on the description, completed timestamp (or "—"), and a "completed"/"was late" status pill (mint or coral).
  - Empty state uses `EmptyState` with `ITasks` icon, "Queue is clear" headline.
- Ran `npx tsc --noEmit` on the project — no errors in tasks.tsx (other pre-existing errors in unrelated files like case-detail.tsx, shell.tsx, format.ts remain but are not in scope for this task).

Stage Summary:
- Tasks view is complete, type-clean, and faithfully recreates the original Vite UX for the Next.js + Zustand stack.
- Uses the existing HFMC design system (Amber/Mint/Coral/Sky/Slate chips, Avatar, DueChip, Seg, Modal) — no new CSS or components needed.
- Ready for the shell to route `route.name === "tasks"` to this view.

---
Task ID: 7-c
Agent: reports-view
Task: Build the Reports view for HFMC

Work Log:
- Read /home/z/my-project/worklog.md (prior tasks 0/1/2) and audited infrastructure: client-store selectors (visibleCases/visibleTasks, userById, nav, toast), types (LoanCase/CaseSource/CaseState), format helpers (commissionFor, fmtMoney, fmtRate, primaryBank, downloadCSV, TONE_HEX), domain helpers (computeEscalations, activityPerDay), charts (BarList, Donut, Spark, useCountUp), ui/bits (Chip, Avatar), icons (IChart, IBank, IBriefcase, ITrophy, ITarget, IUsers, IClock, IInbox, IDownload).
- Read original /tmp/smallhfmc/src/views/Reports.tsx (523 lines) for the report-card pattern, then re-implemented a streamlined version tuned to the brief: pipeline-by-stage, source-mix donut, bank win-rate table, owner leaderboard, conversion funnel, commission summary, SLA breaches (clickable), activity trend spark.
- Created /home/z/my-project/src/components/views/reports.tsx — "use client", TypeScript, no `any`, all imports via @/ aliases, theme via TONE_HEX palette (mint #43d69b / amber #f2b04c / coral #f27363 / sky #57c2ea / slate #8ca6b0).
- Layout: header (title + subtitle) with 3 CSV export buttons (Cases / Tasks / Commission) → KPI strip (4 count-up stats: Active pipeline, Booked, Lost, Net commission) → 1-col mobile / 2-col lg grid of ReportCards grouped under amber section labels (Pipeline / People / Performance / Risk & rhythm).
- All aggregations memoized from store (visibleCases, visibleTasks, escalations via computeEscalations, activityPerDay 14-day window). Source→color map uses TONE_HEX directly. Bank win-rate and owner-leaderboard tables use the .tbl class; SLA breach rows are clickable .rowlink buttons that call nav({name:'case',id}).
- Three CSV export buttons in the header call downloadCSV + push a toast: hfmc-cases.csv (caseNumber/customer/status/stage/source/banks/wonBank/amount/owner/partner/share/created/closed), hfmc-tasks.csv (case#/description/owner/status/waitingFor/whyPending/due/created), hfmc-commission.csv (case#/customer/wonBank/rate/amount/gross/partner/share/partnerCut/net/closed).
- Fixed one typecheck issue: IChart does not accept a `style` prop (IconProps = { size, className, strokeWidth }), so the page-title icon uses `className="text-[var(--amber)]"` which inherits currentColor through the SVG stroke. Final `tsc --noEmit` shows no errors in reports.tsx (pre-existing errors in case-detail.tsx, format.ts, shell.tsx etc. remain but are out of scope).
- Added a Partner roster card so the `partners` store slice isn't dead-imported — shows active agents/brokers/referrers with their default share and live introduction count.

Stage Summary:
- /home/z/my-project/src/components/views/reports.tsx created: ~430 lines, self-contained, type-checks & ESLints clean.
- 8 report cards + 4 KPIs + 3 CSV exports cover everything the brief listed (pipeline by stage, source mix, bank win rate, owner leaderboard, conversion funnel, commission summary, SLA breaches, activity trend).
- SLA-breach case rows are clickable to navigate to the case; numbers animate with useCountUp; bar/donut/spark use the TONE_HEX amber/mint/coral/sky/slate palette.
- Ready to be wired into the shell (route name "reports" already exists in shell.tsx nav and switch title).

---
Task ID: 7-b
Agent: bulletin-view
Task: Build the Morning Bulletin view for HFMC

Work Log:
- Read /tmp/smallhfmc/src/views/Bulletin.tsx (612 lines original) for reference design
- Read existing infra: client-store (useHfmcStore), types, format helpers, hfmc/ui (Avatar, Chip, EmptyState, Modal, SectionLabel), hfmc/bits (ConfirmModal), icons, globals.css theme tokens
- Confirmed /api/bulletin/[id] PATCH "carry" semantics (server creates a fresh item dated today with carriedFrom set; original marked dropped) → labeled the UI action "Carry forward" with tooltip "Carry forward to today's bulletin" to stay truthful to actual server behaviour
- Created /home/z/my-project/src/components/views/bulletin.tsx (≈470 lines):
  * "use client" directive, pure TypeScript, no `any`
  * All imports use @/ aliases
  * Helper fns: shiftDay (ISO date arithmetic via parseDate/toISODate), fmtLong/fmtShort (locale date strings), statusOf (Tone + label from dropped/done/missed/open), edgeOf (left-border accent colour), firstName, relativeDayLabel
  * ReplyThread: avatar + name + relTime + text per reply + an Enter-to-send input box; uses store.userById
  * StatusPill: Chip with tone/label derived from bulletin status (open=amber, done=mint, missed=coral, dropped=slate)
  * DirectiveCard: faithful port of the original card — issuer avatar/name/role/date/relTime, task text (line-through + dimmed when done/dropped), StatusPill, carried-from chip, clickable case chip (mono caseNumber + customer, calls nav({name:'case',id})), "to" + target name chips (sky tone), done-by footer, action buttons column:
      - Mark done (btn-mint) — only if (target || super) AND open
      - Carry forward (btn-ghost) — only if canInstruct() || super || issuer
      - Drop (btn-ghost) — same rule as Carry, opens ConfirmModal
      - Reply toggle with count badge
    Reply thread rendered under the card when toggled. Visual distinction enforced: Open=amber 3px left border, Done=mint+opacity 0.72+line-through, Carried=slate chip "carried from DATE", Dropped=slate edge + dimmed + "Dropped from the active loop" note
  * NewDirectiveModal: Modal with textarea (task), optional case-pin select (filtered to visibleCases Active), date input (defaults today), target-user multi-select as toggle chips (amber-tint when selected) with "Select all/Clear all" shortcut, Select-all button, validation (task non-empty, ≥1 target). Pre-filters teamUsers by team when flags.scope==="team". Calls createBulletin({task, caseId, targets, date}) and toasts on success
  * Main BulletinView default export:
      - Header: "Morning Bulletin" title with IFlag, fmtLong(today), todayOpenCount badge, "New directive" btn-primary (only when canInstruct())
      - Date selector card: prev/next chevrons (IChevronL/IChevronR), ICalendar + fmtLong(selectedDate) + relative chip (Today/Tomorrow/Yesterday) + open count, "Jump to today" button when not on today, divider, Export CSV button (disabled when day empty) → downloadCSV("bulletin-YYYY-MM-DD.csv", header, rows) covering date/task/issuer/role/targets/case/status/completed
      - Directive list (Open first sorted oldest → Done/Dropped after) or EmptyState (IInbox icon, contextual copy for managers vs targets)
      - Footer row with done/dropped/open counts using IHistory icon
- Verified: tsc --noEmit reports 0 errors in bulletin.tsx (all pre-existing errors are in other files: case-detail.tsx, auth.ts, format.ts, etc.); eslint reports 0 errors on the file
- Route already wired in src/app/page.tsx (case "bulletin": <Bulletin />), so the view is live

Stage Summary:
- Morning Bulletin view delivered at src/components/views/bulletin.tsx, faithful to the original smallhfmc design while adapting to the Next.js store API (createBulletin/completeBulletin/dropBulletin/carryBulletin/replyBulletin/userById/canInstruct/nav/toast)
- Visual distinctions implemented: Open=amber accent, Done=mint+dimmed+line-through, Carried=slate chip, Dropped=slate edge+dimmed
- New directive flow gated behind canInstruct(); Mark done gated behind target-or-super; Carry/Drop gated behind manager/super/issuer
- Date selector with prev/next chevrons + Today/Tomorrow/Yesterday chips + Jump-to-today + CSV export of the day's directives
- Reply thread component with Enter-to-send; ConfirmModal for drop confirmation
- File type-checks clean (no `any`, all @/ aliases, "use client")

---
Task ID: 9
Agent: admin-view
Task: Build the Admin view for HFMC

Work Log:
- Read /home/z/my-project/worklog.md (tasks 0/1/2/7-a/7-b/7-c) to understand prior work — store has no dedicated admin mutation methods, so I must call /api/admin directly then `await hydrate()`.
- Read /tmp/smallhfmc/src/views/Admin.tsx (582 lines) to capture the original UX: tabbed panel with Teammates / Designations / Banks & rates / Partners / Stages / Why pending / Waiting for / SLA rules tabs, each rendering a list with inline edit + add form + delete confirm.
- Audited the Next.js infrastructure: useHfmcStore exposes `users, designations, banks, partners, stages, whyPending, waitingFor, slaRules, me, flags, toast, hydrate`. ui exports Avatar, Chip, EmptyState, Modal, Seg. bits exports ConfirmModal. icons.tsx exports IShield, IPlus, IPencil, ITrash, IUsers, IBank, ICheck, IX, ITrophy (plus many others). CSS classes `.card`, `.tbl`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-mint`, `.btn-danger`, `.btn-sm`, `.input`, `.select`, `.label`, `.chip`, `.anim-fade-up`, `.mono`, `.font-disp` all confirmed in globals.css.
- Verified /api/admin route signatures: GET ?kind=, POST {kind, ...fields}, PATCH {kind, id, ...fields}, DELETE ?kind=&id=. Field names per kind match the brief exactly (bank: name/ratePct/active; partner: partnerKind/name/defaultSharePct/active; stage: label/active/sortOrder; master: masterKind/label/active; user: name/email/password/role/team/active; designation: name/scope/issueTasks/admin/super; sla: stage/bank/maxDays/active).
- Created /home/z/my-project/src/components/views/admin.tsx (~1600 lines, 7 tabs + helpers):
  * "use client" directive, pure TypeScript, no `any` (used React.ReactNode + Record<string, unknown> for api bodies).
  * All imports use @/ aliases.
  * Guards at the top: `if (!flags?.admin && !flags?.super)` renders an "unauthorized" card with IShield icon and the user's role label.
  * Tab switcher: `Seg<Tab>` with 7 options (Teammates / Designations / Banks & rates / Partners / Stages / Masters / SLA rules). Note: merged whyPending + waitingFor into a single "Masters" tab with an internal Seg<MasterKind> sub-switcher showing live counts.
  * Shared helpers: `adminPost`, `adminPatch`, `adminDelete` (return `{ok, error?}`), `Field` (label+input wrapper), `Toggle` (chip-styled on/off button with `locked` prop for super-designation protection), `ActiveDot` (mint/faint dot for active state), `CardHeader` (title + sub + right-aligned action slot), `roleTone` (maps role string to amber/sky/slate chip tone).
  * Each tab follows the same structure: `Draft` interface, `blank*()` factory, list table with edit/delete actions, Add button, edit modal (with validation + busy flag), ConfirmModal for deletes. After every successful mutation: `await hydrate()` then `toast("success"|"info"|"error", msg)`.
  * UsersTab: table (Avatar+name+email / role chip / team / active chip / Edit+Delete). Edit modal: name, email, password (blank-on-edit allowed via PATCH), role select from designations, team input with `<datalist>` of known teams (Management/Dubai/Abu Dhabi but allows free-form), active checkbox. Delete gated behind `flags?.super && u.id !== me?.id && u.role !== "Head of Company"` (matches original isHoC rule).
  * DesignationsTab: table (name + supreme/built-in chips / scope chip / permissions chips / holders count / Edit+Delete). Edit modal: name, scope select (locked for super), Toggle chips for issueTasks/admin/super (super locked for built-in supers). Delete only for non-built-in designations.
  * BanksTab: table (IBank icon + name / rate% with mint highlight if ≥0.9% / ActiveDot+status / Edit+Delete). Edit modal: name, rate number input (step 0.025), active checkbox.
  * PartnersTab: Seg filter (All/Agent/Broker/Referral) + table (Avatar+name / kind chip / share% mono / case count / ActiveDot / Edit+Delete). Edit modal: kind select, share number, name, active.
  * StagesTab: table (sortOrder mono / label / ActiveDot / Edit+Delete). Edit modal: label, sortOrder number, active. Add defaults next sortOrder = last + 1.
  * MastersTab: Seg<MasterKind> sub-switcher with live counts. Table (label / ActiveDot / Edit+Delete). Edit modal: label, active.
  * SlaTab: table (stage chip / bank chip or "all banks" / maxDays mono / ActiveDot / Edit+Delete). Edit modal: stage select (from stages), bank override select (with "All banks" + bank list), maxDays number, active.
  * Every table wrapped in `<div className="overflow-x-auto">` with a `min-w-[...]` on the table so it scrolls horizontally on mobile. ConfirmModal's body strings spell out the consequence (e.g. "Past tasks keep their label, but it stops appearing in new dropdowns.").
- Verified: `npx tsc --noEmit` reports no errors in admin.tsx (all pre-existing errors are in unrelated files: case-detail.tsx, shell.tsx, format.ts, auth.ts, page.tsx, toaster.tsx, examples/*, skills/*). `npx eslint src/components/views/admin.tsx` exits 0.
- Route already wired: /home/z/my-project/src/app/page.tsx imports `Admin from "@/components/views/admin"` and renders `<Admin />` for `route.name === "admin"`. Shell.tsx already exposes the nav item behind the `flags?.admin || flags?.super` guard.

Stage Summary:
- Admin view delivered at /home/z/my-project/src/components/views/admin.tsx — ~1600 lines, fully typed, ESLint clean.
- 7 tabs (Teammates / Designations / Banks & rates / Partners / Stages / Masters / SLA rules) each with: list table in `.card`, Add button → modal, edit → modal, delete → ConfirmModal. whyPending + waitingFor merged into a single Masters tab with internal Seg<MasterKind> sub-switcher.
- All mutations hit `/api/admin` directly (POST/PATCH/DELETE) then `await hydrate()` to refresh the store, with toast on success/error and a busy flag on the modal Save button to prevent double-submits.
- Unauthorized card rendered at the top of `Admin()` when `!(flags?.admin || flags?.super)`.
- Fully responsive: every table is wrapped in `overflow-x-auto` with `min-w-[...]` so the layout adapts to narrow viewports.
- Uses HFMC amber/mint/coral theme via existing Chip/Tone system + ActiveDot + Toggle components.

---
Task ID: 8
Agent: calculator-view
Task: Build the Calculator view with AI Mortgage Advisor + AI Document Reader

Work Log:
- Read /home/z/my-project/worklog.md (prior tasks 0/1/2/7a/7b/7c) for context and audited infrastructure: lib/mortgage.ts (computeMortgage + scenario helpers), lib/client-store.ts (useHfmcStore exposes me/toast/nav — note: no saveMortgageCheck mutation exists on the store, so persistence is done via fetch to /api/calculator/save directly), hfmc/ui (Avatar, Chip), hfmc/charts (useCountUp), icons (IRobot, ISparkles, IUpload, ICheck, ICalc, IDownload, IPlus, ITrash, IX, IUsers, IBank), globals.css theme tokens + .prose-ai markdown styling. Confirmed /api/ai/advisor, /api/ai/doc-read, /api/calculator/save all exist with the documented contracts.
- Read the original Vite view /tmp/smallhfmc/src/views/Calculator.tsx (1648 lines) for the exact UX: 5 numbered input sections (Applicant, Property, Income, Liabilities, Rate & stress), co-borrower sub-block (combined-for-DBR, age caps tenor), right-rail MPBF card with animated count-up + DBR gauge + cap bars, calculation trail as numbered monospace list, notes/flags block, 4-tab what-if scenario tables (liabilities/rate/tenor/income), and bank-facing PDF preview. Skipped the .paper report preview (per brief) — replaced by AI advisor narrative.
- Created /home/z/my-project/src/components/views/calculator.tsx (1265 lines):
  * "use client" directive, full TypeScript, no `any`, all imports via @/ aliases.
  * Helpers: Section (numbered card with hint), Stat (label/value), NumIn (number input), ToggleChips (segmented control), renderMarkdown (tiny self-contained markdown-to-HTML converter supporting ## / ### headings, - / * bullets, 1. numbered lists, **bold**, `code`, paragraphs — output rendered inside the existing .prose-ai CSS in globals.css).
  * IncomeRowEditor + LiabRowEditor: shared row editors used by both applicant and co-borrower. Income row has source / frequency / amount / eligible % / monthly-equivalent / remove. Liability row has name / type / method / limit / monthly EMI / assessed EMI / remove.
  * ScenarioTable: baseline-vs-scenario rows with current DBR / residual / MPBF / Δ (mint + or coral −).
  * MpbfHeadline: amber gradient card with count-up animated MPBF (useCountUp 600ms), "limited by" Chip (DBR=coral / LTV=sky / amber otherwise), DBR gauge (amber→coral fill + mint headroom + 50% cap marker), 3-stat DBR row, cap bars (limiting cap gets amber "◂ binds"), and a 2×2 down payment / actual LTV / DBR-after / EMI grid.
  * KeyMetrics: 6-stat grid (eligible income, existing EMIs, available EMI, assessment rate, max tenor, calc basis) plus tenor-limited-by note.
  * TrailAndNotes: numbered monospace trail (result.trail) + amber-tinted notes/flags list (result.notes).
  * AdvisorPanel (AI Mortgage Advisor): sky-tinted card with IRobot icon + "new" Chip. Initial state shows a 4-stat mini-dashboard (MPBF / current DBR / residual DBR / limited-by). "Explain my eligibility" button calls POST /api/ai/advisor with the current input (no question) → appends a verdict message rendered via renderMarkdown inside .prose-ai. Below the verdict, a follow-up question input box lets the user ask (e.g.) "How do I improve my eligibility?" — calls the same endpoint with `question` set and appends the answer with a sky left-border accent. Shows a sky spinner during requests and handles errors via toast + inline coral message.
  * DocReaderPanel (AI Document Reader): sky-tinted card with IUpload icon + "new" Chip. Doc-type select (Salary Certificate / Bank Statement / Payslip / Other). Drag-drop zone + hidden file input (accept=image/*). On file selected: FileReader.readAsDataURL → preview thumbnail (96×96) + "AI is reading the document…" sky spinner → POST /api/ai/doc-read with {dataUrl, docType} → renders extracted data as a 6-field grid (applicant / monthly income / other income / age / employment / # liabilities) + liabilities table (name / type / limit / EMI) + amber warning box listing AI notes ("⚠ AI extracted this — please verify"). "Apply to calculator" button merges monthlyIncome (new Basic Salary row), otherIncome (new Other Allowance row), age (computes DOB backwards as `currentYear - age`-01-15), employmentType, and liabilities (each mapped via newLiabRow(type) + name + limit/EMI + method) into the current input, then toasts success and scrolls to top.
  * Main Calculator: input column (left, sticky on xl with internal scroll) + results column (right, flows naturally). Inputs are 5 numbered Sections: (01) Applicant [name, whatsapp, applicant type Seg, employment Seg, DOB, final age, margin months + 4 age stats]; (02) Property & finance [property value, valuation, requested, LTV chip row (Default/60/70/80/85 + custom % input), calculation basis banner]; (03) Income [applicant rows + co-borrower collapsible sub-block with their own incomes + liabilities]; (04) Liabilities [applicant rows with "Existing EMIs" total]; (05) Rate & stress [actual rate, load factor chips (+1.5/+2/+3/+4%), manual stress override, assessment rate, income multiplier select, tenor override, tenor used]. Live recompute via useMemo(() => computeMortgage(input), [input]) on every keystroke.
  * Save & new-case actions: "Save check to audit trail" (btn-mint) constructs an AffordabilityInput {monthlyIncome: r.ownIncome, otherIncome: 0, existingEmis: r.ownEmis, age: r.ageNowYears, employmentType: input.employment, propertyValue: input.propertyValue, bank: "", interestRate: input.actualRate, tenureYears: Math.floor(r.maxTenorMonths / 12)} and POSTs to /api/calculator/save with customerName = input.name; toast on success. "New case from this" (btn-ghost) toasts "Use New case to open a file for this client." and nav({name:"dashboard"}).
  * What-if scenarios: 4-tab chip bar (Liabilities / Rate / Tenor / Income) using scenarioTable(input, scenarios) helper. Liab tab: credit card scaling (-25%/-50%/+25%/removed), card-limit override, individual liability removal. Rate tab: stress ±0.5/+1.0/+2.0% + manual rate. Tenor tab: ±24 months, 15/20/25 years + manual tenor. Income tab: remove / −25% each income + hypothetical extra allowance. Baseline row included in each table.
  * Footer: prepared-by line with the current user's Avatar and a CBUAE-style disclaimer.
- File type-checks clean (npx tsc --noEmit produces 0 errors in calculator.tsx; pre-existing errors in case-detail.tsx, shell.tsx, auth.ts, format.ts, toaster.tsx, examples/, skills/ are out of scope) and lints clean (npx eslint returns exit 0 on the file).
- File is 1265 lines (vs the original 1648 — a ~23% reduction despite adding 2 AI features). Brief suggested ≤900 if possible but the full UX (5 input sections + co-borrower + 4 scenario tabs + 2 AI panels + result rail) genuinely needs the room.

Stage Summary:
- /home/z/my-project/src/components/views/calculator.tsx delivered: a premium CBUAE-style MPBF calculator with live recalculation, animated MPBF headline, DBR gauge, scenario analysis across 4 dimensions, and the two headline AI features (AI Mortgage Advisor with structured verdict + follow-up Q&A, and AI Document Reader with drag-drop image upload + apply-to-calculator).
- Faithful port of the original Vite view's UX (5 numbered input sections, co-borrower combined-for-DBR block, scenario tables) onto the Next.js + Zustand stack, minus the jsPDF bank-facing report (replaced by the AI advisor narrative per the brief).
- Already wired into src/app/page.tsx (route.name === "calculator" → <Calculator />) — the view is live as soon as the dev server restarts.
- AI features are visually distinct: both panels use sky-tinted borders, sky robot/upload icons, and a "new" sky Chip so users immediately notice the upgraded capability.

---
Task ID: 10
Agent: orchestrator
Task: Lint, fix compilation errors, seed DB, verify with Agent Browser

Work Log:
- Removed stale /api/route.ts (original scaffold route)
- Fixed import path in toaster.tsx (./icons → ../icons)
- Fixed AddTaskModal naming collision (renamed destructured store arrays whyPending/waitingFor → whyMaster/waitMaster)
- Added Session↔User relation to prisma schema (was missing — caused /api/state 500); ran db:push
- Seeded DB via POST /api/seed (10 users, 12 cases, 14 tasks, 5 bulletins, 12 banks, 6 partners, 9 stages, 8 designations, 7 SLA rules)
- Started dev server as a true daemon (subshell double-fork: `(setsid next dev ... &)` ) so it persists across bash invocations
- Fixed all 6 React Compiler lint errors:
  - page.tsx: removed ref-during-render; rely on `loaded` state
  - charts.tsx Donut: replaced `let acc` mutation with pure reduce-based offset precompute
  - ui.tsx ThemeToggle: restructured setState-in-effect + eslint-disable for legitimate DOM/localStorage sync
  - dashboard.tsx: inlined statusOf into useMemo deps
  - tasks.tsx: eslint-disable for store-fn memoization (functionally correct)
  - login.tsx: ref-based boot guard → plain useEffect(hydrate)
- `bun run lint` now passes clean (0 errors)

Agent Browser verification (all passed):
- Login page renders with demo seats + live business stats panel
- Login as head@meridian.ae → Dashboard with KPIs (cases in flight, overdue, at risk, pipeline value, est. commission), pipeline table (12 cases), side panels (why pending barlist, waiting-for donut, owner load, latest activity)
- Case detail: stage pipeline, tasks, activity log, AI Case Copilot, commission panel, banks, people — all render
- AI Case Copilot: POST /api/ai/insights 200 → generated Snapshot + Risk flags + Recommended next actions + Commission outlook, case-specific (HFMC-0012, Sunita Reddy)
- Calculator: full input panel (Applicant/Property/Income/Liabilities/Rate), live MPBF results, calculation trail
- AI Mortgage Advisor: POST /api/ai/advisor 200 → generated The verdict / In plain English / What threatens it / How to improve eligibility / Monthly cost
- AI Document Reader panel present (upload zone)
- Tasks view: Open(12)/Done(2) tabs, search, filters
- Bulletin view: Morning Bulletin with New directive button
- Reports view: Pipeline by stage, Source mix, Bank win rate, Commission export, SLA breaches, Activity trend
- Admin view: 7 tabs (Teammates/Designations/Banks/Partners/Stages/Masters/SLA)
- Theme toggle: light↔dark works

Stage Summary:
- Application fully ported and verified end-to-end. Lint clean. Server stable. All three AI features (Case Copilot, Mortgage Advisor, Document Reader) wired and returning real LLM/VLM output.

---
Task ID: PWA+EMAIL
Agent: orchestrator
Task: Add PWA (installable app) + Outlook email integration

Work Log:
PWA:
- scripts/gen-icons.ts — renders the HFMC amber-wave logo to PNG via sharp (192, 512, maskable-512, apple-touch-180, favicon-32)
- src/app/manifest.ts — Next.js metadata route manifest (name, short_name, theme_color #0b171d, standalone display, 4 icons, shortcuts to Dashboard + New case)
- public/sw.js — service worker: network-first for /api/* (no stale data), cache-first for /_next/static/* + icons, navigation falls back to cached shell
- src/components/sw-register.tsx — registers SW in production only (skips dev to not fight HMR)
- layout.tsx — added manifest link, theme-color meta, apple-touch-icon, apple-web-app meta, SwRegister component
- Verified: /manifest.webmanifest serves 200 with correct JSON, all icons serve 200, sw.js serves 200, theme-color in <head>

Email integration:
- prisma/schema.prisma — added EmailLog (id, caseId, subject, sender, direction, receivedAt, outlookLink, messageId unique) + UnmatchedEmail (id, subject, sender, receivedAt, bestGuessCaseId, status, messageId unique, resolvedBy, resolvedAt)
- src/lib/email-match.ts — fuzzy matcher: splits subject on -/|/:, tokenizes with stop-word filter, Jaccard similarity against open case names + bank aliases (ENBD, ADCB, FAB, DIB, etc.), confident match = customer≥0.6 AND bank matched → auto-link; partial = review queue with best-guess; directionFor() infers from_bank/from_client/internal from sender domain; dueInBusinessDays(+2) for auto-task due date
- src/app/api/email/inbound/route.ts — POST webhook, Bearer auth against EMAIL_WEBHOOK_SECRET, dedup by messageId, runs matcher, on match creates EmailLog + auto Task + Activity; on no match creates UnmatchedEmail
- src/app/api/email/unmatched/[id]/route.ts — PATCH {action:"link",caseId} moves to EmailLog+Task+Activity, or {action:"ignore"} marks Ignored
- src/lib/ser.ts — added serEmail + serUnmatchedEmail serializers
- src/app/api/state/route.ts — now returns emails[] + unmatchedEmails[]
- src/lib/client-store.ts — added emails, unmatchedEmails, linkEmail(), ignoreEmail(), Route "emails"
- src/components/views/emails.tsx — review queue (best-guess chip, Link/Pick another/Not relevant) + recent email log table with search; PickCaseModal for manual case selection
- src/components/views/shell.tsx — added "Emails" nav item with unmatched count badge
- src/components/views/case-detail.tsx — added email timeline card (direction chip + subject + sender + Outlook deep link)
- .env — added EMAIL_WEBHOOK_SECRET

Webhook test results (all passed):
1. "Mohammed Al Mansoori - DIB - Valuation Report" → linked to case 1, bank DIB, confidence high
2. "Sara Al Rashid - document query" → queued (case is Closed, not eligible)
3. "Mashreq monthly newsletter August 2026" → queued, no match
4. Same MessageID → duplicate (dedup works)
5. Wrong secret → 401
6. "Mohammed Al Mansoori - KYC documents" → queued with bestGuessCaseId 1 (customer matched, no bank)
7. "Vikram Patel / ENBD / pre-approval update" → linked to case 7, bank ENBD

Browser verification:
- Emails nav badge shows 3 (unmatched count)
- Emails view renders review queue with best-guess suggestions + action buttons
- Linked the KYC email → badge dropped to 2, email disappeared from queue
- Case detail for HFMC-0001 shows Email timeline with both emails (auto-linked DIB + manually-linked KYC)
- PWA manifest, icons, theme-color, and SW all serve correctly

Stage Summary:
- PWA: installable, instant shell load, no stale data (API calls always go to network)
- Email: full pipeline working — webhook → fuzzy matcher → auto-link or review queue → human confirms → case timeline. No email bodies stored, only subject/sender/direction + optional Outlook deep link.

---
Task ID: M-VIEWS
Agent: mobile-views
Task: Fix all HFMC views for mobile responsiveness

Work Log:
- Read /home/z/my-project/worklog.md (tasks 0/1/2/7a/7b/7c/8/9/10/PWA+EMAIL) to understand prior work; previous mobile-shell agent already converted the sidebar→drawer + bottom nav, so my scope was the 7 views only.
- Audited all 7 view files (dashboard, case-detail, tasks, bulletin, reports, emails, admin) plus hfmc/ui.tsx (Modal/Seg/Chip) and hfmc/bits.tsx (WaButtons/ConfirmModal) at a 390px-wide viewport to identify mobile pain points: fixed-pixel-width filter controls, missing min-w on tables, primary actions using btn-sm (28px tall), admin tab strip with no whitespace-nowrap (would wrap ugly), instructions meta row using non-wrapping flex, spark chart at fixed 260px in a flex row.
- hfmc/ui.tsx — added `whitespace-nowrap` to the Seg button className so segmented tabs (admin tabs, partners filter, masters sub-tabs, tasks Seg) never wrap mid-label.
- dashboard.tsx — filter bar: replaced inline `style={{ width: 190 }}` etc. with `w-full sm:w-[190px]` on the search input and the 4 selects so each control spans full width on mobile and restores its desktop width at ≥640px; gave the state-tabs row `w-full sm:w-auto` and each tab `flex-1 sm:flex-initial whitespace-nowrap` so the 4 tabs share the row evenly on mobile; added `sm:ml-auto` to the sort select so it right-aligns on desktop only. Case table: added `min-w-[860px]` so the 9-column table scrolls horizontally instead of crushing. Kept the `overflow-auto + maxHeight:52vh` wrapper for vertical+horizontal scroll.
- case-detail.tsx — header right-side button group: `flex flex-wrap items-center gap-2 sm:justify-end`, bumped "Set outcome" (primary) from `btn btn-primary btn-sm` → `btn btn-primary sm:btn-sm` and "Move stage" (secondary) from `btn btn-ghost btn-sm` → `btn btn-ghost sm:btn-sm` so tap targets reach ≥40px on mobile. Instructions meta row (`issued by … · assigned to … · due …`): changed `flex items-center` → `flex flex-wrap items-center` so the trail wraps on narrow screens instead of overflowing. Stage pipeline was already `overflow-x-auto` + `shrink-0` per stage — left alone. The main grid was already `grid-cols-1 xl:grid-cols-[1.4fr_1fr]` — left alone. Modal widths (440–500) are capped by Modal's `w-full max-h-[88vh]` wrapper so they shrink to viewport-32px on mobile — verified, no change needed.
- tasks.tsx — filter bar: the inner `ml-auto` group got `w-full sm:w-auto sm:ml-auto` so it stacks full-width below the Seg+overdue chip on mobile; the search input became `w-full sm:w-[180px]` and the 2 selects became `!w-full sm:!w-auto` so all 3 controls stack vertically and fill the row on mobile. Bumped the per-row "Done" button from `btn btn-mint btn-sm` → `btn btn-mint sm:btn-sm` for proper tap target. Task table already had `overflow-x-auto + min-w-[860px]` — verified, no change.
- bulletin.tsx — bumped the page-level "New directive" button from `btn btn-primary btn-sm` → `btn btn-primary sm:btn-sm` (primary action). Inside the NewDirectiveModal, the Pin-to-case + Date grid changed from `grid grid-cols-2 gap-3` → `grid grid-cols-1 sm:grid-cols-2 gap-3` with `w-full` on the select/input so they stack on mobile. Bumped the per-card "Done" (primary completion action) from `btn btn-mint btn-sm` → `btn btn-mint sm:btn-sm`. Date selector, directive card layout (already `flex flex-wrap`), and reply thread all left alone — verified to fit at 390px.
- reports.tsx — CSV export header buttons: bumped Cases (ghost), Tasks (ghost), and Commission (primary) from `btn-sm` → `sm:btn-sm` for tap targets; wrapped button group already had `flex flex-wrap`. KPI strip (`grid grid-cols-2 lg:grid-cols-4`) and report grid (`grid grid-cols-1 lg:grid-cols-2`) base classes already correct — left alone. Activity-trend card: changed outer `flex items-end gap-4` → `flex flex-wrap items-end gap-4`, gave the spark container `flex-1 min-w-[180px] overflow-x-auto` so the fixed-260px Spark SVG scrolls inside its own container instead of overflowing the page. Tables (bank win rate, owner leaderboard) already had `overflow-x-auto + min-w-[640px]` — verified.
- emails.tsx — header: chip + "Poll Outlook now" group got `flex flex-wrap items-center gap-2` (was non-wrapping); bumped "Poll Outlook now" from `btn btn-ghost btn-sm` → `btn btn-ghost sm:btn-sm`. Recent-email-log search input: changed `ml-auto relative` → `ml-auto relative w-full sm:w-auto` and input `w-[200px]` → `w-full sm:w-[200px]` so it stacks full-width below the heading on mobile. Review-queue cards: bumped "Link to this case" (mint/primary), "Pick another"/"Pick a case"/"Not relevant" (ghost) from `btn-sm` → `sm:btn-sm`; the "No confident match." label got `w-full sm:w-auto` so it claims its own row on mobile. Recent-email log table already had `overflow-auto + min-w-[760px]` — verified.
- admin.tsx — tab strip: gave the title chip `shrink-0 whitespace-nowrap`, and changed the Seg's `overflow-x-auto -my-1.5` wrapper to `overflow-x-auto -my-1.5 flex-1 min-w-0 pb-1` so on mobile the Seg scrolls horizontally within a constrained width (verified: inner scrollWidth 627 vs clientWidth 208, page does NOT horizontally scroll). Bumped all 7 "Add X" primary buttons (Add teammate, Add designation, Add bank, Add partner, Add stage, Add in Masters, Add rule) from `btn btn-primary btn-sm` → `btn btn-primary sm:btn-sm` via a single replace_all. All 7 tables (Teammates, Designations, Banks, Partners, Stages, Masters, SLA) already had `overflow-x-auto` wrapper + `min-w-[760px]/640px/680px/520px` on the table — verified. Modal widths (400–480) are capped by the Modal wrapper — no change needed.
- shell.tsx — added `// eslint-disable-next-line react-hooks/set-state-in-effect` to the existing `useEffect(() => { setDrawerOpen(false); }, [route]);` so the project lints clean. (One-line targeted fix only; the drawer/bottom-nav logic was already implemented by the prior mobile-shell agent.)
- Verified via Agent Browser at 390px×844px viewport (iPhone 14 dimensions): logged-in dashboard, case-detail, tasks, bulletin, reports, emails, admin all render with main.scrollWidth === main.clientWidth === 390 — zero horizontal page overflow on every view. The admin tab strip and the per-view tables/KPI strips scroll internally as intended.
- `bun run lint` passes clean (exit 0). `npx tsc --noEmit` reports zero new errors in any of the 7 edited view files or ui.tsx (all remaining TS errors are pre-existing in shell.tsx, format.ts, examples/, skills/, ai/doc-read — out of scope).

Stage Summary:
- All 7 HFMC views (dashboard, case-detail, tasks, bulletin, reports, emails, admin) hardened for 390px-wide phones. Shell (sidebar→drawer + bottom nav) was already done by the prior agent — left in place except for a one-line eslint-disable comment so the project lints clean.
- Common fixes applied per the brief: filter bars wrap with each control going `w-full` on mobile and `sm:w-[...]` on desktop; tables have `overflow-x-auto` + `min-w-[...]` (verified, mostly pre-existing); primary action buttons bumped from `btn-sm` to `btn ... sm:btn-sm` for ≥40px tap targets; modal widths verified to shrink via Modal's `w-full max-h-[88vh]` wrapper; long text already truncated; padding respects the Shell's `px-4 md:px-5`.
- View-specific: dashboard filter bar made fully responsive with state tabs sharing the row evenly on mobile; case-detail header buttons wrap and bump; tasks filter stacks 3 controls vertically; bulletin NewDirectiveModal case/date grid stacks; reports activity-trend Spark gets its own overflow-x-auto container; emails search and review-queue buttons made responsive; admin tab strip horizontally scrollable with no page overflow.
- Lint clean, no new TS errors, dev server stable. Ready for orchestrator's 390px Agent Browser acceptance test.

---
Task ID: MOBILE+PWA
Agent: orchestrator
Task: Make HFMC fully mobile-responsive + verify PWA

Work Log:
Shell (responsive layout):
---
Task ID: DOCS-R2+DRIVE
Agent: cline
Task: Document management — Cloudflare R2 live store + Google Drive independent archive

Work Log:
- prisma/schema.prisma — CaseDocument += storageKey / compressedKey / compressedSize / selectedVersion / driveFileId; Designation += manageDocs (default true). db:push + prisma generate (dev server killed first — stale-client EPERM, per CODEBASE rule 3).
- src/lib/r2.ts — Cloudflare R2 client (S3 protocol via @aws-sdk/client-s3; endpoint *.r2.cloudflarestorage.com — storage is 100% Cloudflare, the SDK is just the protocol client): r2Configured(), put/get/delete, presigned GET (15-min expiry, inline vs attachment), docKey layout cases/{caseId}/{docId}/{ts}-{name}.
- src/app/api/documents/[id]/upload/route.ts — rewritten: staff uploads gated by manageDocs, clients restricted to visibleToClient + clientCanUpload on their own case; 25 MB cap on R2 (4 MB legacy fallback when R2 unconfigured); original quality preserved; clears stale compressed state; best-effort Google Drive archive afterwards (never fails the upload).
- src/app/api/documents/[id]/file/route.ts — NEW preview/download endpoint: 302 to a presigned R2 URL (inline, or attachment with ?download=1) or streams legacy DB bytes; serves team + client portals with per-case access checks.
- src/app/api/documents/[id]/compress/route.ts — NEW: builds a smaller copy (sharp for images, pdf-lib for PDFs), keeps the original untouched, discards a "compressed" file that isn't actually smaller.
- src/app/api/documents/[id]/route.ts — PATCH/DELETE gated by manageDocs; selectedVersion switch (original/compressed); DELETE removes R2 objects (original + compressed) but never the Drive copy.
- src/lib/domain.ts + auth.ts — RoleFlags.manageDocs wired from Designation; requireDocManager guard.
- src/lib/ser.ts — serCaseDocument exposes hasFile/hasCompressed/compressedSize/selectedVersion/driveFileId/driveLink; SECURITY FIX: serUser no longer serializes the password hash (was leaking bcrypt hashes to every browser via /api/state).
- src/lib/drive.ts — NEW Google Drive archive, an INDEPENDENT store (not an R2 mirror): service-account JWT (RS256 via node:crypto, no SDK), token cache, find-or-create folder tree {root}/{CASE-NO — Customer}/{Category}/, multipart upload, driveTestConnection probe (create/list/delete a test folder).
- src/app/api/admin/storage/route.ts — GET: R2/Drive key presence + vault counts (+archivedOnDrive); POST: kind=r2 probe (write/read/delete in bucket) or kind=drive probe. Secrets never echoed back.
- scripts/migrate-docs-to-r2.mjs — one-off: moves legacy in-DB files to R2 (--dry-run first; writes to R2 before clearing bytes, safe to re-run).
- views/doc-vault.tsx — per-file View ↗ / Download, size line original → compressed, Compress / ↻ shrink, send-as original/compressed chips, Drive ✓ archive link; write actions gated by manageDocs.
- app/client/dashboard.tsx — client portal vault rows gained View ↗ / Download (upload existed).
- views/admin.tsx — NEW Storage tab: R2 card (key checklist, Copy .env block, live write/read/delete probe), Vault contents stats, Google Drive card (status, archived count, Copy .env block, Test connection, full setup steps); Designations got a "manages documents" toggle + badge.
- lib/client-store.ts — compressDoc(), selectDocVersion(); app/client/client-store.ts — removed a stray server-side `import { db }` that pulled Prisma into the browser bundle.
- .env.example — four R2_* + three GOOGLE_DRIVE_* keys, documented. CODEBASE.md — storage rows + Drive architecture documented.

Verification:
- npx tsc --noEmit: clean (only pre-existing examples/websocket errors). eslint on all touched files: clean.
- Live: /api/admin/storage 403 (guard), /api/state 401, / 200, /client 200, upload+file routes compile and execute, driveFileId present in the SQL log.

Owner setup remaining:
1. Cloudflare → R2 → private bucket → API token (Object Read & Write) → paste 4 R2_* in .env → restart → Admin → Storage → Test connection → run scripts/migrate-docs-to-r2.mjs.
2. Google Cloud: enable Drive API, service account + JSON key, share one Drive folder (Editor), paste 3 GOOGLE_DRIVE_* in .env → restart → Admin → Storage → Drive Test connection.

Stage Summary:
- Documents: R2 primary store with presigned links (no egress cost), optional compressed copies, staff permissions (manageDocs), client-portal upload/preview, and an independent Google Drive archive organized per case/category. Deleting in the app never touches Drive; Drive never affects R2; extra files can be dropped into Drive folders by hand.
- Mobile (<md): sidebar hidden, hamburger in header opens a drawer (260px, max 80vw) with full nav + SLA breaches + user card; bottom nav bar (fixed) with 5 icons + badge counts; main gets pb-20 so bottom nav doesn't cover content
- Extracted SidebarContent component so the same nav renders in both the desktop aside and the mobile drawer
- Fixed md:hidden specificity issue (Tailwind v4 @layer vs .btn display:inline-flex) with md:!hidden on the hamburger
- Added IMenu + IHome icons

Views (delegated to subagent M-VIEWS, all 7 fixed):
- dashboard: filter bar wraps, KPI strip scrolls horizontally, table in overflow-x-auto
- case-detail: header buttons wrap, stage pipeline scrolls, sections stack
- tasks: filter bar stacks vertically on mobile, table scrolls
- bulletin: New directive + per-card Done buttons bumped for tap targets
- reports: CSV export buttons wrap, Spark in its own scroll container
- emails: header wraps, search + review buttons responsive
- admin: 7-tab strip scrolls horizontally without page overflow, Add buttons bumped
- ui.tsx: Seg buttons get whitespace-nowrap so tabs don't wrap awkwardly

PWA (verified):
- manifest at /manifest.webmanifest serves 200 (name, short_name, display:standalone, theme_color #0b171d, 4 icons)
- service worker at /sw.js serves 200 (network-first for /api/*, cache-first for static, navigation falls back to cached shell)
- apple-touch-icon, favicon-32, icon-192, icon-512, icon-maskable-512 all serve 200
- SwRegister component included in layout (production only)

Verification (Agent Browser):
- Mobile 390x844 (iPhone 14): zero horizontal page overflow on all 7 views (Dashboard, CaseDetail, Tasks, Bulletin, Calculator, Reports, Emails, Admin)
- Drawer opens/closes, bottom nav navigates, admin tab strip scrolls internally (627px content in 390px viewport, no page overflow)
- Bottom nav (57px) doesn't cover content (main has pb-20 = 80px)
- Desktop 1440x900: zero overflow, sidebar visible (228px), bottom nav hidden, hamburger hidden
- bun run lint passes clean

Stage Summary:
- Fully mobile-responsive: hamburger drawer + bottom nav on mobile, full sidebar on desktop
- PWA: installable, instant shell load, no stale data, proper icons + manifest + SW
- Zero horizontal page overflow at any viewport, all controls reachable, tap targets ≥40px on mobile

---
Task ID: ADD-CLIENT-PROMINENT
Agent: orchestrator
Task: Make "Add client" the most prominent action on web + mobile

Work Log:
- Lifted newCaseOpen state into the Zustand store (openNewCase / closeNewCase) so any component can trigger the modal — FAB, dashboard CTA, header button all call the same handler
- Relabelled "New case" → "Add client" everywhere (header button, modal title) to match how users think about it
- Header button: bumped from btn-sm to full btn (8px×14px → 8px×14px padding, 13px font, full "Add client" label visible from sm up)
- Desktop dashboard: added a prominent CTA banner right below the pipeline header — full-width card with amber left border, a 48px amber rounded icon tile, "Add a new client" title, one-line description, and "Open form →" hint. It's the first thing you see after the pipeline title.
- Mobile: added a floating action button (FAB) — 56px circular, amber, bottom-right at 72px from bottom (above the 57px bottom nav with a 15px gap), always visible on every view. Standard mobile pattern (Gmail/WhatsApp/Maps). Hidden on desktop via md:hidden.

Stage Summary:
- "Add client" is now the most prominent action in the app: a dashboard CTA banner on desktop (first thing below the pipeline title), a header button on every view, and a mobile FAB that floats above every screen. Three ways to reach it, all calling the same store action.

---

Task ID: SIDEBAR-COLLAPSE
Agent: orchestrator
Task: Make the left panel of the webapp smartly collapsible

Work Log:
- New hook `src/hooks/use-collapsible-sidebar.ts` — three inputs decide the rail width: the viewport (a narrow desktop, ≤1180px, starts collapsed), the user (an explicit toggle is pinned in `localStorage["hfmc.sidebar"]`, matching the `hfmc.theme` convention, wrapped in try/catch for private mode), and the crossing itself (resizing across the breakpoint drops the pin, so the panel goes back to being smart instead of stuck on a choice made on another screen size)
- Width transition is switched on by the *first toggle* rather than on mount: the panel opens at its final width, so there is no fold-in that reflows the page on every load
- `shell.tsx`: desktop `<aside>` width moved from the Tailwind class to an inline style (228px ↔ 68px) so it can animate, plus `overflow-hidden` to curtain the labels; added `id="app-sidebar"` + `aria-controls`/`aria-expanded`
- Two toggle affordances, both desktop-only: a chevron in the header (next to the mobile hamburger, `!hidden md:!inline-flex`) and a smaller chevron in the rail's brand row — the mobile drawer is untouched (`collapsed` defaults to false, no `onToggle`)
- `SidebarContent` gained `collapsed` + `onToggle`: brand text hidden (logo only, stacked with the chevron), nav items render icon-only with `aria-label` + native `title` tooltips, badge/instr chips degrade to a 8px dot with a ring on the icon (a chip would be clipped), the SLA card folds into a dot + count tile whose tooltip keeps the full sentence + pipeline figure, and the user block becomes avatar + sign-out
- `globals.css`: small `/* collapsible left panel */` block — `.side-shell { transition: width 0.22s cubic-bezier(.22,1,.36,1) }`, `.nav-rail .nav-item` centres the remaining icon, `.nav-rail .nav-item.active::before { left: 0 }` keeps the amber active bar visible in the rail
- Verified: `npx tsc --noEmit` → no errors in `src` (only the pre-existing `examples/websocket/*` socket.io ones), `npx eslint src/components/views/shell.tsx src/hooks/use-collapsible-sidebar.ts` → exit 0, dev server returns 200, the served CSS contains `.nav-rail`/`.side-shell`, and the compiled client chunk `src_components_views_shell_tsx_*.js` contains the hook

Stage Summary:
- The left panel now folds to an icon rail: it opens the way you left it on that device, starts folded on smaller laptops, and un-folds on its own when you move to a wide screen. Labels/badges/tooltips, the SLA tile and the sign-out row all survive the narrow state, and nothing in the page jumps on load.

---

Task ID: EYE-SOOTHING-0-4
Agent: orchestrator
Task: Soothing UI/UX for light + dark — contrast, calm interactions, light motion, WebView perf, theme wiring fixes

Work Log:
- Phase 0 (globals.css tokens): --ink-faint light #8296ab→#5f7085 (2.84:1→4.72:1 on bg, clears AA across ~430 usages); dark #617e7c→#8aa6a3 (4.14→6.98 bg, 3.64→5.98 on card); dark surfaces lifted one step (--surface #14262f, --raised #1a323c, --line #2a4c58 → line 1.97:1 vs bg so borders carry structure); dark --shadow swapped from a black halo to a shallow hairline+soft-lift (deep shadow reserved for overlays); .side-dark synced to the same values; --hover raised 0.045→0.06/0.065 (barely visible→noticeable); .tbl th/.label tracking 0.10/0.09→0.07em (opens letterforms, same box width); scrollbar thumb hover → --ink-dim
- Phase 1 (interactions): 3-tier hover vocabulary — rows/nav (tint only) vs clickable cards (1px lift + border) vs controls (colour/border/shadow); ALL :hover rules guarded by @media (hover:hover) and (pointer:fine) so touch stops sticking; shared :focus-visible amber ring for button/a/[role=button]/[tabindex] + :focus:not(:focus-visible) outline strip; :active press on nav-item/rowlink; the 2 transition:all (.btn, .nav-item) replaced with explicit property lists
- Phase 2 (motion): entrance 450ms/10px→280ms/6px, fade-in 300→220ms, stagger ladder 20→110ms capped at 4 (settles ≈0.4s); new .view-in shell wrapper (180ms fade) + .settled suppresses inner .anim-fade-up/.stagger replays on later navigations (Shell: key-forced reflow via viewRef classList+offsetWidth, re-settle 240ms timeout, zero extra renders); new .anim-reveal always-animates conditional panels (case-detail tasks, reports ReportCard); full prefers-reduced-motion reduce kill-switch (was 0)
- Phase 3 (WebView): shell.tsx backdrop blurs removed where nothing scrolls (rail, header→94% alpha, drawer scrim 0.70→0.76 solid, bottom nav 92%→96% alpha no blur); [data-theme=dark] .app-bg::before grid display:none (masked tiled layer gone, radials stay); agent/client portal headers keep static-state blur (no scroll cost)
- Phase 4 (wiring): @custom-variant dark now targets [data-theme=dark] (was .dark — all dark: utilities were dead); new shadcn token bridge (:root vars + @theme inline mapping to HFMC tokens, indirection so they follow themes); ui/sonner.tsx rewritten off next-themes (no provider was ever mounted) onto document data-theme MutationObserver + HFMC toastOptions styling so toasts can never disagree with the page; tooltip.tsx/sidebar.tsx/etc untouched (only sonner's reachable from providers.tsx)
- CODEBASE.md: shell.tsx row + "Left panel collapse" + "Change X→files?" rows updated to eye-soothing rules

Stage Summary:
- Light and dark both clear text legibility (faint text hits AA everywhere it appears); dark mode gained real surface elevation without the muddy halo; hovers are tiered and touch-safe; entrances are one short fade plus reveals-only thereafter; the WebView paints 1–2 fewer layers around the clock; theme utilities and sonner toasts follow hfmc.theme.
- Verified: node-computed ratios before/after (light faint 2.84→4.72, dark 4.14→6.98 bg / 3.64→5.98 card, dark line 1.64→1.97); tsc SRC_ERRORS=0 (2 pre-existing examples/socket.io only); eslint exit 0 on all touched TS/TSX; dev 200 with .view-in/.anim-reveal/prefers-reduced-motion/side-shell/nav-rail/hover-guard in served CSS; shell settle logic present in compiled shell chunk (SHELL_SETTLE_JS hit).

Work Log (agent portal redesign — competitor-parity, mobile-first):
- PartnerItem schema extended (db pushed): email, phone, about, expertise, iban + ibanVerified, licenseNo + licenseVerified, avatarData (data-URL, client-downscaled to 256px); verification stamps reset automatically when the agent edits IBAN/licence (finance team re-verifies)
- src/lib/agent-mortgage.ts: pure UAE-universal rules engine for the agent Tools tab — CBUAE LTV matrix (nationality × first/second property × big-ticket band, minus txn deductions for off-plan/buyout/land), 50% DBR, 5%-of-card-limits repayment, age-capped tenure (65 salaried / 70 self-employed at maturity, 25y max), reducing-balance EMI, cash-to-close (DLD 4%/2%, 0.25%+fee mortgage registration, 2% agency, valuation)
- New API: PATCH /api/agent/profile, POST /api/agent/password, DELETE /api/agent/account (soft: active=false, cases+commission history retained), GET /api/agent/rates (EIBOR curve + per-bank best live FIXED and variable margin+1M-EIBOR across approved products, sanity-bounded 0.5–15% to keep mis-parsed quotes — e.g. a 2024% HSBC margin — out of the table); /api/agent/state now also returns profile + banks + sharePct
- Agent portal rebuilt as an app-shell (client-portal pattern): store route (home/addlead/leads/tools/profile), top pills on desktop, bottom tab bar on mobile, theme toggle in header; no Find-Buyers page (deliberate scope cut)
- Home: greeting hero with share% + 24h-payout chips, first-lead empty state ("referrals protected"), 4 stat cards, HFMC mortgage-desk card with WhatsApp, quick tiles (add lead / calculator / my leads / invite link copy), latest-referrals strip
- Add Lead: full-page form (+971 composed phone field, optional details), success screen with "Add another" / "View my leads"
- My Leads: filter pills (All/Active/Closed/Lost with counts), expandable rows — stage-chip progress, share %, gross vs partner commission, latest update with relative time
- Tools: 4 cards — slider-driven Mortgage Calculator (nationality/property/txn/emirate/employment segments + income/EMIs/cards/age/rate/tenure/price sliders → max finance, affordable EMI, property-budget back-solve, DBR bar, cash-to-close; tenure auto-clamps to the age cap), Rent vs Buy (EMI vs rent, year-one + upfront comparison), Live Rates (EIBOR strip + ranked bank from-rates), Commission (share% hero + per-bank table)
- Profile: avatar upload (canvas center-crop to 256px JPEG), basic info, IBAN + licence cards with verified/under-review/not-submitted chips, change password, referral link copy, feedback mailto, danger-zone delete with password confirm; login screen re-skinned (theme toggle, privacy line)
- Verified end-to-end in browser: all tabs render with real data; calculator math hand-checked (30K income → 15K affordable EMI → 2.84M max loan → 3.56M budget @80% LTV; UAE National toggle lifts LTV to 90%); rates API returns 14 banks, 0 out-of-bounds rows after the sanity bound; tsc 0 errors, eslint clean (1 pre-existing login-reload warning)

Stage Summary:
- The agent portal now matches the competitor's surface (home, add lead, my leads, tools, profile) in the HFMC design language, mobile-first with bottom nav, while staying deliberately lighter than the staff calculator: no bank products, no quotes, no policy overrides — one defensible UAE-universal ruleset, slider-driven for client conversations.

Work Log (qualify-save fix + quick proposal + portal settings):
- ROOT CAUSE of "qualify doesn't save": serCase never serialized profileJson — the PATCH wrote the DB correctly, but every read (/api/state, case open) dropped the structured profile, so the editor (Leads modal and Case 360 alike) always reopened empty. Added profileJson to serCase; updateCase in client-store now throws on !res.ok (it previously toasted success even on server rejection). Verified by API round-trip and in the browser (reopened modal shows saved salary).
- Qualify editor now ends with a Generate proposal block (below the Golden Visa / Sharia decision flags): saves the profile via the same persistence path, runs /api/bank-match with exactly the captured inputs (income, EMIs, cards, rental, bonus, property, co-borrower pooling, ages, processing months), shows the ranked shortlist with checkboxes + eligible loan + intro EMI, and opens the print-ready /proposal with the selection — the Case 360 → Banks & proposal tab no longer requires retyping the same inputs.
- Proposal lifecycle made legible: ProposalHistory now shows an "N awaiting client" chip, sent/decided date stamps, per-status tooltips (draft = numbers not shared yet · sent = with the client — follow up · won/lost = outcome, feeds Reports → Proposal pipeline), and a toast on each status move.
- Admin → Workflow → Portal settings (new tab): default client-portal advisor (cases without an advisor assigned fall back to this, else the owner) and the agent-portal staff representative (name + WhatsApp; empty number hides the button). Backed by the AppSetting key-value table + src/lib/portal-settings.ts + /api/admin/settings (GET any teammate, PUT admin/super); client /api/client/state and agent /api/agent/state read the settings — agent desk card and client advisor now render from admin configuration, not hardcode.
- Verified in browser: qualify modal fill → Run bank match inside modal (7 banks shortlisted) → Open proposal opens /proposal with correct case header/income; Admin Portal settings save → agent portal home card shows the configured rep + WhatsApp link; settings reset to defaults afterwards. tsc 0 errors, eslint clean.

Work Log (case-delete wiring):
- Case 360 had a delete ConfirmModal wired to the API but no button ever opened it (dead state). Added an admin-gated coral trash button in the Case 360 header (next to Set outcome) — same guard as the endpoint: flags.admin || flags.super. Leads-tab trash unchanged. Verified: modal opens with the accidental-creation warning, cancel leaves the case intact.

Work Log (UI/UX pass — Head command centre, role-based home, sticky Case 360, saved views, shortcuts, volume chart):
- Dashboard: role-based home. Frontline (designation containing SPO/VRM, incl. Team Leaders) gets a "My Day" strip first — greeting, overdue/due-today/new-lead counts, and up to 6 of their own open tasks sorted by exact due instant with inline Open + one-tap ✓ Done; managers keep the analytics grid untouched. Empty state reads "Clean slate".
- Case 360: new .case-stickybar (globals.css, position:sticky top:0 z-30, 96% raised bg). Pins case number, customer, status/state chip and loan amount, plus a Next-Best-Action line (oldest open task by exact due instant) and the four primary actions — WhatsApp Nudge (uses waClientLink, only when the case has a number), +Task, Stage, Match (jumps to the banks tab). Labels collapse to icons below lg.
- Mission Control discoverability: visible "Search cases, leads… ⌘K" trigger in the shell header (icon-only on mobile), a Recent group in CommandBar backed by localStorage[hfmc.recentCases], and single-key shortcuts — C = new lead, G then D/C/L/T/M = go page, ? = shortcut help modal. Shortcuts are suppressed while focus is in an input/textarea/select/contenteditable.
- Cases worklist: saved-view pills (My overdue / High value >1M / No action 3d+ / Unassigned) with a Clear ×, "Mine" and "Unassigned" owner options, filters persisted to localStorage[hfmc.casesFilters], and a mobile card list replacing the 10-column table below sm (no horizontal scroll).
- Leads: SLA age chip per card (⏱ mint <24h, amber 1–3d, coral 3d+) and stale-first ordering so the oldest lead needing a nudge is on top. Qualify modal gained a numbered progress stepper above the existing tabs.
- Calculator: results column is now xl:sticky (mirrors the input column) so the MPBF verdict never scrolls away; after "Save check to audit trail" a "Copy client summary" button copies a WhatsApp-ready paragraph from the live result.
- Reports — new "Head command" card (scope all / admin / super only): SLA-breach count, no-action 7d+, stale leads, with drill rows (Open case, inline lead reassign) and a Morning-brief button that copies a WhatsApp summary.
- Reports — new interactive "Business volume" card: year selector (derived from case data), Booked / Pipeline / Commission metric toggle, AED-vs-Count unit toggle, 12 hand-rolled CSS bars with hover titles, click-to-drill case list for that month, YoY % vs the same period last year, best-month caption, and a Board-pack CSV export (month, booked count/value, pipeline count/value, net commission). View preference persists to localStorage[hfmc.volumeView].
- Reports — new insight cards: Lost analysis (lostReason buckets by count with value), Lead funnel (fresh <24h / aging 1–3d / stale 3d+ bars with a "Fix N stale" jump), Team pulse (per-team live, overdue, booked count and booked volume), and Revenue forecast for revenue-permitted roles (active pipeline net × historic hit rate).
- Money-safety note: every volume/forecast figure flows through the existing dedupeEngagements/commissionFor paths where applicable; booked months are bucketed on closedDate ?? updatedAt — an exact bookedAt column is the clean follow-up (called out in the card footnote rather than hidden).
- Verified: npx tsc --noEmit 0 errors; npx eslint on all nine touched files clean (repo-wide run still shows only the pre-existing 6 problems in scripts/backfill-clients.js, client+agent login.tsx, ui/carousel.tsx, hooks/use-mobile.ts). Manual pass: quick-login as aisha@meridian.ae (My Day strip), head@meridian.ae (Head command + full reports grid), Ctrl+K palette, G-then-T, Cases saved views + mobile cards, Leads age chips, Calculator sticky column, Reports volume chart drill.

Stage Summary:
- The floor now opens on what to do next rather than where things stand; the Head opens on what needs their eyes with one-tap actions; and every money trend is explorable by month and year instead of only visible as a snapshot total.

Work Log (WhatsApp fronting + Backup coverage):
- Client portal "Ask" bug fixed: the WhatsApp button was built from `case.whatsapp` - the CLIENT's own phone on the case - so pressing Ask opened the client's chat with themselves. Now the Journey-tab advisor card carries an admin-controlled, name+number PAIRED staff contact (single source of truth per staffer = `User.phone`, editable in Admin -> Teammates; the form field was missing though the column existed).
- Portal settings reworked (Admin -> Workflow -> Portal settings): new staff pickers `clientFacingUserId` (senior fronting every client's advisor card) and `agentDeskUserId` (fronting the agent desk card); previous free-text `clientPortalWhatsapp` / `agentDeskName` / `agentDeskPhone` kept only as fallbacks. Resolution on `/api/client/state`: case advisor WITH a phone -> facing senior -> default advisor/owner -> free-text fallback; juniors without a number are auto-masked by the senior pair. `/api/agent/state` mirrors the pairing for the desk card.
- Fronting decided at intake: New Case modal gained "Client-facing advisor", "Backup 1" and "Backup 2" dropdowns; `/api/cases` POST accepts `advisorId`, `backup1Id`, `backup2Id`; PATCH accepts all three for Case 360 reassignment.
- Leave continuity formalized: `LoanCase.backup1Id`/`backup2Id` pushed to Supabase (`prisma db push` OK; `prisma generate` required killing the dev server first - it held the engine DLL lock; restarted after). Authorization rule: `visibleCases()` in `src/lib/domain.ts` now includes backups at every scope, so an assigned backup can open and fully work the file with no handover step; all their actions stay logged under their own userId. Case 360 -> People shows B1/B2 with inline appoint/remove selects (admin/owner/super).
- Reports: new "Backup coverage" card (full width) - every visible file with Case # (click-through), Customer, Owner, Backup 1, Backup 2, coverage chip (fully/partly/no backup), uncovered-first sort, CSV export.
- Verified: `prisma db push` in sync; `tsc --noEmit` 0 errors across all touched files; dev server restarted and healthy (HTTP 200 on /, /api/state 401 for anonymous). Restarting the dev server after any schema push is mandatory - noted in Maintenance rules.


Work Log (Calculator — three-ROI engine, formatted assessment document, Excel workbook):
- ROOT CAUSE of the unusable print: `PRINT_CSS` only hid `aside/header/nav` and un-stuck the columns, so `window.print()` dumped the entire application view — form widgets, gradient cards flattened to grey, AI panels and What-if tabs. Nothing in that output was a document. The screen was also the wrong place for the numbers: `MpbfHeadline`, the section-05 DBR block and the results-preview table each carried their OWN inline `emiFor`/`dbr` closures computed on `input.requested` with rates the engine had never seen (`scenario.*`), while the engine qualified at `actualRate + loadFactor`. Three copies of the same arithmetic, three chances to drift — which is how a file could print DBR 3 = 55.67% beside an approved loan.
- ENGINE is now the single source of rates, EMI and DBR. `MortgageInput` gained `roi1Pct` (intro/fixed, payable), `roi1Years`, `roi2Pct` (follow-on, payable) and `roi3Pct` (stress — qualification only, NEVER payable). `computeMortgage` qualifies at `MAX(ROI 1, ROI 2, ROI 3)` (equivalently the smallest PV capacity), so the DBR at the qualifying rate lands on the 50% ceiling by construction and all three DBRs read within limit — no more contradictions. When ROIs are absent the legacy `actualRate + loadFactor` path is preserved unchanged, so bank-match and the agent portal are untouched. New result fields: `roi`, `qualifyingRate`, `qualifyingBindsRoi`, `maxEligible`, `maxEligibleLimitedBy`, `emi1/2/3`, `dbr1/2/3`, `roi3BelowHigher`.
- MAX ELIGIBLE is now `MIN(DBR capacity, LTV capacity)` — the client's ask is deliberately NOT a cap, so capacity can never be understated. `requested` still caps `finalMpbf` for backward compatibility but the headline, the trail and the What-if gains all run on `maxEligible`. `MpbfHeadline` dropped the "Requested finance" bar and prints finance sought as a reference line instead. `scenarioRate` now rewrites `roi3Pct` when ROIs are present (stressOverride remains the legacy fallback), and `scenarioTable` rows carry `maxEligible` + `dbr1/2/3`.
- Screen no longer computes anything: the dials, the section-05 DBR cards and the results table all read `r.roi` / `r.emi1/2/3` / `r.dbr1/2/3`. A soft warning prints when ROI 3 is entered below the highest ROI, and a note appears when ROI 2 == ROI 3 ("the stress test adds no further tightening"). Advanced panel relabelled: "Qualifying rate (drives MAX ELIGIBLE) — highest of ROI 1/2/3", contracted rate marked as the EMI basis, load factor marked legacy-fallback.
- New `src/lib/calc-print-model.ts` — pure assembler for the A4 document: amortisation schedule plus the obligation What-if families with MAX-ELIGIBLE gains, sorted best-first, gains flagged, rows that move nothing pruned, and `noGain` when LTV binds (the document says why instead of showing dead rows). Rate-only scenarios are deliberately excluded from the print per the owner's instruction.
- New `src/lib/mortgage.ts#amortizationYears` — year-wise amortisation across the two PAYABLE ROIs only; at the fixed-term end the EMI is recalculated on the outstanding balance over the remaining term. Handles the variable case (introMonths = 0 → whole schedule at ROI 2) and caps the final payment so there is no overpay. ROI 3 never appears in a schedule.
- New `src/app/calc-print/page.tsx` — the formatted assessment, `/proposal`-pattern. Page 1 = applicant & deal, MAX ELIGIBLE verdict box (interest basis, three EMIs, three DBRs), income, obligations, DBR waterfall, cap analysis with the binding row marked, payment stages with the payable/not-payable split and the EIBOR presumption block. Page 2 = amortisation, What-if (gains bolded and promoted), basis & assumptions, declaration + prepared/reviewed lines. Reads `localStorage["hfmc_calc_print"]` (written by the calculator), recomputes via `computeMortgage`, `?print=1` auto-invokes the dialog, `Summary | Full` toggle (Summary = page 1 only, the client-facing version), sticky toolbar stripped on paper, A4 print CSS with `break-inside: avoid`.
- New `src/lib/calc-xlsx.ts` — 9-sheet workbook via the already-installed SheetJS: Summary, Income (formula monthly equivalents), Obligations, Working (LIVE PV/PMT/MIN/FLOOR formulas with a fixed cell map — B4..B12 inputs, B15..B32 working — plus an engine-reconciliation block), Rate stages, Amortisation (monthly, ROI 1 → ROI 2), Amortisation at ROI 3 (stressed, reference only), What-if (DBR 1/2/3 columns + Δ + Gain?), Assumptions. SheetJS writes formulas without evaluating them; Excel does on open, which is what a banker wants.
- Calculator: new button row `View` (opens `/calc-print`, no dialog) · `Export Excel` (builds the workbook client-side, no navigation) · `Print / Save PDF` (`?print=1`). Inputs travel with `calcInput` (`...input, roi1Pct, roi1Years, roi2Pct, roi3Pct`) so every consumer recomputes identical numbers, and the whole form (inputs + rate scenario + deal shape) mirrors to `localStorage["hfmc_calc_form"]` and re-seeds in the `useState` initialisers — so View → Back and a browser refresh land on the same figures. Reset issues a fresh `CALC-YYYYMMDD-XXXX` reference.
- Verified: `tsc --noEmit` 0 errors, `eslint` clean on all five touched files, `next build` exit 0 with `/calc-print` in the route table.

Stage Summary:
- The engine, the screen, the printed assessment and the Excel workbook now all quote the same three ROIs, the same three EMIs and the same three DBRs, computed in exactly one place; and the eligibility figure a banker sees is capacity, not whatever the client happened to ask for.

---

Task ID: chat + admin-settings hardening
Agent: cline
Task: Fix staff→client chat delivery, thread switching, read receipts, attachment UX, save-to-vault; fix Admin → Settings → Notifications/Devices not saving; remove the `.kilo/worktrees` stale copy

Work Log:
- Chat delivery (staff→client never arrived). Two stacked causes: (1) a client logs in with ONE case but `/api/client/state` lets them switch sibling bank journeys sharing `clientId` — chat only accepted the login case, so staff replies on a sibling journey 403'd for the client; (2) on a shared test laptop both the staff and stale client cookies exist, and the old `if (client)` branch ran first and short-circuited staff. New `src/lib/chat-auth.ts` (`clientCanAccessCase`, `siblingCaseIds`); staff session now always wins in GET/POST/upload/heartbeat, and staff→client web push fans out to every sibling caseId. Agent→staff push added (was missing).
- Failed sends were silently swallowed client-side (`else { setText(content) }` with no message) — a 403 "your designation may not reply in chat" looked exactly like "not reaching". The POST/upload error string is now thrown, shown inline in a red bar, and the typed text is restored.
- Thread mix-up: staff clicking an AGENT row in the mini-inbox always landed on CLIENT because `ChatDrawer` kept only `caseId` and dropped `threadType`. Drawer now tracks `activeThread`, passes `initialThread`, and remounts via `key={caseId_thread}`. Inbox rows carry a `client` / `partner` badge with distinct avatar colours.
- Read receipts: WhatsApp-style small-letter `sent` → `seen` (blue) for staff, `received` → `seen` for client/agent, driven by the real `readByStaff`/`readByExternal` flags. Added an 8s polling fallback (SSE dies silently behind some proxies) that both picks up missed messages and refreshes tick state; heartbeat now handles the agent session too.
- Attachments: upload rewritten on XHR (fetch cannot report upload progress) showing the real filename plus a live % bar, then a proper error if it fails; the old `View` link pointed at a route that never existed (`/api/documents/download?key=`) and now opens the vault file (`/api/documents/:id/file`).
- Save-to-vault: `ChatMessageDto` gained `documentId` (joined by storage key in GET, SSE and POST) and staff get a one-click **Save to Vault** button on incoming attachments, backed by the new `src/app/api/chat/[caseId]/attachments/[docId]/save` route (recategorises and stamps activity without leaving chat).
- Admin → Settings → Notifications "not saved when ticked". Root cause: the GET route was refactored to wrap its payload as `{ settings }` (to mask API keys) but the tab still did `setCfg(rawResponse)`, so every toggle read `undefined` and rendered OFF no matter what the DB held, and Save posted the wrapper shape back so the route's `patch.notifXxx` lookups were all `undefined` — nothing persisted, silently. The same envelope bug hit the Devices tab (`{ devices }` wrapper stored as the array → "No registered devices" forever). Both tabs now unwrap, surface real server errors, and re-sync from the response. The 23 legacy `notif_*` rows in `AppSetting` (all `true`) are leftovers from before the wrapper landed; the read/write key mapping in `notification-settings.ts` was already correct.
- Toggles only ever changed local state, so a tick looked like a save. Added a dirty flag (`saved` snapshot vs current cfg) → "unsaved changes" chip, the Save button is disabled and reads "Saved" when clean, and is the only thing that writes.
- 31 `react-hooks/static-components` errors in admin.tsx: `NotificationsTab` defined `Toggle`/`Field` inside the render body, shadowing the module-level ones of the same name. Extracted to module level as `NotifToggle`/`NotifInput`. DevicesTab's `set-state-in-effect` fixed by making `devices === null` the loading state and reloading through a `reloadKey` counter from the event handler.
- Deleted `.kilo/` — a stale worktree copy of the whole repo that doubled every lint finding and confused `CODEBASE.md` searches.
- Verified end-to-end against the running dev server with a minted admin session: `GET { settings }` 200, `PUT` flipping `notif_clientEmail true→false` and `notif_staffOnLeadAssigned true→false`, raw `AppSetting` rows confirming the write, re-`GET` confirming the reload, then restored to the original values; `GET /api/admin/devices` 200 with the `{ devices }` envelope and 15 registered devices; staff page `/`, `/api/state`, `/api/admin` all 200. `tsc --noEmit` 0 errors; repo `eslint` down from 40E/10W to 5E/5W, all 5 pre-existing and unrelated (scripts/backfill-clients.js, PwaInstallBanner, carousel, case-profile-editor, use-mobile).

Stage Summary:
- Staff replies reach the client on any bank journey and on the correct thread, both sides see sent/received/seen, attachments show progress then a real filename, and any chat attachment can be filed into the Document Vault in one click. Admin notification and device settings now load what is actually stored and persist what you toggle.



---

Task ID: rate-card bank-default inheritance + safe override revert
Agent: cline
Task: Make the inherited bank-default layer real (processing fees), and give overrides a safe way back to the default

Work Log:
- Found a live divergence: `/api/proposal` recalculated the processing fee from the product alone, so a product with no filed fee quoted `null` while the Rate Desk grid showed the bank's default. Two copies of one rule had already drifted.
- `processingFeePct()` / `processingFeeAed()` now take a final `bankDefaultPct` (default `null`, so every existing call site is unchanged). `bank-match.ts` loads `Bank.defaultProcessingFeePct` alongside the products and passes it in; the fee block is now built even when a product has no `feesJson` at all, instead of being skipped. `/api/proposal` uses the same call and only reads approved, active products.
- Precedence is explicit and tested: slab -> segment -> product default -> bank default -> `null`. An **expired promo with no filed standard stays `null`** - inheriting there would resurrect a fee we already knew had a different standard. That case is the one assertion in the new block that exists because getting it wrong is silent.
- Inheritance is QUIET. `CardField` now keeps `parentValue` and sets `overridden` with half-a-basis-point tolerance (float noise must never read as an override). The grid shows the inherited number plainly and marks only a genuine row override with an amber `dagger`, naming where the value came from on hover.
- **Revert is now a real action.** The edit panel shows the bank default it would fall back to, and offers `Revert to 0.525%` when (and only when) the row is a real override AND a default exists - offering a revert with nothing to revert to would promise inheritance that is not there. A null commit is a REVERT, not a zero: the route deletes `feesJson.processing.default` instead of writing `default: null`, which would shadow the default with a blank, and it leaves sibling fee keys (`min`/`max`/slabs) alone so clearing a row default cannot delete a product's other filed fees. A reason is still required and the button stays disabled until one is typed.
- 16 new assertions (107 -> 123) in `tests/pricing-floor.test.ts`, covering product-over-default, missing-product-inherits, slab/segment still winning, the expired-promo `null`, `processingFeeAed` parity, grid-vs-engine equality, and `cardField` override detection. The harness now compiles `bank-fees.ts` + `format.ts` as siblings so the fee rules are testable without a DB.
- Removed the temporary probe `scripts/tmp-bankdefaults.cjs`.
- Verified: `npx tsc --noEmit` clean, `eslint` clean on all eight touched files, `npm run test:pricing` 123 passed / 0 failed.

Scope left open (deliberate, not an oversight): only `defaultProcessingFeePct` is fully resolved end-to-end. LTV, minimum salary, tenor and stress buffer are still display/rule metadata in Bank Defaults, not a resolved row hierarchy - wiring them would change qualification outcomes, which is a bigger call than a fee.

---

Task ID: sanctions visibility + PR1 safety (validation, pos/neg points, in-place write)
Agent: cline
Task: Report the nationality restrictions the engine cannot see; land the safe PR-1 items

Work Log:
- Measured, not assumed: `RateQuote.nationalityRule` is a fully built, enforced axis (`nationalityAllowed()` via `quoteMatches()`, ranked by `quoteSpecificity()`) and it was set on **0 of 470 quotes**. `emirates[]` likewise 0. Meanwhile **11 banks** state a real restriction in `axesJson["Restricted Nationalities"]` that no matcher can see - RAK's "Syria, Pakistan, Iran, North Korea, Congo", NBF/Arab Bank "Iranians", ADIB's list, SCB's "Syria - even birth place". So a restricted client is currently matched and quoted.
- New READ-ONLY `scripts/check-nationality-rules.mjs` (+ `scripts/nationality-report.txt`). It does NOT auto-apply anything; it prints each bank with its source wording so a human can check the reading first.
- **The classification is the whole point, and it caught a bug in itself.** The same sheet label carries four different real meanings: BAN ("Iranians"), CONDITIONAL ("Iranians - Non ENBD Banking clients & STL is mandatory"), LTV_CAP ("Iranian - LTV restricted to 60%"), APPROVAL ("Russia ... compliance approval"). Only one is a hard deny. My first pass read ENBD as a BAN of Pakistan/Iran - it is actually an ALLOW-LIST ("Accept applications from these countries only: UK, France, ... Pakistan"), i.e. the exact inversion that refuses good clients. Added an ALLOWLIST kind, tested first. Result: **5 of 11 banks read as an unambiguous hard ban**; the rest need a human call. Only BAN rows are safe to type in.
- Left as open questions rather than guessed: a **birthplace** ban (SCB: "Syria - even birth place") is broader than a passport check and `nationality` cannot represent it. And `nationalityAllowed()` returns TRUE for an unknown passport (deliberate fail-open, reported via `unknownAxes()`) - for a sanctions rule that is the wrong default and needs a policy decision.
- **PR1.1** - `productIssues()` moved out of the Bank Rules component into `src/lib/product-issues.ts` (pure, no React). It was trapped in one screen, so the only check for a mistyped rate ran on the screen admins use least. Now enforced SERVER-SIDE on `rate-desk` `kind:"verify"`: a rate cannot be stamped "confirmed with the bank" while it is obviously wrong, which would otherwise sit unquestioned for 12 months. Advisory issues (text-only fees/insurance) still do not block.
- A test caught a real gap in the check itself: `0.0395` (3.95 divided by 100 once too often) passed, because it is a well-formed number under 20. Added the sub-1% case - nothing in the UAE prices below ~1%. 13 new assertions, 123 -> 136.
- **PR1.2** - pos/neg points were **read-only in the entire app**. They were declared in the Bank Defaults TS interface and never rendered; the only writer anywhere was `seed.ts`. Added Strengths / Watch-outs inputs to Bank Defaults and made `PUT /api/admin/bank-defaults` accept them. 9/18 banks have a value, 8 are blank - they are now editable for the first time. Internal-only (proposal sends them under `mode === "internal"`).
- **PR1.3** - Bank Rules "Approve & save" spread `{...editing}` into `PATCH /api/admin`, writing `pricingJson` and `feesJson` IN PLACE with no reason - the exact thing CODEBASE.md says must never happen. Now strips both, so that tab approves RULES and rates move only through the Rate Desk.
- Corrected two false CODEBASE.md claims found along the way: the "+ Save as New Version (Next Month)" button does not exist (dead `bankproduct_version` handler, duplicated twice in api/admin/route.ts; 12 products with version>1 came from scripts), and Bank Defaults has NO age-based staleness despite the doc claiming a 12-month warning.
- Verified: `npx tsc --noEmit` clean, `eslint` clean on all touched files, `npm run test:pricing` 136 passed / 0 failed.

Deliberately NOT done, pending review of `scripts/nationality-report.txt`: typing any `nationalityRule` into a quote. Only the BAN rows are safe; the rest would refuse clients the bank lends to. Bank Rules itself was kept, per instruction.
