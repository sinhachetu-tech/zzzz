// Client master — the PERSON behind every engagement. One row per human:
// today's mortgage, next year's buyout, the insurance policy after that all
// link back to the same Client row.
//
// Identity resolution (what decides "same person"):
//   1. EID number  — legally unique in the UAE → definite auto-merge.
//   2. Phone + similar name — confident merge (families share numbers,
//      so the name must corroborate the phone).
//   3. Phone alone — NEVER merges. It's a hint for the UI to surface
//      ("this number is already on file for X — verify"), a human decides.
//   4. Name alone — never merges. Name collisions are normal in the UAE.
//
// Merge policy on match: fill empty fields from the new data; refresh
// financials only with non-zero values (an emptier profile never erases the
// master). Each case keeps its own profileJson snapshot as filed; this master
// holds the latest known truth.

import { db } from "@/lib/db";
import { parseCaseProfile } from "@/lib/case-profile";

export function digits(s?: string | null): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** EID stored digits-only (784-YYYY-NNNNNNN-C → 784YYYYNNNNNNNC). */
export function eidDigits(s?: string | null): string {
  const d = digits(s);
  return d.length >= 10 ? d : "";
}

function nameTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z\u00c0-\u024f\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

/** Token overlap ≥ 0.6 (Jaccard). "sara al rashid" vs "sara al hashimi" (0.5) stays apart. */
function namesSimilar(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared) >= 0.6;
}

export interface ClientSeed {
  fullName: string;
  phone?: string | null;
  eidNo?: string | null;
  passportNo?: string | null;
  email?: string | null;
  dob?: string | null;
  nationality?: string | null;
  residency?: string | null;
  employmentProfile?: string | null;
  companyName?: string | null;
  emirate?: string | null;
  monthlySalary?: number;
  variableIncome?: number;
  rentalIncome?: number;
  existingEmis?: number;
  creditCardLimits?: number;
}

export type MatchStrength = "eid" | "phone_name" | null;

/** Phone+name corroboration lookup used by the portal register (warm prefill). */
export async function matchClientByPhoneName(phone: string | null | undefined, fullName: string): Promise<{ id: number } | null> {
  const ph = digits(phone);
  if (ph.length < 7 || !fullName.trim()) return null;
  const cands = await db.client.findMany({ where: { phone: ph } });
  return cands.find((c) => namesSimilar(c.fullName, fullName)) ?? null;
}

/** Find-or-create the Client row for a seed, applying the merge policy. */
export async function resolveClient(seed: ClientSeed): Promise<{ client: { id: number; fullName: string; phone: string } ; matched: MatchStrength }> {
  const fullName = seed.fullName.trim();
  const eid = eidDigits(seed.eidNo);

  let existing = null as null | { id: number };
  let matched: MatchStrength = null;

  if (eid) {
    const byEid = await db.client.findUnique({ where: { eidNo: eid } });
    if (byEid) {
      existing = byEid;
      matched = "eid";
    }
  }
  if (!existing) {
    const ph = digits(seed.phone);
    if (ph.length >= 7 && fullName) {
      const cands = await db.client.findMany({ where: { phone: ph } });
      const hit = cands.find((c) => namesSimilar(c.fullName, fullName));
      if (hit) {
        existing = hit;
        matched = "phone_name";
      }
    }
  }

  if (existing) {
    const updated = await db.client.update({ where: { id: existing.id }, data: mergeData(seed, eid, false) });
    return { client: updated, matched };
  }

  const created = await db.client.create({ data: mergeData(seed, eid, true) as { fullName: string } });
  return { client: created, matched: null };
}

/** Build the write payload: creation takes everything; a merge fills gaps + fresh non-zero financials. */
function mergeData(seed: ClientSeed, eid: string, isNew: boolean): Record<string, unknown> {
  const ph = digits(seed.phone);
  const usablePhone = ph.length >= 7 ? ph : "";
  const str = (v?: string | null) => {
    const t = String(v ?? "").trim();
    return t.length ? t : undefined;
  };
  const num = (v?: number) => (typeof v === "number" && v > 0 ? v : undefined);

  if (isNew) {
    return {
      fullName: seed.fullName.trim(),
      phone: usablePhone,
      eidNo: eid || undefined,
      passportNo: str(seed.passportNo),
      email: str(seed.email),
      dob: str(seed.dob),
      nationality: str(seed.nationality),
      residency: str(seed.residency) ?? "Resident Expatriate",
      employmentProfile: str(seed.employmentProfile) ?? "Salaried",
      companyName: str(seed.companyName),
      emirate: str(seed.emirate),
      monthlySalary: num(seed.monthlySalary) ?? 0,
      variableIncome: num(seed.variableIncome) ?? 0,
      rentalIncome: num(seed.rentalIncome) ?? 0,
      existingEmis: num(seed.existingEmis) ?? 0,
      creditCardLimits: num(seed.creditCardLimits) ?? 0,
    };
  }
  // merge: fill empty identity fields, refresh financials with non-zero values
  return {
    ...(eid ? { eidNo: eid } : {}),
    ...(str(seed.passportNo) ? { passportNo: str(seed.passportNo) } : {}),
    ...(usablePhone ? { phone: usablePhone } : {}),
    ...(str(seed.email) ? { email: str(seed.email) } : {}),
    ...(str(seed.dob) ? { dob: str(seed.dob) } : {}),
    ...(str(seed.nationality) ? { nationality: str(seed.nationality) } : {}),
    ...(str(seed.residency) ? { residency: str(seed.residency) } : {}),
    ...(str(seed.employmentProfile) ? { employmentProfile: str(seed.employmentProfile) } : {}),
    ...(str(seed.companyName) ? { companyName: str(seed.companyName) } : {}),
    ...(str(seed.emirate) ? { emirate: str(seed.emirate) } : {}),
    ...{ monthlySalary: num(seed.monthlySalary) },
    ...{ variableIncome: num(seed.variableIncome) },
    ...{ rentalIncome: num(seed.rentalIncome) },
    ...{ existingEmis: num(seed.existingEmis) },
    ...{ creditCardLimits: num(seed.creditCardLimits) },
  };
}

/**
 * Ensure a case's Client links exist and the master is refreshed.
 * Called on case creation, portal registration and every profile save.
 * Phone/EID live in the profile (primary + second party); the case's flat
 * fields (customer / whatsapp / coApplicantName) act as fallbacks.
 */
export async function syncCaseClients(caseId: number): Promise<void> {
  const c = await db.loanCase.findUnique({ where: { id: caseId } });
  if (!c) return;

  const prof = parseCaseProfile(c.profileJson, {
    customer: c.customer,
    whatsapp: c.whatsapp,
    loanAmount: c.loanAmount,
    coApplicantName: c.coApplicantName,
  });
  const p = prof.primary;

  const primarySeed: ClientSeed = {
    fullName: (p.fullName || c.customer || "").trim(),
    phone: p.phone || c.whatsapp,
    eidNo: p.eidNo,
    passportNo: p.passportNo,
    email: p.email,
    dob: p.dob,
    nationality: p.nationality,
    residency: p.residency,
    employmentProfile: p.employmentProfile,
    companyName: p.companyName,
    emirate: prof.property.propertyLocation,
    monthlySalary: p.monthlySalary,
    variableIncome: p.variableIncome,
    rentalIncome: p.rentalIncome,
    existingEmis: p.existingEmis,
    creditCardLimits: p.creditCardLimits,
  };

  const data: { clientId?: number; secondPartyClientId?: number | null } = {};
  if (primarySeed.fullName) {
    const { client } = await resolveClient(primarySeed);
    if (c.clientId !== client.id) data.clientId = client.id;
  }

  const s = prof.secondParty;
  const hasSecond = s.role !== "none" && s.fullName.trim().length > 0;
  if (hasSecond) {
    const { client } = await resolveClient({
      fullName: s.fullName.trim(),
      phone: s.phone,
      eidNo: s.eidNo,
      passportNo: s.passportNo,
      email: s.email,
      dob: s.dob,
      nationality: s.nationality,
      residency: s.residency,
      employmentProfile: s.employmentProfile,
      companyName: s.companyName,
      monthlySalary: s.monthlySalary,
      variableIncome: s.variableIncome,
      rentalIncome: s.rentalIncome,
      existingEmis: s.existingEmis,
      creditCardLimits: s.creditCardLimits,
    });
    if (c.secondPartyClientId !== client.id) data.secondPartyClientId = client.id;
  } else if (c.secondPartyClientId) {
    data.secondPartyClientId = null; // second party removed from the profile
  }

  if (Object.keys(data).length) {
    await db.loanCase.update({ where: { id: caseId }, data });
  }
}
