// Resolve a case (+ its client) into the flat data bag the form registry reads.
//
// The bag is intentionally SHALLOW and predictable: `name.first`, `eidNo`,
// `formData.bankAccounts[0].number`, and so on. Every canonical field points at
// one of these paths, so adding a bank form never needs a new resolver — it
// only needs a mapping onto fields that already exist.
//
// `formData` is the "bank asked for something we do not model" escape hatch. It
// is intentionally permissive: modelling every liability bucket and household
// count as first-class columns is not a schema worth having when 80 forms only
// ever read them, and it is trivial to add a key here later.
//
// NAMES ARE NEVER GUESSED. `name.first` / `name.middle` / `name.last` come only
// from fields a person confirmed. When they are absent the single `name.full`
// still works, and a form wanting one box is filled; only a form demanding three
// boxes gets blanks. Splitting "Abdullah Mohammed Al Rashid" by guesswork is the
// kind of thing that gets an application rejected at the bank, so we don't.

import type { ClientDto, LoanCase } from "./types";
import { parseCaseProfile } from "./case-profile";
import { ALL_SHEET_FIELDS } from "./person-sheet";

export interface FormDataBag {
  name: { first: string; middle: string; last: string; full: string };
  eidNo: string;
  eidExpiry: string;
  passportNo: string;
  dob: string;
  nationality: string;
  phone: string;
  email: string;
  monthlySalary: number;
  variableIncome: number;
  rentalIncome: number;
  existingEmis: number;
  creditCardLimits: number;
  totalIncome: number;
  companyName: string;
  employmentProfile: string;
  propertyValue: number | null;
  loanAmount: number;
  transactionType: string;
  propertyLocation: string;
  stage: string;
  caseNumber: string;
  customer: string;
  /** Whatever the profile / case happens to carry beyond the modelled fields. */
  formData: Record<string, unknown>;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(str(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Split a stored full name into parts ONLY when the parts were confirmed by a
 * person. `profile.primary` may carry firstName/middleName/lastName; when it
 * does not, they stay empty rather than being derived from `fullName`.
 */
function nameParts(
  full: string,
  confirmed?: { firstName?: string; middleName?: string; lastName?: string },
): { first: string; middle: string; last: string; full: string } {
  const f = str(confirmed?.firstName);
  const m = str(confirmed?.middleName);
  const l = str(confirmed?.lastName);
  return { first: f, middle: m, last: l, full: str(full) };
}

export function resolveFormData(
  c: LoanCase,
  client: ClientDto | null,
  profileJson?: string | null,
): FormDataBag {
  const prof = parseCaseProfile(profileJson ?? c.profileJson ?? "", {
    customer: c.customer,
    whatsapp: c.whatsapp,
    loanAmount: c.loanAmount,
    coApplicantName: c.coApplicantName,
  });
  const p = prof.primary as unknown as {
    fullName?: string;
    firstName?: string; middleName?: string; lastName?: string;
    email?: string; phone?: string; dob?: string; nationality?: string;
    eidNo?: string; passportNo?: string;
    monthlySalary?: number; variableIncome?: number; rentalIncome?: number;
    existingEmis?: number; creditCardLimits?: number; companyName?: string;
  };

  // The case profile is the per-engagement snapshot and is therefore preferred
  // over the Client master, which holds the LATEST known truth across every
  // engagement. A form filed today should reflect what we know today.
  const pick = <T,>(a: T | undefined, b: T | null | undefined): T => (a !== undefined && a !== null && a !== "" ? a : (b as T));

  const monthlySalary = num(pick(p.monthlySalary, client?.monthlySalary));
  const variableIncome = num(pick(p.variableIncome, client?.variableIncome));
  const rentalIncome = num(pick(p.rentalIncome, client?.rentalIncome));
  const existingEmis = num(pick(p.existingEmis, client?.existingEmis));
  const creditCardLimits = num(pick(p.creditCardLimits, client?.creditCardLimits));

  return {
    name: nameParts(
      str(p.fullName || c.customer),
      { firstName: p.firstName, middleName: p.middleName, lastName: p.lastName },
    ),
    eidNo: str(pick(p.eidNo, client?.eidNo)),
    eidExpiry: str((p as Record<string, unknown>).eidExpiry),
    passportNo: str(pick(p.passportNo, client?.passportNo)),
    dob: str(pick(p.dob, client?.dob)),
    nationality: str(pick(p.nationality, client?.nationality)),
    phone: str(pick(p.phone, c.whatsapp || client?.phone)),
    email: str(pick(p.email, client?.email)),
    monthlySalary,
    variableIncome,
    rentalIncome,
    existingEmis,
    creditCardLimits,
    totalIncome: monthlySalary + variableIncome + rentalIncome,
    companyName: str(pick(p.companyName, client?.companyName)),
    employmentProfile: c.employmentProfile,
    propertyValue: c.propertyValue ?? null,
    loanAmount: c.loanAmount,
    transactionType: c.transactionType,
    propertyLocation: str(c.propertyLocation),
    stage: c.stage,
    caseNumber: c.caseNumber,
    customer: c.customer,
    // The reusable answer sheet is spread in UNDER the modelled fields, so a
    // sheet value can fill something we do not model as a column (the bank
    // account breakdown, the shareholding percentage) without either layer
    // knowing about the other. Modelled values win where both exist — they are
    // the typed, validated source; the sheet is a broad, looser capture.
    formData: {
      ...((p as Record<string, unknown>).formData as Record<string, unknown> ?? {}),
      ...(client?.personData ?? {}),
      // Also expose the sheet under its registry key, so "Total monthly income"
      // resolves as `totalIncome` without being re-listed by hand here.
      ...sheetAliases(client?.personData),
    },
  };
}

/** Registry-key aliases for a sheet, e.g. totalMonthlyIncome → totalIncome. */
function sheetAliases(sheet: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!sheet) return {};
  const out: Record<string, unknown> = {};
  for (const f of ALL_SHEET_FIELDS) {
    if (out[f.key] === undefined) out[f.key] = sheet[f.path];
  }
  return out;
}
