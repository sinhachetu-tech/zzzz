const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const [cases, clients, serviceLines, designations, users, leads] = await Promise.all([
    p.loanCase.count(),
    p.client.count(),
    p.serviceLine.count(),
    p.designation.count(),
    p.user.count(),
    p.lead.count(),
  ]);

  const desigs = await p.designation.findMany({
    select: { name: true, serviceLineIds: true },
    orderBy: { name: "asc" },
  });
  const unlocked = desigs.filter((d) => d.serviceLineIds === "[]").length;
  const locked = desigs.filter((d) => d.serviceLineIds !== "[]").length;

  // The new columns must EXIST on the generated client, not just in the DB.
  const u = await p.user.findFirst({ select: { id: true, serviceLineId: true } });
  const s = await p.serviceLine.findFirst({ select: { code: true, headUserId: true } });

  console.log(
    JSON.stringify(
      {
        cases,
        clients,
        serviceLines,
        designations,
        users,
        leads,
        designationsUnrestricted: unlocked,
        designationsLocked: locked,
        sampleUser: u,
        sampleServiceLine: s,
      },
      null,
      2,
    ),
  );
  await p.$disconnect();
})().catch((e) => {
  console.log("ERR " + e.message);
  process.exit(1);
});