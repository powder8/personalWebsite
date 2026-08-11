/**
 * L2 FLIP TOOLING — set the load-currency cutover flag in the DB.
 *
 *   node --import tsx scripts/set-load-currency.ts <trimp|tss>
 *
 * Upserts `engineSettings.loadCurrency` (the single global engine-settings row).
 * This is the owner-signed-off cutover that points the fitness/fatigue read path
 * (server/fitness.ts + server/insights.ts) at the new TSS-equivalent currency
 * (`activities.trainingLoadTss`) instead of legacy TRIMP. Reversible: run again
 * with `trimp` to flip straight back.
 *
 * PREREQUISITE: run scripts/backfill-load-tss.ts first so `trainingLoadTss` is
 * populated — otherwise unbackfilled rows fall back to on-the-fly / legacy load.
 *
 * ── Alternative: no-DB-write env override ──────────────────────────────────────
 * The read path also honors the `LOAD_CURRENCY` env var, which OVERRIDES this DB
 * setting. To preview the cutover on Vercel WITHOUT writing to the database, set
 * `LOAD_CURRENCY=tss` in the project's environment and redeploy; unset it (or set
 * `trimp`) to revert. Precedence: env `LOAD_CURRENCY` > this DB setting > default
 * ('trimp'). See engine/loadCurrencyFlagLogic.ts + spec §2.4.
 *
 * SAFETY: writes to whatever `getDb()` resolves (local file-backed PGlite in dev
 * when DATABASE_URL is unset). Do NOT point this at production — the prod flip is
 * the owner's job, after reviewing the diff report (scripts/load-currency-diff.ts).
 *
 *   Local dev (PGlite, dev server NOT running):
 *     DATABASE_URL='' node --import tsx scripts/set-load-currency.ts tss
 *     DATABASE_URL='' node --import tsx scripts/set-load-currency.ts trimp
 */
import { getDb } from '@/db';
import { getLoadCurrency, setLoadCurrency } from '@/db/loadCurrencyConfig';
import { parseLoadCurrency } from '@/engine/loadCurrencyFlagLogic';

async function main() {
  const arg = process.argv[2];
  const value = parseLoadCurrency(arg);
  if (value == null) {
    console.error(`Usage: set-load-currency.ts <trimp|tss>   (got: ${arg ?? '<none>'})`);
    process.exit(1);
  }

  const db = await getDb();
  await setLoadCurrency(db, value);

  const effective = await getLoadCurrency(db);
  console.log(`Set engineSettings.loadCurrency = '${value}'.`);
  if (process.env.LOAD_CURRENCY) {
    console.log(
      `NOTE: env LOAD_CURRENCY='${process.env.LOAD_CURRENCY}' is set and OVERRIDES the DB flag — ` +
        `effective currency the read path will use is '${effective}'.`,
    );
  } else {
    console.log(`Effective currency the read path will use: '${effective}'.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
