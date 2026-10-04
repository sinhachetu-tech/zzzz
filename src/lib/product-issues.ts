// Validate a bank product before it is approved — pure, no React, no DB.
//
// WHY this lives in its own module: it was trapped inside `BankRulesTab` in
// `admin.tsx` as a component-local function, which meant the ONE thing that
// catches a mistyped rate could only run on that single screen. The Rate Desk
// (the screen admins actually use daily) had no equivalent, so a rate typed as
// 39.5 instead of 3.95 was caught in one place and not the other.
//
// These are all MALFORMED-INPUT checks, which is a different failure mode from
// `rowIssues()` in `rate-cards.ts` (STALENESS: never / aging / stale). A card
// can be perfectly fresh and still be nonsense, so neither set replaces the
// other.
//
// The messages are deliberately written for a person who did not write the
// importer, because the failure being caught is always "the spreadsheet said
// something ambiguous" — 39.5 and 0.0395 are both plausible readings of the
// same cell, and only one of them is a mortgage rate.
import type { RateQuote } from "@/lib/bank-pricing";

export interface ProductIssue {
  msg: string;
  /** Blocking = approval is refused. Advisory = worth saying, not worth blocking. */
  blocking: boolean;
}

/** The subset of a product this needs. Structural, so both the store's
 *  `BankProduct` and a plain object from an API can be passed. */
export interface ValidatableProduct {
  maxLtvNational?: number | null;
  maxLtvExpatriate?: number | null;
  tenorYears?: number | null;
  minLoan?: number | null;
  maxLoan?: number | null;
  minSalary?: number | null;
  pricingJson?: string | null;
  fees?: string | null;
  insurance?: string | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function productIssues(p: ValidatableProduct): ProductIssue[] {
  const issues: ProductIssue[] = [];

  const ltvN = num(p.maxLtvNational);
  if (ltvN != null && (ltvN <= 0 || ltvN > 100))
    issues.push({ msg: `Max LTV (nationals) ${ltvN}% looks wrong — LTV is between 1 and 100.`, blocking: true });

  const ltvE = num(p.maxLtvExpatriate);
  if (ltvE != null && (ltvE <= 0 || ltvE > 100))
    issues.push({ msg: `Max LTV (expats) ${ltvE}% looks wrong — LTV is between 1 and 100.`, blocking: true });

  const tenor = num(p.tenorYears);
  if (tenor != null && (tenor <= 0 || tenor > 30))
    issues.push({ msg: `Tenor ${tenor}y looks wrong — mortgages run 1 to 30 years.`, blocking: true });

  const minLoan = num(p.minLoan);
  const maxLoan = num(p.maxLoan);
  if (minLoan != null && maxLoan != null && minLoan > maxLoan)
    issues.push({ msg: "Min loan is larger than max loan — swap them.", blocking: true });

  let quotes = 0;
  try {
    const parsed = JSON.parse(p.pricingJson as string);
    for (const q of (parsed?.quotes ?? []) as RateQuote[]) {
      quotes += 1;
      // The decimal error is the single most likely way an Excel import corrupts a
      // rate card: 3.95 read as 39.5, or 3.95 read as 0.0395. Both "look" like a
      // number in the cell, and only one is a mortgage rate in the UAE.
      // The decimal error has two directions and both are real: 3.95 read as 39.5
      // (the cell lost a decimal point) and 3.95 read as 0.0395 (a percentage
      // divided by 100 one time too many). The second is caught here rather than
      // by the `> 20` test, because 0.0395 is a perfectly well-formed NUMBER — it
      // just cannot be a mortgage rate, since nothing in the UAE prices below ~1%.
      const absurdlyLow = q.ratePct != null && q.ratePct < 1;
      if (q.rateType === "FIXED" && (q.ratePct == null || q.ratePct <= 0 || q.ratePct > 20 || absurdlyLow))
        issues.push({ msg: `A quote has rate ${q.ratePct}% — rates are small numbers like 3.95, not 39.5 or 0.0395.`, blocking: true });
      if (q.rateType !== "FIXED" && (q.marginPct == null || q.marginPct < 0 || q.marginPct > 15))
        issues.push({ msg: `A variable quote has margin ${q.marginPct}% — margins are small numbers like 1 or 1.49.`, blocking: true });
    }
  } catch {
    issues.push({ msg: "The pricing JSON is not valid — use the guided quote editor or fix the JSON.", blocking: true });
  }
  if (quotes === 0)
    issues.push({ msg: "No structured quotes yet — without them the engine cannot price this bank at all.", blocking: true });

  const salary = num(p.minSalary);
  if (salary != null && salary > 0 && salary < 1000)
    issues.push({ msg: `Min salary ${salary} looks too small — salaries are monthly in AED (e.g. 10000, not 10).`, blocking: true });

  if (!p.fees) issues.push({ msg: "Fees are text only — they are not part of cost calculations yet.", blocking: false });
  if (!p.insurance) issues.push({ msg: "Insurance is text only — not part of cost-to-close yet.", blocking: false });
  return issues;
}

/** Approval is refused while any blocking issue stands. */
export const blockingIssues = (p: ValidatableProduct) => productIssues(p).filter((i) => i.blocking);
