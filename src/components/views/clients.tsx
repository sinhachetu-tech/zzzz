"use client";

/* Clients — the PERSON behind every engagement, in one list.

   WHY THIS TAB EXISTS: the app has four words that sound like four things but
   are not. A "Lead" is a LoanCase row while stage === "Lead"; a "Case" is that
   same row once converted; a "Client" is the human being; a "Proposal" is a
   saved quote attached to a case. Nothing on screen made that obvious, because
   the Client master had no list view at all — you could only reach a client
   through the Calculator's picker or Case 360's inspector card.

   So this is deliberately the answer to "who is this person?":
     · contact details as tappable links
     · how many engagements we have with them, and what stage each is at
     · lifetime volume, so a repeat client is visibly worth more than a new one

   Read-only on purpose. The Client master is written by syncCaseClients()
   whenever a case profile is saved, so editing it here would just be overwritten
   by the next profile save. Edit the person on their case instead. */

import { useEffect, useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Avatar, Chip, EmptyState } from "@/components/hfmc/ui";
import { ContactLine, resolveContact } from "@/components/case/ContactBits";
import { IUsers } from "@/components/icons";

type SortKey = "name" | "engagements" | "volume" | "recent";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Most recent" },
  { value: "engagements", label: "Most engagements" },
  { value: "volume", label: "Largest volume" },
  { value: "name", label: "Name A–Z" },
];

export default function Clients() {
  const { clients, cases, caseParties, nav, route } = useHfmcStore();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  // Phase B: a deep link (nav({name:"clients", clientId}) — from the parties
  // list on a case) prefills the search with that person's name, so they are
  // actually on screen. Without this the id would arrive and be ignored, and
  // clicking a co-borrower's name would look like it did nothing.
  const focusId = route.name === "clients" ? route.clientId : undefined;
  const focusName = focusId ? clients.find((c) => c.id === focusId)?.fullName : undefined;
  useEffect(() => {
    if (focusName) setSearch(focusName);
  }, [focusName]);

  // A client's engagements are every case they appear on — as the primary
  // applicant OR as a co-borrower / co-applicant. A co-borrower IS a client with
  // their own row, and their volume is real business, so both links count.
  const rows = useMemo(() => {
    const byClient = new Map<number, typeof cases>();
    const add = (id: number | null | undefined, k: (typeof cases)[number]) => {
      if (!id) return;
      const list = byClient.get(id);
      if (list) {
        // A person can reach a case twice (primary AND party). Count it once —
        // their lifetime volume would otherwise be double-counted.
        if (!list.some((x) => x.id === k.id)) list.push(k);
      } else {
        byClient.set(id, [k]);
      }
    };

    for (const c of cases) {
      add(c.clientId, c);
      add(c.secondPartyClientId, c);
    }
    // Phase B: the repeatable party list, not just the one legacy slot. Without
    // this a SECOND co-applicant would show zero engagements and zero volume on
    // their own client record — the exact invisibility CaseParty was built to fix.
    const caseById = new Map(cases.map((c) => [c.id, c]));
    for (const p of caseParties) {
      const k = caseById.get(p.caseId);
      if (k) add(p.clientId, k);
    }

    const mapped = clients.map((cl) => {
      const eng = byClient.get(cl.id) ?? [];
      // Lifetime volume = the loan amount of every engagement that is not lost.
      // Lost files are excluded on purpose: they are not money we booked.
      const volume = eng.filter((c) => c.caseStatus !== "Lost").reduce((s, c) => s + c.loanAmount, 0);
      const lastAt = eng.reduce((m, c) => (c.updatedAt > m ? c.updatedAt : m), cl.createdAt);
      return {
        client: cl,
        engagements: eng,
        volume,
        lastAt,
        contact: resolveContact(
          { whatsapp: cl.phone, profileJson: null, customer: cl.fullName } as never,
          cl,
        ),
      };
    });

    const q = search.trim().toLowerCase();
    const filtered = q
      ? mapped.filter(
          (r) =>
            r.client.fullName.toLowerCase().includes(q) ||
            (r.client.phone || "").includes(q.replace(/\D/g, "")) ||
            (r.client.email || "").toLowerCase().includes(q) ||
            (r.client.eidNo || "").includes(q.replace(/\D/g, "")) ||
            r.engagements.some((c) => c.caseNumber.toLowerCase().includes(q)),
        )
      : mapped;

    return filtered.sort((a, b) => {
      if (sort === "name") return a.client.fullName.localeCompare(b.client.fullName);
      if (sort === "engagements") return b.engagements.length - a.engagements.length;
      if (sort === "volume") return b.volume - a.volume;
      return b.lastAt.localeCompare(a.lastAt);
    });
  }, [clients, cases, caseParties, search, sort]);

  const totalVolume = rows.reduce((s, r) => s + r.volume, 0);
  const repeatCount = rows.filter((r) => r.engagements.length > 1).length;
  const noContact = rows.filter((r) => !r.contact.phone && !r.contact.email).length;

  const stats = [
    { label: "Clients on file", value: String(rows.length) },
    { label: "Repeat clients", value: String(repeatCount) },
    { label: "Live volume", value: fmtMoney(totalVolume) },
    { label: "No contact details", value: String(noContact) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0 flex items-center gap-2.5">
            Clients
          </h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            Every person we work with, and every engagement we have with them. A client outlives any single case —
            edit their details from inside a case.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input w-full sm:!w-[220px]"
            placeholder="Name / phone / email / EID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="select !w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Headline numbers — the reason to look at this tab at all */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {stats.map((s) => (
          <div key={s.label} className="card p-3.5 anim-fade-up">
            <div className="mono text-[18px] font-semibold" style={{ color: "var(--amber)" }}>
              {s.value}
            </div>
            <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card p-10">
          <EmptyState
            icon={<IUsers size={24} />}
            title={search ? "No client matches that search" : "No clients on file yet"}
            body={search
              ? "Try a phone number, an Emirates ID, or part of a case number."
              : "Clients are created automatically when a lead or case is saved with a name and phone."}
          />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card overflow-x-auto hidden md:block" style={{ maxHeight: "62vh" }}>
            <table className="tbl min-w-[900px]">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th>KYC</th>
                  <th>Engagements</th>
                  <th>Volume</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ client, engagements, volume, lastAt, contact }) => (
                  <tr key={client.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Avatar name={client.fullName} size={26} />
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium truncate" style={{ maxWidth: 180 }}>{client.fullName}</div>
                          <div className="text-[10.5px] text-[var(--ink-faint)]">
                            {client.employmentProfile}{client.companyName ? ` · ${client.companyName}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><ContactLine contact={contact} size={11.5} /></td>
                    <td>
                      {client.eidNo
                        ? <Chip tone="mint">EID {client.eidNo}</Chip>
                        : client.passportNo
                          ? <Chip tone="mint">Passport {client.passportNo}</Chip>
                          : <Chip tone="amber">KYC gap</Chip>}
                    </td>
                    <td>
                      {engagements.length === 0 ? (
                        <span className="text-[var(--ink-faint)]">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {engagements.slice(0, 3).map((k) => (
                            <button
                              key={k.id}
                              className="chip hover:underline"
                              title={`${k.caseNumber} · ${k.stage} · ${k.caseStatus}`}
                              style={{ fontSize: "10px" }}
                              onClick={() => nav({ name: "case", id: k.id })}
                            >
                              {k.caseNumber}
                            </button>
                          ))}
                          {engagements.length > 3 && (
                            <span className="chip" style={{ fontSize: "10px" }}>+{engagements.length - 3}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="mono">{volume > 0 ? fmtMoney(volume) : <span className="text-[var(--ink-faint)]">—</span>}</td>
                    <td className="mono text-[12px] text-[var(--ink-dim)]">{fmtDate(lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards — the Clients tab is mostly read on a phone */}
          <div className="md:hidden space-y-2">
            {rows.map(({ client, engagements, volume, lastAt, contact }) => (
              <div key={client.id} className="card p-3.5 anim-fade-up">
                <div className="flex items-start gap-2.5">
                  <Avatar name={client.fullName} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold truncate">{client.fullName}</div>
                    <div className="mt-0.5"><ContactLine contact={contact} size={11.5} /></div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {client.eidNo
                        ? <Chip tone="mint">EID {client.eidNo}</Chip>
                        : client.passportNo
                          ? <Chip tone="mint">Passport {client.passportNo}</Chip>
                          : <Chip tone="amber">KYC gap</Chip>}
                      {engagements.length > 1 && <Chip tone="amber">repeat · {engagements.length} engagements</Chip>}
                      {volume > 0 && <Chip tone="sky">{fmtMoney(volume)}</Chip>}
                    </div>
                    {engagements.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {engagements.slice(0, 4).map((k) => (
                          <button
                            key={k.id}
                            className="chip"
                            style={{ fontSize: "10px" }}
                            onClick={() => nav({ name: "case", id: k.id })}
                          >
                            {k.caseNumber} · {k.stage}
                          </button>
                        ))}
                        {engagements.length > 4 && (
                          <span className="chip" style={{ fontSize: "10px" }}>+{engagements.length - 4}</span>
                        )}
                      </div>
                    )}
                    <div className="mono text-[10.5px] text-[var(--ink-faint)] mt-1.5">last activity {fmtDate(lastAt)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
