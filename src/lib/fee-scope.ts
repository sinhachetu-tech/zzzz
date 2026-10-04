// Which table does a fee belong in?
//
// There are exactly two fee worlds and conflating them produces wrong client quotes:
//
//   PLACE fees  → FeeRule, keyed by EMIRATE × TRANSACTION
//                DLD/ADM transfer · trustee · mortgage registration · title deed
//                real estate agency
//
//   BANK fees   → BankProduct.feesJson, keyed by the product's axes
//                processing fee · valuation fee · pre-approval
//                life & property insurance · early/partial settlement
//
// A place fee does NOT change when the client picks a different bank. Twelve rows
// got this wrong (Bank Processing Fee / Valuation Fee filed under both Dubai and Abu
// Dhabi), which made a client's bank fee depend on their emirate AND double-counted
// it against the real per-bank figure. This predicate now rejects them at the API.
//
// Lives in its own module (not admin.tsx) so the server route can use it without
// importing the whole client component tree.
export function isBankFeeLabel(label: string): boolean {
  return /bank\s+processing|processing\s+fee|valuation\s+fee/i.test(label || "");
}

/** Human-readable reason, used in the rejection message. */
export const BANK_FEE_MISFILE_MESSAGE =
  "\"Bank Processing Fee\" and \"Valuation Fee\" belong to the bank product (Admin → Bank Rules), "
  + "not the emirate fee table — a bank fee must not change with the emirate.";
