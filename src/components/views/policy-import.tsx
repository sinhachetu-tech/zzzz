// Needs-based policy importer — upload a workbook, paste policy text, answer
// what is missing, review, commit as draft. NEVER writes to products directly:
// every commit lands in draft status for the guided editor + approve workflow.
import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { Chip, EmptyState, Modal } from "@/components/hfmc/ui";
import { ICheck, IPlus, IUpload } from "@/components/icons";
import type { BankProduct } from "@/lib/types";
import type { PolicyNeed } from "@/lib/policy-ingest";

type Stage = "idle" | "parsing" | "review" | "asking" | "committing";

interface ReviewState {
  source: string;
  axes: Record<string, string>;
  quoteHints: Array<{
    ratePct: number | null; marginPct: number | null; termYears: number | null;
    txnHints: string[]; stlHint: boolean | null; sourceLine: string;
  }>;
  needs: PolicyNeed[];
  autoQuotes: Array<Record<string, unknown>>;
}

export function PolicyImporterModal({ product, onClose, onApplied }: {
  product: BankProduct | null; // null = create new product on commit
  onClose: () => void;
  onApplied: (productId: number) => void;
}) {
  const { banks, toast, hydrate } = useHfmcStore();
  const [stage, setStage] = useState<Stage>("idle");
  const [bank, setBank] = useState(product?.bankName ?? "");
  const [text, setText] = useState("");
  const [review, setReview] = useState<ReviewState | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checkedAxes, setCheckedAxes] = useState<Record<string, boolean>>({});
  const [checkedQuotes, setCheckedQuotes] = useState<Record<number, boolean>>({});
  const [err, setErr] = useState<string | null>(null);

  const blocking = useMemo(
    () => (review?.needs ?? []).filter((n) => n.importance === "blocking"),
    [review],
  );

  const hydrateSafe = async () => { try { await hydrate(); } catch { /* best-effort */ } };


  const parseText = async () => {
    if (!text.trim()) { toast("error", "Paste the policy text first."); return; }
    setStage("parsing"); setErr(null);
    try {
      const up = await fetch("/api/policy/upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await up.json();
      if (!up.ok) throw new Error(j.error || "Parse failed");
      await enterReview(j, text.slice(0, 60));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Parse failed");
      setStage("idle");
    }
  };

  const uploadFile = async (file: File) => {
    if (!bank.trim()) { toast("error", "Pick the bank first — files are decoded per bank."); return; }
    setStage("parsing"); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bank", bank.trim());
      const res = await fetch("/api/policy/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed");
      if (j.status === "staged") {
        // PDF without a text layer: honest staging, paste path stays open
        setErr(j.message);
        setStage("idle");
        return;
      }
      // workbook → fold every product's axes into one review text
      const parts: string[] = [];
      for (const p of j.products ?? []) {
        parts.push(`--- ${p.bank} · ${p.sheet} ---`);
        for (const [k, v] of Object.entries(p.axes as Record<string, string>)) parts.push(`${k}: ${v}`);
      }
      const joined = parts.join("\n");
      const up = await fetch("/api/policy/upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: joined }),
      });
      const jj = await up.json();
      if (!up.ok) throw new Error(jj.error || "Parse failed");
      await enterReview({ ...jj, source: `workbook ${file.name}: ${(j.sheets ?? []).join(", ")}` }, `workbook ${file.name}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
      setStage("idle");
    }
  };

  const enterReview = async (j: {
    axes: Record<string, string>;
    quoteHints: ReviewState["quoteHints"];
    needs: PolicyNeed[];
    source?: string;
  }, sourceLabel: string) => {
    // deterministic quote-row candidates from the same text (guided-editor shape)
    let autoQuotes: Array<Record<string, unknown>> = [];
    try {
      const { parseRateTable } = await import("@/lib/quote-parser");
      const full = text || Object.entries(j.axes).map(([k, v]) => `${k}: ${v}`).join("\n");
      autoQuotes = parseRateTable(full).map(({ confidence, sourceLine, ...q }) => ({ ...q, note: sourceLine, sourceLabel: sourceLine.slice(0, 40) }));
    } catch { autoQuotes = []; }
    setReview({
      source: j.source ?? sourceLabel,
      axes: j.axes ?? {},
      quoteHints: j.quoteHints ?? [],
      needs: j.needs ?? [],
      autoQuotes,
    });
    const allAxes: Record<string, boolean> = {};
    for (const k of Object.keys(j.axes ?? {})) allAxes[k] = true;
    setCheckedAxes(allAxes);
    const allQ: Record<number, boolean> = {};
    autoQuotes.forEach((_, i) => { allQ[i] = false; });
    setCheckedQuotes(allQ);
    setStage("review");
  };


  const [resolved, setResolvedState] = useState<Record<string, { value: unknown; unit?: string }>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const askAi = async () => {
    if (!review) return;
    setStage("asking"); setErr(null);
    try {
      const res = await fetch("/api/ai/policy-draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text || Object.entries(review.axes).map(([k, v]) => `${k}: ${v}`).join("\n"),
          answers: Object.entries(answers).filter(([, a]) => a.trim()).map(([key, answer]) => ({ key, answer })),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "AI unavailable");
      const nextAnswers = { ...answers };
      const nextResolved: Record<string, { value: unknown; unit?: string }> = {};
      for (const r of j.draft?.resolved ?? []) {
        if (r.status === "found" && r.value != null && String(r.value) !== "") {
          nextAnswers[r.key] = String(r.value);
          nextResolved[r.key] = { value: r.value, unit: r.unit };
        }
      }
      setAnswers(nextAnswers);
      setResolvedState(nextResolved);
      if (j.needs) setReview({ ...review, needs: j.needs });
      toast("success", "AI checked the gaps — found values are pre-filled, the rest need your words.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI unavailable");
    } finally {
      setStage("review");
    }
  };

  const resolveAnswer = async (need: PolicyNeed) => {
    const answer = (answers[need.key] ?? "").trim();
    if (!answer) { toast("error", "Type the answer first (or “don't know” to leave it unverified)."); return; }
    setBusyKey(need.key);
    try {
      const res = await fetch("/api/ai/policy-draft", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: need.key, question: need.question, answer }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Resolve failed");
      setResolvedState((prev) => ({ ...prev, [need.key]: { value: j.patch?.value ?? null, unit: j.patch?.unit } }));
      toast("success", "Answer converted — review it below before committing.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Resolve failed");
    } finally {
      setBusyKey(null);
    }
  };

  const commit = async () => {
    if (!review) return;
    if (!bank.trim() && !product) { toast("error", "Pick the bank this policy belongs to."); return; }
    setStage("committing"); setErr(null);
    try {
      const keptAxes: Record<string, string> = {};
      for (const [k, v] of Object.entries(review.axes)) if (checkedAxes[k] !== false) keptAxes[k] = v;
      const keptQuotes = review.autoQuotes.filter((_, i) => checkedQuotes[i]);
      const r1 = await fetch("/api/policy/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "axes", bankName: (product?.bankName ?? bank).trim(), productId: product?.id,
          sheet: product?.sheet ?? "Salaried", employment: product?.employment ?? "Salaried",
          residency: product?.residency ?? "Resident", financeType: product?.financeType ?? "Residential",
          program: product?.program ?? "", loanKind: product?.loanKind ?? "",
          axes: keptAxes, sourceFiles: review.source,
        }),
      });
      const j1 = await r1.json();
      if (!r1.ok) throw new Error(j1.error || "Axes commit failed");
      const pid: number = j1.productId;
      if (keptQuotes.length) {
        const r2 = await fetch("/api/policy/apply", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "quotes", productId: pid, quotes: keptQuotes }),
        });
        const j2 = await r2.json();
        if (!r2.ok) throw new Error(j2.error || "Quotes commit failed");
      }
      const resolvedAnswers = Object.entries(resolved)
        .filter(([, r]) => r.value != null)
        .map(([key, r]) => ({ key, value: r.value, unit: r.unit }));
      if (resolvedAnswers.length) {
        await fetch("/api/policy/apply", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "answers", productId: pid, answers: resolvedAnswers }),
        });
      }
      toast("success", "Saved as draft — open the product and approve when verified.");
      try { await hydrate(); } catch { /* best-effort */ }
      onApplied(pid);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Commit failed");
      setStage("review");
    }
  };

  return (
    <Modal
      full
      title={product ? `Import policy → ${product.bankName} · ${product.name}` : "Import bank policy"}
      sub="Upload a workbook or paste the text. Answer what is missing. Review line by line. Commits land as DRAFT — approve only after verifying."
      onClose={onClose}
    >
      <div className="space-y-4">
        {(stage === "idle" || stage === "parsing") && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2.5">
              <label className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-wider">1 · Bank</label>
              <select className="select" value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">— pick the bank —</option>
                {banks.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
              <label className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-wider">2 · Workbook (.xlsx / .csv)</label>
              <label className="rounded-lg p-4 block text-center cursor-pointer" style={{ border: "1px dashed var(--line)", background: "var(--tint)" }}>
                <input
                  type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.target.value = ""; }}
                />
                <IUpload size={18} />
                <div className="text-[12px] mt-1">Drop a rates / policy workbook</div>
                <div className="text-[10.5px] text-[var(--ink-faint)]">Sheets are decoded row-by-row — you pick which land below.</div>
              </label>
              <div className="text-[10.5px] text-[var(--ink-faint)]">PDF? Open it, copy the body text, paste it on the right. (PDF binary parsing is not in this build — the paste path is the honest route.)</div>
            </div>
            <div className="space-y-2.5">
              <label className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-wider">2b · Or paste policy text</label>
              <textarea
                className="textarea mono" rows={12} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={"Fixed Rate: 3.95% Fixed for 3 years, STL\nProcessing Fee: 1.05% capped at 10,500\nLife Insurance: 0.03 p.m on loan outstanding\n…"}
              />
              <button className="btn btn-primary btn-sm" disabled={stage === "parsing"} onClick={() => void parseText()}>
                {stage === "parsing" ? "Reading…" : "Read document →"}
              </button>
            </div>
          </div>
        )}

        {review && stage !== "idle" && stage !== "parsing" && (
          <ReviewBody
            review={review} answers={answers} setAnswers={setAnswers} resolved={resolved}
            checkedAxes={checkedAxes} setCheckedAxes={setCheckedAxes}
            checkedQuotes={checkedQuotes} setCheckedQuotes={setCheckedQuotes}
            blocking={blocking} busyKey={busyKey}
            onResolve={(n) => void resolveAnswer(n)}
            onAskAi={() => void askAi()} asking={stage === "asking"}
            onBack={() => setStage("idle")}
            onCommit={() => void commit()} committing={stage === "committing"}
          />
        )}
        {err && <p className="text-[12px] m-0" style={{ color: "var(--coral)" }}>⚠ {err}</p>}
      </div>
    </Modal>
  );
}

function PolicyImportNeedsQuestions(props: {
  needs: PolicyNeed[];
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  resolved: Record<string, { value: unknown; unit?: string }>;
  busyKey: string | null;
  onResolve: (n: PolicyNeed) => void;
  onAskAi: () => void;
  asking: boolean;
}) {
  const q = props;
  if (q.needs.length === 0) return null;
  return (
    <div className="rounded-xl p-3 space-y-2" style={{ border: "1px solid color-mix(in srgb, var(--coral) 40%, var(--line))", background: "color-mix(in srgb, var(--coral) 5%, var(--surface))" }}>
      <div className="flex items-center gap-2">
        <div className="text-[11px] font-disp font-semibold flex-1" style={{ color: "var(--coral)" }}>
          The document does not state {q.needs.length} thing{q.needs.length === 1 ? "" : "s"} the engine needs — answer in plain words (nothing is guessed).
        </div>
        <button className="btn btn-ghost btn-sm" disabled={q.asking} onClick={q.onAskAi}>{q.asking ? "AI checking…" : "AI: check the gaps"}</button>
      </div>
      {q.needs.map((n) => (
        <div key={n.key} className="rounded-lg p-2.5 space-y-1.5" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
          <div className="flex items-center gap-2 text-[12px]">
            <Chip tone={n.importance === "blocking" ? "coral" : "amber"}>{n.importance}</Chip>
            <span className="font-medium flex-1">{n.question}</span>
          </div>
          <div className="flex gap-1.5">
            <input
              className="input !py-1.5 text-[12px] flex-1"
              placeholder={'e.g. "1.05% capped at 10,500" · "all transactions" · "don\'t know"'}
              value={q.answers[n.key] ?? ""}
              onChange={(e) => q.setAnswers({ ...q.answers, [n.key]: e.target.value })}
            />
            <button className="btn btn-ghost btn-sm whitespace-nowrap" disabled={q.busyKey === n.key} onClick={() => q.onResolve(n)}>
              {q.busyKey === n.key ? "…" : <><ICheck size={12} /> Convert</>}
            </button>
          </div>
          {q.resolved[n.key] != null && (
            <div className="text-[11px] mono" style={{ color: "var(--mint)" }}>
              → will file: {JSON.stringify(q.resolved[n.key].value)}{q.resolved[n.key].unit ? ` (${q.resolved[n.key].unit})` : ""}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AxesReview(props: {
  axes: Record<string, string>;
  checked: Record<string, boolean>;
  setChecked: (c: Record<string, boolean>) => void;
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1.5">
        Policy axes — tick to keep ({Object.entries(props.checked).filter(([, v]) => v !== false).length}/{Object.keys(props.axes).length})
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 max-h-[260px] overflow-y-auto pr-1">
        {Object.entries(props.axes).map(([k, v]) => (
          <label key={k} className="rounded-lg px-2.5 py-2 flex gap-2 items-start cursor-pointer" style={{ background: "var(--tint)", opacity: props.checked[k] === false ? 0.45 : 1 }}>
            <input
              type="checkbox" className="mt-1"
              checked={props.checked[k] !== false}
              onChange={(e) => props.setChecked({ ...props.checked, [k]: e.target.checked })}
            />
            <span className="min-w-0">
              <span className="text-[11px] font-semibold block truncate">{k}</span>
              <span className="text-[11px] text-[var(--ink-dim)] block whitespace-pre-wrap leading-snug">{String(v).slice(0, 220)}</span>
            </span>
          </label>
        ))}
        {Object.keys(props.axes).length === 0 && <EmptyState icon={<IUpload size={20} />} title="No labelled rows found" body="Paste 'Label: value' rows or upload a workbook with a label column." />}
      </div>
    </div>
  );
}

function QuotesReview(props: {
  quotes: Array<Record<string, unknown>>;
  checked: Record<number, boolean>;
  setChecked: (c: Record<number, boolean>) => void;
}) {
  const kept = props.quotes.filter((_, i) => props.checked[i]).length;
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1.5">
        Rate rows detected — tick to file ({kept}/{props.quotes.length})
      </div>
      {props.quotes.length === 0 ? (
        <p className="text-[11.5px] text-[var(--ink-faint)] m-0">No rate rows detected — quotes stay empty until the guided editor files them.</p>
      ) : (
        <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
          {props.quotes.map((r, i) => (
            <label key={i} className="rounded-lg px-2.5 py-2 flex gap-2 items-center cursor-pointer mono text-[11.5px]" style={{ background: "var(--tint)", opacity: props.checked[i] ? 1 : 0.45 }}>
              <input type="checkbox" checked={!!props.checked[i]} onChange={(e) => props.setChecked({ ...props.checked, [i]: e.target.checked })} />
              <span className="flex-1">
                <strong>{r.ratePct != null ? `${r.ratePct}%` : r.marginPct != null ? `+${r.marginPct} EIBOR` : "—"}</strong>
                {typeof r.termYears === "number" && r.termYears > 0 ? ` · ${r.termYears}y` : " · day-1 variable"}
                {Array.isArray(r.txns) && r.txns.length > 0 ? ` · ${(r.txns as string[]).join("/")}` : ""}
                {typeof r.stl === "boolean" ? (r.stl ? " · STL" : " · NSTL") : ""}
              </span>
              <span className="text-[10.5px] text-[var(--ink-faint)] truncate max-w-[220px]">{String(r.sourceLine ?? "")}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewBody(props: {
  review: ReviewState;
  answers: Record<string, string>; setAnswers: (a: Record<string, string>) => void;
  resolved: Record<string, { value: unknown; unit?: string }>;
  checkedAxes: Record<string, boolean>; setCheckedAxes: (c: Record<string, boolean>) => void;
  checkedQuotes: Record<number, boolean>; setCheckedQuotes: (c: Record<number, boolean>) => void;
  blocking: PolicyNeed[]; busyKey: string | null;
  onResolve: (need: PolicyNeed) => void;
  onAskAi: () => void; asking: boolean;
  onBack: () => void; onCommit: () => void; committing: boolean;
}) {
  const p = props;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--ink-dim)]">
        <Chip tone="slate">{p.review.source}</Chip>
        <Chip tone={p.blocking.length ? "coral" : "mint"}>{p.blocking.length ? `${p.blocking.length} blocking gap${p.blocking.length === 1 ? "" : "s"}` : "no blocking gaps"}</Chip>
        <span className="ml-auto" />
        <button className="btn btn-ghost btn-sm" onClick={p.onBack}>← Start over</button>
        <button className="btn btn-primary btn-sm" disabled={p.committing} onClick={p.onCommit}>
          {p.committing ? "Saving…" : "Review done — save as draft"}
        </button>
      </div>
      <PolicyImportNeedsQuestions
        needs={p.review.needs} answers={p.answers} setAnswers={p.setAnswers}
        resolved={p.resolved} busyKey={p.busyKey} onResolve={p.onResolve}
        onAskAi={p.onAskAi} asking={p.asking}
      />
      <AxesReview axes={p.review.axes} checked={p.checkedAxes} setChecked={p.setCheckedAxes} />
      <QuotesReview quotes={p.review.autoQuotes} checked={p.checkedQuotes} setChecked={p.setCheckedQuotes} />
      <div className="flex items-center gap-2 text-[11px] text-[var(--ink-faint)]">
        <IPlus size={12} />
        <span>Committing writes axes + ticked quotes + converted answers as <strong>DRAFT</strong> on one product. Approval stays manual — see the product editor.</span>
      </div>
    </div>
  );
}
