// One-off: populate feesJson/insuranceJson for every bank product missing them,
// by running the axes migrator (extractFromAxes logic, admin "Sync from axes"
// equivalent) across the whole universe. Never overwrites existing values.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

function digits(s){return String(s??"").replace(/\D/g,"");}
function parsePct(s){const m=String(s||"").match(/(\d+(?:\.\d+)?)\s*%/);return m?parseFloat(m[1]):null;}
function parseKilo(s,re){const i=String(s||"").search(re);if(i===-1)return null;const m=String(s).slice(0,i).match(/(\d[\d,]*)([kK])?\s*(?:aed|AED)?\s*$/);if(!m)return null;const n=parseFloat(m[1].replace(/,/g,""))*(/k/i.test(m[2]||"")?1000:1);return n>100?Math.round(n):null;}
function parseAedFixed(s){const m=String(s||"").replace(/,/g,"").match(/(\d{3,6})/);if(!m)return null;const n=parseFloat(m[1]);return Number.isFinite(n)&&n>0?n:null;}
function procDec(s){const p=parsePct(s);if(p!=null)return p;const m=String(s||"").match(/\b(0\.\d{4,})\b/);return m?Math.round(parseFloat(m[1])*10000)/100:null;}

const prods = await db.bankProduct.findMany();
let feesFilled=0, insFilled=0, skipped=0;
for (const p of prods) {
  let axes={}; try{axes=JSON.parse(p.axesJson||"{}");}catch{}
  const hasFees = p.feesJson && p.feesJson!=="{}";
  const hasIns = p.insuranceJson && p.insuranceJson!=="{}";
  if (hasFees && hasIns) { skipped++; continue; }
  const fees = hasFees ? JSON.parse(p.feesJson) : { processing:{} };
  const ins = hasIns ? JSON.parse(p.insuranceJson) : {};
  if (!hasFees) {
    const pr = axes["Processing Fee"] ?? "";
    const pp = procDec(pr);
    if (pp!=null) fees.processing.default = pp;
    const cap = parseKilo(pr,/(?:whichever lower|cap|max)/i); if (cap!=null) fees.processing.maxFee = cap;
    const paRaw = String(axes["Pre Approval Fee"]??"").replace(/\u2014/g,"\n");
    const lines = paRaw.split(/\n/).map(x=>x.trim()).filter(Boolean);
    if (lines.length>=1){const v=parseAedFixed(lines[0]); fees.preApproval = v!=null?{fee:v}:(/free/i.test(lines[0])?{fee:0}:undefined); if(!fees.preApproval) delete fees.preApproval;}
    if (lines.length>=2 && fees.preAppointment!==undefined){} // noop
    if (lines.length>=2 && fees.preApproval){const v2=parseAedFixed(lines[1]); if(v2!=null)fees.preApproval.feeSelfEmployed=v2; else if(/free/i.test(lines[1]))fees.preApproval.feeSelfEmployed=0;}
    const valRaw = axes["Valuation Fee"] ?? ""; if (String(valRaw).trim()) fees.valuation={note:String(valRaw).slice(0,200)};
    const esRaw = String(axes["Early Settlement"]??"").split(/\n/)[0]??"";
    const esP=parsePct(esRaw), esCap=parseKilo(esRaw,/(?:whichever lower|cap|max)/i);
    if (esP!=null||esCap!=null){fees.earlySettlement={note:esRaw.slice(0,120)};if(esP!=null)fees.earlySettlement.pct=esP;if(esCap!=null)fees.earlySettlement.cap=esCap;}
    const psRaw = String(axes["Partial Settlement"]??"").split(/\n/)[0]??"";
    if (/free/i.test(psRaw)){const fp=parsePct(psRaw.replace(/penalty/i,""));fees.partialSettlement={freeYearlyPct:fp??undefined,note:psRaw.slice(0,120)};}
    else {const psP=parsePct(psRaw),psCap=parseKilo(psRaw,/(?:whichever lower|cap)/i);if(psP!=null||psCap!=null){fees.partialSettlement={note:psRaw.slice(0,120)};if(psP!=null)fees.partialSettlement.pct=psP;if(psCap!=null)fees.partialSettlement.cap=psCap;}}
    feesFilled++;
  }
  if (!hasIns) {
    const lifeRaw = String(axes["Life Insurance"]??"").split(/\n/)[0]??"";
    const smallDec=(str)=>{const pm=str.match(/(\d+(?:\.\d+)?)\s*%/);if(pm)return parseFloat(pm[1]);const dm=str.match(/\b(0\.\d{2,6})\b/);return dm?parseFloat(dm[1]):null;};
    if (/p\.m|per month|monthly/i.test(lifeRaw)){const r=smallDec(lifeRaw);if(r!=null)ins.life={basis:"per_million_monthly",rate:r,note:lifeRaw.slice(0,120)};}
    else if (/p\.a|per annum|annual/i.test(lifeRaw)){const r=smallDec(lifeRaw);if(r!=null)ins.life={basis:"pct_pa_of_loan",rate:r,note:lifeRaw.slice(0,120)};}
    const propRaw=String(axes["Property Insurance"]??"").split(/\n/)[0]??"";
    const pr2=smallDec(propRaw); if(pr2!=null)ins.property={basis:"pct_pa_of_property",rate:pr2,note:propRaw.slice(0,120)};
    insFilled++;
  }
  await db.bankProduct.update({where:{id:p.id},data:{
    ...(hasFees?{}:{feesJson:JSON.stringify(fees)}),
    ...(hasIns?{}:{insuranceJson:JSON.stringify(ins)}),
  }});
}
console.log(`products=${prods.length} feesFilled=${feesFilled} insuranceFilled=${insFilled} alreadyDone=${skipped}`);
await db.$disconnect();
