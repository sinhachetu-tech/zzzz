// /api/admin/* — master data CRUD for banks, partners, stages, masters, users, designations, sla.
// Each is a small collection: GET (list) + POST (create) on the collection, PATCH/DELETE on :id.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serBank, serPartner, serStage, serMaster, serUser, serChannel, serDocRule, serFeeRule, serCommTemplate, serPromotion } from "@/lib/ser";

async function guard() {
  const me = await currentUser();
  if (!me) return null;
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return null;
  return { me, flags };
}

/* ---------------- banks ---------------- */
export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  if (kind === "banks") return NextResponse.json({ items: (await db.bankItem.findMany({ orderBy: { id: "asc" } })).map(serBank) });
  if (kind === "partners") return NextResponse.json({ items: (await db.partnerItem.findMany({ orderBy: { id: "asc" } })).map(serPartner) });
  if (kind === "stages") return NextResponse.json({ items: (await db.stageItem.findMany({ orderBy: { sortOrder: "asc" } })).map(serStage) });
  if (kind === "masters") {
    const all = await db.masterItem.findMany({ orderBy: { id: "asc" } });
    return NextResponse.json({
      whyPending: all.filter((m) => m.kind === "whyPending").map(serMaster),
      waitingFor: all.filter((m) => m.kind === "waitingFor").map(serMaster),
    });
  }
  if (kind === "users") return NextResponse.json({ items: (await db.user.findMany({ orderBy: { id: "asc" } })).map(serUser) });
  if (kind === "designations") return NextResponse.json({ items: await db.designation.findMany({ orderBy: { id: "asc" } }) });
  if (kind === "channels") return NextResponse.json({ items: (await db.channelItem.findMany({ orderBy: { id: "asc" } })).map(serChannel) });
  if (kind === "sla") return NextResponse.json({ items: await db.slaRule.findMany({ orderBy: { id: "asc" } }) });
  if (kind === "docrules") return NextResponse.json({ items: (await db.docRule.findMany({ orderBy: { id: "asc" } })).map(serDocRule) });
  if (kind === "feerules") return NextResponse.json({ items: (await db.feeRule.findMany({ orderBy: [{ emirate: "asc" }, { sortOrder: "asc" }] })).map(serFeeRule) });
  if (kind === "commtemplates") return NextResponse.json({ items: (await db.commTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] })).map(serCommTemplate) });
  if (kind === "promotions") return NextResponse.json({ items: (await db.promotion.findMany({ orderBy: [{ validFrom: "desc" }, { id: "asc" }] })).map(serPromotion) });
  return NextResponse.json({ error: "kind required" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json();
  const { kind } = body;
  try {
    if (kind === "bank") {
      const item = await db.bankItem.create({ data: { name: body.name, ratePct: body.ratePct ?? 0, active: body.active ?? true, contactsJson: JSON.stringify(Array.isArray(body.contacts) ? body.contacts : []) } });
      return NextResponse.json({ item: serBank(item) });
    }
    if (kind === "partner") {
      const item = await db.partnerItem.create({ data: { kind: body.partnerKind, name: body.name, defaultSharePct: body.defaultSharePct ?? 20, password: body.password || "agent123", active: body.active ?? true, contactsJson: JSON.stringify(Array.isArray(body.contacts) ? body.contacts : []) } });
      return NextResponse.json({ item: serPartner(item) });
    }
    if (kind === "channel") {
      const item = await db.channelItem.create({ data: { name: body.name, commissionPct: body.commissionPct ?? 0.4, active: body.active ?? true, contactsJson: JSON.stringify(Array.isArray(body.contacts) ? body.contacts : []) } });
      return NextResponse.json({ item: serChannel(item) });
    }
    if (kind === "stage") {
      const max = await db.stageItem.aggregate({ _max: { sortOrder: true } });
      const item = await db.stageItem.create({ data: { label: body.label, active: true, sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1 } });
      return NextResponse.json({ item: serStage(item) });
    }
        if (kind === "bankproduct_version") {
      const orig = await db.bankProduct.findUnique({ where: { id: Number(body.originalProductId) } });
      if (!orig) return NextResponse.json({ error: "original product not found" }, { status: 404 });
      const newEffective = body.effectiveDate ? String(body.effectiveDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
      const newExpiry = body.expiryDate ? String(body.expiryDate).slice(0, 10) : "2099-12-31";
      
      const prevDate = new Date(new Date(newEffective).getTime() - 86400000).toISOString().slice(0, 10);
      await db.bankProduct.update({
        where: { id: orig.id },
        data: { expiryDate: prevDate },
      });

      const maxVersion = orig.version ?? 1;
      const { id: _omitId, createdAt: _omitC, updatedAt: _omitU, ...origFields } = orig;
      const item = await db.bankProduct.create({
        data: {
          ...origFields,
          version: maxVersion + 1,
          effectiveDate: newEffective,
          expiryDate: newExpiry,
          pricingJson: body.pricingJson ?? orig.pricingJson,
          feesJson: body.feesJson ?? orig.feesJson,
          insuranceJson: body.insuranceJson ?? orig.insuranceJson,
          rateTable: body.rateTable ?? orig.rateTable,
          notes: body.notes ?? orig.notes,
          status: "approved",
          approvedBy: g.me.name,
        },
      });
      return NextResponse.json({ item });
    }
    if (kind === "master") {
      const item = await db.masterItem.create({ data: { kind: body.masterKind, label: body.label, active: true } });
      return NextResponse.json({ item: serMaster(item) });
    }
    if (kind === "user") {
      const item = await db.user.create({ data: { name: body.name, email: body.email.toLowerCase(), password: body.password || "demo123", role: body.role, team: body.team || "Dubai", active: body.active ?? true, phone: body.phone?.trim() || null } });
      return NextResponse.json({ item: serUser(item) });
    }
    if (kind === "designation") {
      const item = await db.designation.create({ data: { name: body.name, scope: body.scope ?? "own", issueTasks: !!body.issueTasks, admin: !!body.admin, super: !!body.super, viewRevenue: !!body.viewRevenue, manageDocs: body.manageDocs !== undefined ? !!body.manageDocs : true, clientChat: body.clientChat !== undefined ? !!body.clientChat : true, builtIn: false } });
      return NextResponse.json({ item });
    }
    if (kind === "sla") {
      const item = await db.slaRule.create({ data: { stage: body.stage, bank: body.bank ?? null, maxDays: body.maxDays, active: true } });
      return NextResponse.json({ item });
    }
    if (kind === "docrule") {
      const item = await db.docRule.create({
        data: {
          name: body.name, category: body.category ?? "KYC",
          validityDays: body.validityDays ?? 0, warnDays: body.warnDays ?? 7,
          verifyNotes: body.verifyNotes ?? "",
          applicableEmployment: JSON.stringify(body.applicableEmployment?.length ? body.applicableEmployment : ["all"]),
          applicablePropertyType: JSON.stringify(body.applicablePropertyType?.length ? body.applicablePropertyType : ["any"]),
          applicableTransaction: JSON.stringify(body.applicableTransaction?.length ? body.applicableTransaction : ["any"]),
          applicableResidency: JSON.stringify(body.applicableResidency?.length ? body.applicableResidency : ["all"]),
          mandatory: body.mandatory ?? true,
          visibleToClient: body.visibleToClient ?? true,
          clientCanUpload: body.clientCanUpload ?? true,
          expiryTrackingRequired: body.expiryTrackingRequired ?? ((body.validityDays ?? 0) > 0 || (body.warnDays ?? 0) > 0),
          active: body.active ?? true,
        },
      });
      return NextResponse.json({ item: serDocRule(item) });
    }
    if (kind === "feerule") {
      const max = await db.feeRule.aggregate({ where: { emirate: body.emirate, txnType: body.txnType }, _max: { sortOrder: true } });
      const item = await db.feeRule.create({
        data: {
          emirate: body.emirate, txnType: body.txnType, label: body.label,
          amountType: body.amountType ?? "fixed", amount: body.amount ?? 0,
          paidBy: body.paidBy ?? "Client", note: body.note ?? "",
          sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1, active: body.active ?? true,
        },
      });
      return NextResponse.json({ item: serFeeRule(item) });
    }
    if (kind === "commtemplate") {
      const max = await db.commTemplate.aggregate({ _max: { sortOrder: true } });
      const item = await db.commTemplate.create({
        data: {
          key: body.key, channel: body.channel ?? "whatsapp", stageKey: body.stageKey ?? "doc",
          bank: body.bank ?? null, name: body.name, subject: body.subject ?? null,
          body: body.body, vars: JSON.stringify(body.vars ?? []),
          sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 10, active: body.active ?? true,
        },
      });
      return NextResponse.json({ item: serCommTemplate(item) });
    }
    if (kind === "promotion") {
      if (!body.name || !body.validFrom || !body.validTo) {
        return NextResponse.json({ error: "name, validFrom, validTo are required" }, { status: 400 });
      }
      if (String(body.validTo) < String(body.validFrom)) {
        return NextResponse.json({ error: "validTo must be on/after validFrom" }, { status: 400 });
      }
      const item = await db.promotion.create({
        data: {
          bankProductId: Number(body.bankProductId),
          name: body.name, description: body.description ?? "",
          rateOptionTermYears: body.rateOptionTermYears == null || body.rateOptionTermYears === "" ? null : Number(body.rateOptionTermYears),
          rateDiscountBps: body.rateDiscountBps == null || body.rateDiscountBps === "" ? null : Number(body.rateDiscountBps),
          processingFeeOverridePct: body.processingFeeOverridePct == null || body.processingFeeOverridePct === "" ? null : Number(body.processingFeeOverridePct),
          valuationFeeWaived: !!body.valuationFeeWaived,
          validFrom: String(body.validFrom).slice(0, 10),
          validTo: String(body.validTo).slice(0, 10),
          active: body.active ?? true,
          createdBy: g.me.name,
        },
      });
      return NextResponse.json({ item: serPromotion(item) });
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "create failed" }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json();
  const { kind, id } = body;
  const numId = parseInt(id, 10);
  try {
    if (kind === "bank") {
      const item = await db.bankItem.update({ where: { id: numId }, data: { name: body.name, ratePct: body.ratePct, active: body.active, ...(body.contacts !== undefined ? { contactsJson: JSON.stringify(Array.isArray(body.contacts) ? body.contacts : []) } : {}) } });
      return NextResponse.json({ item: serBank(item) });
    }
    if (kind === "partner") {
      const item = await db.partnerItem.update({ where: { id: numId }, data: { name: body.name, kind: body.partnerKind, defaultSharePct: body.defaultSharePct, password: body.password || undefined, active: body.active, ...(body.contacts !== undefined ? { contactsJson: JSON.stringify(Array.isArray(body.contacts) ? body.contacts : []) } : {}) } });
      return NextResponse.json({ item: serPartner(item) });
    }
    if (kind === "channel") {
      const item = await db.channelItem.update({ where: { id: numId }, data: { name: body.name, commissionPct: body.commissionPct, active: body.active, ...(body.contacts !== undefined ? { contactsJson: JSON.stringify(Array.isArray(body.contacts) ? body.contacts : []) } : {}) } });
      return NextResponse.json({ item: serChannel(item) });
    }
    if (kind === "stage") {
      const item = await db.stageItem.update({ where: { id: numId }, data: { label: body.label, active: body.active, sortOrder: body.sortOrder } });
      return NextResponse.json({ item: serStage(item) });
    }
        if (kind === "bankproduct_version") {
      const orig = await db.bankProduct.findUnique({ where: { id: Number(body.originalProductId) } });
      if (!orig) return NextResponse.json({ error: "original product not found" }, { status: 404 });
      const newEffective = body.effectiveDate ? String(body.effectiveDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
      const newExpiry = body.expiryDate ? String(body.expiryDate).slice(0, 10) : "2099-12-31";
      
      const prevDate = new Date(new Date(newEffective).getTime() - 86400000).toISOString().slice(0, 10);
      await db.bankProduct.update({
        where: { id: orig.id },
        data: { expiryDate: prevDate },
      });

      const maxVersion = orig.version ?? 1;
      const { id: _omitId, createdAt: _omitC, updatedAt: _omitU, ...origFields } = orig;
      const item = await db.bankProduct.create({
        data: {
          ...origFields,
          version: maxVersion + 1,
          effectiveDate: newEffective,
          expiryDate: newExpiry,
          pricingJson: body.pricingJson ?? orig.pricingJson,
          feesJson: body.feesJson ?? orig.feesJson,
          insuranceJson: body.insuranceJson ?? orig.insuranceJson,
          rateTable: body.rateTable ?? orig.rateTable,
          notes: body.notes ?? orig.notes,
          status: "approved",
          approvedBy: g.me.name,
        },
      });
      return NextResponse.json({ item });
    }
    if (kind === "master") {
      const item = await db.masterItem.update({ where: { id: numId }, data: { label: body.label, active: body.active } });
      return NextResponse.json({ item: serMaster(item) });
    }
    if (kind === "user") {
      const data: Record<string, unknown> = { name: body.name, email: body.email?.toLowerCase(), role: body.role, team: body.team, active: body.active };
      if (body.password) data.password = body.password;
      if (body.phone !== undefined) data.phone = body.phone?.trim() || null;
      const item = await db.user.update({ where: { id: numId }, data });
      return NextResponse.json({ item: serUser(item) });
    }
    if (kind === "designation") {
      const data: Record<string, unknown> = { name: body.name, scope: body.scope, issueTasks: !!body.issueTasks, admin: !!body.admin, super: !!body.super, viewRevenue: !!body.viewRevenue };
      if (body.manageDocs !== undefined) data.manageDocs = !!body.manageDocs;
      if (body.clientChat !== undefined) data.clientChat = !!body.clientChat;
      const item = await db.designation.update({ where: { id: numId }, data });
      return NextResponse.json({ item });
    }
    if (kind === "sla") {
      const item = await db.slaRule.update({ where: { id: numId }, data: { stage: body.stage, bank: body.bank ?? null, maxDays: body.maxDays, active: body.active } });
      return NextResponse.json({ item });
    }
    if (kind === "docrule") {
      const item = await db.docRule.update({
        where: { id: numId },
        data: {
          name: body.name, category: body.category, validityDays: body.validityDays,
          warnDays: body.warnDays, verifyNotes: body.verifyNotes,
          ...(body.applicableEmployment ? { applicableEmployment: JSON.stringify(body.applicableEmployment) } : {}),
          ...(body.applicablePropertyType ? { applicablePropertyType: JSON.stringify(body.applicablePropertyType) } : {}),
          ...(body.applicableTransaction ? { applicableTransaction: JSON.stringify(body.applicableTransaction) } : {}),
          ...(body.applicableResidency ? { applicableResidency: JSON.stringify(body.applicableResidency) } : {}),
          ...(body.mandatory !== undefined ? { mandatory: !!body.mandatory } : {}),
          ...(body.visibleToClient !== undefined ? { visibleToClient: !!body.visibleToClient } : {}),
          ...(body.clientCanUpload !== undefined ? { clientCanUpload: !!body.clientCanUpload } : {}),
          ...(body.expiryTrackingRequired !== undefined ? { expiryTrackingRequired: !!body.expiryTrackingRequired } : {}),
          active: body.active,
        },
      });
      return NextResponse.json({ item: serDocRule(item) });
    }
    if (kind === "eibor") {
      const item = await db.eiborRate.upsert({
        where: { tenor: body.tenor },
        create: { tenor: body.tenor, ratePct: Number(body.ratePct), updatedOn: body.updatedOn ?? new Date().toISOString().slice(0, 10), note: body.note ?? "" },
        update: { ratePct: Number(body.ratePct), updatedOn: body.updatedOn ?? new Date().toISOString().slice(0, 10), note: body.note ?? "" },
      });
      return NextResponse.json({ item });
    }
    if (kind === "bankproduct") {
      const data: Record<string, unknown> = {};
      const numFields = ["maxLtvNational","maxLtvExpatriate","minLoan","maxLoan","tenorYears","minSalary","totalTatDays","paTatDays","paValidityDays","folValidityDays","valuationValidityDays"] as const;
      for (const f of numFields) if (body[f] !== undefined) data[f] = body[f] === null || body[f] === "" ? null : Number(body[f]);
      for (const f of ["rateTable","stressTest","fees","insurance","eligibility","documents","notes","effectiveDate","expiryDate","pricingJson","feesJson","insuranceJson","cardRulePct","bonusPct","rentalIncomePct","rentalCapPctOfSalary","dbrPct","stressBufferPct"]) if (body[f] !== undefined) data[f] = body[f];
      if (body.status !== undefined) {
        data.status = body.status;
        if (body.status === "approved") { data.approvedBy = g.me.name; data.effectiveDate = data.effectiveDate ?? new Date().toISOString().slice(0,10); }
      }
      const item = await db.bankProduct.update({ where: { id: numId }, data });
      return NextResponse.json({ item });
    }
    if (kind === "feerule") {
      const item = await db.feeRule.update({
        where: { id: numId },
        data: {
          emirate: body.emirate, txnType: body.txnType, label: body.label,
          amountType: body.amountType, amount: body.amount, paidBy: body.paidBy,
          note: body.note, sortOrder: body.sortOrder, active: body.active,
        },
      });
      return NextResponse.json({ item: serFeeRule(item) });
    }
    if (kind === "commtemplate") {
      const item = await db.commTemplate.update({
        where: { id: numId },
        data: {
          key: body.key, channel: body.channel, stageKey: body.stageKey,
          bank: body.bank ?? null, name: body.name, subject: body.subject ?? null,
          body: body.body, vars: JSON.stringify(body.vars ?? []),
          sortOrder: body.sortOrder, active: body.active,
        },
      });
      return NextResponse.json({ item: serCommTemplate(item) });
    }
    if (kind === "promotion") {
      const data: Record<string, unknown> = {};
      for (const f of ["name", "description", "validFrom", "validTo", "active"] as const) {
        if (body[f] !== undefined) data[f] = f === "validFrom" || f === "validTo" ? String(body[f]).slice(0, 10) : body[f];
      }
      for (const f of ["bankProductId", "rateOptionTermYears", "rateDiscountBps", "processingFeeOverridePct"] as const) {
        if (body[f] === undefined) continue;
        data[f] = body[f] == null || body[f] === "" ? null : Number(body[f]);
      }
      if (body.valuationFeeWaived !== undefined) data.valuationFeeWaived = !!body.valuationFeeWaived;
      if (data.validFrom && data.validTo && String(data.validTo) < String(data.validFrom)) {
        return NextResponse.json({ error: "validTo must be on/after validFrom" }, { status: 400 });
      }
      const item = await db.promotion.update({ where: { id: numId }, data });
      return NextResponse.json({ item: serPromotion(item) });
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "update failed" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id");
  if (!kind || !id) return NextResponse.json({ error: "kind & id required" }, { status: 400 });
  const numId = parseInt(id, 10);
  try {
    if (kind === "bank") await db.bankItem.delete({ where: { id: numId } });
    else if (kind === "partner") await db.partnerItem.delete({ where: { id: numId } });
    else if (kind === "channel") await db.channelItem.delete({ where: { id: numId } });
    else if (kind === "stage") await db.stageItem.delete({ where: { id: numId } });
    else if (kind === "master") await db.masterItem.delete({ where: { id: numId } });
    else if (kind === "user") await db.user.delete({ where: { id: numId } });
    else if (kind === "designation") await db.designation.delete({ where: { id: numId } });
    else if (kind === "sla") await db.slaRule.delete({ where: { id: numId } });
    else if (kind === "bankproduct") await db.bankProduct.delete({ where: { id: numId } });
    else if (kind === "docrule") await db.docRule.delete({ where: { id: numId } });
    else if (kind === "feerule") await db.feeRule.delete({ where: { id: numId } });
    else if (kind === "commtemplate") await db.commTemplate.delete({ where: { id: numId } });
    else if (kind === "promotion") await db.promotion.delete({ where: { id: numId } });
    else return NextResponse.json({ error: "unknown kind" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 400 });
  }
}
