// Quote parser — turns a bank's rate-card text into structured RateQuote
// drafts. Deterministic (no AI), line-based, with confidence flags; the human
// reviews the draft in the guided editor before approval.
// Phase 1: expands year ranges ("2 & 3 Years", "8-10 Years"), multi-txn lists
// ("Resale, Direct & Buy-Out plus Equity"), FTV bands (<=60 / >60), and
// per-line follow-on margins ("thereafter 1% + 3M EIBOR with floor 1%").
import type { RateQuote } from "@/lib/bank-pricing";
import { canonicalTxn, canonicalSegment, expandFixedYearLabel } from "@/lib/bank-rules-taxonomy";

export interface ParsedQuote extends RateQuote {
  confidence: "high" | "medium" | "low";
  sourceLine: string;
}

export function basisFromText(s: string): RateQuote["rateType"] {
  if (/6\s*-?\s*month/i.test(s) || /6m\b/i.test(s)) return "6M_EIBOR";
  if (/1\s*-?\s*month/i.test(s) || /1m\b/i.test(s)) return "1M_EIBOR";
  if (/12\s*-?\s*month|1\s*year/i.test(s)) return "1Y_EIBOR";
  return "3M_EIBOR";
}

export function parseRateTable(text: string): ParsedQuote[] {
  // Split on newlines, plus inline STL/NSTL section breaks — but ONLY when
  // preceded by whitespace, so token forms ("Fixed_3Years_STL", "LAP_3years_STL",
  // "OffPlan_3years_NSTL_...") are never chopped mid-token.
  const lines = String(text || "").split(/\n|\s(?=N?STL\b)/g).map((l) => l.trim()).filter(Boolean);
  const quotes: ParsedQuote[] = [];
  let ctxStl: boolean | null = null;
  let ctxTxns: string[] | null = null; // multi-txn context: "Resale, Direct & Buy-Out plus Equity"
  let ctxFtvMin: number | null = null;
  let ctxFtvMax: number | null = null;
  let ctxSegment: string | null = null;

  /** Split a context line into every canonical txn it names. canonicalTxn()
   *  already does whole-word matching, so fragments can never alias. */
  const txnsIn = (l: string): string[] => {
    const found = new Set<string>();
    // comma/&/+/slash separated chunks each mapped independently
    for (const chunk of l.split(/[,/&+]/)) {
      const c = canonicalTxn(chunk);
      if (c) found.add(c);
    }
    // keyword sweep for names the chunker misses — underscores and digits are
    // word glue here, so "Fixed_3Years_STL" contributes nothing via fragments.
    const low = l.toLowerCase().replace(/[_0-9]+/g, " ");
    if (/\bbuyout\b/.test(low)) found.add("Buyout");
    if (/\bequity\b|cash[\s-]?out|refinance|top[\s-]?up/.test(low)) found.add("Equity Release");
    if (/\bland\b|\bplot\b/.test(low)) found.add("Land");
    if (/\blap\b/.test(low)) found.add("LAP");
    if (/self[\s-]?const|building finance|\bbldg\b/.test(low)) found.add("Self-Construction");
    if (/off[\s-]?plan/.test(low)) found.add("Off-Plan");
    if (/\bresale\b|secondary|second hand/.test(low)) found.add("Resale");
    if (/\bprimary\b|\bhandover\b|\bdeveloper\b|\bdirect\b|\bfresh\b|final payment/.test(low)) {
      found.add(/handover/.test(low) ? "Primary Handover" : "Primary Purchase");
    }
    return [...found];
  };

  /** STL token detection that survives surrounding underscores:
   *  "_NSTL_Self Emp" must read as NSTL even though `\b` fails after the
   *  underscore (underscore is a word char). Fallback = contextual STL. */
  const stlFromToken = (s: string, fallback: boolean | null): boolean | null =>
    /(^|[_\s-])nstl([_\s-]|$)/i.test(s) ? false
    : /(^|[_\s-])stl([_\s-]|$)/i.test(s) ? true
    : fallback;

  for (const line of lines) {
    const l = line;
    // context updates
    if (/\bSTL\b/i.test(l) && !/\bNSTL\b/i.test(l)) ctxStl = true;
    if (/\bNSTL\b/i.test(l)) ctxStl = false;
    const seg = canonicalSegment(l);
    if (seg) ctxSegment = seg;
    const listed = txnsIn(l);
    // a context line names txns but carries no rate → it scopes the lines below.
    // A rate line that itself names one txn (e.g. "LAP_3years_STL - 4.69%")
    // keeps ONLY its own txn — it must not inherit a stale multi-txn context.
    const hasRate = /(\d+(?:\.\d+)?)\s*%/.test(l);
    if (listed.length && !hasRate) ctxTxns = listed;
    else if (listed.length && hasRate && !/[,/&+]/.test(l)) ctxTxns = listed;
    if (/ftv/i.test(l)) {
      const up = l.match(/(?:up\s*to|<=|≤)\s*(\d+(?:\.\d+)?)\s*%?/i);
      const above = l.match(/above\s*(\d+(?:\.\d+)?)/i);
      if (above) { ctxFtvMin = parseFloat(above[1]); ctxFtvMax = 100; }
      else if (up) { ctxFtvMin = null; ctxFtvMax = parseFloat(up[1]); }
    }

    const lineTxns = listed.length ? listed : ctxTxns;
    const followOn: RateQuote["variableAfter"] = (() => { // "thereafter 1% + 3M EIBOR with floor rate of 1%"
      const m = l.match(/thereafter\s*(\d+(?:\.\d+)?)\s*%?\s*\+\s*(3|6|1|12)?\s*-?\s*months?\s*eibor/i)
        ?? l.match(/after[-–]?\s*(?:3m\s*e\s*\+\s*)?(\d+(?:\.\d+)?)\s*%/i);
      if (!m) return null;
      const basisHit = l.match(/thereafter[^.]*?(3|6|1|12)\s*-?\s*months?\s*eibor/i)?.[1]
        ?? (/3m\s*e\s*\+/i.test(l) ? "3" : "3");
      const floor = l.match(/floor[^0-9]*(\d+(?:\.\d+)?)/i);
      return {
        basis: `${basisHit}M_EIBOR` as "1M" | "3M" | "6M" | "1Y",
        marginPct: parseFloat(m[1]),
        floorPct: floor ? parseFloat(floor[1]) : null,
      };
    })();

    // fixed-for-term quotes incl. ranges — expands to one quote per year:
    // "Fixed_1Year_STL: 3.99%", "2 & 3 Years - 3.99% Fixed", "LAP_3years_STL - 4.69%"
    const fixedRe = /(\d+(?:\.\d+)?)\s*%?\s*[-–:]?\s*fixed[^0-9]{0,20}(\d+)\s*year/i;
    const fm = l.match(fixedRe);
    const rangeRe = /(\d+(?:\.\d+)?)\s*%?\s*(?:fixed\s*)?(?:for\s*)?(\d{1,2}\s*(?:[-&,/]|and|to)\s*\d{1,2}\s*(?:years?|yrs?))/i;
    if (fm) {
      const years = expandFixedYearLabel(`${fm[2]} years`) ?? [parseInt(fm[2], 10)];
      // inline tokens override context: "Fixed_1Year_STL" / "_NSTL" / "OffPlan_3years_NSTL" / "LAP_3years_"
      const lineStl = stlFromToken(l, ctxStl);
      for (const y of years) {
        quotes.push({
          stl: lineStl, termYears: y, rateType: "FIXED", ratePct: parseFloat(fm[1]),
          txn: lineTxns?.[0] ?? ctxTxns?.[0] ?? null,
          txns: lineTxns && lineTxns.length > 1 ? [...lineTxns] : (lineTxns?.length ? [...lineTxns] : null),
          segment: canonicalSegment(l) ?? ctxSegment,
          variableAfter: followOn as RateQuote["variableAfter"],
          ftvMin: ctxFtvMin, ftvMax: ctxFtvMax,
          note: l.slice(0, 160),
          confidence: lineStl != null ? "high" : "medium",
          sourceLine: l.slice(0, 160),
        });
      }
      continue;
    }
    // range-first form: "2 & 3 Years - 3.99% Fixed" (rate AFTER the range).
    // Single-txn shorthand also matches here ("Land_Fin_3years - 5.49%"),
    // but ONLY when the line carries no other txn context — a header-scoped
    // multi-txn context ("Resale, Direct & Buy-Out…" above) wins over the token.
    const rm = !fm ? l.match(rangeRe) : null;
    if (rm) {
      const years = expandFixedYearLabel(rm[2]) ?? [];
      const singleTxn = (lineTxns?.length ?? 0) === 1 ? lineTxns : null;
      const effTxns = ctxTxns?.length ? ctxTxns : singleTxn;
      for (const y of years) {
        quotes.push({
          stl: stlFromToken(l, ctxStl), termYears: y, rateType: "FIXED", ratePct: parseFloat(rm[1]),
          txn: effTxns?.[0] ?? null,
          txns: effTxns?.length ? [...effTxns] : null,
          segment: ctxSegment,
          variableAfter: followOn as RateQuote["variableAfter"],
          ftvMin: ctxFtvMin, ftvMax: ctxFtvMax,
          note: l.slice(0, 160),
          confidence: ctxStl != null ? "high" : "medium",
          sourceLine: l.slice(0, 160),
        });
      }
      if (years.length) continue;
    }

    // term-first forms (term BEFORE the rate) — covers every shape the UAE
    // sheets use, including ranges and token prefixes:
    //   "Fixed_3Years_STL - 3.99%"      "2 & 3 Years - 3.99% Fixed"
    //   "LAP_3years_STL - 4.69%"        "OffPlan_3years_NSTL_Self Emp_Others - 5.24%"
    //   "Land_Fin_3years - 5.49%"       "8 - 10 Years - 5.50%"
    // "Nyear loan tenor" is stripped first so "Fixed_2Years_... 10year loan tenor - 4.49%"
    // reads the 2-year term, not the "10" inside the phrase.
    const pre = l.replace(/\d+\s*years?\s*loan\s*tenor/gi, " loan tenor ");
    const tm = pre.match(/(?:^|[_\s-])(\d{1,2}(?:\s*(?:[-&,/]|and|to)\s*\d{1,2})?)\s*-?\s*years?[^0-9%]{0,45}?(\d+(?:\.\d+)?)\s*%/i);
    if (tm) {
      const years = expandFixedYearLabel(`${tm[1]} years`) ?? [parseInt(tm[1], 10)];
      const lineStl = stlFromToken(l, ctxStl);
      // header context wins; a token txn counts only when it is the line's sole txn
      const singleTxn = (lineTxns?.length ?? 0) === 1 ? lineTxns : null;
      const effTxns = ctxTxns?.length ? ctxTxns : singleTxn;
      const valid = years.filter((y) => y >= 1 && y <= 30);
      if (valid.length) {
        for (const y of valid) {
          quotes.push({
            stl: lineStl, termYears: y, rateType: "FIXED", ratePct: parseFloat(tm[2]),
            txn: effTxns?.[0] ?? null,
            txns: effTxns?.length ? [...effTxns] : null,
            segment: canonicalSegment(l) ?? ctxSegment,
            variableAfter: followOn as RateQuote["variableAfter"],
            ftvMin: ctxFtvMin, ftvMax: ctxFtvMax,
            sourceLabel: tm[1].trim(), // audit trace: "2 & 3", "8 - 10"
            note: l.slice(0, 160),
            confidence: lineStl != null ? "high" : "medium",
            sourceLine: l.slice(0, 160),
          });
        }
        continue;
      }
    }

    // variable margins: "1.849% + 3 months EIBOR" or "margin of 1.49814% + 3 months EIBOR"
    const varRe = /(\d+(?:\.\d+)?)\s*%?\s*(?:fixed\s*margin\s*(?:of|:)?|[-+])\s*\+?\s*(3|6|1|12)?\s*-?\s*months?\s*(?:\s*\+)?\s*eibor/i;
    const vm = l.match(varRe);
    if (vm) {
      const basis = basisFromText(vm[2] ? `${vm[2]} months eibor` : l);
      const floor = (() => {
        const f = l.match(/floor[^0-9]*(\d+(?:\.\d+)?)/i);
        return f ? parseFloat(f[1]) : null;
      })();
      quotes.push({
        stl: ctxStl, termYears: 0, ftvMin: ctxFtvMin, ftvMax: ctxFtvMax, rateType: basis,
        marginPct: parseFloat(vm[1]), floorPct: floor,
        txn: lineTxns?.[0] ?? null, txns: lineTxns?.length ? [...lineTxns] : null,
        segment: ctxSegment,
        note: l.slice(0, 160),
        confidence: ctxStl != null ? "high" : "medium",
        sourceLine: l.slice(0, 160),
      });
      continue;
    }

    // standalone "5.52% Fixed Margin of 1.24814% + 3 months EIBOR" — day-1 all-in + margin
    const allIn = l.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:fixed\s*margin|margin)\s+of\s+(\d+(?:\.\d+)?)\s*%\s*\+\s*(3|6|1|12)?\s*-?\s*months?\s*eibor/i);
    if (allIn) {
      const basis = basisFromText(allIn[3] ? `${allIn[3]} months eibor` : l);
      quotes.push({
        stl: ctxStl, termYears: 0, ftvMin: ctxFtvMin, ftvMax: ctxFtvMax, rateType: basis,
        marginPct: parseFloat(allIn[2]),
        txn: lineTxns?.[0] ?? null, txns: lineTxns?.length ? [...lineTxns] : null,
        segment: ctxSegment,
        note: l.slice(0, 160),
        confidence: ctxStl != null ? "high" : "medium",
        sourceLine: l.slice(0, 160),
      });
    }
  }

  // dedupe identical matches
  const seen = new Set<string>();
  return quotes.filter((q) => {
    const k = JSON.stringify([q.stl, q.termYears, q.ftvMin, q.ftvMax, q.rateType, q.ratePct, q.marginPct, q.txn, q.txns, q.segment]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
