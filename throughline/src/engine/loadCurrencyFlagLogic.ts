/**
 * Load-currency FLAG resolution (spec story L2 cutover).
 *
 * PURE (no `server-only`, no DB, no clock, no env access): decides which training
 * -load currency the fitness/fatigue read path should consume —
 *
 *     'trimp'  the legacy Banister/volume currency (`activities.trainingLoad`)
 *     'tss'    the new TSS-equivalent currency (`activities.trainingLoadTss`)
 *
 * The flag DEFAULTS to 'trimp', so wiring this in changes NOTHING until an owner
 * flips it (via the `engineSettings.loadCurrency` setting or the `LOAD_CURRENCY`
 * env var). See docs/multisport/load-currency-transfer-spec.md §2.4.
 *
 * Precedence (highest → lowest):
 *   1. env `LOAD_CURRENCY`      — a per-deploy override (Vercel env, no DB write)
 *   2. `engineSettings.loadCurrency` — the persisted, owner-flipped setting
 *   3. the default, 'trimp'.
 *
 * Only the exact strings 'tss' / 'trimp' count; anything else (unset, empty,
 * typo) is ignored at that level and precedence falls through.
 */

export type LoadCurrency = 'trimp' | 'tss';

/** The default currency — legacy TRIMP. Flag OFF ⇒ behavior unchanged. */
export const DEFAULT_LOAD_CURRENCY: LoadCurrency = 'trimp';

/** Parse a raw string into a currency, or null if it isn't a recognized value. */
export function parseLoadCurrency(value: string | null | undefined): LoadCurrency | null {
  if (value == null) return null;
  const v = value.trim().toLowerCase();
  return v === 'tss' || v === 'trimp' ? v : null;
}

/**
 * Resolve the effective currency from the env override and the persisted setting.
 * Env wins over the setting, which wins over the default. Unrecognized values at
 * any level are ignored (fall through), never throwing.
 */
export function resolveLoadCurrency(
  envVal: string | null | undefined,
  settingVal: string | null | undefined,
): LoadCurrency {
  return parseLoadCurrency(envVal) ?? parseLoadCurrency(settingVal) ?? DEFAULT_LOAD_CURRENCY;
}
