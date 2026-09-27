"use client";

/* Live predicates for the stage drawer — derived from docs / updates / fields.
   Auto-detected (confirm manually before moving); no new tables. */
import { useMemo } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { journeyIndexOf } from "@/lib/workflow/registry";

export function useStageLive(c: LoanCase) {
  const { caseDocuments, caseUpdates, tasks, stageTransitions, slaRules } = useHfmcStore();
  return useMemo(() => {
    const docs = caseDocuments.filter((d) => d.caseId === c.id);
    const updates = caseUpdates
      .filter((u) => u.caseId === c.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const openTasks = tasks.filter((t) => t.caseId === c.id && t.status === "Open");
    const bankTasks = openTasks.filter((t) => t.waitingFor === "Bank");
    // oldest open task by exact due instant = the Next-Best-Action
    const oldestTask = [...openTasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
    const transitions = stageTransitions
      .filter((t) => t.caseId === c.id)
      .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
    const mandatory = docs.filter((d) => d.mandatory && d.status !== "Waived");
    const blocked = mandatory.filter((d) => d.status !== "Verified");
    const byCat = (cats: string[]) => docs.filter((d) => cats.includes(d.category));
    const verifiedIn = (cats: string[]) =>
      byCat(cats).filter((d) => d.status === "Verified" || d.status === "Waived").length;
    const valDoc = docs.find(
      (d) => d.title.toLowerCase().includes("valuation")
    );
    const notes = updates.map((u) => u.note.toLowerCase()).join("\n");
    const has = (re: RegExp) => re.test(notes);
    const jIdx = journeyIndexOf(c.stage);
    const kycBlocked = blocked.filter((d) => d.category === "KYC").length;
    const incomeBlocked = blocked.filter((d) => d.category === "Income").length;

    // field-backed (✓) vs note-sniffed heuristic (~) — the drawer marks ~ ticks
    // as "~detected" until batch-3 date fields land on LoanCase.
    const heuristic = new Set([
      "handedToValuation", "valInitiated", "inspected", "valReport",
      "folConversionSent", "folConversion", "clientCall", "folSigned",
      "liabilityLetter", "settlementMc", "settled", "transferEmail", "titleDeed",
    ]);

    const checks: Record<string, boolean> = {
      waGroup: !!c.waGroup,
      kycDocs: (verifiedIn(["KYC"]) >= 2 || byCat(["KYC"]).length > 0) && kycBlocked === 0,
      incomeDocs: incomeBlocked === 0 && byCat(["Income"]).length > 0,
      txnDocs: !!c.transactionType,
      readyToSubmit: blocked.length === 0 && docs.length > 0,
      noBlockedMandatory: blocked.length === 0 && mandatory.length > 0,
      profileComplete: !!c.profileJson && c.profileJson.length > 40,
      submitted: !!c.fileSubmittedDate,
      followedUp: updates.length > 0,
      preCaptured: !!c.preApprovalDate && c.preApprovalAmount != null,
      handedToValuation: jIdx > 1 || has(/valuation/),
      mouReady: !!c.transactionType,
      valInitiated: !!c.valuationInitiatedDate || has(/valuation|inspection/) || jIdx > 2,
      inspected: !!c.inspectionDate || has(/inspect/),
      valReport: !!c.valuationReportDate || valDoc?.status === "Verified" || has(/valuation (report|received|positive)/),
      folConversionSent: !!c.folConversionDate || has(/conversion/),
      folConversion: !!c.folConversionDate || has(/conversion/),
      folVerified: !!c.folDate,
      clientCall: has(/client call|explained fol|fol explained|signing date/),
      folSigned: !!c.folSignedDate || (has(/sign(ed|ing)/) && !!c.folDate),
      booked: (!!c.folSignedDate || !!c.folDate) && c.ddaActive,
      clearances: verifiedIn(["Transfer"]) > 0,
      liabilityLetter: !!c.liabilityLetterDate || has(/liability/),
      settlementMc: !!c.settlementDate || has(/(manager'?s cheque|\bmc\b|settlement)/),
      settled: !!c.settlementDate || has(/settl(ed|ement done|ement complete)/),
      expiryOk: !blocked.some(
        (d) => d.expiryDate && d.expiryDate < new Date().toISOString().slice(0, 10)
      ),
      transferEmail: !!c.transferDate || has(/transfer.*(email|sent|scheduled)|transfer date/),
      titleDeed: !!c.titleDeedDate || has(/title deed/),
    };
    return {
      docs, updates, openTasks, bankTasks, oldestTask, transitions,
      mandatory, blocked, heuristic,
      latest: updates[0] ?? null, checks, jIdx,
    };
  }, [caseDocuments, caseUpdates, tasks, stageTransitions, slaRules, c]);
}
