// Lead readiness — ONE definition of "is this lead ready to become a case",
// shared by the Convert pre-flight modal and the Leads list (its badge, its
// sort and its "Ready to convert" filter).
//
// WHY A SHARED MODULE: the pre-flight checklist and the list badge are the
// same five questions asked of the same person. If they were written twice they
// would drift — the modal would say a lead is ready while the list ranked it
// last, and nobody would trust either. Pure and dependency-free on purpose: the
// modal needs it to decide whether to block, the list needs it to sort, and the
// sort must stay cheap enough to run on every keystroke of a search box.

export interface ReadinessItem {
  key: "phone" | "email" | "kyc" | "owner" | "amount";
  label: string;
  ok: boolean;
  /** Soft gaps are shown and sorted on, but never block a conversion. */
  soft: boolean;
  hint: string;
}

export interface Readiness {
  items: ReadinessItem[];
  /** 0–100, weighted so the three hard gaps dominate. */
  score: number;
  /** No HARD gap outstanding — i.e. this lead could be converted right now. */
  ready: boolean;
  /** How many hard gaps are outstanding. */
  gaps: number;
}

export interface ReadinessInput {
  phone: string;
  email: string;
  eidNo?: string | null;
  passportNo?: string | null;
  /** Resolved owner name, or null/undefined when unassigned. */
  ownerName?: string | null;
  /**
   * The amount the prospect is asking about. Optional and possibly null — a
   * lead legitimately has "not stated" (Phase 4 makes that a real value on the
   * Lead row rather than a zero), and a golden-visa enquiry has no loan figure at
   * all. Callers pass `intendedAmount ?? 0`.
   */
  loanAmount?: number | null;
  customer?: string;
  /**
   * Optional: is the money figure meaningful for what they asked about? A will
   * or a golden visa has no "loan amount", so requiring one would block a
   * conversion that is perfectly ready. When false the amount is scored but not
   * treated as a hard gap.
   */
  amountMatters?: boolean;
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function phoneDigits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const { phone, email, eidNo, passportNo, ownerName, amountMatters = true } = input;
  const amount = input.loanAmount ?? 0;

  const phoneOk = phoneDigits(phone).length >= 7;
  const emailOk = isValidEmail(email);
  const kycId = (eidNo || passportNo || "").trim();
  const ownerOk = !!ownerName && ownerName.trim().length > 0;
  const amountOk = amount > 0;

  const items: ReadinessItem[] = [
    {
      key: "phone", label: "Phone on file", ok: phoneOk, soft: false,
      hint: phoneOk ? phone.trim() : "Required — the client can't be chased without it",
    },
    {
      key: "email", label: "Email on file", ok: emailOk, soft: true,
      hint: emailOk ? email.trim() : "Optional, but every gap here is a dead lead later",
    },
    {
      key: "kyc", label: "KYC identity", ok: !!kycId, soft: true,
      hint: kycId || "Not needed to convert — collect it in Document Collection",
    },
    {
      key: "owner", label: "Owner assigned", ok: ownerOk, soft: false,
      hint: ownerOk ? (ownerName as string) : "Unassigned files are how cases go quiet for 3 weeks",
    },
    {
      // Amount is only a HARD gap where money is the thing being asked about. A
      // golden-visa or will enquiry has no loan figure to capture, and demanding
      // one would leave a perfectly ready lead permanently "not ready".
      key: "amount",
      label: amountMatters ? "Amount captured" : "Amount captured (optional here)",
      ok: amountOk,
      soft: !amountMatters,
      hint: amountOk
        ? `AED ${amount.toLocaleString()}`
        : amountMatters
          ? "Needed before the match engine can quote anything"
          : "Not applicable to this service — convert without it",
    },
  ];

  // Hard gaps weigh 2, soft gaps weigh 1, so a lead missing only an email still
  // outranks one with no owner and no amount.
  const earned = items.reduce((s, i) => s + (i.ok ? (i.soft ? 1 : 2) : 0), 0);
  const possible = items.reduce((s, i) => s + (i.soft ? 1 : 2), 0);

  return {
    items,
    score: Math.round((earned / possible) * 100),
    ready: items.every((i) => i.ok || i.soft),
    gaps: items.filter((i) => !i.ok && !i.soft).length,
  };
}
