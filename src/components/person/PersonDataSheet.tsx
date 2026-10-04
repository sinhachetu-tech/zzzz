"use client";

/* PersonDataSheet — the bank-form answer sheet, for one human.
 *
 * DESIGN INTENT (the answer to "how do I put 50 fields in without overwhelming
 * staff"): staff are almost never shown 50 empty boxes.
 *
 *   · COUNT FIRST — a meter and "31 of 47 answered", not a wall of inputs.
 *   · SECTIONS COLLAPSED, and only the INCOMPLETE ones open by default. There is
 *     no value in making someone scroll past 30 answers they already gave.
 *   · ANSWERED FIELDS ARE READ-ONLY with a ✓. Staff should never re-key the EID
 *     number or the salary that is already on file.
 *   · THE GAPS ARE THE ONLY ACTIONABLE PART, and staff mostly do not type them —
 *     most are facts only the client knows (mother's maiden name, their friend's
 *     mobile, their home-country address). `onRequest` lets staff CHASE rather
 *     than transcribe, which is the whole point of the client portal.
 *
 * The field list comes from src/lib/person-sheet.ts, never from JSX here, so a
 * field discovered on next month's bank form is added in ONE place and appears
 * in the UI, the completion meter and the PDF filler at once.
 */

import { useMemo, useState } from "react";
import { Chip } from "@/components/hfmc/ui";
import {
  PERSON_SECTIONS,
  isAnswered,
  sheetCompletion,
  type PersonData,
  type SheetField,
} from "@/lib/person-sheet";
import { setUnsavedChanges } from "@/lib/leave-guard";
import { ICheck, IArrowR } from "@/components/icons";

/** Store numbers as numbers, so the meter treats 0 as a real answer — "zero
 *  dependants" IS an answer, an empty box is not. */
function coerce(path: string, v: string): string | number {
  const numeric = /income|salary|amount|limit|monthly|pct|percent|employees|dependants|years|year|number/i.test(path);
  if (numeric && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return v;
}

function Input({
  f,
  value,
  disabled,
  onChange,
}: {
  f: SheetField;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const common = {
    className: "input !py-1 text-[12px]",
    disabled,
    value,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  if (f.input === "select") {
    return (
      <select {...common}>
        <option value="">— select —</option>
        {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (f.input === "date") return <input type="date" {...common} />;
  if (f.input === "number") return <input type="number" min={0} {...common} />;
  return <input type="text" {...common} />;
}

export function PersonDataSheet({
  data,
  selfEmployed,
  secondParty,
  readOnly,
  onChange,
  onRequest,
  onDirtyChange,
}: {
  data: PersonData;
  selfEmployed?: boolean;
  secondParty?: boolean;
  readOnly?: boolean;
  /** Commits the whole draft. Called ONLY from the Save button. */
  onChange?: (next: PersonData) => void;
  onRequest?: (missing: SheetField[]) => void;
  /** Reports whether there are unsaved edits, so the parent can warn. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  // Sections start CLOSED, always — including the incomplete ones. Opening the
  // incomplete ones by default was a well-meant idea that made the sheet read as
  // 102 empty boxes, which is the exact overwhelm this sheet exists to avoid. The
  // collapsed header already says how many are outstanding in each section, so
  // the whole picture is available without expanding anything, and every section
  // re-opens and re-closes freely — a completed section closes just as easily.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => open[id] === true;

  // DRAFT, DON'T SAVE PER KEYSTROKE. Edits land in local `draft` and are committed
  // to the server only on an explicit Save. Saving on every keystroke meant a
  // network write per character — slow, and it let a half-typed value be stored
  // and then counted as "answered".
  const [draft, setDraft] = useState<PersonData>(data);
  const [lastData, setLastData] = useState<PersonData>(data);
  // Re-sync when the parent hands us new data (a hydrate after someone else
  // saved). Adjusting state during RENDER — the sanctioned pattern — rather than
  // in an effect, which this repo's lint rightly rejects.
  if (data !== lastData) {
    setLastData(data);
    setDraft(data);
  }
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(data), [draft, data]);
  // The meter reads the DRAFT, not the saved data, so the count reflects what has
  // been typed in this sitting — including values not yet saved.
  const completion = useMemo(
    () => sheetCompletion(draft, { selfEmployed, secondParty }),
    [draft, selfEmployed, secondParty],
  );
  // Report dirty state upward for the tab-switch modal AND into the shared
  // leave-guard, which is what covers navigating to Leads / Dashboard / Cases:
  // those are client-side `nav()` calls that never trigger beforeunload.
  onDirtyChange?.(dirty);
  setUnsavedChanges(dirty);

  const set = (path: string, v: string) => setDraft((d) => ({ ...d, [path]: coerce(path, v) }));
  const save = () => { if (dirty && onChange) onChange(draft); };

  return (
    <div className="card p-4 anim-fade-up">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-disp font-semibold text-[13px]">Application data sheet</span>
        {completion.pct === 100
          ? <Chip tone="mint">complete ✓</Chip>
          : <Chip tone={completion.pct >= 60 ? "amber" : "coral"}>{completion.done} of {completion.total} answered</Chip>}
        {onRequest && completion.clientMissing.length > 0 && (
          <button
            className="btn btn-mint btn-sm ml-auto"
            onClick={() => onRequest(completion.clientMissing)}
            title="Ask the client to fill these in their portal rather than keying them here"
          >
            Request {completion.clientMissing.length} from client
          </button>
        )}
      </div>

      {/* Count first, list second. */}
      <div className="flex items-center gap-2 mb-3">
        <div className="h-1.5 flex-1 rounded-full" style={{ background: "var(--line-soft)" }}>
          <div
            className="h-1.5 rounded-full transition-all"
            style={{ width: `${completion.pct}%`, background: completion.pct === 100 ? "var(--mint)" : "var(--amber)" }}
          />
        </div>
        <span className="mono text-[11px]" style={{ color: completion.pct === 100 ? "var(--mint)" : "var(--amber)" }}>
          {completion.pct}%
        </span>
      </div>
      <div className="space-y-1.5">
        {PERSON_SECTIONS.map((section) => {
          const fields = section.fields.filter((f) => {
            if (f.onlyIfSelfEmployed && !selfEmployed) return false;
            if (f.onlyIfSecondParty && !secondParty) return false;
            return true;
          });
          if (fields.length === 0) return null;
          const missing = fields.filter((f) => !isAnswered(draft, f)).length;
          const expanded = isOpen(section.id);

          return (
            <div key={section.id} className="rounded-lg" style={{ border: "1px solid var(--line-soft)" }}>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-left"
                onClick={() => setOpen((p) => ({ ...p, [section.id]: !expanded }))}
              >
                <span className="text-[12.5px] font-medium">{section.title}</span>
                {missing === 0 ? <Chip tone="mint">done</Chip> : <Chip tone="amber">{missing} needed</Chip>}
                <span className="ml-auto text-[var(--ink-faint)]">{expanded ? <IArrowR size={12} /> : "▸"}</span>
              </button>

              {expanded && (
                <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: "1px dashed var(--line)" }}>
                  {section.blurb && <p className="text-[11px] text-[var(--ink-faint)] m-0 mb-1">{section.blurb}</p>}
                  {fields.map((f) => {
                    const answered = isAnswered(draft, f);
                    return (
                      <div key={f.path} className="grid grid-cols-1 sm:grid-cols-[1fr_1.1fr] gap-2 items-start">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {answered && <span style={{ color: "var(--mint)" }}><ICheck size={10} /></span>}
                            <span className="text-[12px]" style={{ color: answered ? "var(--ink-dim)" : "var(--ink)" }}>
                              {f.label}
                              {f.required && !answered && <span style={{ color: "var(--coral)" }}> *</span>}
                            </span>
                          </div>
                          {f.hint && <p className="text-[10px] text-[var(--ink-faint)] m-0 mt-0.5 leading-snug">{f.hint}</p>}
                        </div>
                        <Input
                          f={f}
                          value={String(draft?.[f.path] ?? "")}
                          // An answered field is EDITABLE, not locked. It used to be
                          // `disabled` on the reasoning that nobody should re-key what
                          // is already on file — but that created a dead end: a wrong
                          // answer could never be corrected, and "clear it to re-open"
                          // was a control that did not exist. The ✓ and the muted
                          // label already say "we have this"; the broker's ability to
                          // fix a wrong value is worth more than the keystroke saved.
                          // `readOnly` is passed through ONLY for a genuinely locked
                          // context (a save in flight). An ANSWERED field is
                          // deliberately NOT locked: it used to be `disabled` on the
                          // reasoning that nobody should re-key what is already on
                          // file — but that created a dead end, because a wrong
                          // answer could never be corrected and the "clear it to
                          // re-open" control the comment described did not exist.
                          disabled={readOnly}
                          onChange={(v) => set(f.path, v)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* SAVE BAR — the only commit point, and deliberately unmissable: full
          width, sticky to the bottom of the card, lit only when there is
          something to save. A quiet grey button at the end of a long form is a
          button nobody finds, and the whole point of moving off per-keystroke
          saving is that the user can SEE where the commit is. */}
      {onChange && (
        <div
          className="sticky bottom-0 z-10 -mx-4 px-4 pt-3 pb-1 mt-3"
          style={{ borderTop: "1px solid var(--line-soft)", background: "var(--card, var(--bg))" }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[12px] font-medium flex items-center gap-1.5" style={{ color: dirty ? "var(--amber)" : "var(--mint)" }}>
              {dirty
                ? <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--amber)" }} />
                : <ICheck size={13} />}
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                className="btn btn-ghost"
                disabled={!dirty}
                onClick={() => { setDraft(data); setLastData(data); setUnsavedChanges(false); }}
              >
                Discard
              </button>
              <button
                className="btn btn-primary px-6 py-2.5 text-[13.5px] font-semibold"
                disabled={!dirty}
                onClick={save}
                style={dirty ? undefined : { opacity: 0.55 }}
              >
                <ICheck size={15} /> Save details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
