/**
 * Seed demo data into whichever database getDb() resolves (Neon in prod when
 * DATABASE_URL is set, else local PGlite). Idempotent: no-ops if athletes exist.
 *
 * Use after `npm run db:migrate` to give a fresh deploy a clickable demo roster.
 *   DATABASE_URL=... npm run db:seed
 */
import { getDb } from '@/db';
import { seedIfEmpty } from '@/db/seed';

async function main() {
  const db = await getDb();
  await seedIfEmpty(db);
  console.log('Seed complete (no-op if data already existed).');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
