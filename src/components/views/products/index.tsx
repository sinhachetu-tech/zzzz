// Products — the broker-facing product catalogue.
//
// Two views behind one route: a filterable, paginated LIST of every live rate line
// (the axis signature + headline rate), and a DETAIL sheet for one product. Kept as
// one view so "back to the list" never loses the broker's filters — they are
// component state, not a route, which is what the rest of this app does.
"use client";

import { useState } from "react";
import { ProductBrowser } from "@/components/views/products/browser";
import { ProductDetail } from "@/components/views/products/detail";

export function Products() {
  const [openId, setOpenId] = useState<number | null>(null);

  if (openId != null) {
    return <ProductDetail id={openId} onBack={() => setOpenId(null)} />;
  }
  return (
    <div className="space-y-3">
      <div className="px-1">
        <h1 className="font-disp font-semibold text-[17px] m-0">Bank products</h1>
        <p className="text-[12px] text-[var(--ink-faint)] m-0">
          Every live rate line across all banks — who it is for, what it costs, and what it charges.
        </p>
      </div>
      <ProductBrowser onOpen={(id) => setOpenId(id)} />
    </div>
  );
}
