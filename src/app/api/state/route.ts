// GET /api/state — hydrate the frontend with everything the current user can see.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import {
  visibleCases, visibleTasks, bulletinVisible, computeEscalations,
} from "@/lib/domain";
import {
  serUser, serCase, serTask, serActivity, serBank, serPartner, serStage,
  serMaster, serSla, serInstruction, serBulletin, serChannel, serDocRule, serFeeRule,
  serStageTransitionDto, serCaseDocument, serCaseUpdate, serProposal, serBankProduct, serClient, serCommTemplate, serPromotion, serServiceLine, serLead, serCaseParty, serCaseWith,
} from "@/lib/ser";
import { caseStatusOf } from "@/lib/format";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const flags = await flagsFor(me);

  // ── Batch 1: core entities (people, cases, tasks, workflow) ──────────────
  const [users, designations, cases, tasks, stages, masters] = await Promise.all([
    db.user.findMany({ orderBy: { id: "asc" } }),
    db.designation.findMany({ orderBy: { id: "asc" } }),
    db.loanCase.findMany({ orderBy: { id: "asc" } }),
    db.task.findMany({ orderBy: { id: "asc" } }),
    // Phase 5: `include: { stageSet: … }` so every stage arrives knowing which
    // service line it belongs to. StageItem has no serviceLineId of its own —
    // the SET carries it — so without this the frontend cannot scope a journey
    // and would fall back to the mortgage stages for every case.
    db.stageItem.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        steps: { orderBy: { sortOrder: "asc" } },
        stageSet: { select: { id: true, serviceLineId: true, active: true, name: true } },
      },
    }),
    db.masterItem.findMany({ orderBy: { id: "asc" } }),
  ]);

  // ── Batch 2: reference data ───────────────────────────────────────────────
  const [banks, partners, channels, slaRules, docRules, feeRules] = await Promise.all([
    db.bankItem.findMany({ orderBy: { id: "asc" } }),
    db.partnerItem.findMany({ orderBy: { id: "asc" } }),
    db.channelItem.findMany({ orderBy: { id: "asc" } }),
    db.slaRule.findMany({ orderBy: { id: "asc" } }),
    db.docRule.findMany({ orderBy: { id: "asc" } }),
    db.feeRule.findMany({ orderBy: [{ emirate: "asc" }, { sortOrder: "asc" }] }),
  ]);

  // Service lines + products ride along in the main payload rather than a second
  // fetch: every screen needs them (pickers, filters, chips), and a second round
  // trip would let the case list render against a catalogue that hasn't arrived.
  const serviceLinesRaw = await db.serviceLine.findMany({
    orderBy: { sortOrder: "asc" },
    include: { products: { orderBy: { sortOrder: "asc" } } },
  });

  // ── Batch 3: activity & comms ─────────────────────────────────────────────
  const [activities, instructions, bulletinsRaw, commTemplates, eiborRates] = await Promise.all([
    db.activity.findMany({ orderBy: { at: "desc" }, take: 200 }),
    db.instruction.findMany({ orderBy: { id: "asc" }, include: { replies: true } }),
    db.bulletinItem.findMany({ orderBy: { id: "asc" }, include: { targets: true, replies: true } }),
    db.commTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    db.eiborRate.findMany(),
  ]);

  // ── Batch 4: case-level data ──────────────────────────────────────────────
  const [stageTransitions, allDocs, caseUpdates, caseProposals] = await Promise.all([
    db.stageTransition.findMany({ orderBy: { at: "desc" }, take: 400, include: { user: { select: { name: true } } } }),
    db.caseDocument.findMany({ orderBy: [{ caseId: "asc" }, { sortOrder: "asc" }] }),
    db.caseUpdate.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1000, include: { author: { select: { name: true } } } }),
    db.proposal.findMany({ orderBy: { version: "desc" }, include: { author: { select: { name: true } } } }),
  ]);

  // ── Batch 5: extras (tolerate missing tables) ─────────────────────────────
  const [bankProducts, emails, unmatched, clients, promotions] = await Promise.all([
    db.bankProduct.findMany({ orderBy: [{ bankId: "asc" }, { id: "asc" }], include: { bank: { select: { name: true } } } }),
    db.emailLog.findMany({ orderBy: { receivedAt: "desc" }, take: 100 }).catch(() => []),
    db.unmatchedEmail.findMany({ where: { status: "Pending" }, orderBy: { receivedAt: "desc" } }).catch(() => []),
    db.client.findMany({ orderBy: { id: "asc" } }),
    db.promotion.findMany({ orderBy: [{ validFrom: "desc" }, { id: "asc" }] }).catch(() => []),
  ]);

  // ── Leads (Phase 4) ────────────────────────────────────────────────────────
  // The funnel's own entity. `serviceLine`, `product` and `owner` are included
  // rather than joined client-side: the Leads list renders all three on every
  // card, and a second round trip would let the list paint against missing
  // names. `possibleDuplicateOf` is resolved here rather than in the browser —
  // it needs every client's phone, which non-admin users are not entitled to.
  const leadsRaw = await db.lead.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      serviceLine: { select: { id: true, code: true, name: true } },
      product: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
  });

  // Duplicate hint (Phase 4): the same person can arrive three ways — website,
  // walk-in, agent entry — and only the last one would win a merge. Surfaced on
  // the card as a HINT only; the merge itself stays a human decision.
  const clientByPhone = new Map<string, { id: number; name: string }>();
  for (const c of clients) {
    const digits = (c.phone || "").replace(/\D/g, "");
    if (digits.length >= 7 && !clientByPhone.has(digits)) {
      clientByPhone.set(digits, { id: c.id, name: c.fullName });
    }
  }


  const leadsDto = leadsRaw.map((l) => {
    const digits = (l.phone || "").replace(/\D/g, "");
    const dup = digits.length >= 7 ? clientByPhone.get(digits) ?? null : null;
    return serLead(l, {
      serviceLineName: l.serviceLine.name,
      serviceLineCode: l.serviceLine.code,
      productName: l.product?.name ?? null,
      ownerName: l.owner?.name ?? null,
      // Suppress the hint once it has been acted on, so a converted lead's card
      // doesn't keep shouting about the client it deliberately became.
      possibleDuplicateOf: l.status === "Converted" || l.clientId ? null : dup,
    });
  });

  // ── Case parties (Phase A) ──────────────────────────────────────────────────
  // Everyone on every case, with their role, typed through the model rather than
  // raw SQL. `legacySlot` marks the party that is ALSO held by
  // LoanCase.secondPartyClientId: Phase B keeps the two in step, and until it has
  // run on a given case the flag tells the UI which rows are still mirrored by the
  // old column so they are not double-counted.
  const partyRows = await db.caseParty.findMany({
    orderBy: [{ caseId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, caseId: true, clientId: true, role: true, sortOrder: true, createdAt: true },
  });
  const legacySlotByCase = new Map(
    cases.map((c) => [c.id, c.secondPartyClientId ?? 0]),
  );

  const clientNameById = new Map(clients.map((c) => [c.id, c.fullName]));
  const casePartiesDto = partyRows.map((p) =>
    serCaseParty(p, {
      clientName: clientNameById.get(p.clientId) ?? "",
      legacySlot: legacySlotByCase.get(p.caseId) === p.clientId,
    }),
  );

  const usersDto = users.map(serUser);
  // Phase B: coApplicantName is derived from the linked party rather than typed.
  // The column stays the fallback for anyone entered as free text before parties
  // existed, so nothing regresses — but a guarantor who IS on file now shows their
  // real name, and their profile is one click away.
  const firstPartyNameByCase = new Map<number, string>();
  {
    const ranked = [...partyRows].sort(
      (a, b) => a.caseId - b.caseId || a.sortOrder - b.sortOrder || a.id - b.id,
    );
    for (const p of ranked) {
      if (firstPartyNameByCase.has(p.caseId)) continue;
      firstPartyNameByCase.set(p.caseId, clientNameById.get(p.clientId) ?? "");
    }
  }
  const casesDto = cases.map((c) =>
    serCaseWith(c, { coApplicantName: firstPartyNameByCase.get(c.id) || undefined }),
  );
  const tasksDto = tasks.map(serTask);
  const meFull = usersDto.find((u) => u.id === me.id)!;

  const visible = visibleCases(casesDto, usersDto, meFull, flags);
  const visibleTasksList = visibleTasks(tasksDto, casesDto, usersDto, meFull, flags);
  const escalations = computeEscalations(visible, slaRules);

  // Revenue is restricted: without the designation's viewRevenue permission the
  // commission ingredients (bank rates, channel cuts, partner shares) are zeroed
  // server-side, so no client can compute earnings from the state it receives.
  const banksDto = flags.viewRevenue
    ? banks.map(serBank)
    : banks.map((b) => ({ ...serBank(b), ratePct: 0 }));
  const channelsDto = flags.viewRevenue
    ? channels.map(serChannel)
    : channels.map((ch) => ({ ...serChannel(ch), commissionPct: 0 }));
  const visibleIds = new Set(visible.map((c) => c.id));
  const vaultDocs = allDocs.filter((d) => visibleIds.has(d.caseId)).map(serCaseDocument);
  const scopedCases = flags.viewRevenue
    ? casesDto
    : casesDto.map((c) => (c.partner ? { ...c, partner: { ...c.partner, sharePct: 0 } } : c));

  const bulletinsDto = bulletinsRaw
    .map(serBulletin)
    .filter((b) => bulletinVisible(b, meFull, usersDto, flags));

  return NextResponse.json({
    me,
    flags,
    users: usersDto,
    designations,
    cases: scopedCases,
    visibleCaseIds: visible.map((c) => c.id),
    tasks: tasksDto,
    visibleTaskIds: visibleTasksList.map((t) => t.id),
    activities: activities.map(serActivity),
    // Phase 5: flatten the included stageSet so each StageItem carries its own
  // serviceLineId. The frontend never needs the set itself, only the line.
  stages: stages.map((s) => serStage({
    ...s,
    stageSetId: s.stageSetId ?? s.stageSet?.id ?? null,
    serviceLineId: s.stageSet?.serviceLineId ?? null,
  })),
    whyPending: masters.filter((m) => m.kind === "whyPending").map(serMaster),
    waitingFor: masters.filter((m) => m.kind === "waitingFor").map(serMaster),
    milestoneDates: masters.filter((m) => m.kind === "milestoneDate").map(serMaster),
    banks: banksDto,
    serviceLines: serviceLinesRaw.map((l) => serServiceLine(l, l.products)),
    // Revenue masking applies to leads too: an intended amount is a pipeline
    // figure, and the same roles that can't see a case's loan amount must not be
    // able to total the funnel either.
    leads: flags.viewRevenue
      ? leadsDto
      : leadsDto.map((l) => ({ ...l, intendedAmount: null })),
    channels: channelsDto,
    partners: partners.map(serPartner),
    slaRules: slaRules.map(serSla),
    instructions: instructions.map(serInstruction),
    bulletin: bulletinsDto,
    escalations: escalations.length,
    docRules: docRules.map(serDocRule),
    bankProducts: bankProducts.map(serBankProduct),
    eibor: eiborRates,
    caseUpdates: caseUpdates.map(serCaseUpdate),
    caseProposals: caseProposals.map(serProposal),
    feeRules: feeRules.map(serFeeRule),
    stageTransitions: stageTransitions.map(serStageTransitionDto),
    caseDocuments: vaultDocs,
    clients: clients.map(serClient),
    // Phase A: scoped by VISIBLE case ids, exactly like vaultDocs above. A user
    // who cannot see a case must not learn that it has a guarantor — that is the
    // whole point of case-level visibility. Filtering here rather than in the
    // browser means an unauthorised party never reaches the client at all.
    caseParties: casePartiesDto.filter((p) => visibleIds.has(p.caseId)),
    commTemplates: commTemplates.map(serCommTemplate),
    promotions: promotions.map(serPromotion),
  });
}
