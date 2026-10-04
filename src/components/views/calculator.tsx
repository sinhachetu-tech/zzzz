"use client";

/* HFMC Mortgage Eligibility Calculator — CBUAE-style MPBF engine
   with AI Mortgage Advisor + AI Document Reader.
   The flagship view. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { parsePricing, resolveQuote, rateSchedule } from "@/lib/bank-pricing";
import {
  FREQUENCIES, LIAB_METHODS, LIAB_TYPES, LTV_CHOICES,
  SALARIED_SOURCES, SE_SOURCES,
  cloneInput, computeMortgage, defaultInput, blankInput, defaultLtvPct,
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
import { buildPrintModel } from "@/lib/calc-print-model";
import { todayISO } from "@/lib/format";
import { Avatar, Chip } from "@/components/hfmc/ui";
import { useCountUp, Dial } from "@/components/hfmc/charts";
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
  // a stored 0 renders empty so typing replaces it (no "0500000" fighting)
  return (
    <input className="input mono" type="number" min={min} step={step} value={Number.isFinite(value) && value !== 0 ? value : ""} placeholder={placeholder ?? "0"}
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
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-disp font-semibold">Assessed</div>
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
  rows: { label: string; dbr: number; residual: number; maxEligible: number; dbr1: number; dbr2: number; dbr3: number }[];
  base: number;
}) {
  const delta = (v: number): ReactNode => {
    const d = v - base;
    if (Math.abs(d) < 1) return <span className="text-[var(--ink-faint)]">—</span>;
    return <span style={{ color: d > 0 ? "var(--mint)" : "var(--coral)" }}>{d > 0 ? "+" : "−"}{fmtAED(Math.abs(d))}</span>;
  };
  return (
    <div className="rf-scroll rf-scroll-x">
      <table className="tbl" style={{ minWidth: 800 }}>
        <thead>
          <tr>
            <th>Scenario</th>
            <th className="text-right">Current DBR</th>
            <th className="text-right">Residual</th>
            <th className="text-right">Req. DBR 1</th>
            <th className="text-right">Req. DBR 2</th>
            <th className="text-right">Req. DBR 3</th>
            <th className="text-right">Max finance</th>
            <th className="text-right">Δ vs base</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} style={{ cursor: "default" }}>
              <td className="text-[12.5px]">{r.label}</td>
              <td className="mono text-right text-[12.5px]">{fmtPct(r.dbr)}</td>
              <td className="mono text-right text-[12.5px]">{fmtPct(r.residual)}</td>
              <td className="mono text-right text-[12.5px]">{fmtPct(r.dbr1)}</td>
              <td className="mono text-right text-[12.5px]">{fmtPct(r.dbr2)}</td>
              <td className="mono text-right text-[12.5px]">{fmtPct(r.dbr3)}</td>
              <td className="mono text-right text-[12.5px] font-semibold">{fmtAED(r.maxEligible)}</td>
              <td className="mono text-right text-[12.5px]">{delta(r.maxEligible)}</td>
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
            <div className="rf-form-grid-sm mt-3 gap-2 text-[11px]">
              <div className="rounded-md px-2.5 py-2" style={{ background: "var(--tint)" }}>Maximum finance<br /><strong className="mono text-[var(--amber)]">{fmtAED(r.maxEligible)}</strong></div>
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
            <div className="rf-form-grid-sm gap-2 text-[11.5px]">
              <Field label="Applicant" value={result.applicantName || "—"} />
              <Field label="Monthly income" value={result.monthlyIncome ? fmtAED(result.monthlyIncome) : "—"} />
              <Field label="Other income" value={result.otherIncome ? fmtAED(result.otherIncome) : "—"} />
              <Field label="Age" value={result.age != null ? `${result.age} yrs` : "—"} />
              <Field label="Employment" value={result.employmentType || "—"} />
              <Field label="Liabilities" value={result.liabilities?.length ? `${result.liabilities.length} found` : "none"} />
            </div>
            {result.liabilities && result.liabilities.length > 0 && (
              <div className="rf-scroll rf-scroll-x mt-2.5">
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
      <div className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">{label}</div>
      <div className="mono text-[12px] truncate" title={value}>{value}</div>
    </div>
  );
}

/* ------------------------------ MPBF headline card ------------------------------ */

function MpbfHeadline({ r, input }: { r: MortgageResult; input: MortgageInput }) {
  /* The BIG number on the card is MAX ELIGIBLE = MIN(DBR capacity, LTV capacity).
     The client's ask is NOT a cap here — it prints separately as a reference line —
     so capacity can never be understated. */
  const mpbfDisplay = useCountUp(r.maxEligible, 600);
  const caps = [
    { label: "DBR / Residual DBR MPBF", v: r.dbrMpbf },
    { label: "LTV MPBF", v: r.ltvMpbf },
    ...(r.multiplierCap != null ? [{ label: `Income multiplier (${input.multiplierX}×)`, v: r.multiplierCap }] : []),
  ];
  const capMax = Math.max(...caps.map((c) => c.v), 1);

  const limitedTone = r.maxEligibleLimitedBy === "DBR / Income" ? "coral" : r.maxEligibleLimitedBy === "LTV" ? "sky" : "amber";

  return (
    <div
      className="card p-5 anim-fade-up"
      style={{ borderColor: "var(--amber-line)", background: "linear-gradient(180deg, var(--amber-tint), var(--surface))", boxShadow: "var(--shadow)" }}
    >
      <div className="text-[10.5px] uppercase tracking-[0.14em] font-disp font-semibold" style={{ color: "var(--amber)" }}>Maximum permissible finance</div>
      <div className="font-disp font-bold text-[34px] sm:text-[38px] leading-[1.05] tracking-tight mt-1 tabular-nums">{fmtAED(mpbfDisplay)}</div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <span className="text-[11.5px] text-[var(--ink-faint)]">limited by</span>
        <Chip tone={limitedTone}>{r.maxEligibleLimitedBy}</Chip>
        {r.maxEligible <= 0 && <Chip tone="coral">not eligible</Chip>}
        {r.roi && (
          <span className="mono text-[11px] text-[var(--ink-faint)]" title="ROI 3 sets maximum permissible finance">
            @{fmtPct(r.qualifyingRate)} · ROI{["1", "2", "3"][r.qualifyingBindsRoi - 1]}
          </span>
        )}
      </div>

      {r.requested > 0 && (
        <div className="rounded-lg px-3 py-2 mt-3" style={{ background: r.requestEligible ? "var(--mint-tint)" : "var(--coral-tint)", border: `1px solid ${r.requestEligible ? "var(--mint)" : "var(--coral)"}` }}>
          <div className="flex justify-between gap-2 text-[11px] font-disp font-semibold">
            <span>REQUESTED {fmtAED(r.requested)}</span>
            <span style={{ color: r.requestEligible ? "var(--mint)" : "var(--coral)" }}>{r.requestEligible ? "ELIGIBLE" : "NOT ELIGIBLE"}</span>
          </div>
          <div className="mono text-[10.5px] mt-1 text-[var(--ink-dim)]">
            ROI 3 DBR {fmtPct(r.dbr3)} of {fmtPct(r.maxDbr)}{r.requestEligible ? ` · within the ${fmtAED(r.maxEligible)} maximum` : ` · exceeds maximum by ${fmtAED(r.requestShortfall)}`}
          </div>
        </div>
      )}

      {r.roi && r.roi3BelowHigher && (
        <p className="text-[11.5px] m-0 mt-1.5" style={{ color: "var(--amber)" }}>
          ⚑ ROI 3 ({fmtPct(r.roi.r3)}) is below ROI 1 or ROI 2; it still sets maximum permissible finance.
        </p>
      )}

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
        <div className="rf-form-grid-sm gap-2 mt-2.5">
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

      {/* DBR 1·2·3 — read from the ENGINE on the maximum eligible amount. */}
      {(() => {
        const cap = r.maxDbr || 50;
        const stages: { label: string; rate: number; emi: number; val: number | null; note: string }[] = r.roi
          ? [
              { label: "DBR 1 · intro", rate: r.roi.r1, emi: r.emi1, val: r.dbr1, note: `${r.roi.introYears || 0}y` },
              { label: "DBR 2 · follow-on", rate: r.roi.r2, emi: r.emi2, val: r.dbr2, note: "variable after fixed term" },
              { label: "DBR 3 · stress", rate: r.roi.r3, emi: r.emi3, val: r.dbr3, note: "qualifying — never payable" },
            ]
          : [
              { label: "DBR 1 · intro", rate: r.actualRate, emi: r.emi1, val: r.dbr1, note: "assessment rate" },
              { label: "DBR 2 · follow-on", rate: r.assessmentRate, emi: r.emi2, val: r.dbr2, note: "same basis" },
              { label: "DBR 3 · stress", rate: r.assessmentRate, emi: r.emi3, val: r.dbr3, note: "qualifying rate" },
            ];
        return (
          <>
          {/* Three 124px dials side by side need ~372px, which does NOT fit the ~326px of
              usable width on a 390px phone. Comparison between the three is the whole
              point, so they stay side by side and the strip scrolls instead of
              stacking (stacking would hide the comparison). `justify-items-center`
              becomes `start` on a phone because centring an overflowing grid clips
              its first column; `min-w-max` stops the tracks from shrinking. */}
          <div className="grid grid-cols-3 gap-1 justify-items-start sm:justify-items-center min-w-max mt-4 pt-3.5 rf-scroll rf-scroll-x" style={{ borderTop: "1px dashed var(--line)" }}>
            {stages.map((s) => {
              const emi = Math.round(s.emi);
              return (
                <div key={s.label} className="flex flex-col items-center">
                  <Dial value={s.val ?? 0} cap={cap} display={s.val != null ? `${s.val}%` : "—"} label={s.label} size={124} />
                  <span className="mono text-[10.5px] text-[var(--ink-faint)] -mt-0.5">{s.rate.toFixed(2)}% · {fmtAED(emi)}/mo · {s.note}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1 text-center">
            {'DBR = (EMI + existing obligations) / eligible monthly income. "—" means no income entered yet.'}
          </p>
          </>
        );
      })()}

      <div className="rf-form-grid-sm gap-x-4 gap-y-2.5 mt-4 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
        <Stat label="Required down payment" value={fmtAED(r.downPayment)} />
        <Stat label="Actual LTV" value={fmtPct(r.actualLtv)} />
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

/* Client picker — search the client master by name, mobile, email or EID. */
function ClientPicker({ clients, cases, onPick, onClose }: {
  clients: { id: number; fullName: string; phone: string; email: string | null; eidNo: string | null; emirate: string | null; dob: string | null; residency: string; employmentProfile: string; monthlySalary: number }[];
  cases: { id: number; clientId: number | null; profileJson?: string | null }[];
  onPick: (c: { id: number; fullName: string; dob: string | null; emirate: string | null; residency: string; employmentProfile: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return clients.slice(0, 8);
    return clients.filter((c) =>
      c.fullName.toLowerCase().includes(t) ||
      (c.phone || "").includes(t.replace(/\D/g, "")) ||
      (c.email ?? "").toLowerCase().includes(t) ||
      (c.eidNo ?? "").includes(t.replace(/\D/g, ""))
    ).slice(0, 10);
  }, [q, clients]);
  return (
    <div className="px-5 py-4">
      <input className="input" autoFocus placeholder="Name, mobile, email or Emirates ID…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 space-y-1.5 max-h-[46vh] overflow-y-auto">
        {hits.length === 0 && <p className="text-[12.5px] text-[var(--ink-faint)] m-0 py-3 text-center">No match — type the name, part of the mobile, email or EID.</p>}
        {hits.map((c) => (
          <button key={c.id} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--tint)] transition-colors" style={{ border: "1px solid var(--line-soft)" }}
            onClick={() => onPick(c)}>
            <span className="text-[13px] font-medium">{c.fullName}</span>
            <span className="block text-[11px] text-[var(--ink-faint)] mono">
              {[c.phone, c.email, c.eidNo ? "EID ✓" : null, c.employmentProfile].filter(Boolean).join(" · ")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const PRINT_CSS = `
@media print {
  aside, header, nav { display: none !important; }
  .no-print { display: none !important; }
  .xl\:grid-cols-\[1fr_420px\] { display: block !important; }
  .xl\:sticky { position: static !important; max-height: none !important; overflow: visible !important; }
  .card { break-inside: avoid; border-color: #ddd !important; background: white !important; }
  body { background: white !important; }
}
`;

export default function Calculator() {
  const { me, toast, nav, feeRules, docRules, clients, cases, bankProducts, eibor } = useHfmcStore();
  /* The form survives View → Back and a browser refresh: the mirror in localStorage is
     read once, here in the initialisers, so the figures are never silently reset. */
  const formSeed = useMemo(() => {
    try {
      const raw = localStorage.getItem("hfmc_calc_form");
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch { return null; }
  }, []);
  const [mode, setMode] = useState<CalcMode>("affordability");
  const [input, setInput] = useState<MortgageInput>(() => ((formSeed?.input as MortgageInput | undefined) ?? defaultInput()));
  // deal shape — auto-filled from the selected client's latest case, always editable
  const [dealEmirate, setDealEmirate] = useState(() => ((formSeed?.dealEmirate as string | undefined) ?? "Dubai"));
  const [dealTxn, setDealTxn] = useState(() => ((formSeed?.dealTxn as string | undefined) ?? "Resale"));
  const [pickerOpen, setPickerOpen] = useState(false);
  // rate scenario — what-if over the three rates, or fetched from a bank product
  const [rateStyle, setRateStyle] = useState<"fixed" | "variable">(() => ((formSeed?.rateStyle as "fixed" | "variable" | undefined) ?? "fixed"));
  const [introRate, setIntroRate] = useState(() => ((formSeed?.introRate as number | undefined) ?? 0));
  const [introYears, setIntroYears] = useState(() => ((formSeed?.introYears as number | undefined) ?? 3));
  const [foTenor, setFoTenor] = useState<"1M" | "3M" | "6M" | "1Y">(() => ((formSeed?.foTenor as "1M" | "3M" | "6M" | "1Y" | undefined) ?? "3M"));
  const [foSpread, setFoSpread] = useState(() => ((formSeed?.foSpread as number | undefined) ?? 0));
  const [foFinal, setFoFinal] = useState(() => ((formSeed?.foFinal as number | undefined) ?? 0));
  const [useFoFinal, setUseFoFinal] = useState(() => ((formSeed?.useFoFinal as boolean | undefined) ?? false));
  // stress inference: spread filled -> follow-on + spread; else the direct ROI
  // typed in the second box; both empty -> follow-on itself
  const [stressSpread, setStressSpread] = useState(() => ((formSeed?.stressSpread as string | undefined) ?? ""));
  const [stressFinal, setStressFinal] = useState(() => ((formSeed?.stressFinal as string | undefined) ?? ""));
  const [fetchBank, setFetchBank] = useState("");
  const printStyle = <style>{PRINT_CSS}</style>;
  const [fetchProduct, setFetchProduct] = useState("");
  // quotes of the last fetched product — tenure switches re-resolve from these
  const [fetched, setFetched] = useState<{ bankName: string; quotes: NonNullable<ReturnType<typeof parsePricing>>["quotes"] } | null>(null);

  const eiborPct = (t: string) => eibor.find((e) => e.tenor === t)?.ratePct ?? null;

  // resolve a product's live quote against the CURRENT deal shape, with a
  // relaxation cascade so any filed quote can be found (exact -> any txn ->
  // either STL -> day-1 variable). No more "only DIB fetches".
  const applyProduct = (prod: (typeof bankProducts)[number], allowRaw = false) => {
    const pricing = parsePricing(prod.pricingJson) ?? { quotes: [] };
    const today = new Date().toISOString().slice(0, 10);
    const ftv = prod.maxLtvExpatriate ?? 80;
    const txnMap: Record<string, string | null> = {
      "Resale": "Resale", "Primary Handover": "Primary Handover", "Buyout": "Buyout",
      "Buyout + Equity Release": "Buyout + Equity Release", "Equity Release": "Equity Release",
    };
    const txn = txnMap[dealTxn] ?? null;
    const attempts: Parameters<typeof resolveQuote>[1][] = [];
    for (const t of [3, 1, 5, 2, 4]) {
      attempts.push({ stl: true, termYears: t, ftv, txn: txn ?? "any", on: today });
      attempts.push({ stl: true, termYears: t, ftv, txn: "any", on: today });
    }
    attempts.push({ stl: true, termYears: null, ftv, txn: txn ?? "any", on: today });
    attempts.push({ stl: true, termYears: null, ftv, txn: "any", on: today });
    attempts.push({ stl: true, termYears: null, ftv, txn: "any", on: today });
    let quote = attempts.map((a) => resolveQuote(pricing, a)).find(Boolean);
    if (!quote && allowRaw) {
      // relaxed rescue: any quote valid today, axes ignored (banks file odd txn/STL combos)
      quote = pricing.quotes.find((qq) => {
        const f = qq.effectiveFrom ?? "";
        const t = qq.effectiveTo ?? "";
        return (!f || f <= today) && (!t || t === "2099-12-31" || t >= today);
      }) ?? null;
      if (quote) toast("info", "Closest match — this product's quotes are filed under different txn/STL axes; verify the figure.");
    }
    if (!quote) {
      toast("error", "That product has no rate quotes filed yet.");
      setFetched(null); setIntroRate(0); setFoSpread(0); setFoFinal(0);
      setStressSpread(""); setStressFinal("");
      return false;
    }
    setFetched({ bankName: prod.bankName, quotes: pricing.quotes });
    const sched = rateSchedule(quote, { ON: eiborPct("ON") ?? 0, "1M": eiborPct("1M") ?? 0, "3M": eiborPct("3M") ?? 0, "6M": eiborPct("6M") ?? 0, "1Y": eiborPct("1Y") ?? 0 }, prod.stressBufferPct ?? 0);
    if (sched.introTermYears && sched.introTermYears > 0) {
      setRateStyle("fixed"); setIntroRate(sched.introRatePct ?? 0); setIntroYears(sched.introTermYears);
      const fo = sched.followOnRatePct ?? 0;
      const basis = (quote.variableAfter?.basis ?? "3M") as "1M" | "3M" | "6M" | "1Y";
      setFoTenor(basis); setUseFoFinal(true); setFoFinal(fo);
      setStressSpread(""); setStressFinal(String(sched.stressRatePct ?? fo));
    } else {
      setRateStyle("variable"); setFoTenor((quote.rateType.replace("_EIBOR", "") || "3M") as "1M" | "3M" | "6M" | "1Y");
      setFoSpread(quote.marginPct ?? 0); setUseFoFinal(false); setFoFinal(0);
      setStressSpread(""); setStressFinal(String(sched.stressRatePct ?? 0));
    }
    return true;
  };

  // current-version products only — same selection rule as the match engine
  // (skip future-effective, skip expired, keep max version per product identity)
  const currentProducts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map<string, typeof bankProducts[number]>();
    for (const p of bankProducts.filter((b) => b.active && b.status === "approved")) {
      const eff = p.effectiveDate ? p.effectiveDate.slice(0, 10) : "";
      const exp = (p as unknown as { expiryDate?: string }).expiryDate?.slice(0, 10) ?? "2099-12-31";
      if (eff && eff > today) continue;
      if (exp && exp < today) continue;
      const key = p.bankId + "__" + p.name.trim().toLowerCase();
      const existing = map.get(key);
      if (!existing || (p.version ?? 1) > (existing.version ?? 1)) map.set(key, p);
    }
    return Array.from(map.values());
  }, [bankProducts]);

  // three-scenario rates: explicit inputs, or auto-filled from the chosen bank product.
  // DBR1/2/3 use the calculator's own qualifying income + existing obligations.
  const scenario = useMemo(() => {
    const sSpread = stressSpread.trim() === "" ? null : Number(stressSpread);
    const sFinal = stressFinal.trim() === "" ? null : Number(stressFinal);
    const r2 = (x: number) => Math.round(x * 10000) / 10000;
    const stressOf = (base: number) => r2(sSpread != null ? base + sSpread : sFinal ?? base);
    if (rateStyle === "variable") {
      const eib = eiborPct(foTenor) ?? 0;
      const rate = r2(eib + foSpread);
      return { intro: rate, introYears: 0, followOn: rate, stress: stressOf(rate) };
    }
    const eib = eiborPct(foTenor) ?? 0;
    const followOn = r2(useFoFinal ? foFinal : eib + foSpread);
    return { intro: introRate, introYears, followOn, stress: stressOf(followOn) };
  }, [rateStyle, foTenor, foSpread, useFoFinal, foFinal, stressSpread, stressFinal, introRate, introYears, eibor]);
  const [whif, setWhif] = useState<WhifTab>("liab");
  const [cardId, setCardId] = useState("");
  const [cardLimit, setCardLimit] = useState("");
  const [manualRate, setManualRate] = useState("");
  const [manualTenor, setManualTenor] = useState("");
  const [extraIncome, setExtraIncome] = useState("");

  const up = (patch: Partial<MortgageInput>) => setInput((p) => ({ ...p, ...patch }));

  /* The three ROIs travel WITH the input so the print route and the Excel export
     can recompute the identical figures from a saved snapshot. `r` is therefore the
     SINGLE source of rates, EMI and DBR — the screen below must read `r`, never
     recompute them. */
  const calcInput = useMemo<MortgageInput>(
    () => ({ ...input, roi1Pct: scenario.intro, roi1Years: scenario.introYears, roi2Pct: scenario.followOn, roi3Pct: scenario.stress }),
    [input, scenario],
  );
  const r = useMemo(() => computeMortgage(calcInput), [calcInput]);

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

  const baseRow = { label: "Current (baseline)", dbr: r.currentDbr, residual: r.residualDbr, maxEligible: r.maxEligible, dbr1: r.dbr1, dbr2: r.dbr2, dbr3: r.dbr3 };
  const liabRows    = [baseRow, ...scenarioTable(calcInput, liabScenarios)];
  const rateRows    = [{ label: `Current · ${r.roi ? fmtPct(r.qualifyingRate) : fmtPct(r.assessmentRate)}`, dbr: r.currentDbr, residual: r.residualDbr, maxEligible: r.maxEligible, dbr1: r.dbr1, dbr2: r.dbr2, dbr3: r.dbr3 }, ...scenarioTable(calcInput, rateScenarios)];
  const tenorRows   = [{ label: `Current · ${tenorLabel(r.maxTenorMonths)}`, dbr: r.currentDbr, residual: r.residualDbr, maxEligible: r.maxEligible, dbr1: r.dbr1, dbr2: r.dbr2, dbr3: r.dbr3 }, ...scenarioTable(calcInput, tenorScenarios)];
  const incomeRows  = [baseRow, ...scenarioTable(calcInput, incomeScenarios)];

  const [savedId, setSavedId] = useState<number | null>(null);

  /* ---------------- View / Print / Export Excel ----------------
     The assessment document reads its figures from a snapshot in localStorage, so the
     print route recomputes the identical numbers. The stamp is persisted with the form
     bag so View → Back → View keeps the same reference. */
  const [stamp, setStamp] = useState<string>(() => {
    try {
      const s = localStorage.getItem("hfmc_calc_stamp");
      if (s) return s;
    } catch { /* private mode */ }
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `CALC-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  });

  const eiborRow = eibor.find((e) => e.tenor === foTenor);

  const openPrint = (viewMode: "full" | "summary", printNow = false) => {
    const snap = {
      input: calcInput,
      meta: {
        dealEmirate, dealTxn, mode: viewMode,
        preparedBy: me?.name ?? "",
        eiborAsOn: eiborRow?.updatedOn ?? todayISO(),
        roi2FromEibor: !useFoFinal,
        eiborTenor: foTenor,
        eiborPct: eiborRow?.ratePct ?? null,
        eiborMarginPct: useFoFinal ? null : foSpread,
      },
      stamp,
    };
    try { localStorage.setItem("hfmc_calc_print", JSON.stringify(snap)); } catch { /* private mode */ }
    window.open(printNow ? "/calc-print?print=1" : "/calc-print", "_blank");
  };

  const exportXlsx = async () => {
    try {
      const [{ buildCalcWorkbook }, XLSX] = await Promise.all([
        import("@/lib/calc-xlsx"),
        import("xlsx"),
      ]);
      const wb = buildCalcWorkbook(calcInput, r, buildPrintModel(calcInput, r), {
        dealEmirate, dealTxn, preparedBy: me?.name ?? "", stamp,
      });
      XLSX.writeFile(wb, `${stamp}.xlsx`);
      toast("success", "Workbook saved — the Working sheet recalculates live in Excel.");
    } catch (e) {
      toast("error", "Could not build the workbook: " + (e instanceof Error ? e.message : "unknown"));
    }
  };

  /* The form mirror is written on every change (see above) so View → Back and a browser
     refresh land on the same figures. The stamp is persisted alongside it so the
     printed reference stays stable for the same file. */
  useEffect(() => {
    try {
      localStorage.setItem("hfmc_calc_stamp", stamp);
      localStorage.setItem("hfmc_calc_form", JSON.stringify({
        input, introRate, introYears, foTenor, foSpread, useFoFinal, foFinal, rateStyle, stressSpread, stressFinal, dealEmirate, dealTxn,
      }));
    } catch { /* private mode */ }
  }, [input, introRate, introYears, foTenor, foSpread, useFoFinal, foFinal, rateStyle, stressSpread, stressFinal, dealEmirate, dealTxn, stamp]);

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
      const data = await res.json().catch(() => ({}));
      setSavedId(typeof data.id === "number" ? data.id : -1);
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
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const d = new Date();
                const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
                const next = `CALC-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
                setStamp(next);
                setInput(blankInput());
                toast("info", "Calculator reset — new reference " + next + ".");
              }}>
                Reset
              </button>
              <button className="btn btn-ghost btn-sm" title="Open the formatted assessment in a new tab — nothing is sent anywhere"
                onClick={() => openPrint("full")}>
                View
              </button>
              <button className="btn btn-ghost btn-sm" title="Save the assessment as Excel — 9 sheets with live formulas and the monthly amortisation"
                onClick={exportXlsx}>
                Export Excel
              </button>
              <button className="btn btn-primary btn-sm" title="Open the assessment and send it straight to the print dialog (Print / Save as PDF)"
                onClick={() => openPrint("full", true)}>
                Print / Save PDF
              </button>
            </>
          )}
        </div>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 anim-fade-in" style={{ background: "rgba(6,13,17,0.72)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setPickerOpen(false); }}>
          <div className="card anim-scale-in w-full" style={{ maxWidth: 560, background: "var(--raised)" }}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
              <h3 className="font-disp text-[15px] font-semibold m-0">Pick a client</h3>
              <button className="btn btn-ghost btn-sm !px-2" onClick={() => setPickerOpen(false)}>✕</button>
            </div>
            <ClientPicker
              clients={clients}
              cases={cases}
              onPick={(cl) => {
                up({
                  name: cl.fullName,
                  dob: cl.dob ?? input.dob,
                  applicantType: cl.residency === "UAE National" ? "UAE National" : "Expatriate",
                  employment: cl.employmentProfile === "Self-Employed" ? "Self-Employed" : "Salaried",
                });
                if (cl.emirate) setDealEmirate(cl.emirate);
                // co-borrower auto-fetch: a client who is a second party on another case comes in via the case profile
                const linked = cases.find((c) => c.clientId === cl.id && c.profileJson);
                if (linked) {
                  try {
                    const prof = JSON.parse(linked.profileJson || "{}");
                    const emi = Number(prof.primary?.existingEmis) || 0;
                    if (emi) setInput((prev) => ({ ...prev, liabilities: prev.liabilities.map((l, i) => (i === 0 ? { ...l, emi } : l)) }));
                  } catch { /* ignore */ }
                }
                setPickerOpen(false);
                toast("success", cl.fullName + " loaded — verify income and liabilities.");
              }}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        </div>
      )}

      {mode === "transfer" ? (
        <TransferFees feeRules={feeRules} docRules={docRules} initial={{ emirate: dealEmirate, txn: dealTxn, propertyValue: input.propertyValue, finance: input.requested }} />
      ) : (
      <>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4 items-start">
        {/* ================= input column ================= */}
        <div className="space-y-4 xl:sticky xl:top-[86px] xl:self-start xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto xl:pr-1 xl:-mr-1 xl:scrollbar-thin">
          <Section num="01" title="Applicant" hint="age sets the usable tenor">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Applicant name</label>
                <div className="flex gap-1.5">
                  <input className="input" value={input.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. Mohammed Al Mansoori" />
                  <button className="btn btn-ghost btn-sm shrink-0 no-print" title="Search existing clients by name, mobile, email or EID" onClick={() => setPickerOpen(true)}>🔍</button>
                </div>
              </div>
              <div>
                <label className="label">Emirate · <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>pre-filled, editable</span></label>
                <select className="select" value={dealEmirate} onChange={(e) => setDealEmirate(e.target.value)}>
                  {["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "RAK", "Fujairah", "UAQ"].map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Transaction type · <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>pre-filled, editable</span></label>
                <select className="select" value={dealTxn} onChange={(e) => setDealTxn(e.target.value)}>
                  {["Resale", "Primary Handover", "Buyout", "Buyout + Equity Release", "Equity Release"].map((x) => <option key={x}>{x}</option>)}
                </select>
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
              <div className="rf-form-grid-sm">
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
            <div className="rf-form-grid-sm gap-3 mt-3.5 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
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

          <Section num="05" title="Rate scenario — intro / follow-on / stress" hint="DBR 1·2·3 at each stage, or fetch from a bank product">
            {/* optional engine fetch */}
            <div className="no-print flex flex-wrap items-end gap-2 mb-3 pb-3" style={{ borderBottom: "1px dashed var(--line)" }}>
              <div>
                <label className="label">Fetch from engine — optional</label>
                <select className="select" style={{ width: 150 }} value={fetchBank}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFetchBank(v); setFetchProduct(""); setFetched(null);
                    setIntroRate(0); setFoSpread(0); setFoFinal(0);
                    setStressSpread(""); setStressFinal("");
                    if (!v) return; // bank cleared -> every fetched figure cleared with it
                    // auto-select: prefer a product whose filed axes match the deal,
                    // then relax only if nothing strict resolves
                    const bankProductsOf = currentProducts.filter((b) => b.bankName === v);
                    for (const b of bankProductsOf) {
                      setFetchProduct(String(b.id));
                      if (applyProduct(b, false)) return;
                    }
                    for (const b of bankProductsOf) {
                      setFetchProduct(String(b.id));
                      if (applyProduct(b, true)) return;
                    }
                    setFetchProduct("");
                  }}>
                  <option value="">— bank —</option>
                  {[...new Set(currentProducts.map((b) => b.bankName))].sort().map((bn) => <option key={bn}>{bn}</option>)}
                </select>
              </div>
              {fetchBank && (
                <div>
                  <label className="label">Product</label>
                  <select className="select" style={{ width: 240 }} value={fetchProduct}
                    onChange={(e) => {
                      setFetchProduct(e.target.value);
                      const prod = bankProducts.find((b) => String(b.id) === e.target.value);
                      if (!prod) return;
                      if (applyProduct(prod, true)) toast("success", prod.bankName + " rates loaded — edit freely, engine link is optional.");
                    }}>
                    <option value="">— product —</option>
                    {currentProducts.filter((b) => b.bankName === fetchBank).map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* fixed vs variable */}
            <div className="flex gap-1.5 mb-3">
              <button type="button" className="chip transition-all" style={rateStyle === "fixed" ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                onClick={() => setRateStyle("fixed")}>Fixed intro</button>
              <button type="button" className="chip transition-all" style={rateStyle === "variable" ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                onClick={() => setRateStyle("variable")}>Day-1 variable</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {rateStyle === "fixed" ? (
                <>
                  <div>
                    <label className="label">Intro / fixed rate %</label>
                    <input className="input mono" type="number" step={0.01} min={0} value={introRate || ""} onChange={(e) => setIntroRate(Number(e.target.value) || 0)} />
                  </div>
                  <div>
                    <label className="label">Fixed for</label>
                    <select className="select" value={introYears}
                      onChange={(e) => {
                        const y = Number(e.target.value);
                        setIntroYears(y);
                        // re-resolve from the fetched card: that tenor's rate, or blank when not filed
                        if (fetched) {
                          const hit = fetched.quotes.find((qq) => qq.termYears === y && qq.rateType === "FIXED");
                          setIntroRate(hit?.ratePct ?? 0);
                          if (!hit) toast("info", fetched.bankName + " has no " + y + "-year rate filed — enter it manually.");
                        }
                      }}>
                      {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y} year{y > 1 ? "s" : ""}</option>)}
                    </select>
                  </div>
                </>
              ) : <div className="sm:col-span-2 text-[11.5px] text-[var(--ink-faint)] self-end pb-2">Day-1 variable: intro = follow-on (EIBOR + spread below).</div>}
              <div>
                <label className="label">Follow-on {rateStyle === "fixed" ? "after fixed term" : ""}</label>
                <div className="flex gap-1">
                  <select className="select !w-auto" value={useFoFinal ? "final" : foTenor} onChange={(e) => { if (e.target.value === "final") setUseFoFinal(true); else { setUseFoFinal(false); setFoTenor(e.target.value as typeof foTenor); } }}>
                    <option value="1M">1M EIBOR +</option>
                    <option value="3M">3M EIBOR +</option>
                    <option value="6M">6M EIBOR +</option>
                    <option value="1Y">1Y EIBOR +</option>
                    <option value="final">final figure</option>
                  </select>
                  {useFoFinal
                    ? <input className="input mono !w-24" type="number" step={0.01} value={foFinal || ""} onChange={(e) => setFoFinal(Number(e.target.value) || 0)} placeholder="%" />
                    : <input className="input mono !w-20" type="number" step={0.005} value={foSpread || ""} onChange={(e) => setFoSpread(Number(e.target.value) || 0)} placeholder="spread" />}
                </div>
              </div>
              <div>
                <label className="label">Stress — spread + <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>or any ROI</span></label>
                <div className="flex gap-1">
                  <input className="input mono !w-20" type="number" step={0.05} value={stressSpread}
                    title="If filled: stress = follow-on rate + this spread"
                    onChange={(e) => setStressSpread(e.target.value)} placeholder="spread" />
                  <input className="input mono !w-24" type="number" step={0.01} value={stressFinal}
                    title="Used only when spread is empty — the stress ROI as a direct figure"
                    onChange={(e) => setStressFinal(e.target.value)} placeholder="or ROI" />
                </div>
              </div>
            </div>

                        {/* ROI 3 is the qualifying rate for maximum eligibility. */}
            {/* DBR 1·2·3 at this scenario — read from the ENGINE, same figures as the dials opposite */}
            {r.roi ? (
              <div className="rf-form-grid-sm gap-2.5 mt-3.5 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
                {[
                  { label: `DBR 1 · intro ${r.roi.r1.toFixed(2)}%${r.roi.introYears ? ` · ${r.roi.introYears}y` : ""}`, emi: r.emi1, val: r.dbr1 },
                  { label: `DBR 2 · follow-on ${r.roi.r2.toFixed(2)}%`, emi: r.emi2, val: r.dbr2 },
                  { label: `DBR 3 · stress ${r.roi.r3.toFixed(2)}%`, emi: r.emi3, val: r.dbr3 },
                ].map(({ label, emi, val }, i) => (
                  <div key={label} className="rounded-lg px-3 py-2" style={{ background: i === 2 ? "var(--amber-tint)" : "var(--bg2)", border: i === 2 ? "1px solid var(--amber)" : "1px solid var(--line)" }}>
                    <div className="text-[10.5px] font-disp font-semibold" style={{ color: i === 2 ? "var(--amber)" : "var(--ink-faint)" }}>{label}</div>
                    <div className="mono text-[15px] font-bold mt-0.5" style={{ color: i === 2 ? "var(--amber)" : undefined }}>{val}%</div>
                    <div className="text-[10.5px] text-[var(--ink-faint)] mono">EMI {fmtAED(Math.round(emi))}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <details className="mt-3.5 pt-3.5 text-[12px]" style={{ borderTop: "1px dashed var(--line)" }}>
              <summary className="cursor-pointer font-disp font-semibold text-[var(--ink-faint)]">
                Qualifying rate (drives MAX ELIGIBLE) — {r.roi ? <>ROI 3 → {fmtPct(r.qualifyingRate)}</> : <>currently {fmtPct(r.assessmentRate)}</>} · tenor {tenorLabel(r.maxTenorMonths)}
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
                <div>
                  <label className="label">Contracted rate % <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— EMI basis</span></label>
                  <input className="input mono" type="number" step={0.05} min={0} value={input.actualRate}
                    onChange={(e) => up({ actualRate: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="label">Manual stress rate — optional</label>
                  <input className="input mono" type="number" step={0.05} min={0} value={input.stressOverride ?? ""} placeholder={r.roi ? `ROI 3: ${fmtPct(r.qualifyingRate)}` : `auto: ${fmtPct(input.actualRate + input.loadFactor)}`}
                    onChange={(e) => up({ stressOverride: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Load factor — legacy fallback, used only when ROI 1/2/3 are absent</label>
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
                <div>
                  <label className="label">Income multiplier cap</label>
                  <select className="select" value={input.multiplierX} onChange={(e) => up({ multiplierX: Number(e.target.value) })}>
                    <option value={0}>Off</option>
                    {[5, 6, 7, 8].map((x) => <option key={x} value={x}>{x}× annual</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Tenor override (mo)</label>
                  <input className="input mono" type="number" min={12} step={12} value={input.tenorOverrideMonths ?? ""} placeholder="auto (age)"
                    onChange={(e) => up({ tenorOverrideMonths: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
                </div>
              </div>
            </details>
          </Section>
        </div>

        {/* ================= results column — sticky so verdict never scrolls away ================= */}
        <div className="space-y-4 xl:sticky xl:top-[86px] xl:self-start xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto xl:pr-1 xl:-mr-1 xl:scrollbar-thin">
          {/* proposal-style preview — the full working on one sheet, prints as-is */}
          <div className="card anim-fade-up" style={{ background: "var(--surface)" }}>
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5" style={{ borderBottom: "2px solid var(--amber)" }}>
              <div>
                <div className="font-disp font-bold text-[14px]">Eligibility working{input.name ? ` · ${input.name}` : ""}</div>
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">HFMC · indicative, not a bank approval</div>
              </div>
              <div className="text-right mono text-[11px] text-[var(--ink-faint)]">
                {dealEmirate} · {dealTxn}
                <div>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
              </div>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              {/* AED figures ("AED 2,500,000") need ~220px to render un-truncated, so this is
            the wide variant: 1-up on a phone, 2-up on a tablet, 3-up on desktop. */}
              <div className="rf-form-grid gap-2 text-center">
                <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--tint)" }}>
                  <div className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">Property value</div>
                  <div className="mono text-[13px] font-semibold">{fmtAED(input.propertyValue)}</div>
                </div>
                <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--amber-tint)" }}>
                  <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold" style={{ color: "var(--amber)" }}>Finance sought</div>
                  <div className="mono text-[13px] font-bold" style={{ color: "var(--amber)" }}>{fmtAED(input.requested)}</div>
                </div>
                <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--tint)" }}>
                  <div className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">Eligible income</div>
                  <div className="mono text-[13px] font-semibold">{fmtAED(r.eligibleIncome)}/mo</div>
                </div>
              </div>
              {input.requested > 0 && (
                <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: r.requestEligible ? "var(--mint-tint)" : "var(--coral-tint)", border: `1px solid ${r.requestEligible ? "var(--mint)" : "var(--coral)"}` }}>
                  <span className="font-disp font-semibold" style={{ color: r.requestEligible ? "var(--mint)" : "var(--coral)" }}>{r.requestEligible ? "REQUEST ELIGIBLE" : "REQUEST NOT ELIGIBLE"}</span>
                  <span className="mono"> · ROI 3 DBR {fmtPct(r.dbr3)} / {fmtPct(r.maxDbr)} · maximum permissible finance {fmtAED(r.maxEligible)}</span>
                </div>
              )}

              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-[var(--ink-faint)] text-left">
                    <th className="py-1 font-disp text-[10.5px] uppercase tracking-[0.08em]">Stage</th>
                    <th>Rate</th><th>EMI</th><th>DBR</th>
                  </tr>
                </thead>
                <tbody>
                  {r.roi ? (
                    ([
                      { label: "1 · Intro (fixed)", rate: r.roi.r1, emi: r.emi1, dbr: r.dbr1, note: r.roi.introYears ? `${r.roi.introYears}y fixed` : "intro" },
                      { label: "2 · After intro", rate: r.roi.r2, emi: r.emi2, dbr: r.dbr2, note: "variable after fixed term" },
                      { label: "3 · Stress-qualified", rate: r.roi.r3, emi: r.emi3, dbr: r.dbr3, note: "qualifying — never payable" },
                    ] as const).map(({ label, rate, emi, dbr, note }, i) => (
                      <tr key={label} style={{ borderTop: "1px dashed var(--line)" }}>
                        <td className="py-1.5">{label}<span className="text-[10.5px] text-[var(--ink-faint)]"> · {note}</span></td>
                        <td className="mono text-center">{rate.toFixed(2)}%</td>
                        <td className="mono text-center">{fmtAED(Math.round(emi))}</td>
                        <td className="mono text-center font-semibold" style={{ color: i === 2 ? "var(--amber)" : undefined }}>{dbr}%</td>
                      </tr>
                    ))
                  ) : null}
                  <tr style={{ borderTop: "1px dashed var(--line)" }}>
                    <td className="py-1.5 text-[var(--ink-dim)]">Existing obligations</td>
                    <td /><td className="mono text-center">{fmtAED(r.existingEmis)}</td>
                    <td className="mono text-center">{fmtPct(r.currentDbr)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="flex flex-wrap gap-x-5 gap-y-1 pt-2 mono text-[11.5px]" style={{ borderTop: "1px solid var(--line)" }}>
                <span>Qualifying: <strong style={{ color: "var(--amber)" }}>{r.roi ? fmtPct(r.qualifyingRate) : fmtPct(r.assessmentRate)}</strong></span>
                <span>Tenor: <strong>{tenorLabel(r.maxTenorMonths)}</strong></span>
                <span>DBR ceiling: <strong>{r.maxDbr}%</strong></span>
                <span>Available EMI: <strong>{fmtAED(r.availableEmi)}</strong></span>
                <span>Maximum finance: <strong style={{ color: "var(--mint)" }}>{fmtAED(r.maxEligible ?? 0)}</strong></span>
              </div>
            </div>
          </div>

          <MpbfHeadline r={r} input={input} />

          <KeyMetrics r={r} />

          <TrailAndNotes r={r} />

          {/* save / new case actions */}
          <div className="no-print card p-4 anim-fade-up flex flex-col gap-2">
            <button className="btn btn-mint justify-center" onClick={onSave}>
              <IDownload size={15} /> Save check to audit trail
            </button>
            {savedId != null && (
              <button
                className="btn btn-ghost justify-center"
                title="Copy a client-friendly summary to share on WhatsApp"
                onClick={() => {
                  const msg = `HFMC eligibility — ${input.name || "applicant"}: requested ${fmtAED(r.requested)} is ${r.requestEligible ? "ELIGIBLE" : "NOT ELIGIBLE"} (ROI 3 DBR ${r.dbr3}% of ${r.maxDbr}% cap). Maximum permissible finance is ${fmtAED(r.maxEligible)} (${r.maxEligibleLimitedBy} binds). DBR 1/2/3: ${r.dbr1}%/${r.dbr2}%/${r.dbr3}%. Indicative only — not a bank approval.`;
                  navigator.clipboard?.writeText(msg).then(
                    () => toast("success", "Client summary copied — paste it on WhatsApp."),
                    () => toast("error", "Copy failed — select the working manually.")
                  );
                }}
              >
                📋 Copy client summary
              </button>
            )}
            <button className="btn btn-ghost justify-center" onClick={onNewCase}>
              <IBank size={15} /> New case from this
            </button>
            <p className="text-[10.5px] text-[var(--ink-faint)] text-center m-0">
              Saving only stores the check for audit — a case is created from the dashboard.
            </p>
          </div>

          {/* AI advisor */}
          <div className="no-print">
            <AdvisorPanel input={input} r={r} />
          </div>

          {/* AI document reader */}
          <div className="no-print">
            <DocReaderPanel onApply={applyDocRead} />
          </div>
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
                <ScenarioTable rows={liabRows} base={r.maxEligible} />
              )}
            </div>
          )}

          {whif === "rate" && (
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[12px] text-[var(--ink-faint)]">Manual assessment rate:</span>
                <input className="input mono" style={{ width: 130 }} type="number" min={0} step={0.05} placeholder="e.g. 6.50" value={manualRate} onChange={(e) => setManualRate(e.target.value)} />
              </div>
              <ScenarioTable rows={rateRows} base={r.maxEligible} />
            </div>
          )}

          {whif === "tenor" && (
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[12px] text-[var(--ink-faint)]">Manual tenor (months):</span>
                <input className="input mono" style={{ width: 130 }} type="number" min={12} step={12} placeholder="e.g. 178" value={manualTenor} onChange={(e) => setManualTenor(e.target.value)} />
              </div>
              <ScenarioTable rows={tenorRows} base={r.maxEligible} />
            </div>
          )}

          {whif === "income" && (
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[12px] text-[var(--ink-faint)]">Hypothetical extra allowance (AED/mo):</span>
                <input className="input mono" style={{ width: 150 }} type="number" min={0} step={500} placeholder="e.g. 3000" value={extraIncome} onChange={(e) => setExtraIncome(e.target.value)} />
              </div>
              <ScenarioTable rows={incomeRows} base={r.maxEligible} />
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

function TransferFees({ feeRules, docRules, initial }: { feeRules: FeeRule[]; docRules: DocRule[]; initial?: { emirate?: string; txn?: string; propertyValue?: number; finance?: number } }) {
  // seeds from the affordability inputs (auto-picked, still editable here)
  const [emirate, setEmirate] = useState<(typeof FEE_EMIRATES)[number]>((initial?.emirate as typeof emirate) ?? "Dubai");
  const [txn, setTxn] = useState<(typeof FEE_TXNS)[number]>((initial?.txn === "Buyout" || initial?.txn === "Equity Release" || initial?.txn === "Buyout + Equity Release" ? "Buyout" : initial?.txn === "Primary Handover" ? "Primary" : initial?.txn === "Resale" ? "Resale" : "Primary") as typeof txn);
  const [propertyValue, setPropertyValue] = useState(initial?.propertyValue ?? 2500000);
  const [finance, setFinance] = useState(initial?.finance ?? 2000000);

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
          <div className="rf-scroll rf-scroll-x">
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
