// One-off backfill: create Client master rows for every existing case and
// link them (clientId / secondPartyClientId). Same identity policy as
// src/lib/client-master.ts: EID exact → phone+name → create new.
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const digits = (s) => String(s ?? "").replace(/\D/g, "");
const eidDigits = (s) => { const d = digits(s); return d.length >= 10 ? d : ""; };

function nameTokens(s) {
  return new Set(String(s || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length > 1));
}
function namesSimilar(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared) >= 0.6;
}

function seedFrom(primary, fallbacks) {
  return {
    fullName: String(primary?.fullName || fallbacks.customer || "").trim(),
    phone: digits(primary?.phone || fallbacks.whatsapp),
    eidNo: eidDigits(primary?.eidNo),
    passportNo: String(primary?.passportNo || "").trim() || null,
    email: String(primary?.email || "").trim() || null,
    dob: String(primary?.dob || "").trim() || null,
    nationality: String(primary?.nationality || "").trim() || null,
    residency: String(primary?.residency || "").trim() || "Resident Expatriate",
    employmentProfile: String(primary?.employmentProfile || "").trim() || "Salaried",
    companyName: String(primary?.companyName || "").trim() || null,
    emirate: String(fallbacks.propertyLocation || "").trim() || null,
    monthlySalary: Number(primary?.monthlySalary) || 0,
    variableIncome: Number(primary?.variableIncome) || 0,
    rentalIncome: Number(primary?.rentalIncome) || 0,
    existingEmis: Number(primary?.existingEmis) || 0,
    creditCardLimits: Number(primary?.creditCardLimits) || 0,
  };
}

function mergeData(seed, isNew) {
  const phone = seed.phone.length >= 7 ? seed.phone : "";
  const str = (v) => (v && String(v).trim() ? String(v).trim() : null);
  const num = (v) => (v > 0 ? v : null);
  if (isNew) {
    return {
      fullName: seed.fullName, phone,
      eidNo: seed.eidNo || null, passportNo: str(seed.passportNo), email: str(seed.email),
      dob: str(seed.dob), nationality: str(seed.nationality),
      residency: seed.residency, employmentProfile: seed.employmentProfile,
      companyName: str(seed.companyName), emirate: str(seed.emirate),
      monthlySalary: seed.monthlySalary, variableIncome: seed.variableIncome,
      rentalIncome: seed.rentalIncome, existingEmis: seed.existingEmis,
      creditCardLimits: seed.creditCardLimits,
    };
  }
  return {
    ...(seed.eidNo ? { eidNo: seed.eidNo } : {}),
    ...(str(seed.passportNo) ? { passportNo: str(seed.passportNo) } : {}),
    ...(phone ? { phone } : {}),
    ...(str(seed.email) ? { email: str(seed.email) } : {}),
    ...(str(seed.dob) ? { dob: str(seed.dob) } : {}),
    ...(str(seed.nationality) ? { nationality: str(seed.nationality) } : {}),
    ...(seed.residency ? { residency: seed.residency } : {}),
    ...(seed.employmentProfile ? { employmentProfile: seed.employmentProfile } : {}),
    ...(str(seed.companyName) ? { companyName: str(seed.companyName) } : {}),
    ...(str(seed.emirate) ? { emirate: str(seed.emirate) } : {}),
    ...(seed.monthlySalary ? { monthlySalary: seed.monthlySalary } : {}),
    ...(seed.variableIncome ? { variableIncome: seed.variableIncome } : {}),
    ...(seed.rentalIncome ? { rentalIncome: seed.rentalIncome } : {}),
    ...(seed.existingEmis ? { existingEmis: seed.existingEmis } : {}),
    ...(seed.creditCardLimits ? { creditCardLimits: seed.creditCardLimits } : {}),
  };
}

async function resolveClient(seed) {
  if (!seed.fullName) return { id: null, matched: null };
  let existing = null, matched = null;
  if (seed.eidNo) {
    const byEid = await db.client.findUnique({ where: { eidNo: seed.eidNo } });
    if (byEid) { existing = byEid; matched = "eid"; }
  }
  if (!existing && seed.phone.length >= 7) {
    const cands = await db.client.findMany({ where: { phone: seed.phone } });
    const hit = cands.find((c) => namesSimilar(c.fullName, seed.fullName));
    if (hit) { existing = hit; matched = "phone_name"; }
  }
  if (existing) {
    await db.client.update({ where: { id: existing.id }, data: mergeData(seed, false) });
    return { id: existing.id, matched };
  }
  const created = await db.client.create({ data: mergeData(seed, true) });
  return { id: created.id, matched: null };
}

(async () => {
  const cases = await db.loanCase.findMany();
  let linked = 0, created = 0, skipped = 0;
  for (const c of cases) {
    let prof = {};
    try { prof = JSON.parse(c.profileJson || "{}"); } catch { prof = {}; }
    const primary = seedFrom(prof.primary, { customer: c.customer, whatsapp: c.whatsapp, propertyLocation: c.propertyLocation });
    if (!primary.fullName) { skipped++; continue; }
    const before = await db.client.count();
    const { id: clientId, matched } = await resolveClient(primary);
    if (await db.client.count() > before) created++;
    const patch = {};
    if (clientId && c.clientId !== clientId) patch.clientId = clientId;
    if (prof.secondParty?.role !== "none" && prof.secondParty?.fullName?.trim()) {
      const sp = seedFrom(prof.secondParty, {});
      const { id: spId } = await resolveClient(sp);
      if (spId && c.secondPartyClientId !== spId) patch.secondPartyClientId = spId;
    } else if (c.secondPartyClientId) {
      patch.secondPartyClientId = null;
    }
    if (Object.keys(patch).length) {
      await db.loanCase.update({ where: { id: c.id }, data: patch });
      linked++;
    }
    console.log(`${c.caseNumber}: ${matched ?? "new client"}${Object.keys(patch).length ? " → linked" : ""}`);
  }
  console.log(`\nDone. cases=${cases.length} linked=${linked} clientsCreated=${created} skipped(no name)=${skipped}`);
  await db.$disconnect();
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
