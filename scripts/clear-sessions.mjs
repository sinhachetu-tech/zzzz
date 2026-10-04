// Run: node scripts/clear-sessions.mjs
// Deletes all DB sessions so everyone must log in fresh.
// Safe — sessions are recreated on next login.
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const { count } = await db.session.deleteMany({});
console.log(`Cleared ${count} session(s). Everyone must log in again.`);
await db.$disconnect();
