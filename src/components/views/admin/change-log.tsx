// Admin → Change log
//
// The audit trail made visible. BankProduct.approvedBy only records WHO last
// approved a version; this is what answers "what did we tell the client on 3
// March, and who changed it?" — every pricing-affecting write lands here.
"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/hfmc/ui";
import { fmtDateTime, relTime } from "@/lib/format";

interface LogItem {
  id: number;
  entity: string;
  entityId: string;
  action: string;
  field: string;
  beforeVal: string;
  afterVal: string;
  reason: string;
  actorName: string;
  at: string;
}

const ENTITIES = ["all", "BankProduct", "Promotion", "AppSetting"];

/** Pricing figures are the point of this log, so surface the ones that changed. */
function summarise(item: LogItem): string {
  const pick = (raw: string): string => {
    if (!raw) return "—";
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object") {
        for (const k of ["ratePct", "marginPct", "floorPct"]) if (typeof v[k] === "number") return `${v[k]}%`;
        if (typeof v.minFixedRatePct === "number") return `floor ${v.minFixedRatePct}%`;
        if (v.version) return `v${v.version}`;
      }
      return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
    } catch {
      return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
    }
  };
  return `${pick(item.beforeVal)} → ${pick(item.afterVal)}`;
}

export function ChangeLog() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [entity, setEntity] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = entity === "all" ? "" : `?entity=${entity}`;
      const res = await fetch(`/api/admin/changelog${qs}`);
      if (res.ok) setItems(((await res.json()) as { items: LogItem[] }).items ?? []);
    } catch {
      /* leave the list empty rather than blanking a working view */
    } finally {
      setLoading(false);
    }
  }, [entity]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of the audit trail; the setState is inside an async callback, not the effect body
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="card anim-fade-up">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <div className="min-w-0 flex-1">
          <h3 className="font-disp font-semibold text-[14px] m-0">Change log</h3>
          <p className="text-[11.5px] text-[var(--ink-faint)] mt-0.5 mb-0">
            Every rate, product and overlay edit, with the reason given at the time. Rate revisions never overwrite history — they close the old line and open a new one.
          </p>
        </div>
        <select className="select !w-auto" value={entity} onChange={(e) => setEntity(e.target.value)}>
          {ENTITIES.map((x) => <option key={x} value={x}>{x === "all" ? "Everything" : x}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="p-8 text-center text-[13px]" style={{ color: "var(--ink-faint)" }}>Loading…</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<span>⎘</span>} title="No changes recorded yet"
          body="Revise a rate in the Rate Desk, or save the pricing floor, and it will appear here." />
      ) : (
        <div className="rf-scroll rf-scroll-x">
          <table className="tbl w-full">
            <thead>
              <tr><th>When</th><th>Who</th><th>What</th><th>Change</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="whitespace-nowrap text-[11.5px]">
                    <div>{relTime(i.at)}</div>
                    <div style={{ color: "var(--ink-faint)" }}>{fmtDateTime(i.at)}</div>
                  </td>
                  <td className="whitespace-nowrap">{i.actorName || "—"}</td>
                  <td className="whitespace-nowrap text-[11.5px]">
                    {i.entity}{i.field ? <span style={{ color: "var(--ink-faint)" }}> · {i.field}</span> : null}
                    <div style={{ color: "var(--amber)" }}>{i.action}</div>
                  </td>
                  <td className="mono text-[11.5px] whitespace-nowrap">{summarise(i)}</td>
                  <td className="text-[11.5px]" style={{ color: "var(--ink-dim)" }}>{i.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
