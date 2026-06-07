# Throughline V1 — Build Spec

> Drop this file into `projects/personalWebsite/` (e.g. as `throughline/BUILD_SPEC.md`) and point Claude Code at it.
> Goal: a working pilot — Garmin-connected readiness engine + coach console + morning delivery — for ~5–10 invite-only athletes coached by an elite running coach who is also the product's quality bar.

---

## Context (read first)

Throughline is an AI endurance coach. The wedge: it adapts training to **recovery and subjective signals** (HRV, resting HR, sleep, soreness, mood), not just a fixed plan. V1 is web-only, runners-only, Garmin-only, invite-only. The coach console matters more than the athlete UI: the coach (an expert human) manages real athletes through it, and **every manual override is captured as labeled training data**.

Two non-negotiable architecture principles:

1. **The planner is deterministic and auditable.** LLMs translate natural language in and out; they never decide the training. All plan decisions come from the structured engine (rules + models) so they can be regression-tested against the coach's judgment.
2. **Interventions edit engine inputs, not outputs.** Coach tweaks should change athlete state/constraints (injury, caps, availability) so replanning adjusts coherently. Direct session edits are allowed but must be **pinned** so the planner routes around them.

---

## Phase 0 — Inventory & decisions (Claude Code: do this first, report back before scaffolding)

1. Inventory the existing site: framework, language, hosting/deploy target, domain setup, whether a privacy policy page exists.
2. Propose where the new app lives. Default preference: **separate app/service in this repo** (e.g. `apps/throughline/` or `throughline/`), deployed at a subdomain (`app.<domain>`) or under `/coach`. Do NOT weave product code into the website's pages beyond a landing link. The product must stay cleanly extractable later.
3. Choose stack to match repo conventions where sensible. Defaults if no strong convention: TypeScript, Next.js (or plain Node/Express API + React) for the console, **Postgres** (Neon/Supabase fine) for data. SQLite acceptable for local dev only — webhooks need an always-on hosted endpoint.
4. Confirm an email-sending path exists or pick one (Resend/Postmark/SES) for morning delivery.

## Phase 0.5 — Non-code checklist (human tasks; surface these as TODOs, don't block on them)

- [ ] Legal entity to apply under (Garmin requires applying as a company, with a company-domain email).
- [ ] Public **privacy policy** page on the site (Garmin application requires a link to it).
- [ ] One-paragraph product description page (the application asks for the use case).
- [ ] Submit Garmin Connect Developer Program access request. Approval ≈ 2 business days; evaluation environment first, then production. Plan around this gate.

---

## Phase 1 — Data foundation

### Entities (minimum schema)

- `Athlete` — profile, goal race + date, timezone, contact (email/phone).
- `IntakeProfile` — coach-style onboarding answers: race history & PRs, typical weekly volume, injury history, training days available, current plan if any.
- `ConnectedAccount` — provider (=garmin), OAuth tokens, scopes, status.
- `RawEvent` — **append-only** log of every inbound payload (webhook, backfill, file upload), with provider, type, received_at, raw JSON/blob. Never mutate. Everything else is derived and re-derivable.
- `Activity` — normalized session: sport, start, duration, distance, avg/max HR, pace splits, cadence, source ref.
- `DailySummary`, `SleepRecord`, `HrvRecord`, `RestingHrRecord` — normalized daily signals.
- `CheckIn` — athlete subjective daily input: soreness (0–10), energy/mood (0–10), RPE of yesterday's session, free-text note.
- `Baseline` — per athlete per signal: rolling short window (7d) and long window (60d) stats; readings consumed as z-scores vs own baseline.
- `FitnessFatigueState` — per athlete: CTL/ATL-style chronic & acute load and balance, recomputed on new data.
- `Plan` / `PlannedSession` — the periodized week(s); sessions carry type, target load/paces, date, and `pinned` flag.
- `Directive` — structured coach instruction with effect window (e.g. intensity cap 14d, no-run days, volume ceiling). Includes `source_text` if it came from free text.
- `InjuryRecord` — first-class: body part, severity, allowed modalities, status lifecycle (acute → returning → cleared).
- `Override` — any coach change to engine output: before/after, **reason code** (enum, coach-defined taxonomy) + optional note. Append-only.
- `AthleteNote` — standing per-athlete memory ("underreports soreness"), structured + consumed by the engine at plan time.

### Garmin integration

- OAuth 2.0 connect flow; store tokens per `ConnectedAccount`.
- Webhook endpoint(s) for push summaries (activities, dailies, sleep). Verify, enqueue, write `RawEvent`, then normalize async.
- **Backfill**: on connect, trigger Garmin's backfill for historical data (target: as much history as the program allows) so baselines and load state are warm from day one.
- Build against the **evaluation environment** first; keep provider config in env vars; isolate all Garmin-specific code behind a `providers/garmin` module so Whoop/Oura/Apple can be added later without schema change.

### Manual history import (for non-Garmin past data)

- File upload: parse `.FIT`, `.TCX`, `.GPX` (use established parser libraries; don't hand-roll FIT decoding).
- Forgiving CSV import (date, distance, duration, avg HR optional) for spreadsheet-era logs.
- All imports also land in `RawEvent` first.

---

## Phase 2 — Readiness engine v0

- Per-signal personal baselines: rolling 7d vs 60d, output as z-scores. No absolute thresholds anywhere.
- Fitness–fatigue (Banister-style impulse–response) state from session loads; pace/HR-derived training impulse for running.
- Readiness assessment each morning per athlete: combine HRV z, resting-HR z, sleep, latest `CheckIn` into a small interpretable score + **one defensible sentence** ("HRV suppressed 2 days against baseline and soreness 6/10 — today should be easy").
- Output is explainable: every readiness call lists the signals that drove it.
- **Validation harness before any athlete sees it**: run the engine over historical data for the coach's real athletes; produce a per-day readiness log she can grade (agree / too cautious / too aggressive). Store grades — this is the first eval set.

## Phase 3 — Plan engine v0 (deliberately simple)

- Periodized plan skeleton generated backward from goal race date using coach-authored week templates (base/build/peak/taper) scaled by intake volume.
- Adaptation rule layer (coach-authored, in code or config, version-controlled): e.g. low readiness + quality session scheduled → swap with easy day; soreness ≥ 7 → reduce next-day intensity; 2+ missed sessions → re-periodize, don't cram; active `InjuryRecord` → apply modality constraints and return-to-run progression template.
- Replanning is deterministic given (state, constraints, directives, pins). Same inputs → same plan.
- **Draft → preview → publish**: replans produce a draft with a diff view; coach approves before the athlete sees it.

## Phase 4 — Coach console (function over polish; this is the primary product surface in V1)

Screens:
1. **Roster** — athletes with today's readiness, flags (low readiness, active injury, missed sessions), sorted by needs-attention.
2. **Athlete detail** — readiness history, signal charts vs baseline, current plan, check-ins, notes.
3. **State & constraints editor** — injuries (full lifecycle), availability, volume/intensity caps, engine params (conservatism dial, per-signal trust weights).
4. **Free-text directive flow** — coach types natural language → LLM proposes the structured `Directive`/edits → coach confirms or corrects → only the structured form enters the engine. (LLM translates; never silently prescribes.)
5. **Plan editor** — session-level edits create pins; every change requires a reason code; all changes land in `Override`.
6. **Override log** — filterable history; weekly view of reason-code distribution (the engine-deficiency report).

## Phase 5 — Athlete delivery (thin by design)

- Morning email (or WhatsApp later) per athlete: readiness sentence + today's session. No login required.
- Daily check-in: simplest possible — a magic-link micro-form (3 sliders + optional note) linked from the morning email; writes `CheckIn`.
- LLM drafts the athlete-facing wording from the engine's structured output, in a warm coach voice; template-reviewed by the coach once, then automatic.

---

## Out of scope for V1 (do not build)

Mobile apps; payments; any provider beyond Garmin (but keep the provider abstraction); social features; nutrition tracking; learned/ML plan policy (rules + fitted models only); multi-coach support; public signup.

## Definition of done (pilot-ready)

1. An athlete can connect Garmin, backfill history, and complete intake in one sitting.
2. Every morning, each athlete gets a readiness call + today's session by email; check-in link works.
3. The coach can run her real roster through the console: see flags, log injuries, issue free-text directives, pin edits — all captured with reason codes.
4. The readiness validation harness shows ≥ ~80% coach agreement on historical data before live use.
5. Every inbound byte exists in `RawEvent`; every coach change exists in `Override`/`Directive`. Append-only verified.

## Success criteria for the pilot itself (4–6 weeks, 5–10 athletes)

- Coach agreement with morning readiness calls stays high and trends up.
- Override rate trends **down** week over week (the engine is learning the gaps via rule fixes).
- Athletes open the morning email most days and complete check-ins ≥ 4×/week.
- The coach reports it saves time vs her current workflow — if it doesn't, find out exactly where and fix that first.
