"use client";

/* CollectPanel — "what do I still need to get?" on the Case 360 overview.
 *
 * THE ONE RULE: this component stores NOTHING. It is a projection of the same
 * CaseDocument rows the Doc Vault renders, so a tick here and an upload there can
 * never disagree. A second stored checklist was the obvious design and the wrong
 * one — this codebase has already been bitten by a two-sources-of-truth bug (the
 * notification-settings envelope, where a wrapper mismatch silently broke every
 * toggle). Two things make drift structurally impossible:
 *
 *   1. OUTSTANDING = the document has no file attached (and isn't Waived).
 *      Derived, never stored, so it cannot be stale or wrong.
 *   2. The "tick" IS the upload — the same saveDoc/uploadDoc the vault uses, so
 *      there is no separate completion flag to fall out of sync.
 *
 * WHY IT IS NOT SIMPLY THE DOC VAULT: the vault is the management surface
 * (versions, compress, merge-to-PDF, bulk ZIP, verify/reject) and it lives one
 * tab away. This is the PROMPT — you should not have to switch tabs to discover
 * you are missing three documents. Detail stays in the vault; the nudge comes
 * forward.
 *
 * ANTI-OVERWHELM decisions, in order of impact:
 *   · a COUNT first ("6 still needed"), a list second — never a wall of rows
 *   · only OUTSTANDING items are listed; collected ones collapse to "12 done"
 *   · mandatory and optional are separated — optional really is "if applicable"
 *   · the rule's verifyNotes prints under the title, so a bare list becomes
 *     actual guidance ("must NOT be signed — RM signs at submission")
 *   · bank-scoped rules are tagged, which explains both why the item is here and
 *     why the sibling bank leg does not have it
 *   · past document collection it collapses to a few lines, because a checklist
 *     at Transfer stage is noise
 */

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { CaseDocument, LoanCase } from "@/lib/types";
import { Chip } from "@/components/hfmc/ui";
import { isDocOutstanding } from "@/components/views/doc-vault";
import { ICheck, IArrowR } from "@/components/icons";

type Row = CaseDocument & {
  verifyNotes: string;
  bankScoped: string[]; // banks this rule is limited to ([] = every bank)
  siblingHas: string | null; // case number of a leg that already holds this file
};

/** Document collection is the only stage where "what to collect" is the question
 *  being asked. Past it, the panel shrinks to a summary. */
const COLLECTION_STAGES = ["Document Collection", "Pre-Approval", "Valuation", "FOL + Loan Booking", "Transfer"];

export function CollectPanel({ c, onOpenVault }: { c: LoanCase; onOpenVault: () => void }) {
  const { caseDocuments, docRules, cases } = useHfmcStore();
  const [showDone, setShowDone] = useState(false);

  const { rows, outstanding, done } = useMemo(() => {
    const docs = caseDocuments.filter((d) => d.caseId === c.id);
    const ruleById = new Map(docRules.map((r) => [r.id, r]));

    // Sibling legs of the same deal — the source of "you already have this".
    const rootId = c.parentCaseId ?? c.id;
    const siblingCases = cases.filter((k) => k.id === rootId || k.parentCaseId === rootId);

    const built: Row[] = docs.map((d) => {
      const rule = d.templateId != null ? ruleById.get(d.templateId) : undefined;
      const scope = rule?.applicableBank ?? [];
      const bankScoped = scope.filter((s) => s !== "any" && s !== "all");

      let siblingHas: string | null = null;
      if (!d.hasFile && d.templateId != null) {
        for (const leg of siblingCases) {
          if (leg.id === c.id || leg.caseStatus !== "Active") continue;
          const hit = caseDocuments.find(
            (x) => x.caseId === leg.id && x.templateId === d.templateId && x.hasFile,
          );
          if (hit) { siblingHas = leg.caseNumber; break; }
        }
      }

      return { ...d, verifyNotes: rule?.verifyNotes ?? d.notes ?? "", bankScoped, siblingHas };
    });

    return {
      rows: built,
      outstanding: built.filter((d) => isDocOutstanding(d.status, d.hasFile)),
      done: built.filter((d) => !isDocOutstanding(d.status, d.hasFile)),
    };
  }, [caseDocuments, docRules, cases, c.id, c.parentCaseId, c.caseStatus]);

  const pastCollection = COLLECTION_STAGES.findIndex((s) => s === c.stage) > 0;
  if (rows.length === 0) {
    return (
      <div className="card p-4 anim-fade-up">
        <div className="flex items-center gap-2">
          <span className="font-disp font-semibold text-[13px]">What to collect</span>
          <Chip tone="slate">no rules matched</Chip>
        </div>
        <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-1.5">
          No document rules apply to this borrower yet. Add one ad-hoc in the Vault, or check the case profile
          (employment / property / residency) — rules are matched against those.
        </p>
      </div>
    );
  }

  const pct = rows.length ? Math.round((done.length / rows.length) * 100) : 0;
  // Mandatory first: the top of the list is always what blocks the case.
  const ordered = [...outstanding].sort((a, b) =>
    a.mandatory !== b.mandatory ? (a.mandatory ? -1 : 1) : a.title.localeCompare(b.title),
  );
  const shown = pastCollection ? ordered.slice(0, 3) : ordered;

  return (
    <div className="card p-4 anim-fade-up">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-disp font-semibold text-[13px]">What to collect</span>
        {outstanding.length === 0
          ? <Chip tone="mint">all {rows.length} collected ✓</Chip>
          : <Chip tone={pastCollection ? "slate" : "amber"}>{outstanding.length} still needed</Chip>}
        {done.length > 0 && <span className="text-[11px] text-[var(--ink-faint)]">{done.length} done</span>}
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onOpenVault} title="Open the full Document Vault">
          Open vault <IArrowR size={12} />
        </button>
      </div>

      {/* Count first, list second. */}
      <div className="flex items-center gap-2 mb-2.5">
        <div className="h-1.5 flex-1 rounded-full" style={{ background: "var(--line-soft)" }}>
          <div
            className="h-1.5 rounded-full transition-all"
            style={{ width: `${pct}%`, background: outstanding.length ? "var(--amber)" : "var(--mint)" }}
          />
        </div>
        <span className="mono text-[11px]" style={{ color: outstanding.length ? "var(--amber)" : "var(--mint)" }}>
          {done.length}/{rows.length}
        </span>
      </div>

      {outstanding.length === 0 ? (
        <p className="text-[11.5px] m-0" style={{ color: "var(--mint)" }}>
          Every required document for this case has a file attached.
        </p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((d) => (
            <div key={d.id} className="flex items-start gap-2">
              <span
                className="mt-1 w-3.5 h-3.5 rounded-full border shrink-0"
                style={{ borderColor: d.mandatory ? "var(--coral)" : "var(--line)" }}
                title={d.mandatory ? "Mandatory — blocks progression" : "Optional / if applicable"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] font-medium">{d.title}</span>
                  {d.mandatory ? <Chip tone="coral">required</Chip> : <Chip tone="slate">optional</Chip>}
                  {d.bankScoped.length > 0 && <Chip tone="sky">{d.bankScoped.join(" / ")} only</Chip>}
                </div>
                {/* The rule's own guidance — this is what turns a list into
                    instructions, and it is where "must NOT be signed" lives. */}
                {d.verifyNotes && (
                  <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5 leading-snug">{d.verifyNotes}</p>
                )}
                {d.siblingHas && (
                  <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--mint)" }}>
                    Already collected on {d.siblingHas} — the client does not need to send it again.
                  </p>
                )}
                {d.status === "Rejected" && d.rejectionReason && (
                  <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--coral)" }}>
                    Rejected: {d.rejectionReason}
                  </p>
                )}
              </div>
            </div>
          ))}
          {pastCollection && outstanding.length > shown.length && (
            <button className="btn btn-ghost btn-sm mt-1" onClick={onOpenVault}>
              +{outstanding.length - shown.length} more in the vault
            </button>
          )}
        </div>
      )}

      {done.length > 0 && (
        <button
          className="text-[11px] mt-2.5 text-[var(--ink-faint)] hover:text-[var(--ink-dim)] transition-colors"
          onClick={() => setShowDone((v) => !v)}
        >
          {showDone ? "Hide" : "Show"} the {done.length} collected
        </button>
      )}
      {showDone && (
        <div className="mt-2 pt-2 space-y-1" style={{ borderTop: "1px dashed var(--line)" }}>
          {done.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-[11.5px]">
              <span style={{ color: "var(--mint)" }}><ICheck size={11} /></span>
              <span className="text-[var(--ink-dim)] truncate">{d.title}</span>
              <span className="ml-auto mono text-[10.5px] text-[var(--ink-faint)]">{d.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
