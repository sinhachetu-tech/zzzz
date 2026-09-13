// Email→case fuzzy matcher for HFMC.
//
// Pipeline (called by the inbound webhook):
//   1. Split subject on common separators → candidate parts
//   2. For each part: token-overlap (Jaccard) against every open case's
//      customer name AND every active bank name (incl. known aliases)
//   3. Confident match (customer ≥ 0.6 AND a bank matched) → auto-link
//   4. Partial match (customer ≥ 0.5 XOR bank matched) → review queue
//      with bestGuessCaseId set so the human sees a suggestion
//   5. No match → review queue with no guess
//
// The safety net: nothing gets mis-filed silently. A near-miss on a name
// waits for a human glance instead of attaching to the wrong case.

export interface BankForMatch {
  name: string;
  active: boolean;
}

export interface CaseForMatch {
  id: number;
  customer: string;
  caseStatus: string; // only Active cases are eligible
  banks: string[];
}

export interface MatchInput {
  subject: string;
  sender: string;
  cases: CaseForMatch[];
  banks: BankForMatch[];
}

export type MatchResult =
  | { kind: "matched"; caseId: number; bankName: string | null; confidence: "high"; customerScore: number }
  | { kind: "unmatched"; bestGuessCaseId: number | null; customerScore: number; bankName: string | null; reason: "low-customer" | "no-bank" | "no-match" };

// Known bank aliases — short forms that appear in subject lines alongside the full name.
// Maps alias (lowercase) → canonical bank name (as stored in BankItem.name).
const BANK_ALIASES: Record<string, string> = {
  "enbd": "ENBD",
  "emirates nbd": "ENBD",
  "adcb": "ADCB",
  "abu dhabi commercial bank": "ADCB",
  "fab": "FAB",
  "first abu dhabi bank": "FAB",
  "mashreq": "Mashreq",
  "hsbc": "HSBC",
  "scb": "SCB",
  "standard chartered": "SCB",
  "cbd": "CBD",
  "commercial bank of dubai": "CBD",
  "dib": "DIB",
  "dubai islamic bank": "DIB",
  "adib": "ADIB",
  "abu dhabi islamic bank": "ADIB",
  "uab": "UAB",
  "union arab bank": "UAB",
  "rak": "RAK Bank",
  "rak bank": "RAK Bank",
  "ras al khaimah bank": "RAK Bank",
  "nbf": "NBF",
  "national bank of fujairah": "NBF",
};

const STOP = new Set([
  "the", "and", "for", "from", "re", "fw", "fwd", "regarding", "about", "your", "you",
  "a", "an", "of", "to", "in", "on", "at", "by", "with", "is", "are", "was", "were",
  "query", "email", "message", "kindly", "please", "dear", "sir", "madam", "sirs",
  "valuer", "valuation", "report", "update", "follow", "up", "request", "required",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s&-]/g, " ")
    .split(/[\s,|\/-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// Jaccard similarity over token sets. Simple but effective for short names.
function jaccard(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const sa = new Set(aTokens);
  const sb = new Set(bTokens);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function splitSubject(subject: string): string[] {
  // Split on -, |, /, : and brackets, then trim + dedupe
  const parts = subject
    .split(/\s*[-|/:]\s*|\s*\(.*?\)\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  // also try the whole subject as one part (covers "Mohammed Al Mansoori DIB")
  if (!parts.includes(subject.trim())) parts.push(subject.trim());
  return parts;
}

function findBank(text: string, banks: BankForMatch[]): { name: string; alias: string } | null {
  const lower = text.toLowerCase();
  // Check aliases first (short forms like "DIB" match before "Dubai Islamic Bank")
  for (const [alias, canonical] of Object.entries(BANK_ALIASES)) {
    if (banks.some((b) => b.name === canonical && b.active)) {
      // word-boundary match so "DIB" doesn't match inside "admissible"
      const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(lower)) return { name: canonical, alias };
    }
  }
  // Then full bank names
  for (const b of banks) {
    if (!b.active) continue;
    if (lower.includes(b.name.toLowerCase())) return { name: b.name, alias: b.name };
  }
  return null;
}

export function matchEmail(inp: MatchInput): MatchResult {
  const openCases = inp.cases.filter((c) => c.caseStatus === "Active");
  const subjectParts = splitSubject(inp.subject);
  const subjectTokens = tokenize(inp.subject);

  // 1. Try to find a bank anywhere in the subject.
  const bankHit = findBank(inp.subject, inp.banks);

  // 2. Score every open case by best token-overlap against any subject part.
  let bestCase: { id: number; customer: string; score: number } | null = null;
  for (const c of openCases) {
    const caseTokens = tokenize(c.customer);
    let best = 0;
    for (const part of subjectParts) {
      const partTokens = tokenize(part);
      const score = jaccard(partTokens, caseTokens);
      if (score > best) best = score;
    }
    // also score the whole subject against the case name (covers "Mohammed Al Mansoori DIB" where the name isn't its own segment)
    const whole = jaccard(subjectTokens, caseTokens);
    if (whole > best) best = whole;
    if (!bestCase || best > bestCase.score) {
      bestCase = { id: c.id, customer: c.customer, score: best };
    }
  }

  const customerScore = bestCase?.score ?? 0;
  const hasBank = !!bankHit;

  // 3. Confident → auto-link. Requires a strong customer match AND a bank.
  //    (Bank-only is not enough — many cases share the same bank.)
  if (customerScore >= 0.6 && hasBank && bestCase) {
    return {
      kind: "matched",
      caseId: bestCase.id,
      bankName: bankHit!.name,
      confidence: "high",
      customerScore,
    };
  }

  // 4. Partial → review queue with a best guess if we have one.
  if (customerScore >= 0.4 && bestCase) {
    return {
      kind: "unmatched",
      bestGuessCaseId: bestCase.id,
      customerScore,
      bankName: bankHit?.name ?? null,
      reason: hasBank ? "low-customer" : "no-bank",
    };
  }

  // 5. No match at all.
  return {
    kind: "unmatched",
    bestGuessCaseId: null,
    customerScore,
    bankName: bankHit?.name ?? null,
    reason: "no-match",
  };
}

// Direction inference from sender domain.
export function directionFor(sender: string): "from_bank" | "from_client" | "internal" {
  const lower = sender.toLowerCase();
  if (lower.includes("@meridian.ae") || lower.includes("@hfmc.")) return "internal";
  // crude bank-domain check
  const bankDomains = ["@enbd.", "@adcb.", "@fab.", "@mashreq.", "@hsbc.", "@scb.", "@cbd.", "@dib.", "@adib.", "@uab.", "@rakbank.", "@nbf."];
  if (bankDomains.some((d) => lower.includes(d))) return "from_bank";
  return "from_client";
}

// +2 business days from now (Mon–Fri). Used as the default due date for auto-created tasks.
export function dueInBusinessDays(days: number): string {
  const d = new Date();
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++; // skip Sat/Sun
  }
  return d.toISOString().slice(0, 10);
}
