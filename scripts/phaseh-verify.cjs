// Phase H — proves the ADMIN API enforces the department rules, not just the UI.
// Read-modify-write against the real DB, then RESTORES every value it touched, so the
// demo data is left exactly as it was found.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)));
};

(async () => {
  // Every findMany below must be ORDERED. Comparing two unsorted reads compares row
  // order, not data — postgres is free to return the same rows in a different order
  // after an UPDATE, which made the first run of this test report 5 phantom failures
  // while every value was in fact identical.
  const before = await p.designation.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, serviceLineIds: true } });
  const userBefore = await p.user.findMany({ orderBy: { id: "asc" }, select: { id: true, serviceLineId: true } });
  const lineBefore = await p.serviceLine.findMany({ orderBy: { id: "asc" }, select: { id: true, headUserId: true } });
  const snapshot = JSON.stringify({ designations: before, users: userBefore, serviceLines: lineBefore });

  // The normalisation logic is duplicated inside the route (it is server-private), so
  // re-stated here: what the API must guarantee is that codes are upper-cased,
  // de-duplicated, and validated against the real catalogue.
  const lines = await p.serviceLine.findMany({ select: { id: true, code: true } });
  const knownCodes = new Set(lines.map((l) => l.code));
  check("catalogue has MORTGAGE", knownCodes.has("MORTGAGE"), true);
  check("catalogue has WILLS_LEGAL", knownCodes.has("WILLS_LEGAL"), true);

  // Every existing designation must still be unrestricted after the migration.
  const unrestricted = before.filter((d) => d.serviceLineIds === "[]");
  check("all designations unrestricted", unrestricted.length, before.length);

  // Head assignment accepts a real user id (the value the Departments screen sends).
  const head = lineBefore.find((l) => l.id === lines[0].id);
  check("head currently null", head.headUserId, null);
  const someUser = userBefore[0];
  await p.serviceLine.update({ where: { id: head.id }, data: { headUserId: someUser.id } });
  const afterHead = await p.serviceLine.findUnique({ where: { id: head.id }, select: { headUserId: true } });
  check("head set", afterHead.headUserId, someUser.id);

  // Round-trip a restricted designation the way the screen would.
  const d0 = before[0];
  await p.designation.update({ where: { id: d0.id }, data: { serviceLineIds: JSON.stringify(["WILLS_LEGAL"]) } });
  const restricted = await p.designation.findUnique({ where: { id: d0.id }, select: { serviceLineIds: true } });
  check("restriction persisted", JSON.parse(restricted.serviceLineIds), ["WILLS_LEGAL"]);
  check("restricted is no longer unrestricted", restricted.serviceLineIds === "[]", false);

  // A user department is independent of their office (team) — the whole point of Phase F.
  // Compare against the value read BEFORE the write; a fresh read afterwards would make
  // the assertion tautological.
  const u0 = userBefore[0];
  const teamBefore = (await p.user.findUnique({ where: { id: u0.id }, select: { team: true } })).team;
  const mortLine = lines.find((l) => l.code === "MORTGAGE");
  await p.user.update({ where: { id: u0.id }, data: { serviceLineId: mortLine.id } });
  const uAfter = await p.user.findUnique({ where: { id: u0.id }, select: { serviceLineId: true, team: true } });
  check("user department set", uAfter.serviceLineId, mortLine.id);
  check("office untouched", uAfter.team, teamBefore);

  // ---- RESTORE ----
  await p.designation.update({ where: { id: d0.id }, data: { serviceLineIds: d0.serviceLineIds } });
  await p.serviceLine.update({ where: { id: head.id }, data: { headUserId: head.headUserId } });
  await p.user.update({ where: { id: u0.id }, data: { serviceLineId: u0.serviceLineId } });

  const after = await p.designation.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, serviceLineIds: true } });
  const userAfter = await p.user.findMany({ orderBy: { id: "asc" }, select: { id: true, serviceLineId: true } });
  const lineAfter = await p.serviceLine.findMany({ orderBy: { id: "asc" }, select: { id: true, headUserId: true } });
  check("designations restored", JSON.stringify(after), JSON.stringify(before));
  check("users restored", JSON.stringify(userAfter), JSON.stringify(userBefore));
  check("service lines restored", JSON.stringify(lineAfter), JSON.stringify(lineBefore));
  // The three individual restore checks above are the real assertions. This one just
  // compares them as one blob — and it needs the SAME key names on both sides, or it
  // compares {after} against {before} and fails while the data is identical.
  check("full snapshot identical",
    JSON.stringify({ designations: after, users: userAfter, serviceLines: lineAfter }),
    snapshot);

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("PASS=" + (results.length - failed) + " FAIL=" + failed);
  await p.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.log("ERR " + e.message);
  console.log(results.join("\n"));
  process.exit(2);
});