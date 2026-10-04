"use client";

/**
 * Phase D — the PERSON screen.
 *
 * READ-ONLY BY DESIGN, and that is the whole point. Everything here is derived
 * from the store on render; nothing is persisted, because "active facilities" and
 * "lifetime value" are not facts ABOUT a person — they are answers to questions
 * about their cases. Storing them would create a second source of truth that
 * silently rots the moment a case changes.
 *
 * THE BOUNDARY (the rule that keeps this honest):
 *   Client = stagnant personal facts. personData = latest known truth.
 *   Everything below "their engagements" belongs to the CASES, not the person.
 *   "Co-borrower on HFMC-0187" is a role on a LINK, not a permanent fact about
 *   Ahmed's wife — so it is read from CaseParty and never written onto Client.
 */
import { useMemo } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { Avatar, Chip, ContactLine, EmptyState } from "@/components/hfmc/ui";
import type { CaseParty, ClientDto, Lead, LoanCase, PartyRole, ServiceLineDto } from "@/lib/types";
import { fmtMoney } from "@/lib/format";

/** One engagement, tagged with how this person is involved and by which line. */
type Row = { kase: LoanCase; role: "Primary" | PartyRole | null; line: ServiceLineDto | undefined };

function engagementsFor(clientId: number, cases: LoanCase[], parties: CaseParty[]): Row[] {
  const partyByCase = new Map<number, CaseParty>();
  for (const p of parties) if (p.clientId === clientId) partyByCase.set(p.caseId, p);

  const rows: Row[] = [];
  for (const k of cases) {
    // Primary is checked FIRST: someone who is both the primary applicant and a
    // listed party is labelled once, not twice.
    if (k.clientId === clientId) rows.push({ kase: k, role: "Primary", line: undefined });
    else {
      const p = partyByCase.get(k.id);
      if (p) rows.push({ kase: k, role: p.role, line: undefined });
      else if (k.secondPartyClientId === clientId)
        rows.push({ kase: k, role: "CoBorrower", line: undefined });
    }
  }
  return rows;
}

export default function ClientPersonScreen({ client }: { client: ClientDto }) {
  const { cases, caseParties, serviceLines, leads, nav } = useHfmcStore();

  const lineById = useMemo(() => new Map(serviceLines.map((s) => [s.id, s])), [serviceLines]);

  const rows = useMemo(() => {
    const built = engagementsFor(client.id, cases, caseParties);
    for (const r of built) r.line = lineById.get(r.kase.serviceLineId);
    // Newest first — the most recent file is nearly always why someone opened this.
    return built.sort((a, b) => b.kase.updatedAt.localeCompare(a.kase.updatedAt));
  }, [client.id, cases, caseParties, lineById]);

  const active = rows.filter((r) => r.kase.caseStatus === "Active");
  const closed = rows.filter((r) => r.kase.caseStatus !== "Active");

  // Lifetime value EXCLUDES lost files: they are not money we booked. Grouped by
  // service line because "2.1M across 3 services" answers "what is this client
  // worth", and one flat number hides that most of it is a single product.
  const byLine = useMemo(() => {
    const m = new Map<string, { line: ServiceLineDto | undefined; n: number; volume: number }>();
    for (const r of rows) {
      if (r.kase.caseStatus === "Lost") continue;
      const key = r.line?.code ?? "UNASSIGNED";
      const cur = m.get(key) ?? { line: r.line, n: 0, volume: 0 };
      cur.n++;
      cur.volume += r.kase.loanAmount;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.volume - a.volume);
  }, [rows]);

  const totalVolume = byLine.reduce((s, x) => s + x.volume, 0);
  const openLeads = (leads as Lead[]).filter(
    (l) => l.clientId === client.id && l.status !== "Converted" && l.status !== "Lost"
  );

  // Net monthly position. Debt service is an outflow, rental income an inflow.
  // Surfaced because a WILL has to account for the debts and a MORTGAGE has to
  // afford them — the two reasons anyone looks up a person.
  const monthlyIncome = client.monthlySalary + client.variableIncome + client.rentalIncome;
  const monthlyOutgo = client.existingEmis;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="card p-4">
      <div className="font-disp font-semibold text-[13.5px] mb-3">{title}</div>
      {children}
    </div>
  );

  return (
    <div className="space-y-3">
/** Who they are — stagnant personal facts. Nothing case-shaped appears here. */
function PersonHeader({ client }: { client: ClientDto }) {
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <Avatar name={client.fullName} size={44} />
        <div className="min-w-0 flex-1">
          <div className="font-disp font-semibold text-[16px]">{client.fullName}</div>
          <div className="text-[12px] text-[var(--ink-dim)] mt-0.5">
            {client.employmentProfile}
            {client.companyName ? ` · ${client.companyName}` : ""}
            {client.nationality ? ` · ${client.nationality}` : ""}
          </div>
          <div className="mt-2">
            <ContactLine
              contact={{ phone: client.phone, email: client.email, whatsapp: null }}
              size={12}
            />
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {client.eidNo ? (
              <Chip tone="mint">EID {client.eidNo}</Chip>
            ) : client.passportNo ? (
              <Chip tone="mint">Passport {client.passportNo}</Chip>
            ) : (
              <Chip tone="amber">KYC gap</Chip>
            )}
            {client.emirate && <Chip tone="slate">{client.emirate}</Chip>}
            <Chip tone="slate">{client.residency}</Chip>
          </div>
        </div>
      </div>
    </div>
  );
}

function MoneyStrip({
  income,
  outgo,
  volume,
  activeCount,
}: {
  income: number;
  outgo: number;
  volume: number;
  activeCount: number;
type LineGroup = { line: ServiceLineDto | undefined; n: number; volume: number };

/** "What are their active facilities" — the question this whole screen exists for. */
function Facilities({
  byLine,
  openLeads,
  serviceLines,
}: {
  byLine: LineGroup[];
  openLeads: Lead[];
  serviceLines: ServiceLineDto[];
}) {
  return (
    <div className="card p-4">
      <div className="font-disp font-semibold text-[13.5px] mb-3">Active facilities</div>
      {byLine.length === 0 ? (
        <div className="text-[12px] text-[var(--ink-faint)]">No live or completed engagements yet.</div>
      ) : (
        <div className="space-y-1.5">
          {byLine.map((g) => (
            <div key={g.line?.code ?? "UNASSIGNED"} className="flex items-center gap-2">
              <Chip tone={g.line ? "amber" : "coral"}>{g.line?.shortName ?? "Unassigned"}</Chip>
              <span className="text-[12px] text-[var(--ink-dim)]">
                {g.n} file{g.n === 1 ? "" : "s"}
              </span>
              <span className="mono text-[12px] ml-auto">{fmtMoney(g.volume)}</span>
            </div>
          ))}
        </div>
      )}

      {openLeads.length > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px dashed var(--line)" }}>
          <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--ink-faint)] mb-1.5">
            Open enquiries
          </div>
          {/* An unconverted lead is interest, not business — kept separate so a
              pipeline number is never mistaken for a deal. */}
          {openLeads.map((l) => (
            <div key={l.id} className="text-[12px] flex items-center gap-2 py-0.5">
              <Chip tone="slate">{l.status}</Chip>
              <span>{l.name}</span>
              <span className="text-[var(--ink-faint)]">
                {serviceLines.find((s) => s.id === l.serviceLineId)?.shortName ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Engagements({ rows, onOpen }: { rows: Row[]; onOpen: (caseId: number) => void }) {
  return (
    <div className="card p-4">
      <div className="font-disp font-semibold text-[13.5px] mb-3">Engagements ({rows.length})</div>
      {rows.length === 0 ? (
        <EmptyState title="No cases yet" body="This person has not been on a case." />
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <button
              key={r.kase.id}
              onClick={() => onOpen(r.kase.id)}
              className="w-full flex items-center gap-2 text-left py-1.5 px-2 rounded hover:bg-[var(--bg2)] transition-colors"
            >
              <span className="mono text-[12px] shrink-0">{r.kase.caseNumber}</span>
              <Chip tone={r.line ? "slate" : "coral"}>{r.line?.shortName ?? "Unassigned"}</Chip>
              {r.role && <Chip tone={r.role === "Primary" ? "mint" : "slate"}>{r.role}</Chip>}
              <span className="text-[12px] text-[var(--ink-dim)] truncate">{r.kase.stage}</span>
              <span
                className="text-[11px] ml-auto shrink-0"
                style={{
                  color:
                    r.kase.caseStatus === "Lost"
                      ? "var(--coral)"
                      : r.kase.caseStatus === "Active"
                        ? "var(--mint)"
                        : "var(--ink-faint)",
                }}
              >
                {r.kase.caseStatus}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
}) {
  const cell = (label: string, value: string, color?: string) => (
    <div className="card p-3.5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">{label}</div>
      <div className="mono text-[15px] mt-1" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cell("Monthly income", fmtMoney(income))}
      {cell("Debt service", fmtMoney(outgo), outgo ? "var(--coral)" : undefined)}
      {cell("Lifetime value", volume > 0 ? fmtMoney(volume) : "—")}
      {cell("Active files", String(activeCount))}
    </div>
  );
}
      <PersonHeader client={client} />
      <MoneyStrip
        income={monthlyIncome}
        outgo={monthlyOutgo}
        volume={totalVolume}
        activeCount={active.length}
      />
      <Facilities byLine={byLine} openLeads={openLeads} serviceLines={serviceLines} />
      <Engagements rows={[...active, ...closed]} onOpen={(id) => nav({ name: "case", id })} />
    </div>
  );
}