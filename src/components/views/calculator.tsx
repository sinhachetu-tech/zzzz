"use client";

/* HFMC Mortgage Eligibility Calculator — CBUAE-style MPBF engine
   with AI Mortgage Advisor + AI Document Reader.
   The flagship view. */

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useHfmcStore } from "@/lib/client-store";
import {
  FREQUENCIES, LIAB_METHODS, LIAB_TYPES, LTV_CHOICES,
  SALARIED_SOURCES, SE_SOURCES,
  cloneInput, computeMortgage, defaultInput, defaultLtvPct,
  fmtAED, fmtPct, incomeMonthly, liabilityEmi,
  newIncomeRow, newLiabRow,
  scenarioCardNewLimit, scenarioCardsPct, scenarioIncomePct,
  scenarioIncomeRemove, scenarioRate, scenarioRemoveCards,
  scenarioRemoveLiab, scenarioTenor, scenarioTable,
  tenorLabel,
  MAX_DBR,
} from "@/lib/mortgage";
import type {
  Employment, Frequency, IncomeRow, LiabMethod, LiabRow,
  LiabType, MortgageInput, MortgageResult,
} from "@/lib/mortgage";
import type { AffordabilityInput } from "@/lib/calc";
import type { DocRule, FeeRule } from "@/lib/types";
import { Avatar, Chip } from "@/components/hfmc/ui";
import { useCountUp } from "@/components/hfmc/charts";
import {
  ICalc, IDownload, IPlus, ITrash, IX, IRobot, ISparkles, IUpload, ICheck,
  IUsers, IBank,
} from "@/components/icons";

/* ------------------------------ tiny helpers ------------------------------ */

function Section({ num, title, hint, children }: { num: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5 anim-fade-up">
      <div className="flex items-baseline gap-3 mb-3.5">
        <span className="mono text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--amber-tint)", color: "var(--amber)" }}>{num}</span>
        <h2 className="font-disp font-semibold text-[15px] m-0">{title}</h2>
        {hint && <span className="text-[11.5px] text-[var(--ink-faint)] ml-auto hidden sm:inline">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">{label}</div>
      <div className="mono text-[13.5px] font-medium" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

function NumIn({ value, onChange, min = 0, step = 1000, placeholder }: { value: number; onChange: (n: number) => void; min?: number; step?: number; placeholder?: string }) {
  return (
    <input className="input mono" type="number" min={min} step={step} value={Number.isFinite(value) ? value : ""} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
  );
}

function ToggleChips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--line)" }}>
      {options.map((o) => (
        <button key={o} type="button"
          className="flex-1 px-2 py-1.5 text-[12px] font-disp font-semibold transition-all"
          style={value === o ? { background: "var(--amber-tint)", color: "var(--amber)" } : { color: "var(--ink-faint)", background: "transparent" }}
          onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/* --------------------------- tiny markdown renderer --------------------------- */
/* Supports: ## / ### headings, - / * bullets, 1. numbered lists, **bold**, `code`,
   and paragraphs. Output is rendered inside .prose-ai (already styled by globals.css). */
function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+?)`/g, "<code>$1</code>");
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    if (line.startsWith("### ")) { out.push(`<h3>${inline(line.slice(4))}</h3>`); i++; continue; }
    if (line.startsWith("## "))  { out.push(`<h2>${inline(line.slice(3))}</h2>`); i++; continue; }
    if (line.startsWith("# "))   { out.push(`<h2>${inline(line.slice(2))}</h2>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" &&
      !lines[i].startsWith("#") && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("");
}

/* ------------------------------ income/liability row editors ------------------------------ */

function IncomeRowEditor({
  row, sourcePool, tone, onChange, onRemove,
}: {
  row: IncomeRow; sourcePool: string[]; tone: "mint" | "sky";
  onChange: (patch: Partial<IncomeRow>) => void; onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_92px_110px_70px_100px_28px] gap-2 items-center anim-fade-in">
      <select className="select" value={row.source} onChange={(e) => onChange({ source: e.target.value })}>
        {sourcePool.map((s) => <option key={s}>{s}</option>)}
      </select>
      <select className="select" value={row.frequency} onChange={(e) => onChange({ frequency: e.target.value as Frequency })}>
        {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
      </select>
      <NumIn value={row.amount} onChange={(n) => onChange({ amount: n })} step={500} />
      <NumIn value={row.eligiblePct} onChange={(n) => onChange({ eligiblePct: Math.min(100, Math.max(0, n)) })} step={5} min={0} />
      <span className="mono text-[12.5px] text-right" style={{ color: `var(--${tone})` }}>{fmtAED(incomeMonthly(row))}</span>
      <button className="text-[var(--ink-faint)] hover:text-[var(--coral)] transition-colors justify-self-center" title="Remove row" onClick={onRemove}>
        <IX size={14} />
      </button>
    </div>
  );
}

function LiabRowEditor({
  row, onChange, onRemove,
}: {
  row: LiabRow; onChange: (patch: Partial<LiabRow>) => void; onRemove: () => void;
}) {
  return (
    <div className="rounded-lg p-2.5 anim-fade-in" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
      <div className="grid grid-cols-[1fr_130px_130px] gap-2">
        <input className="input" value={row.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Liability name" />
        <select className="select" value={row.type} onChange={(e) => onChange({ type: e.target.value as LiabType })}>
          {LIAB_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="select" value={row.method} onChange={(e) => onChange({ method: e.target.value as LiabMethod })}>
          {LIAB_METHODS.map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-[1fr_1fr_110px_28px] gap-2 mt-2 items-center">
        <div>
          <label className="label" style={{ marginBottom: 3 }}>{row.type === "Credit Card" || row.type === "Overdraft" ? "Limit / outstanding" : "Outstanding"}</label>
          <NumIn value={row.limitOrOutstanding} onChange={(n) => onChange({ limitOrOutstanding: n })} step={1000} />
        </div>
        <div>
          <label className="label" style={{ marginBottom: 3 }}>Monthly EMI {row.method.startsWith("5%") ? "(ignored)" : ""}</label>
          <NumIn value={row.monthlyEmi} onChange={(n) => onChange({ monthlyEmi: n })} step={100} />
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-disp font-semibold">Assessed</div>
          <div className="mono text-[13px]" style={{ color: "var(--coral)" }}>{fmtAED(liabilityEmi(row))}</div>
        </div>
        <button className="text-[var(--ink-faint)] hover:text-[var(--coral)] transition-colors justify-self-center" title="Remove liability" onClick={onRemove}>
          <ITrash size={14} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ scenario table ------------------------------ */

function ScenarioTable({ rows, base }: {
  rows: { label: string; dbr: number; residual: number; mpbf: number }[];
  base: number;
}) {
  const delta = (v: number): ReactNode => {
    const d = v - base;
    if (Math.abs(d) < 1) return <span className="text-[var(--ink-faint)]">—</span>;
    return <span style={{ color: d > 0 ? "var(--mint)" : "var(--coral)" }}>{d > 0 ? "+" : "−"}{fmtAED(Math.abs(d))}</span>;
  };
  return (
    <div className="overflow-x-auto">
      <table className="tbl" style={{ minWidth: 460 }}>
        <thead>
          <tr>
            <th>Scenario</th>
            <th className="text-right">DBR</th>
            <th className="text-right">Residual</th>
            <th className="text-right">MPBF</th>
            <th className="text-right">Δ vs base</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} style={{ cursor: "default" }}>
              <td className="text-[12.5px]">{r.label}</td>
              <td className="mono text-right text-[12.5px]">{fmtPct(r.dbr)}</td>
              <td className="mono text-right text-[12.5px]">{fmtPct(r.residual)}</td>
              <td className="mono text-right text-[12.5px] font-semibold">{fmtAED(r.mpbf)}</td>
              <td className="mono text-right text-[12.5px]">{delta(r.mpbf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ AI Mortgage Advisor ------------------------------ */

interface AdvisorMsg { role: "verdict" | "q"; markdown: string; }

function AdvisorPanel({ input, r }: { input: MortgageInput; r: MortgageResult }) {
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<AdvisorMsg[]>([]);
  const [question, setQuestion] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const toast = useHfmcStore((s) => s.toast);

  const callAdvisor = async (q?: string) => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/ai/advisor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, question: q }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const data = await res.json() as { markdown: string };
      setMessages((m) => [...m, { role: q ? "q" : "verdict", markdown: data.markdown }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Advisor unavailable";
      setErr(msg);
      toast("error", "AI advisor error: " + msg);
    } finally {
      setLoading(false);
    }
  };

  const askFollowUp = () => {
    const q = question.trim();
    if (!q || loading) return;
    setMessages((m) => [...m, { role: "q", markdown: `> ${q}` }]);
    setQuestion("");
    void callAdvisor(q);
  };

  return (
    <div
      className="card anim-fade-up"
      style={{ borderColor: "color-mix(in srgb, var(--sky) 35%, var(--line))", background: "color-mix(in srgb, var(--sky) 4%, var(--surface))" }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: "color-mix(in srgb, var(--sky) 18%, var(--line-soft))" }}>
        <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ background: "color-mix(in srgb, var(--sky) 14%, transparent)", color: "var(--sky)", border: "1px solid color-mix(in srgb, var(--sky) 30%, transparent)" }}>
          <IRobot size={17} />
        </span>
        <div className="min-w-0">
          <h3 className="font-disp font-semibold text-[14.5px] m-0 flex items-center gap-1.5">
            AI Mortgage Advisor
            <Chip tone="sky"><span className="flex items-center gap-1"><ISparkles size={11} /> new</span></Chip>
          </h3>
          <p className="text-[11.5px] text-[var(--ink-faint)] m-0 truncate">Senior UAE credit analyst explains eligibility in plain English</p>
        </div>
        <div className="ml-auto shrink-0">
          <button className="btn btn-primary btn-sm" disabled={loading} onClick={() => callAdvisor()}>
            {loading && messages.length === 0 ? "Analysing…" : messages.length === 0 ? "Explain my eligibility" : "Re-run analysis"}
          </button>
        </div>
      </div>

      <div className="p-4">
        {messages.length === 0 && !loading && (
          <div className="text-[12.5px] text-[var(--ink-dim)] leading-relaxed">
            Click <strong>Explain my eligibility</strong> for a plain-English breakdown — verdict, what threatens it,
            concrete levers to improve MPBF, and the monthly cost. Then ask follow-up questions like
            <em> “what if I clear the credit card?”</em> or <em>“how does adding a co-borrower help?”</em>.
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="rounded-md px-2.5 py-2" style={{ background: "var(--tint)" }}>Final MPBF<br /><strong className="mono text-[var(--amber)]">{fmtAED(r.finalMpbf)}</strong></div>
              <div className="rounded-md px-2.5 py-2" style={{ background: "var(--tint)" }}>Current DBR<br /><strong className="mono" style={{ color: r.currentDbr > 50 ? "var(--coral)" : "var(--ink)" }}>{fmtPct(r.currentDbr)}</strong></div>
              <div className="rounded-md px-2.5 py-2" style={{ background: "var(--tint)" }}>Residual DBR<br /><strong className="mono" style={{ color: "var(--mint)" }}>{fmtPct(r.residualDbr)}</strong></div>
              <div className="rounded-md px-2.5 py-2" style={{ background: "var(--tint)" }}>Limited by<br /><strong style={{ color: "var(--amber)" }}>{r.limitedBy}</strong></div>
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className="mb-4 last:mb-0">
            {m.role === "q" && m.markdown.startsWith("> ") ? (
              <div className="text-[12px] mono mb-2 px-3 py-2 rounded-md" style={{ background: "var(--tint)", color: "var(--ink-dim)" }}>
                <span className="text-[var(--sky)] font-semibold">You asked:</span> {m.markdown.slice(2)}
              </div>
            ) : (
              <div
                className="prose-ai"
                style={m.role === "q" ? { borderLeft: "2px solid var(--sky)", paddingLeft: 12 } : undefined}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.markdown) }}
              />
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2.5 text-[12.5px] text-[var(--ink-faint)] py-2">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-[var(--sky)] border-t-transparent animate-spin" />
            The advisor is reasoning over your figures…
          </div>
        )}

        {err && (
          <div className="text-[12px] text-[var(--coral)] mt-2 px-3 py-2 rounded-md" style={{ background: "rgba(217,45,32,0.06)", border: "1px solid rgba(217,45,32,0.25)" }}>
            {err}
          </div>
        )}

        {messages.length > 0 && (
          <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: "1px dashed var(--line)" }}>
            <input
              className="input flex-1"
              placeholder="Ask a follow-up — e.g. how do I improve eligibility?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askFollowUp(); } }}
              disabled={loading}
            />
            <button className="btn btn-mint btn-sm" disabled={loading || !question.trim()} onClick={askFollowUp}>
              Ask
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ AI Document Reader ------------------------------ */

interface ExtractedLiab { name: string; type: string; limitOrOutstanding: number; monthlyEmi: number }
interface ExtractedData {
  applicantName?: string;
  monthlyIncome?: number;
  otherIncome?: number;
  age?: number;
  employmentType?: "Salaried" | "Self-Employed";
  liabilities?: ExtractedLiab[];
  notes?: string[];
}
interface DocReadResponse { data: ExtractedData; raw: string }

function DocReaderPanel({ onApply }: { onApply: (data: ExtractedData) => void }) {
  const toast = useHfmcStore((s) => s.toast);
  const [docType, setDocType] = useState("Salary Certificate");
  const [loading, setLoading] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast("error", "Please upload an image file (PNG / JPEG).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setDataUrl(url);
      void extract(url);
    };
    reader.onerror = () => toast("error", "Could not read file.");
    reader.readAsDataURL(file);
  };

  const extract = async (url: string) => {
    setLoading(true); setErr(null); setResult(null);
    try {
      const res = await fetch("/api/ai/doc-read", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: url, docType }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as DocReadResponse;
      setResult(json.data);
      toast("success", "Document parsed by AI — verify before applying.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI reader unavailable";
      setErr(msg);
      toast("error", "AI document reader error: " + msg);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setDataUrl(null); setResult(null); setErr(null); setLoading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div
      className="card anim-fade-up"
      style={{ borderColor: "color-mix(in srgb, var(--sky) 35%, var(--line))", background: "color-mix(in srgb, var(--sky) 4%, var(--surface))" }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: "color-mix(in srgb, var(--sky) 18%, var(--line-soft))" }}>
        <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ background: "color-mix(in srgb, var(--sky) 14%, transparent)", color: "var(--sky)", border: "1px solid color-mix(in srgb, var(--sky) 30%, transparent)" }}>
          <IUpload size={17} />
        </span>
        <div className="min-w-0">
          <h3 className="font-disp font-semibold text-[14.5px] m-0 flex items-center gap-1.5">
            AI Document Reader
            <Chip tone="sky"><span className="flex items-center gap-1"><ISparkles size={11} /> new</span></Chip>
          </h3>
          <p className="text-[11.5px] text-[var(--ink-faint)] m-0 truncate">Upload a salary certificate / payslip / statement to pre-fill the calculator</p>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <label className="label m-0 shrink-0">Doc type</label>
          <select className="select" style={{ width: 200 }} value={docType} onChange={(e) => setDocType(e.target.value)}>
            {["Salary Certificate", "Bank Statement", "Payslip", "Other"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>

        {!dataUrl && (
          <label
            className="flex flex-col items-center justify-center text-center rounded-lg cursor-pointer transition-all"
            style={{
              minHeight: 130,
              border: dragging ? "1.5px dashed var(--sky)" : "1.5px dashed var(--line)",
              background: dragging ? "color-mix(in srgb, var(--sky) 10%, transparent)" : "var(--tint)",
            }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) readFile(f);
            }}
          >
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
            <IUpload size={20} className="text-[var(--ink-faint)] mb-1.5" />
            <span className="font-disp font-semibold text-[13px]">Drop an image here, or click to browse</span>
            <span className="text-[11.5px] text-[var(--ink-faint)] mt-0.5">PNG / JPEG · UAE salary certificate, bank statement, or payslip</span>
          </label>
        )}

        {dataUrl && (
          <div className="flex gap-3">
            <img src={dataUrl} alt="Uploaded document thumbnail"
              className="rounded-md object-cover shrink-0"
              style={{ width: 96, height: 96, border: "1px solid var(--line)" }} />
            <div className="flex-1 min-w-0">
              {loading && (
                <div className="flex items-center gap-2 text-[12.5px] text-[var(--ink-faint)] mt-1">
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-[var(--sky)] border-t-transparent animate-spin" />
                  AI is reading the document…
                </div>
              )}
              {!loading && result && (
                <div className="text-[12.5px] text-[var(--ink-dim)]">
                  <strong style={{ color: "var(--mint)" }}>Extracted.</strong> Review the data below then apply.
                </div>
              )}
              {!loading && err && (
                <div className="text-[12.5px] text-[var(--coral)]">{err}</div>
              )}
              <div className="mt-2 flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>Replace…</button>
                <button className="btn btn-ghost btn-sm" onClick={reset}>Clear</button>
                {!loading && result && (
                  <button className="btn btn-mint btn-sm ml-auto" onClick={() => { onApply(result); }}>
                    <ICheck size={13} /> Apply to calculator
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px dashed var(--line)" }}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11.5px]">
              <Field label="Applicant" value={result.applicantName || "—"} />
              <Field label="Monthly income" value={result.monthlyIncome ? fmtAED(result.monthlyIncome) : "—"} />
              <Field label="Other income" value={result.otherIncome ? fmtAED(result.otherIncome) : "—"} />
              <Field label="Age" value={result.age != null ? `${result.age} yrs` : "—"} />
              <Field label="Employment" value={result.employmentType || "—"} />
              <Field label="Liabilities" value={result.liabilities?.length ? `${result.liabilities.length} found` : "none"} />
            </div>
            {result.liabilities && result.liabilities.length > 0 && (
              <div className="mt-2.5 overflow-x-auto">
                <table className="tbl" style={{ minWidth: 360 }}>
                  <thead>
                    <tr><th>Name</th><th>Type</th><th className="text-right">Limit / outstanding</th><th className="text-right">EMI</th></tr>
                  </thead>
                  <tbody>
                    {result.liabilities.map((l, i) => (
                      <tr key={i} style={{ cursor: "default" }}>
                        <td className="text-[12px]">{l.name || "—"}</td>
                        <td className="text-[12px]">{l.type}</td>
                        <td className="mono text-right text-[12px]">{l.limitOrOutstanding ? fmtAED(l.limitOrOutstanding) : "—"}</td>
                        <td className="mono text-right text-[12px]">{l.monthlyEmi ? fmtAED(l.monthlyEmi) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.notes && result.notes.length > 0 && (
              <div className="mt-3 rounded-md px-3 py-2 text-[11.5px]"
                style={{ background: "color-mix(in srgb, var(--amber) 8%, transparent)", border: "1px solid var(--amber-line)" }}>
                <div className="font-disp font-semibold mb-1" style={{ color: "var(--amber)" }}>⚠ AI extracted this — please verify</div>
                <ul className="m-0 pl-4 space-y-0.5" style={{ color: "var(--ink-dim)" }}>
                  {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md px-2.5 py-1.5" style={{ background: "var(--tint)" }}>
      <div className="text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">{label}</div>
      <div className="mono text-[12px] truncate" title={value}>{value}</div>
    </div>
  );
}

/* ------------------------------ MPBF headline card ------------------------------ */

function MpbfHeadline({ r, input }: { r: MortgageResult; input: MortgageInput }) {
  const mpbfDisplay = useCountUp(r.finalMpbf, 600);
  const caps = [
    { label: "DBR / Residual DBR MPBF", v: r.dbrMpbf },
    { label: "LTV MPBF", v: r.ltvMpbf },
    ...(r.multiplierCap != null ? [{ label: `Income multiplier (${input.multiplierX}×)`, v: r.multiplierCap }] : []),
    ...(r.requested > 0 ? [{ label: "Requested finance", v: r.requested }] : []),
  ];
  const capMax = Math.max(...caps.map((c) => c.v), 1);

  const limitedTone = r.limitedBy === "DBR / Income" ? "coral" : r.limitedBy === "LTV" ? "sky" : "amber";

  return (
    <div
      className="card p-5 anim-fade-up"
      style={{ borderColor: "var(--amber-line)", background: "linear-gradient(180deg, var(--amber-tint), var(--surface))", boxShadow: "var(--shadow)" }}
    >
      <div className="text-[10.5px] uppercase tracking-[0.14em] font-disp font-semibold" style={{ color: "var(--amber)" }}>Final MPBF</div>
      <div className="font-disp font-bold text-[34px] sm:text-[38px] leading-[1.05] tracking-tight mt-1 tabular-nums">{fmtAED(mpbfDisplay)}</div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <span className="text-[11.5px] text-[var(--ink-faint)]">limited by</span>
        <Chip tone={limitedTone}>{r.limitedBy}</Chip>
        {r.finalMpbf <= 0 && <Chip tone="coral">not eligible</Chip>}
      </div>

      {/* DBR gauge */}
      <div className="mt-4">
        <div className="flex justify-between text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1.5">
          <span>Debt burden</span><span>cap {fmtPct(r.maxDbr)}</span>
        </div>
        <div className="relative h-3 rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
          <div className="absolute inset-y-0 left-0 rounded-l-full transition-all duration-500"
            style={{ width: `${Math.min(r.currentDbr, 100)}%`, background: r.currentDbr > 50 ? "linear-gradient(90deg,#d95f4f,#f27363)" : "linear-gradient(90deg,#d99427,#f2b04c)" }} />
          {r.currentDbr < 50 && (
            <div className="absolute inset-y-0 transition-all duration-500"
              style={{ left: `${r.currentDbr}%`, width: `${50 - r.currentDbr}%`, background: "color-mix(in srgb, var(--mint) 38%, transparent)" }} />
          )}
          <div className="absolute inset-y-0 w-[2px]" style={{ left: "50%", background: "var(--ink)" }} />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2.5">
          <Stat label="Current DBR" value={fmtPct(r.currentDbr)} tone={r.currentDbr > 50 ? "var(--coral)" : undefined} />
          <Stat label="Maximum" value={fmtPct(r.maxDbr)} />
          <Stat label="Residual" value={fmtPct(r.residualDbr)} tone="var(--mint)" />
        </div>
      </div>

      {/* caps */}
      <div className="mt-4 space-y-2">
        {caps.map((c) => {
          const minV = Math.min(...caps.map((x) => x.v));
          const limiting = Math.abs(c.v - minV) < 1;
          return (
            <div key={c.label}>
              <div className="flex justify-between text-[11.5px] mb-1">
                <span className={limiting ? "text-[var(--ink)] font-semibold" : "text-[var(--ink-dim)]"}>
                  {c.label}{limiting && <span style={{ color: "var(--amber)" }}> ◂ binds</span>}
                </span>
                <span className="mono">{fmtAED(c.v)}</span>
              </div>
              <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${(c.v / capMax) * 100}%`, background: limiting ? "var(--amber)" : "var(--slate)" }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-4 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
        <Stat label="Required down payment" value={fmtAED(r.downPayment)} />
        <Stat label="Actual LTV" value={fmtPct(r.actualLtv)} />
        <Stat label="DBR after mortgage" value={fmtPct(r.dbrAfter)} tone={r.dbrAfter > 50 ? "var(--coral)" : "var(--mint)"} />
        <Stat label="EMI at actual rate" value={`${fmtAED(r.newEmi)}/mo`} />
      </div>
    </div>
  );
}

/* ------------------------------ key metrics grid ------------------------------ */

function KeyMetrics({ r }: { r: MortgageResult }) {
  return (
    <div className="card p-4 anim-fade-up">
      <h3 className="font-disp font-semibold text-[13.5px] m-0 mb-3">Key metrics</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
        <Stat label="Eligible income" value={`${fmtAED(r.eligibleIncome)}/mo`} tone="var(--mint)" />
        <Stat label="Existing EMIs" value={`${fmtAED(r.existingEmis)}/mo`} tone="var(--coral)" />
        <Stat label="Available EMI" value={`${fmtAED(r.availableEmi)}/mo`} />
        <Stat label="Assessment rate" value={fmtPct(r.assessmentRate)} tone="var(--amber)" />
        <Stat label="Max usable tenor" value={tenorLabel(r.maxTenorMonths)} tone="var(--amber)" />
        <Stat label="Calc basis" value={fmtAED(r.calcBasis)} />
      </div>
      {r.tenorLimitedBy && (
        <p className="text-[11.5px] text-[var(--ink-faint)] mt-3 mb-0">
          Tenor limited by{" "}
          <strong style={{ color: r.tenorLimitedBy === "co-borrower" ? "var(--coral)" : "var(--amber)" }}>
            {r.tenorLimitedBy === "co-borrower" ? `co-borrower's age (${r.coAgeYears}y)` : r.tenorLimitedBy}
          </strong>.
        </p>
      )}
    </div>
  );
}

/* ------------------------------ trail + notes ------------------------------ */

function TrailAndNotes({ r }: { r: MortgageResult }) {
  return (
    <div className="card p-4 anim-fade-up">
      <h3 className="font-disp font-semibold text-[13.5px] m-0 mb-2.5">Calculation trail</h3>
      <ol className="space-y-1.5 m-0 p-0 list-none">
        {r.trail.map((t, i) => (
          <li key={i} className="mono text-[11px] leading-relaxed text-[var(--ink-dim)] flex gap-2">
            <span className="text-[var(--ink-faint)] shrink-0">{String(i + 1).padStart(2, "0")}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
      {r.notes.length > 0 && (
        <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: "1px dashed var(--line)" }}>
          <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold" style={{ color: "var(--amber)" }}>Notes & flags</div>
          {r.notes.map((n, i) => (
            <p key={i} className="text-[11.5px] m-0 leading-relaxed" style={{ color: "var(--amber)" }}>⚑ {n}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ main view ------------------------------ */

type WhifTab = "liab" | "rate" | "tenor" | "income";

type CalcMode = "affordability" | "transfer";

export default function Calculator() {
  const { me, toast, nav, feeRules, docRules } = useHfmcStore();
  const [mode, setMode] = useState<CalcMode>("affordability");
  const [input, setInput] = useState<MortgageInput>(defaultInput);
  const [whif, setWhif] = useState<WhifTab>("liab");
  const [cardId, setCardId] = useState("");
  const [cardLimit, setCardLimit] = useState("");
  const [manualRate, setManualRate] = useState("");
  const [manualTenor, setManualTenor] = useState("");
  const [extraIncome, setExtraIncome] = useState("");

  const up = (patch: Partial<MortgageInput>) => setInput((p) => ({ ...p, ...patch }));
  const r = useMemo(() => computeMortgage(input), [input]);

  const setEmployment = (emp: string) => {
    const employment = (emp === "Self-Employed" ? "Self-Employed" : "Salaried") as Employment;
    const pool = employment === "Self-Employed" ? SE_SOURCES : SALARIED_SOURCES;
    setInput((p) => ({
      ...p, employment,
      incomes: p.incomes.map((row) =>
        pool.includes(row.source) ? row
          : { ...row, source: pool[0], eligiblePct: employment === "Self-Employed" && pool[0] === "Business Income" ? 70 : 100 }
      ),
    }));
  };

  const patchIncome = (id: string, patch: Partial<IncomeRow>) =>
    setInput((p) => ({ ...p, incomes: p.incomes.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const patchLiab = (id: string, patch: Partial<LiabRow>) =>
    setInput((p) => ({ ...p, liabilities: p.liabilities.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  const patchCoIncome = (id: string, patch: Partial<IncomeRow>) =>
    setInput((p) => p.coBorrower ? { ...p, coBorrower: { ...p.coBorrower, incomes: p.coBorrower.incomes.map((x) => (x.id === id ? { ...x, ...patch } : x)) } } : p);
  const patchCoLiab = (id: string, patch: Partial<LiabRow>) =>
    setInput((p) => p.coBorrower ? { ...p, coBorrower: { ...p.coBorrower, liabilities: p.coBorrower.liabilities.map((x) => (x.id === id ? { ...x, ...patch } : x)) } } : p);

  const defaultLtv = defaultLtvPct(input.applicantType);
  const isCustomLtv = input.customLtv.trim() !== "" && !Number.isNaN(parseFloat(input.customLtv));
  const sourcePool = input.employment === "Self-Employed" ? SE_SOURCES : SALARIED_SOURCES;
  const cards = input.liabilities.filter((l) => l.type === "Credit Card");

  /* ---------------- scenarios ---------------- */
  const liabScenarios = useMemo(() => {
    const rows: { label: string; input: MortgageInput }[] = [];
    if (cards.length) {
      rows.push({ label: "Credit cards −25%", input: scenarioCardsPct(input, 0.75) });
      rows.push({ label: "Credit cards −50%", input: scenarioCardsPct(input, 0.5) });
      rows.push({ label: "Credit cards +25%", input: scenarioCardsPct(input, 1.25) });
      rows.push({ label: "Credit cards removed", input: scenarioRemoveCards(input) });
      const lim = Number(cardLimit);
      if (lim > 0) rows.push({ label: `Card limit → ${fmtAED(lim)}`, input: scenarioCardNewLimit(input, cardId || cards[0].id, lim) });
    }
    for (const l of input.liabilities.filter((x) => x.type !== "Credit Card"))
      rows.push({ label: `Remove ${l.name || l.type}`, input: scenarioRemoveLiab(input, l.id) });
    return rows;
  }, [input, cardId, cardLimit, cards.length]);

  const rateScenarios = useMemo(() => {
    const base = input.actualRate + input.loadFactor;
    const rows = [
      { label: "Stress −0.5%", input: scenarioRate(input, base - 0.5) },
      { label: "Stress +0.5%", input: scenarioRate(input, base + 0.5) },
      { label: "Stress +1.0%", input: scenarioRate(input, base + 1) },
      { label: "Stress +2.0%", input: scenarioRate(input, base + 2) },
    ];
    const m = Number(manualRate);
    if (m > 0) rows.push({ label: `Manual ${m.toFixed(2)}%`, input: scenarioRate(input, m) });
    return rows;
  }, [input, manualRate]);

  const tenorScenarios = useMemo(() => {
    const rows = [
      { label: "Tenor −24 months", input: scenarioTenor(input, Math.max(12, r.maxTenorMonths - 24)) },
      { label: "Tenor +24 months", input: scenarioTenor(input, r.maxTenorMonths + 24) },
      { label: "15 years", input: scenarioTenor(input, 15 * 12) },
      { label: "20 years", input: scenarioTenor(input, 20 * 12) },
      { label: "25 years", input: scenarioTenor(input, 25 * 12) },
    ];
    const m = Number(manualTenor);
    if (m > 0) rows.push({ label: `Manual ${m} months`, input: scenarioTenor(input, m) });
    return rows;
  }, [input, r.maxTenorMonths, manualTenor]);

  const incomeScenarios = useMemo(() => {
    const rows: { label: string; input: MortgageInput }[] = [];
    for (const row of input.incomes) {
      rows.push({ label: `Remove ${row.source}`, input: scenarioIncomeRemove(input, row.id) });
      rows.push({ label: `${row.source} −25%`, input: scenarioIncomePct(input, row.id, 0.75) });
    }
    const extra = Number(extraIncome);
    if (extra > 0) {
      const c = cloneInput(input);
      c.incomes = [...c.incomes, { ...newIncomeRow("Other Income"), amount: extra }];
      rows.push({ label: `Add allowance ${fmtAED(extra)}/mo`, input: c });
    }
    return rows;
  }, [input, extraIncome]);

  const baseRow = { label: "Current (baseline)", dbr: r.currentDbr, residual: r.residualDbr, mpbf: r.finalMpbf };
  const liabRows    = [baseRow, ...scenarioTable(input, liabScenarios)];
  const rateRows    = [{ label: `Current · ${fmtPct(r.assessmentRate)}`, dbr: r.currentDbr, residual: r.residualDbr, mpbf: r.finalMpbf }, ...scenarioTable(input, rateScenarios)];
  const tenorRows   = [{ label: `Current · ${tenorLabel(r.maxTenorMonths)}`, dbr: r.currentDbr, residual: r.residualDbr, mpbf: r.finalMpbf }, ...scenarioTable(input, tenorScenarios)];
  const incomeRows  = [baseRow, ...scenarioTable(input, incomeScenarios)];

  /* ---------------- actions ---------------- */
  const onSave = async () => {
    const aff: AffordabilityInput = {
      monthlyIncome: r.ownIncome,
      otherIncome: 0,
      existingEmis: r.ownEmis,
      age: r.ageNowYears,
      employmentType: input.employment,
      propertyValue: input.propertyValue,
      bank: "",
      interestRate: input.actualRate,
      tenureYears: Math.floor(r.maxTenorMonths / 12),
    };
    try {
      const res = await fetch("/api/calculator/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: aff, caseId: null, customerName: input.name || "Unnamed applicant" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("success", "Check saved to the audit trail.");
    } catch (e) {
      toast("error", "Could not save check: " + (e instanceof Error ? e.message : "unknown"));
    }
  };

  const onNewCase = () => {
    toast("info", "Use New case to open a file for this client.");
    nav({ name: "dashboard" });
  };

  /* ---------------- apply AI doc-read result ---------------- */
  const applyDocRead = (data: ExtractedData) => {
    setInput((p) => {
      const next = { ...p };
      if (data.applicantName) next.name = data.applicantName;
      if (data.employmentType) next.employment = data.employmentType;
      if (data.age != null && data.age > 0) {
        const y = new Date().getFullYear() - Math.floor(data.age);
        next.dob = `${y}-01-15`;
      }
      // Replace income rows with extracted ones (keep existing if zero extracted)
      const newIncomes: IncomeRow[] = [];
      if (data.monthlyIncome && data.monthlyIncome > 0) {
        newIncomes.push({ ...newIncomeRow("Basic Salary", next.employment), amount: data.monthlyIncome });
      }
      if (data.otherIncome && data.otherIncome > 0) {
        newIncomes.push({ ...newIncomeRow("Other Allowance", next.employment), amount: data.otherIncome });
      }
      if (newIncomes.length) next.incomes = newIncomes;
      // Map liabilities (merge with existing — don't wipe user-entered ones)
      if (data.liabilities && data.liabilities.length) {
        const mapped: LiabRow[] = data.liabilities.map((l) => {
          const t = (LIAB_TYPES.includes(l.type as LiabType) ? l.type : "Other Loan") as LiabType;
          const row = newLiabRow(t);
          return {
            ...row,
            name: l.name || t,
            limitOrOutstanding: l.limitOrOutstanding || 0,
            monthlyEmi: l.monthlyEmi || 0,
            method: t === "Credit Card" ? "5% of Limit" : "Actual EMI" as LiabMethod,
          };
        });
        next.liabilities = [...p.liabilities, ...mapped];
      }
      return next;
    });
    toast("success", "AI-extracted data applied — please verify each figure.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* ---------------- render ---------------- */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0 flex items-center gap-2.5">
            <ICalc size={22} className="text-[var(--amber)]" /> Mortgage Calculator
          </h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            {mode === "affordability"
              ? <>Preliminary MPBF assessment · CBUAE-style DBR {fmtPct(MAX_DBR)} cap · <em>not</em> a bank approval</>
              : <>Cash needed at transfer · SOP §6.9 fee matrices · editable in Admin → Fee rules</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleChips
            options={["Affordability", "Transfer Fees"]}
            value={mode === "affordability" ? "Affordability" : "Transfer Fees"}
            onChange={(v) => setMode(v === "Transfer Fees" ? "transfer" : "affordability")}
          />
          {mode === "affordability" && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setInput(defaultInput()); toast("info", "Calculator reset."); }}>
              Reset
            </button>
          )}
        </div>
      </div>

      {mode === "transfer" ? (
        <TransferFees feeRules={feeRules} docRules={docRules} />
      ) : (
      <>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4 items-start">
        {/* ================= input column ================= */}
        <div className="space-y-4 xl:sticky xl:top-[86px] xl:self-start xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto xl:pr-1 xl:-mr-1 xl:scrollbar-thin">
          <Section num="01" title="Applicant" hint="age sets the usable tenor">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Applicant name</label>
                <input className="input" value={input.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. Mohammed Al Mansoori" />
              </div>
              <div>
                <label className="label">WhatsApp</label>
                <input className="input mono" value={input.whatsapp} onChange={(e) => up({ whatsapp: e.target.value })} placeholder="+971 50 …" />
              </div>
              <div>
                <label className="label">Applicant type</label>
                <ToggleChips options={["Expatriate", "UAE National"]} value={input.applicantType} onChange={(v) => up({ applicantType: v as MortgageInput["applicantType"] })} />
              </div>
              <div>
                <label className="label">Employment</label>
                <ToggleChips options={["Salaried", "Self-Employed"]} value={input.employment} onChange={setEmployment} />
              </div>
              <div>
                <label className="label">Date of birth</label>
                <input className="input mono" type="date" value={input.dob} onChange={(e) => e.target.value && up({ dob: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Final age</label>
                  <NumIn value={input.finalAge} onChange={(n) => up({ finalAge: n })} step={1} min={40} />
                </div>
                <div>
                  <label className="label">Margin (mo)</label>
                  <NumIn value={input.marginMonths} onChange={(n) => up({ marginMonths: n })} step={1} min={0} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3.5 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
              <Stat label="Current age" value={`${r.ageNowYears}y`} />
              <Stat label="After margin" value={`${Math.floor(r.ageAfterMarginMonths / 12)}y ${r.ageAfterMarginMonths % 12}m`} />
              <Stat label="Remaining period" value={tenorLabel(r.remainingMonths)} />
              <Stat label="Max usable tenor" value={tenorLabel(r.maxTenorMonths)} tone="var(--amber)" />
            </div>
          </Section>

          <Section num="02" title="Property & finance" hint="only what the calculation needs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Property value (AED)</label>
                <NumIn value={input.propertyValue} onChange={(n) => up({ propertyValue: n })} step={50000} />
              </div>
              <div>
                <label className="label">Bank valuation — optional</label>
                <input className="input mono" type="number" min={0} step={50000} value={input.valuation ?? ""} placeholder="blank if not available"
                  onChange={(e) => up({ valuation: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="label">Requested finance (AED)</label>
                <NumIn value={input.requested} onChange={(n) => up({ requested: n })} step={50000} />
              </div>
            </div>

            <div className="mt-3">
              <label className="label">
                LTV applied — default {defaultLtv}% for {input.applicantType}
                {isCustomLtv && <span style={{ color: "var(--amber)" }}> · using custom {parseFloat(input.customLtv)}%</span>}
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" className="chip transition-all"
                  style={input.ltvPctChoice == null && !isCustomLtv ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                  onClick={() => up({ ltvPctChoice: null, customLtv: "" })}>
                  Default {defaultLtv}%
                </button>
                {LTV_CHOICES.map((v) => (
                  <button key={v} type="button" className="chip transition-all"
                    style={input.ltvPctChoice === v && !isCustomLtv ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                    onClick={() => up({ ltvPctChoice: v, customLtv: "" })}>
                    {v}%
                  </button>
                ))}
                <span className="flex items-center gap-1.5 px-2 py-1 rounded-lg border" style={{ borderColor: isCustomLtv ? "var(--amber)" : "var(--line)", background: "var(--bg2)" }}>
                  <input className="mono text-[12px] bg-transparent outline-none" style={{ width: 40 }} type="number" min={1} max={95} step={1}
                    placeholder="custom" value={input.customLtv} onChange={(e) => up({ customLtv: e.target.value })} />
                  <span className="text-[11px]" style={{ color: isCustomLtv ? "var(--amber)" : "var(--ink-faint)" }}>%</span>
                </span>
              </div>
            </div>

            <p className="text-[12px] text-[var(--ink-dim)] mt-3 mb-0 rounded-lg px-3 py-2" style={{ background: "var(--tint)" }}>
              Calculation basis: <strong className="mono">{fmtAED(r.calcBasis)}</strong>
              <span className="text-[var(--ink-faint)]"> — {r.basisLabel}. LTV {r.ltvPct}% for {input.applicantType}.</span>
            </p>
          </Section>

          <Section num="03" title="Income" hint={input.employment === "Self-Employed" ? "self-employed basis" : "all sources → monthly equivalent"}>
            <div className="space-y-2">
              {input.incomes.map((row) => (
                <IncomeRowEditor key={row.id} row={row} sourcePool={sourcePool} tone="mint"
                  onChange={(p) => patchIncome(row.id, p)}
                  onRemove={() => setInput((p) => ({ ...p, incomes: p.incomes.filter((x) => x.id !== row.id) }))} />
              ))}
            </div>
            <div className="flex items-center justify-between mt-3">
              <button className="btn btn-ghost btn-sm"
                onClick={() => setInput((p) => ({ ...p, incomes: [...p.incomes, newIncomeRow(sourcePool[Math.min(p.incomes.length, sourcePool.length - 1)], input.employment)] }))}>
                <IPlus size={13} /> Add income
              </button>
              <div className="text-[12.5px]">
                Eligible monthly income{input.coBorrower ? " (combined)" : ""}{" "}
                <strong className="mono text-[15px]" style={{ color: "var(--mint)" }}>{fmtAED(r.eligibleIncome)}</strong>
              </div>
            </div>

            {/* Co-borrower — calculation only, never written to a case */}
            <div
              className="mt-4 rounded-lg p-3.5 transition-colors"
              style={{
                border: input.coBorrower ? "1px solid color-mix(in srgb, var(--sky) 35%, transparent)" : "1px dashed var(--line)",
                background: input.coBorrower ? "color-mix(in srgb, var(--sky) 6%, transparent)" : "transparent",
              }}
            >
              {!input.coBorrower ? (
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  up({ coBorrower: { name: "", dob: "1992-01-15", incomes: [newIncomeRow(sourcePool[0], input.employment)], liabilities: [] } });
                }}>
                  <IUsers size={13} /> Add co-borrower (if applicable)
                </button>
              ) : (
                <div className="anim-fade-in">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[11px] uppercase tracking-[0.12em] font-disp font-semibold" style={{ color: "var(--sky)" }}>
                      Co-borrower · combined for DBR · age limits the tenor
                    </span>
                    <button className="text-[var(--ink-faint)] hover:text-[var(--coral)] transition-colors" title="Remove co-borrower"
                      onClick={() => up({ coBorrower: null })}>
                      <ITrash size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px_110px] gap-2 mb-2">
                    <div>
                      <label className="label">Co-borrower name</label>
                      <input className="input" placeholder="Shown on the report only" value={input.coBorrower.name}
                        onChange={(e) => up({ coBorrower: { ...input.coBorrower!, name: e.target.value } })} />
                    </div>
                    <div>
                      <label className="label">Date of birth</label>
                      <input className="input mono" type="date" value={input.coBorrower.dob}
                        onChange={(e) => e.target.value && up({ coBorrower: { ...input.coBorrower!, dob: e.target.value } })} />
                    </div>
                    <div>
                      <label className="label">Age now</label>
                      <div className="mono text-[15px] font-semibold pt-1.5" style={{ color: r.tenorLimitedBy === "co-borrower" ? "var(--coral)" : "var(--ink-dim)" }}>
                        {r.coAgeYears} yrs{r.tenorLimitedBy === "co-borrower" && " ◂ caps tenor"}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {input.coBorrower.incomes.map((row) => (
                      <IncomeRowEditor key={row.id} row={row} sourcePool={sourcePool} tone="sky"
                        onChange={(p) => patchCoIncome(row.id, p)}
                        onRemove={() => setInput((p) => p.coBorrower ? { ...p, coBorrower: { ...p.coBorrower, incomes: p.coBorrower.incomes.filter((x) => x.id !== row.id) } } : p)} />
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2.5">
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setInput((p) => p.coBorrower ? { ...p, coBorrower: { ...p.coBorrower, incomes: [...p.coBorrower.incomes, newIncomeRow(sourcePool[Math.min(p.coBorrower.incomes.length, sourcePool.length - 1)], input.employment)] } } : p)}>
                      <IPlus size={13} /> Add co-borrower income
                    </button>
                    <div className="text-[12.5px]">
                      Co-borrower income <strong className="mono text-[14px]" style={{ color: "var(--sky)" }}>{fmtAED(r.coIncome)}</strong>/mo
                    </div>
                  </div>

                  <div className="mt-3 pt-3" style={{ borderTop: "1px dashed color-mix(in srgb, var(--sky) 30%, transparent)" }}>
                    <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold mb-2" style={{ color: "var(--sky)" }}>
                      Their liabilities
                    </div>
                    {input.coBorrower.liabilities.length === 0 && (
                      <p className="text-[12px] text-[var(--ink-faint)] m-0 mb-2">No liabilities declared for the co-borrower.</p>
                    )}
                    <div className="space-y-2">
                      {input.coBorrower.liabilities.map((l) => (
                        <LiabRowEditor key={l.id} row={l}
                          onChange={(p) => patchCoLiab(l.id, p)}
                          onRemove={() => setInput((p) => p.coBorrower ? { ...p, coBorrower: { ...p.coBorrower, liabilities: p.coBorrower.liabilities.filter((x) => x.id !== l.id) } } : p)} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-2.5">
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setInput((p) => p.coBorrower ? { ...p, coBorrower: { ...p.coBorrower, liabilities: [...p.coBorrower.liabilities, newLiabRow()] } } : p)}>
                        <IPlus size={13} /> Add co-borrower liability
                      </button>
                      <div className="text-[12.5px]">
                        Co-borrower EMIs <strong className="mono text-[14px]" style={{ color: "var(--coral)" }}>{fmtAED(r.coEmis)}</strong>/mo
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-[var(--ink-faint)] mt-2.5 mb-0">
                    Income, liabilities and age are combined into the eligibility calculation only — the co-borrower is never written to the case file.
                  </p>
                </div>
              )}
            </div>
          </Section>

          <Section num="04" title="Liabilities" hint="credit cards assess at 5% of limit by default">
            {input.liabilities.length === 0 && (
              <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No liabilities declared — the full DBR headroom is available.</p>
            )}
            <div className="space-y-2">
              {input.liabilities.map((l) => (
                <LiabRowEditor key={l.id} row={l}
                  onChange={(p) => patchLiab(l.id, p)}
                  onRemove={() => setInput((p) => ({ ...p, liabilities: p.liabilities.filter((x) => x.id !== l.id) }))} />
              ))}
            </div>
            <div className="flex items-center justify-between mt-3">
              <button className="btn btn-ghost btn-sm" onClick={() => setInput((p) => ({ ...p, liabilities: [...p.liabilities, newLiabRow()] }))}>
                <IPlus size={13} /> Add liability
              </button>
              <div className="text-[12.5px]">
                Existing EMIs <strong className="mono text-[15px]" style={{ color: "var(--coral)" }}>{fmtAED(r.existingEmis)}</strong>
              </div>
            </div>
          </Section>

          <Section num="05" title="Rate & stress" hint="assessment rate drives the DBR MPBF">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Actual / contract rate %</label>
                <input className="input mono" type="number" step={0.05} min={0} value={input.actualRate}
                  onChange={(e) => up({ actualRate: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="label">Load factor</label>
                <div className="flex gap-1.5 flex-wrap">
                  {[1.5, 2, 3, 4].map((l) => (
                    <button key={l} type="button" className="chip transition-all"
                      style={input.loadFactor === l && input.stressOverride == null ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                      onClick={() => up({ loadFactor: l, stressOverride: null })}>
                      +{l}%
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Manual stress rate — optional</label>
                <input className="input mono" type="number" step={0.05} min={0} value={input.stressOverride ?? ""} placeholder={`auto: ${fmtPct(input.actualRate + input.loadFactor)}`}
                  onChange={(e) => up({ stressOverride: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-3.5 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
              <Stat label="Assessment rate" value={fmtPct(r.assessmentRate)} tone="var(--amber)" />
              <div>
                <label className="label">Income multiplier cap</label>
                <select className="select" style={{ width: 130 }} value={input.multiplierX} onChange={(e) => up({ multiplierX: Number(e.target.value) })}>
                  <option value={0}>Off</option>
                  {[5, 6, 7, 8].map((x) => <option key={x} value={x}>{x}× annual</option>)}
                </select>
              </div>
              <div>
                <label className="label">Tenor override (mo)</label>
                <input className="input mono" type="number" min={12} step={12} value={input.tenorOverrideMonths ?? ""} placeholder="auto (age)"
                  onChange={(e) => up({ tenorOverrideMonths: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
              </div>
              <Stat label="Tenor used" value={tenorLabel(r.maxTenorMonths)} />
            </div>
          </Section>
        </div>

        {/* ================= results column ================= */}
        <div className="space-y-4">
          <MpbfHeadline r={r} input={input} />

          <KeyMetrics r={r} />

          <TrailAndNotes r={r} />

          {/* save / new case actions */}
          <div className="card p-4 anim-fade-up flex flex-col gap-2">
            <button className="btn btn-mint justify-center" onClick={onSave}>
              <IDownload size={15} /> Save check to audit trail
            </button>
            <button className="btn btn-ghost justify-center" onClick={onNewCase}>
              <IBank size={15} /> New case from this
            </button>
            <p className="text-[10.5px] text-[var(--ink-faint)] text-center m-0">
              Saving only stores the check for audit — a case is created from the dashboard.
            </p>
          </div>

          {/* AI advisor */}
          <AdvisorPanel input={input} r={r} />

          {/* AI document reader */}
          <DocReaderPanel onApply={applyDocRead} />
        </div>
      </div>

      {/* ================= what-if scenarios ================= */}
      <div className="card anim-fade-up">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <h3 className="font-disp font-semibold text-[14px] m-0">What-if analysis</h3>
          <span className="text-[11.5px] text-[var(--ink-faint)] hidden sm:inline">each row re-runs the full MPBF calc with one input changed</span>
          <div className="flex gap-1.5 ml-auto flex-wrap">
            {([["liab", "Liabilities"], ["rate", "Rate"], ["tenor", "Tenor"], ["income", "Income"]] as [WhifTab, string][]).map(([k, l]) => (
              <button key={k} className="chip transition-all"
                style={whif === k ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                onClick={() => setWhif(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4">
          {whif === "liab" && (
            <div>
              <div className="flex flex-wrap gap-2 mb-3">
                {cards.length > 0 && (
                  <>
                    <select className="select" style={{ width: 200 }} value={cardId || cards[0].id} onChange={(e) => setCardId(e.target.value)}>
                      {cards.map((c) => <option key={c.id} value={c.id}>{c.name || "Credit Card"} · {fmtAED(c.limitOrOutstanding)}</option>)}
                    </select>
                    <input className="input mono" style={{ width: 170 }} type="number" min={0} step={1000} placeholder="new limit →" value={cardLimit} onChange={(e) => setCardLimit(e.target.value)} />
                  </>
                )}
              </div>
              {liabScenarios.length === 0 ? (
                <p className="text-[12.5px] text-[var(--ink-faint)] m-0">Add liabilities above to model reductions and removals.</p>
              ) : (
                <ScenarioTable rows={liabRows} base={r.finalMpbf} />
              )}
            </div>
          )}

          {whif === "rate" && (
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[12px] text-[var(--ink-faint)]">Manual assessment rate:</span>
                <input className="input mono" style={{ width: 130 }} type="number" min={0} step={0.05} placeholder="e.g. 6.50" value={manualRate} onChange={(e) => setManualRate(e.target.value)} />
              </div>
              <ScenarioTable rows={rateRows} base={r.finalMpbf} />
            </div>
          )}

          {whif === "tenor" && (
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[12px] text-[var(--ink-faint)]">Manual tenor (months):</span>
                <input className="input mono" style={{ width: 130 }} type="number" min={12} step={12} placeholder="e.g. 178" value={manualTenor} onChange={(e) => setManualTenor(e.target.value)} />
              </div>
              <ScenarioTable rows={tenorRows} base={r.finalMpbf} />
            </div>
          )}

          {whif === "income" && (
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[12px] text-[var(--ink-faint)]">Hypothetical extra allowance (AED/mo):</span>
                <input className="input mono" style={{ width: 150 }} type="number" min={0} step={500} placeholder="e.g. 3000" value={extraIncome} onChange={(e) => setExtraIncome(e.target.value)} />
              </div>
              <ScenarioTable rows={incomeRows} base={r.finalMpbf} />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11.5px] text-[var(--ink-faint)] px-1">
        {me && <Avatar name={me.name} size={20} />}
        <span>Prepared by {me?.name ?? "—"} · figures follow CBUAE-style limits ({fmtPct(MAX_DBR)} DBR, {input.applicantType} LTV bands, 25y max tenor) — lender policy may differ.</span>
      </div>
      </>
      )}
    </div>
  );
}

/* ------------------------------ transfer fees (SOP §6.9) ------------------------------ */

const FEE_EMIRATES = ["Dubai", "Abu Dhabi"] as const;
const FEE_TXNS = ["Primary", "Resale", "Buyout"] as const;

function TransferFees({ feeRules, docRules }: { feeRules: FeeRule[]; docRules: DocRule[] }) {
  const [emirate, setEmirate] = useState<(typeof FEE_EMIRATES)[number]>("Dubai");
  const [txn, setTxn] = useState<(typeof FEE_TXNS)[number]>("Primary");
  const [propertyValue, setPropertyValue] = useState(2500000);
  const [finance, setFinance] = useState(2000000);

  const rows = feeRules
    .filter((f) => f.active && f.emirate === emirate && f.txnType === txn)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  const feeOf = (f: FeeRule) =>
    f.amountType === "fixed" ? f.amount
    : f.amountType === "pct_property" ? (propertyValue * f.amount) / 100
    : (finance * f.amount) / 100;

  const clientRows = rows.filter((f) => f.paidBy !== "Seller");
  const sellerRows = rows.filter((f) => f.paidBy === "Seller");
  const clientFees = clientRows.reduce((s, f) => s + feeOf(f), 0);
  const equity = Math.max(propertyValue - finance, 0);
  const totalCash = equity + clientFees;
  const ltv = propertyValue > 0 ? (finance / propertyValue) * 100 : 0;

  const activeDocs = docRules.filter((d) => d.active);

  return (
    <div className="space-y-4">
      <Section num="01" title="Deal shape" hint="fees recalculate instantly">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Emirate</label>
            <ToggleChips options={[...FEE_EMIRATES]} value={emirate} onChange={(v) => setEmirate(v as (typeof FEE_EMIRATES)[number])} />
          </div>
          <div>
            <label className="label">Transaction type</label>
            <ToggleChips options={[...FEE_TXNS]} value={txn} onChange={(v) => setTxn(v as (typeof FEE_TXNS)[number])} />
          </div>
          <div>
            <label className="label">Property value (AED)</label>
            <NumIn value={propertyValue} onChange={setPropertyValue} min={0} step={50000} />
          </div>
          <div>
            <label className="label">Finance amount (AED)</label>
            <NumIn value={finance} onChange={setFinance} min={0} step={50000} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5 mt-4 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
          <Stat label="LTV" value={fmtPct(ltv)} tone={ltv > 85 ? "var(--coral)" : undefined} />
          <Stat label="Equity / self contribution" value={fmtAED(equity)} />
          <Stat label="Client-paid fees" value={fmtAED(clientFees)} tone="var(--amber)" />
          <Stat label="Gross cash needed" value={fmtAED(totalCash)} tone="var(--mint)" />
        </div>
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 items-start">
        <div className="card anim-fade-up overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
            <h3 className="font-disp font-semibold text-[13.5px] m-0">{emirate} · {txn === "Buyout" ? "Buyout / Equity Release" : txn}</h3>
            <span className="text-[11px] text-[var(--ink-faint)] ml-auto">managed in Admin → Fee rules</span>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl min-w-[560px]">
              <thead>
                <tr><th>Charge</th><th className="text-right">Amount</th><th>Payment</th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={3} className="text-[12.5px] text-[var(--ink-faint)] py-4">No fee rules for this emirate / transaction type yet — add them in Admin → Fee rules.</td></tr>
                )}
                {clientRows.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <span className="font-medium">{f.label}</span>
                      {f.note && <span className="block text-[10.5px] text-[var(--ink-faint)]">{f.note}</span>}
                    </td>
                    <td className="mono text-right">{fmtAED(feeOf(f))}</td>
                    <td><Chip tone="slate">{f.paidBy}</Chip></td>
                  </tr>
                ))}
                {sellerRows.length > 0 && (
                  <tr>
                    <td colSpan={3} className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] pt-3">Seller-side · not in client total</td>
                  </tr>
                )}
                {sellerRows.map((f) => (
                  <tr key={f.id} style={{ opacity: 0.65 }}>
                    <td>
                      <span className="font-medium">{f.label}</span>
                      {f.note && <span className="block text-[10.5px] text-[var(--ink-faint)]">{f.note}</span>}
                    </td>
                    <td className="mono text-right">{fmtAED(feeOf(f))}</td>
                    <td><Chip tone="sky">{f.paidBy}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t text-[11.5px] text-[var(--ink-faint)] flex items-center gap-2" style={{ borderColor: "var(--line-soft)" }}>
            Equity {fmtAED(equity)} + client-paid fees {fmtAED(clientFees)} = <strong className="mono" style={{ color: "var(--amber)" }}>{fmtAED(totalCash)}</strong> gross cash needed
          </div>
        </div>

        <div className="card p-4 anim-fade-up">
          <h3 className="font-disp font-semibold text-[13.5px] mt-0 mb-1">Document validity reference</h3>
          <p className="text-[11.5px] text-[var(--ink-faint)] mt-0 mb-3">SOP §8.2 — managed in Admin → Doc Validity.</p>
          <div className="space-y-2 max-h-[52vh] overflow-y-auto scrollbar-thin">
            {activeDocs.length === 0 && <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No document rules yet.</p>}
            {activeDocs.map((d) => (
              <div key={d.id} className="rounded-lg px-3 py-2" style={{ background: "var(--tint)" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-medium flex-1 truncate">{d.name}</span>
                  <Chip tone="slate">{d.category}</Chip>
                  {d.validityDays > 0 ? (
                    <span className="mono text-[11px] font-semibold" style={{ color: "var(--amber)" }}>{d.validityDays}d</span>
                  ) : (
                    <span className="text-[10.5px] text-[var(--ink-faint)]">no fixed validity</span>
                  )}
                </div>
                {d.verifyNotes && <p className="text-[11px] text-[var(--ink-dim)] mt-1 mb-0 leading-snug">{d.verifyNotes}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
