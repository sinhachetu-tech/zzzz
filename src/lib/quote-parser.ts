// Quote parser — turns a bank's rate-card text into structured RateQuote
// drafts. Deterministic (no AI), line-based, with confidence flags; the human
// reviews the draft in the guided editor before approval.
import type { RateQuote } from "@/lib/bank-pricing";

export interface ParsedQuote extends RateQuote {
  confidence: "high" | "medium" | "low";
  sourceLine: string;
}

const EIBOR_BASIS = (s: string): RateQuote["rateType"] | null => {
  if (/3\s*-?\s*month/i.test(s) || /3m\b/i.test(s)) return "3M_EIBOR";
  if (/6\s*-?\s*month/i.test(s) || /6m\b/i.test(s)) return "6M_EIBOR";
  if (/1\s*-?\s*month/i.test(s) || /1m\b/i.test(s)) return "1M_EIBOR";
  if (/12\s*-?\s*month|1\s*year/i.test(s)) return "1Y_EIBOR";
  return null;
};

export function parseRateTable(text: string): ParsedQuote[] {
  const lines = String(text || "").split(/\n|(?=STL|NSTL)/g).map((l) => l.trim()).filter(Boolean);
  const quotes: ParsedQuote[] = [];
  let ctxStl: boolean | null = null;
  let ctxTxn: string | null = null;
  let ctxFtvMax: number | null = null;

  for (const line of lines) {
    const l = line;
    // context updates
    if (/\bSTL\b/i.test(l) && !/\bNSTL\b/i.test(l)) ctxStl = true;
    if (/\bNSTL\b/i.test(l)) ctxStl = false;
    if (/equity release|cashout/i.test(l)) ctxTxn = "Equity Release";
    else if (/buyout\s*\+|buyout with equity/i.test(l)) ctxTxn = "Buyout + Equity Release";
    else if (/buyout/i.test(l)) ctxTxn = "Buyout";
    else if (/land/i.test(l)) ctxTxn = "Land";
    else if (/lap/i.test(l)) ctxTxn = "LAP";
    else if (/self[-\s]?construction/i.test(l)) ctxTxn = "Self Construction";
    else if (/primary|handover|developer|direct|fresh/i.test(l) && !/buyout/i.test(l)) ctxTxn = /off[-\s]?plan/i.test(l) ? "Primary Handover" : "Resale";
    if (/ftv/i.test(l)) {
      const up = l.match(/(?:up\s*to|<=|≤)\s*(\d+(?:\.\d+)?)\s*%?/i);
      const above = l.match(/above\s*(\d+(?:\.\d+)?)/i);
      if (above) ctxFtvMax = 100;
      else if (up) ctxFtvMax = parseFloat(up[1]);
    }

    // fixed-for-term quotes: "3.95% Fixed for 3 years" / "Fixed_1Year_STL: 3.99%"
    const fixedRe = /(\d+(?:\.\d+)?)\s*%?\s*[-–]?\s*fixed[^0-9]{0,20}(\d+)\s*year/i;
    const fm = l.match(fixedRe);
    if (fm) {
      quotes.push({
        stl: ctxStl, termYears: parseInt(fm[2], 10), rateType: "FIXED", ratePct: parseFloat(fm[1]),
        txn: ctxTxn, segment: /geco/i.test(l) ? "GECO" : /abu dhabi|auh developer/i.test(l) ? "AUH Developer" : null,
        note: l.slice(0, 160),
        confidence: ctxStl != null ? "high" : "medium",
        sourceLine: l.slice(0, 160),
      });
      continue;
    }

    // variable margins: "1.849% + 3 months EIBOR" or "margin of 1.49814% + 3 months EIBOR"
    const varRe = /(\d+(?:\.\d+)?)\s*%?\s*(?:fixed\s*margin\s*(?:of|:)?|[-+])\s*\+?\s*(3|6|1|12)?\s*-?\s*months?\s*(?:\s*\+)?\s*eibor/i;
    const vm = l.match(varRe);
    if (vm) {
      const basis = (vm[2] || "3") + "M_EIBOR";
      const floor = (() => {
        const f = l.match(/floor[^0-9]*(\d+(?:\.\d+)?)/i);
        return f ? parseFloat(f[1]) : null;
      })();
      quotes.push({
        stl: ctxStl, termYears: 0, ftvMax: ctxFtvMax, rateType: basis as RateQuote["rateType"],
        marginPct: parseFloat(vm[1]), floorPct: floor, txn: ctxTxn,
        segment: /geco/i.test(l) ? "GECO" : /szhp/i.test(l) ? "SZHP" : null,
        note: l.slice(0, 160),
        confidence: ctxStl != null ? "high" : "medium",
        sourceLine: l.slice(0, 160),
      });
      continue;
    }

    // standalone "5.52% Fixed Margin of 1.24814% + 3 months EIBOR" — day-1 all-in + margin
    const allIn = l.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:fixed\s*margin|margin)\s+of\s+(\d+(?:\.\d+)?)\s*%\s*\+\s*(3|6|1|12)?\s*-?\s*months?\s*eibor/i);
    if (allIn) {
      const basis = (allIn[3] || "3") + "M_EIBOR";
      quotes.push({
        stl: ctxStl, termYears: 0, ftvMax: ctxFtvMax, rateType: basis as RateQuote["rateType"],
        marginPct: parseFloat(allIn[2]), txn: ctxTxn,
        note: l.slice(0, 160),
        confidence: ctxStl != null ? "high" : "medium",
        sourceLine: l.slice(0, 160),
      });
    }
  }

  // dedupe identical matches
  const seen = new Set<string>();
  return quotes.filter((q) => {
    const k = JSON.stringify([q.stl, q.termYears, q.ftvMax, q.rateType, q.ratePct, q.marginPct, q.txn]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
