import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const sessions = await db.session.findMany({
  include: { user: { select: { name: true, role: true, active: true } } },
  orderBy: { expiresAt: 'desc' },
  take: 10,
});

const now = new Date();
console.log('\n--- Active sessions ---');
for (const s of sessions) {
  const expired = s.expiresAt < now;
  console.log(`  ${s.user.name} | ${s.user.role} | expires ${s.expiresAt.toISOString()} | ${expired ? '❌ EXPIRED' : '✅ valid'}`);
}

const total = await db.session.count();
console.log(`\nTotal sessions in DB: ${total}`);

await db.$disconnect();
