// Phase 0 audit — READ-ONLY. Reports bank legs that were never beaten.
//
// WHY: a multi-bank mortgage is modelled as SIBLING LoanCase rows linked by
// parentCaseId (one case per bank, because each bank issues its own reference,
// has its own RM, its own document set and its own stage). But nothing in any
// write path ever closes a sibling: when the FOL wins at Mashreq, the Emirates
// leg stays caseStatus="Active", keeps accruing its own projected commission and
// stays in the pipeline and revenue forecast. That is phantom money.
//
// The business reality is that the legs are a COMPETITIVE SET with exactly one
// winner: many pre-approvals, one FOL, one loan taken. `caseStatus` cannot
// express that — "Lost" means "we lost this business", which is not what
// happened to the Emirates leg (we lost the RACE and booked Mashreq).
//
// This script only REPORTS. Safe to run any number of times; it cannot write.
// Phase 2 adds legStatus + sibling auto-close; this is the measurement that says
// how much existing data needs reconciling first.
//
//   node scripts/audit-bank-legs.mjs
//   node scripts/audit-bank-legs.mjs --json   # machine-readable summary

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const AS_JSON = process.argv.includes("--json");

const banksOf = (s) => {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.filter(Boolean) : [];
  } catch {
    return [];
  }
};

const label = (c) => banksOf(c.banks).join("+") || "(no bank)";

/** A leg is "live" when it still looks like work we might book. */
const isLive = (c) => c.caseStatus === "Active";
const isBooked = (c) => c.caseStatus === "Closed";

async function main() {
  const all = await prisma.loanCase.findMany({
    select: {
      id: true, caseNumber: true, banks: true, customer: true, parentCaseId: true,
      caseStatus: true, wonBank: true, loanAmount: true, stage: true, updatedAt: true,
    },
  });

  // Group into engagements: parentCaseId is the group's key. A null parent is
  // its own group — but a legacy row still listing several banks is a group of
  // one until scripts/split-multi-bank-cases.js has run.
  const groups = new Map();
  for (const c of all) {
    const key = c.parentCaseId ?? `solo:${c.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
const findings = {
    multiLeg: [],
    multipleWinners: [],
    multipleLive: [],
    wonBankConflict: [],
    unsplitLegacy: [],
  };

  for (const [, legs] of groups) {
    const sorted = [...legs].sort((a, b) => a.id - b.id);
    const parent = sorted[0];
    // Computed once per engagement: the live/booked split is what the whole
    // audit is about, and it is needed outside the multi-leg branch below.
    const live = sorted.filter(isLive);

    if (sorted.length > 1) {
      const booked = sorted.filter(isBooked);
      findings.multiLeg.push({
        caseNumber: parent.caseNumber,
        customer: parent.customer,
        legs: sorted.map(label),
        liveCount: live.length,
        bookedCount: booked.length,
        pipelineExposure: live.reduce((s, c) => s + (c.loanAmount || 0), 0),
        stageSpread: [...new Set(sorted.map((c) => c.stage))],
      });
    }

    // Impossible under "one FOL, one loan": two legs both booked.
    if (sorted.filter(isBooked).length > 1) {
      findings.multipleWinners.push({
        caseNumber: parent.caseNumber,
        customer: parent.customer,
        booked: sorted.filter(isBooked).map((c) => `${c.caseNumber} ${label(c)}`),
      });
    }

    // The main finding: legs that look like live pipeline on a deal that has
    // already been won elsewhere. Needs a human to say which leg actually won.
    if (sorted.length > 1 && live.length > 0) {
      const anyWonBank = sorted.some((c) => c.wonBank);
      const anyBooked = sorted.some(isBooked);
      if (anyWonBank || anyBooked) {
        findings.multipleLive.push({
          caseNumber: parent.caseNumber,
          customer: parent.customer,
          pipelineExposure: live.reduce((s, c) => s + (c.loanAmount || 0), 0),
          stillLive: live.map((c) => `${c.caseNumber} ${label(c)} @ ${c.stage}`),
          signals: sorted
            .filter((c) => c.wonBank || isBooked(c))
            .map((c) => `${c.caseNumber} ${label(c)} wonBank=${c.wonBank ?? "-"} status=${c.caseStatus}`),
        });
      }
    }

    // Siblings disagreeing about which bank won.
    const distinctWon = new Set(sorted.map((c) => c.wonBank).filter(Boolean));
    if (distinctWon.size > 1) {
      findings.wonBankConflict.push({
        caseNumber: parent.caseNumber,
        customer: parent.customer,
        claims: sorted.filter((c) => c.wonBank).map((c) => `${c.caseNumber} ${label(c)} → ${c.wonBank}`),
      });
    }
  }

  // Legacy rows still listing several banks: not yet per-bank legs.
  for (const c of all) {
    if (c.parentCaseId === null && banksOf(c.banks).length > 1) {
      findings.unsplitLegacy.push({ caseNumber: c.caseNumber, banks: label(c) });
    }
  }
const summary = {
    totalCases: all.length,
    engagements: groups.size,
    multiLegEngagements: findings.multiLeg.length,
    legsStillLiveOnAWonDeal: findings.multipleLive.length,
    pipelineExposureOnThose: findings.multipleLive.reduce((s, f) => s + f.pipelineExposure, 0),
    multipleBookedLegs: findings.multipleWinners.length,
    wonBankConflicts: findings.wonBankConflict.length,
    unsplitLegacyRows: findings.unsplitLegacy.length,
  };

  if (AS_JSON) {
    console.log(JSON.stringify({ summary, findings }, null, 2));
    return;
  }

  const line = "-".repeat(72);
  console.log("PHASE 0 AUDIT — bank legs that were never beaten (READ-ONLY)\n");
  console.log(line);
  console.log(`cases total                     : ${summary.totalCases}`);
  console.log(`engagements (parent groups)     : ${summary.engagements}`);
  console.log(`engagements with >1 bank leg    : ${summary.multiLegEngagements}`);
  console.log(`unsplit legacy rows (>1 bank)   : ${summary.unsplitLegacyRows}`);
  console.log(line);
  console.log("NEEDS HUMAN RECONCILIATION");
  console.log(`  legs still live on a won deal : ${summary.legsStillLiveOnAWonDeal}`);
  console.log(`  pipeline exposure (phantom)    : AED ${summary.pipelineExposureOnThose.toLocaleString()}`);
  console.log(`  engagements with >1 booked leg : ${summary.multipleBookedLegs}  (impossible)`);
  console.log(`  wonBank conflicts              : ${summary.wonBankConflicts}`);
  console.log(line);

  if (findings.multipleLive.length) {
    console.log("\nPHANTOM PIPELINE — live legs on an engagement that already has a winner:\n");
    for (const f of findings.multipleLive.slice(0, 40)) {
      console.log(`  ${f.caseNumber}  ${f.customer}   exposure AED ${f.pipelineExposure.toLocaleString()}`);
      for (const s of f.signals) console.log(`      winner signal: ${s}`);
      for (const s of f.stillLive) console.log(`      still live   : ${s}`);
      console.log("");
    }
    if (findings.multipleLive.length > 40) console.log(`  … and ${findings.multipleLive.length - 40} more\n`);
  }
if (findings.multipleWinners.length) {
    console.log("\nIMPOSSIBLE — more than one leg booked on one engagement:\n");
    for (const f of findings.multipleWinners) {
      console.log(`  ${f.caseNumber}  ${f.customer}`);
      for (const b of f.booked) console.log(`      booked: ${b}`);
    }
    console.log("");
  }

  if (findings.wonBankConflict.length) {
    console.log("\nWON-BANK CONFLICTS — siblings disagree on the winner:\n");
    for (const f of findings.wonBankConflict) {
      console.log(`  ${f.caseNumber}  ${f.customer}`);
      for (const c of f.claims) console.log(`      ${c}`);
    }
    console.log("");
  }

  if (findings.unsplitLegacy.length) {
    console.log("\nUNSPLIT LEGACY ROWS — still list several banks on one row:\n");
    for (const f of findings.unsplitLegacy) console.log(`  ${f.caseNumber}  ${f.banks}`);
    console.log("\n  run scripts/split-multi-bank-cases.js to normalise these first.\n");
  }

  console.log("READ-ONLY — nothing was written.\n");
}

main()
  .catch((e) => {
    console.error("ERROR", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());