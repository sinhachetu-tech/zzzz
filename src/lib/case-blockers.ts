/* Case blockers — ONE ranked answer to "what is stopping this file?".
 *
 * WHY THIS FILE EXISTS: the blockers used to be scattered across the sticky bar
 * (next best action = oldest open task), the stage cards (docs x/y), the Collect
 * panel (count of documents still needed), the tab badges (six different styles)
 * and the data-sheet tab ("16 needed"). Six surfaces, six visual languages, and
 * nothing that ranked them — so "3 documents" sat above "task is 4 days
 * overdue". Same class of bug the CollectPanel comment warns about: a second
 * stored checklist would drift, so this is a PURE PROJECTION of rows that
 * already exist and are already owned elsewhere. It stores nothing.
 *
 * RANKING IS THE POINT. Order of precedence:
 *   1. overdue task      — a promise was broken, it is visible and embarrassing
 *   2. missing doc       — mandatory paperwork, blocks progression
 *   3. open instruction  — someone senior is waiting on us
 *   4. data-sheet gap    — we are waiting on the client, not on ourselves
 *   5. no daily update   — today's note has not been written
 * Self-service work (adding a task, running a match) deliberately does NOT
 * appear: the strip exists to surface what is ALREADY owed, not to advertise
 * buttons.
 *
 * `tab` on each blocker is what makes the strip actionable — "Resolve" jumps
 * straight to the one place that can clear it, instead of leaving the user to
 * work out which of five workspaces owns the problem.
 */

import type { CaseDocument, ClientDto, Instruction, LoanCase, Task } from "@/lib/types";
import { isOverdueDue, parseTaskDue, todayISO } from "@/lib/format";
import { sheetCompletion } from "@/lib/person-sheet";
import type { CaseTab } from "@/components/case/stage-parts";

/** block = only we can clear it and it is late. wait = we are waiting on
 *  someone else. due = a habit that is slipping, not yet a breach. */
export type BlockerTone = "block" | "wait" | "due";

export interface Blocker {
  key: string;
  tone: BlockerTone;
  /** short noun phrase, e.g. "2 documents still needed" */
  label: string;
  /** the specific thing, when there is exactly one worth naming */
  detail: string | null;
  /** where this can be resolved */
  tab: CaseTab;
}

export interface CaseBlockerInput {
  c: LoanCase;
  tasks: Task[];
  /** outstanding document rows — the caller derives these with the vault's own
   *  `isDocOutstanding`, so the strip can never disagree with the vault */
  outstandingDocs: CaseDocument[];
  clients: ClientDto[];
  instructions: Instruction[];
  /** ISO dates (YYYY-MM-DD) on which a daily update was logged */
  updatedOn: string[];
}

function taskTime(t: Task): number {
  return parseTaskDue(t.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

export function computeCaseBlockers(input: CaseBlockerInput): Blocker[] {
  const { c, tasks, outstandingDocs, clients, instructions, updatedOn } = input;
  const out: Blocker[] = [];

  // 1) overdue tasks — only open ones, oldest instant first
  const overdue = tasks
    .filter((t) => t.status === "Open" && isOverdueDue(t.dueDate))
    .sort((a, b) => taskTime(a) - taskTime(b));
  for (const t of overdue) {
    out.push({
      key: `task-${t.id}`,
      tone: "block",
      label: overdue.length === 1 ? "Task overdue" : `${overdue.length} tasks overdue`,
      detail: t.description,
      tab: "now",
    });
  }

  // 2) mandatory paperwork outstanding. Optional docs are deliberately absent:
  //    CollectPanel already labels them "if applicable", and a blocker strip
  //    that cries wolf is a blocker strip people stop reading.
  const mand = outstandingDocs.filter((d) => d.mandatory);
  if (mand.length > 0) {
    out.push({
      key: "docs",
      tone: "block",
      label: mand.length === 1 ? "Document required" : `${mand.length} documents required`,
      detail: mand.length === 1 ? mand[0].title : null,
      tab: "documents",
    });
  }

  // 3) open instructions to us
  const openInstr = instructions.filter((i) => i.status === "Open");
  if (openInstr.length > 0) {
    out.push({
      key: "instr",
      tone: "wait",
      label: openInstr.length === 1 ? "Instruction open" : `${openInstr.length} instructions open`,
      detail: openInstr.length === 1 ? openInstr[0].instruction : null,
      tab: "now",
    });
  }

  // 4) bank-application data sheet gaps — we are waiting on the client
  let sheetTotal = 0;
  let sheetDone = 0;
  for (const id of [c.clientId, c.secondPartyClientId]) {
    if (!id) continue;
    const cl = clients.find((x) => x.id === id);
    if (!cl) continue;
    const comp = sheetCompletion(cl.personData ?? {}, {
      selfEmployed: cl.employmentProfile === "Self-Employed",
    });
    sheetTotal += comp.total;
    sheetDone += comp.done;
  }
  const sheetMissing = sheetTotal - sheetDone;
  if (sheetTotal > 0 && sheetMissing > 0) {
    out.push({
      key: "sheet",
      tone: "wait",
      label: `${sheetMissing} data-sheet field${sheetMissing === 1 ? "" : "s"} outstanding`,
      detail: null,
      tab: "client",
    });
  }

  // 5) today's note. Only for a live case past Lead — a brand-new lead or a
  //    closed file has no business carrying a "log an update" nag.
  const pastLead = c.stage !== "Lead";
  if (c.caseStatus === "Active" && pastLead && !updatedOn.includes(todayISO())) {
    out.push({
      key: "daily",
      tone: "due",
      label: "No daily update today",
      detail: null,
      tab: "now",
    });
  }

  return out;
}

/** The one line the command bar turns into a button. `null` means there is
 *  genuinely nothing owed and the bar says so plainly rather than inventing a
 *  task to look busy. */
export function primaryAction(blockers: Blocker[]): Blocker | null {
  return blockers[0] ?? null;
}
