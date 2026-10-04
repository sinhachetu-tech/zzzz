// PATCH /api/cases/:id — update a case (stage, status, wonBank, owner, partner, banks, etc.)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serCase } from "@/lib/ser";
import { syncCaseVault } from "@/lib/vault";
import { syncCaseClients } from "@/lib/client-master";
import { LEG_STATUSES, type LegStatus } from "@/lib/types";

/** Parse the `banks` JSON array defensively (legacy rows can hold anything). */
function banksOf(raw: string | null | undefined): string[] {
  try {
    const a = JSON.parse(raw ?? "[]");
    return Array.isArray(a) ? a.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

/**
 * How to name the winner in a "lost the race" note. Prefers the bank we were
 * told won (body.wonBank), else the winning leg's own bank. Never returns an
 * empty string — the sentence has to read sensibly in the activity log.
 */
function winnerName(legBanksRaw: string | null | undefined, wonBank?: unknown): string {
  const explicit = typeof wonBank === "string" ? wonBank.trim() : "";
  if (explicit) return explicit;
  return banksOf(legBanksRaw)[0] ?? "another bank";
}

// DELETE /api/cases/:id — remove an accidentally-created lead/case.
// Deliberately restricted: admin/super only, because it cascades to tasks,
// documents, proposals and the whole audit trail.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const caseId = parseInt(id, 10);
  const existing = await db.loanCase.findUnique({ where: { id: caseId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.loanCase.delete({ where: { id: caseId } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const caseId = parseInt(id, 10);
  const body = await req.json();

  const existing = await db.loanCase.findUnique({ where: { id: caseId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  const actions: string[] = [];

  if (body.stage && body.stage !== existing.stage) {
    data.stage = body.stage;
    actions.push(`stage → ${body.stage}`);
    // Conversion stamp — written ONLY on the transition out of "Lead", and only
    // if it was never stamped before. A case dragged back to Lead and forward
    // again keeps its ORIGINAL conversion date, because the question this
    // answers is "how long has this been a live file", not "when was the stage
    // last touched". A manually-created case (never a Lead) stays null, which
    // is what makes the "From lead" saved view honest.
    if (existing.stage === "Lead" && !existing.convertedAt) {
      data.convertedAt = new Date();
      data.convertedById = me.id;
      actions.push("converted from lead");
    }
  }
  if (body.caseStatus && body.caseStatus !== existing.caseStatus) {
    data.caseStatus = body.caseStatus;
    if (body.caseStatus === "Closed" || body.caseStatus === "Lost") {
      data.closedDate = new Date().toISOString().slice(0, 10);
    }
    actions.push(`status → ${body.caseStatus}`);
  }
  if (body.wonBank !== undefined && body.wonBank !== existing.wonBank) {
    data.wonBank = body.wonBank;
    actions.push(body.wonBank ? `won by ${body.wonBank}` : "cleared winning bank");
  }

  // --- BANK LEG OUTCOME (Phase 2) -------------------------------------------
  // A multi-bank mortgage is a RACE with exactly one winner, so the outcome of
  // one leg determines every other leg. That invariant is enforced HERE, in the
  // write path, rather than left to staff discipline — otherwise a beaten leg
  // stays Active, keeps accruing commission and sits in the pipeline forever.
  let legClosed = 0;
  if (body.legStatus !== undefined && body.legStatus !== existing.legStatus) {
    const next = String(body.legStatus);
    if (!LEG_STATUSES.includes(next as LegStatus)) {
      return NextResponse.json({ error: `legStatus: invalid value "${next}"` }, { status: 400 });
    }
    data.legStatus = next;
    data.decidedAt = new Date();
    data.decidedById = me.id;
    actions.push(`leg → ${next}`);

    // Who else is in this race? The legacy shape has the parent row doubling as
    // the first bank's leg, so a leg's siblings are "rows pointing at my
    // parentCaseId" plus — when I AM the parent — every row pointing at me.
    const parentId = existing.parentCaseId;
    const contenders = parentId == null
      ? (await db.loanCase.findMany({ where: { parentCaseId: caseId }, select: { id: true, caseNumber: true, banks: true, legStatus: true } }))
      : (await db.loanCase.findMany({ where: { parentCaseId: parentId }, select: { id: true, caseNumber: true, banks: true, legStatus: true } }));

    if (next === "Won") {
      const winner = winnerName(existing.banks, body.wonBank);
      // Refuse a second winner on the same engagement — "one FOL, one loan" is
      // the whole premise, and two winners is the data error Phase 0 audits for.
      const alreadyWon = contenders.find((c) => c.legStatus === "Won");
      if (alreadyWon) {
        return NextResponse.json(
          { error: `${alreadyWon.caseNumber} is already recorded as the winning leg. Only one bank can win this engagement.` },
          { status: 400 },
        );
      }
      // Close every still-running sibling. Declined/Withdrawn legs are left as
      // they are: they carry a real signal that must not be overwritten.
      const beaten = contenders.filter((c) => c.legStatus === "Active");
      for (const s of beaten) {
        await db.loanCase.update({
          where: { id: s.id },
          data: {
            legStatus: "LostRace",
            decidedAt: new Date(),
            decidedById: me.id,
            lostReason: `Lost race — won at ${winner}`,
          },
        });
        await db.activity.create({
          data: { caseId: s.id, userId: me.id, action: `lost the race — won at ${winner}` },
        });
        legClosed++;
      }
      if (beaten.length) {
        actions.push(`closed ${beaten.length} losing leg${beaten.length > 1 ? "s" : ""}`);
      }
    }
  }
  if (body.ownerId !== undefined && body.ownerId !== existing.ownerId) {
    data.ownerId = body.ownerId;
    const u = await db.user.findUnique({ where: { id: body.ownerId } });
    actions.push(`owner → ${u?.name ?? body.ownerId}`);
  }
  // Declared up here because the BANKS block below also sets it — `banks` is a
  // document-rule axis now, so changing it re-syncs the vault too.
  let profileChanged = false;

  if (body.banks !== undefined) {
    // ONE BANK PER CASE — enforced, not merely conventional.
    //
    // A multi-bank deal is modelled as SIBLING cases (see POST /api/cases and
    // /api/cases/:id/add-bank), because each bank has its own case number, its
    // own document rules and its own stage. Writing several banks onto one row
    // recreates exactly the shape that model exists to prevent, and it silently
    // breaks the per-bank document axis: DocRule.applicableBank is evaluated
    // against this array, so "Mashreq or Emirates" can never be resolved to a
    // single bank's checklist.
    //
    // This guard is what stopped the 9 legacy seeded rows from growing. They
    // predate it and are untouched — it only rejects NEW writes, so
    // scripts/split-multi-bank-cases.js is unaffected.
    const incoming = body.banks;
    if (Array.isArray(incoming) && incoming.length > 1) {
      return NextResponse.json(
        {
          error:
            "A case holds one bank. Adding another opens a separate case for it — use “Add bank” (POST /api/cases/:id/add-bank) so the new bank gets its own case number, documents and stage.",
        },
        { status: 400 },
      );
    }
    // The bank is now a document-rule axis, so a re-shop can legitimately pull
    // in new required documents. Additive sync only — it never deletes, so a
    // document already collected for the previous bank is never destroyed.
    const before = (() => { try { return JSON.parse(existing.banks) as string[]; } catch { return []; } })();
    const after = Array.isArray(incoming) ? (incoming as string[]) : [];
    const same = before.length === after.length && before.every((b) => after.includes(b));
    if (!same) {
      data.banks = JSON.stringify(after);
      const fmt = (l: string[]) => (l.length ? l.join(", ") : "none");
      actions.push(`banks: ${fmt(before)} → ${fmt(after)}`);
      profileChanged = true;
    }
  }
  // The bank's own case / application number — distinct from our HFMC-xxxx, and
  // the number the bank quotes back to us on every follow-up.
  if (body.bankRef !== undefined) {
    const next = (body.bankRef === null ? "" : String(body.bankRef)).trim();
    const prev = (existing.bankRef ?? "").trim();
    if (next !== prev) {
      data.bankRef = next || null;
      actions.push(next ? `bank ref → ${next}` : "cleared bank ref");
    }
  }
  if (body.source !== undefined) data.source = body.source;
  if (body.partner !== undefined) {
    data.partnerKind = body.partner?.kind ?? null;
    data.partnerName = body.partner?.name ?? null;
    data.partnerSharePct = body.partner?.sharePct ?? null;
  }
  if (body.statusNote !== undefined) data.statusNote = body.statusNote;
  // Document Vault profile vectors — changing any of them re-syncs the checklist
  if (body.employmentProfile !== undefined && body.employmentProfile !== existing.employmentProfile) {
    data.employmentProfile = body.employmentProfile;
    profileChanged = true;
  }
  if (body.propertyType !== undefined && body.propertyType !== existing.propertyType) {
    data.propertyType = body.propertyType;
    profileChanged = true;
  }
  // --- FINAL PROPERTY CLASSIFICATION (canonical dims — validated, additive) ---
  // Validation rules enforced server-side:
  //  - commercialSubtype must be NULL unless propertyTypeCanonical = COMMERCIAL
  //  - unknown/guessed values are rejected: only the documented enums pass
  const VALID = {
    propertyTypeCanonical: ["RESIDENTIAL", "COMMERCIAL", "UNKNOWN"],
    commercialSubtype: ["OFFICE", "RETAIL_SHOP", "WAREHOUSE", "INDUSTRIAL", "HOTEL_HOSPITALITY", "MIXED_USE", "LAND_PLOT", "OTHER_COMMERCIAL", "UNKNOWN"],
    propertyStage: ["OFF_PLAN", "HANDOVER", "COMPLETED", "UNKNOWN"],
    constructionStatus: ["NOT_STARTED", "UNDER_CONSTRUCTION", "COMPLETED", "UNKNOWN"],
    partyRelationship: ["DEVELOPER", "EXISTING_OWNER", "SELF", "UNKNOWN"],
    existingFinance: ["NONE", "MORTGAGE", "UNKNOWN"],
    transactionPurpose: ["PURCHASE", "REFINANCE", "EQUITY_RELEASE", "REFINANCE_AND_EQUITY", "UNKNOWN"],
  } as const;
  for (const [field, allowed] of Object.entries(VALID)) {
    if (body[field] === undefined) continue;
    const v = body[field];
    if (v !== null && v !== "" && !(allowed as readonly string[]).includes(String(v))) {
      return NextResponse.json({ error: `${field}: invalid value "${v}"` }, { status: 400 });
    }
    data[field] = v === "" ? (field === "commercialSubtype" ? null : "UNKNOWN") : v;
  }
  if (data.propertyTypeCanonical !== undefined && data.propertyTypeCanonical !== "COMMERCIAL") {
    data.commercialSubtype = null; // subtype NULL iff not COMMERCIAL — never guessed
  } else if (data.propertyTypeCanonical === "COMMERCIAL" && data.commercialSubtype === undefined && existing.commercialSubtype) {
    // subtype left untouched on a COMMERCIAL update
  } else if (data.propertyTypeCanonical === "COMMERCIAL" && data.commercialSubtype === undefined) {
    data.commercialSubtype = "UNKNOWN"; // commercial but subtype not yet known — TO_VERIFY, not invented
  }
  if (data.commercialSubtype !== undefined && data.commercialSubtype !== null && data.commercialSubtype !== "UNKNOWN"
      && (data.propertyTypeCanonical ?? (existing as unknown as { propertyTypeCanonical?: string }).propertyTypeCanonical) !== "COMMERCIAL") {
    data.commercialSubtype = null; // guard: subtype only sticks when the property IS commercial
  }
  if (body.residency !== undefined && body.residency !== existing.residency) {
    data.residency = body.residency;
    profileChanged = true;
  }
  if (body.transactionType !== undefined && body.transactionType !== existing.transactionType) {
    data.transactionType = body.transactionType;
    profileChanged = true;
  }
  if (body.bankRm !== undefined) data.bankRm = body.bankRm;
  if (body.propertyLocation !== undefined) data.propertyLocation = body.propertyLocation;
  if (body.coApplicantName !== undefined) data.coApplicantName = body.coApplicantName;
  if (body.onHold !== undefined) data.onHold = !!body.onHold;
  if (body.holdReason !== undefined) data.holdReason = body.holdReason;
  if (body.holdUntil !== undefined) data.holdUntil = body.holdUntil;
  if (body.lostReason !== undefined) data.lostReason = body.lostReason;
  if (body.advisorId !== undefined) data.advisorId = body.advisorId ? Number(body.advisorId) : null;
  if (body.backup1Id !== undefined) data.backup1Id = body.backup1Id ? Number(body.backup1Id) : null;
  if (body.backup2Id !== undefined) data.backup2Id = body.backup2Id ? Number(body.backup2Id) : null;
  if (body.notificationOverrides !== undefined) {
    data.notificationOverrides = body.notificationOverrides ? JSON.stringify(body.notificationOverrides) : null;
  }
  if (body.fileSubmittedDate !== undefined) data.fileSubmittedDate = body.fileSubmittedDate;
  if (body.preApprovalDate !== undefined) data.preApprovalDate = body.preApprovalDate;
  if (body.preApprovalAmount !== undefined) data.preApprovalAmount = body.preApprovalAmount;
  if (body.preApprovalTenure !== undefined) data.preApprovalTenure = body.preApprovalTenure;
  if (body.preApprovalRoi !== undefined) data.preApprovalRoi = body.preApprovalRoi;
  if (body.folDate !== undefined) data.folDate = body.folDate;
  if (body.folAmount !== undefined) data.folAmount = body.folAmount;
  if (body.folTenure !== undefined) data.folTenure = body.folTenure;
  if (body.folRoi !== undefined) data.folRoi = body.folRoi;
  // stage timeline (Case 360 drawer). RULE: signing can never precede conversion.
  const STAGE_DATES = [
    "valuationInitiatedDate", "inspectionDate", "valuationReportDate",
    "folConversionDate", "folSignedDate",
    "liabilityLetterDate", "settlementDate", "transferDate", "titleDeedDate",
  ] as const;
  for (const f of STAGE_DATES) {
    if (body[f] === undefined) continue;
    if (f === "folSignedDate" && body[f]) {
      // RULE 4.1 → 4.4: signing can never be recorded before the FOL conversion.
      // Cast keeps this compiling while the Prisma client catches up after
      // `prisma generate` (schema.prisma already carries the column).
      const ex = existing as unknown as { folConversionDate?: string | null };
      const conv = body.folConversionDate !== undefined ? body.folConversionDate : ex.folConversionDate;
      if (!conv) {
        return NextResponse.json(
          { error: "FOL conversion must be recorded before signing (4.1 → 4.4)." },
          { status: 400 }
        );
      }
    }
    data[f] = body[f] === "" ? null : body[f];
  }
  if (body.ddaActive !== undefined) data.ddaActive = !!body.ddaActive;
  if (body.whatsapp !== undefined) data.whatsapp = body.whatsapp;
  if (body.waGroup !== undefined) data.waGroup = body.waGroup;
  if (body.customer !== undefined) data.customer = body.customer;
  if (body.loanAmount !== undefined) data.loanAmount = body.loanAmount;
  // REAL property value. Explicitly settable so the LTV data gap can be closed
  // once someone captures it — the engine no longer fabricates it.
  if (body.propertyValue !== undefined) {
    data.propertyValue = body.propertyValue === null || body.propertyValue === "" ? null : Number(body.propertyValue);
  }
  // structured profile (income, liabilities, KYC ids, second party) — persisted
  // verbatim; each case keeps its own snapshot of the applicant as filed
  if (body.profileJson !== undefined) data.profileJson = body.profileJson;

  // Flexible stage data (dynamic custom milestone dates & fields defined by admin)
  let stageDataChanged = false;
  let stageDataMap: Record<string, unknown> = {};
  try {
    const raw = (existing as unknown as { stageDataJson?: string | null }).stageDataJson;
    stageDataMap = raw ? JSON.parse(raw) : {};
  } catch {}

  if (body.stageDataJson !== undefined) {
    try {
      const incoming = typeof body.stageDataJson === "string" ? JSON.parse(body.stageDataJson) : body.stageDataJson;
      stageDataMap = { ...stageDataMap, ...incoming };
      stageDataChanged = true;
    } catch {}
  }

  // Auto-absorb any custom date fields sent directly by name (e.g. developerNocDate)
  for (const [k, v] of Object.entries(body)) {
    if (
      k.endsWith("Date") &&
      (data as Record<string, unknown>)[k] === undefined &&
      k !== "preApprovalDate" &&
      k !== "fileSubmittedDate" &&
      k !== "folDate"
    ) {
      stageDataMap[k] = v === "" ? null : v;
      stageDataChanged = true;
    }
  }

  if (stageDataChanged) {
    (data as Record<string, unknown>).stageDataJson = JSON.stringify(stageDataMap);
  }

  const updated = await db.loanCase.update({ where: { id: caseId }, data });

  // profile vectors moved → pull in newly-applicable document requirements
  if (profileChanged) await syncCaseVault(caseId);

  // identity/profile data changed → refresh the Client master links
  let fresh = updated;
  if (body.profileJson !== undefined || body.whatsapp !== undefined || body.customer !== undefined || body.coApplicantName !== undefined) {
    try {
      await syncCaseClients(caseId);
      fresh = (await db.loanCase.findUnique({ where: { id: caseId } })) ?? updated;
    } catch (e) {
      console.error("client sync failed:", e);
    }
  }

  if (data.stage) {
    await db.stageTransition.create({
      data: {
        caseId,
        fromStage: existing.stage,
        toStage: String(data.stage),
        comment: typeof body.stageComment === 'string' ? body.stageComment : '',
        userId: me.id,
      },
    });
  }

  for (const a of actions) {
    await db.activity.create({
      data: { caseId, userId: me.id, action: a },
    });
  }

  return NextResponse.json({
    case: serCase(fresh!),
    // Set when marking a leg Won closed sibling legs in the same request. The
    // client store re-hydrates on any mutation, so this is informational — but
    // it lets the toast say "closed 2 losing legs" instead of silently changing
    // numbers the user is looking at.
    legClosed,
  });
}
