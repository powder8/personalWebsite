# Throughline — Roadmap / Backlog

Running list of things we've discussed and deferred, so we don't lose them.
Newest themes at the top. (Done items live in git history / the competitive
analysis; this is the "later" list.)

---

## Athlete insights (the big one — in progress)
The vision: help athletes/coaches understand *what drives fitness* and ask
questions in plain language.

- **Phase 1 — descriptive insights over existing data (STARTED):** detect an
  athlete's fitness peaks and the *ramps into them*; characterize the best
  training blocks (volume, frequency, consistency) vs. their baseline. Also the
  downside: **overreaching / breakdown signatures** (ATL spikes, deep-negative
  TSB, sleep drop, HRV suppression preceding a slump/injury). Frame everything
  as **coach-reviewable hypotheses, not prescriptions** (n-of-1: association ≠
  causation; consistency usually dominates; the ramp matters more than the peak).
- **Phase 1b — recovery factors:** the rest/sleep/stress/HRV side of "what led
  to high fitness" needs the wellness integrations (below). Light up as Garmin/
  Whoop data arrives.
- **Context-aware fitness model (started — recency done):** a benchmark must
  reflect *what's realistic now*, not a peak from a different life stage.
  - ✅ **Recency:** anchor + insights benchmark use recent (~2yr) data; career
    best shown as labeled context. Glitch guards (ceiling + corroboration);
    races exempt (bypass guards, surfaced as major efforts).
  - ⏳ **Age-grading / masters defaults:** VDOT ignores age. Add athlete DOB →
    WMA age factors to (a) compare performances fairly across a career and
    (b) set age-appropriate current potential. Needs a DOB profile field.
    **Heather's ask (feedback):** masters athletes should default to a more
    conservative threshold (~15s/mi slower than the raw VDOT-derived pace).
    Build this on top of DOB: when age ≥ ~40, ease the threshold (and likely
    recovery cadence) by a masters factor. Deferred because it's a coaching-
    model change that needs the DOB field + Heather's sign-off on the factor,
    not a guess. The exact-anchor VDOT/equivalent half of that feedback IS
    shipped (equivalentPerformances snaps the anchor distance to the entered
    time, e.g. a 2:58:56 marathon reads 2:58:56).
  - ⏳ **Course / elevation:** a hilly or high-altitude race time understates
    fitness. Capture Strava `total_elevation_gain` / grade-adjusted pace →
    normalize race times before VDOT. Needs an elevation column + capture.
  - ⏳ **Recency-decay weighting** of older performances; "realistic current
    potential" = recent trajectory + age. Don't over-fit — coach judgment is a
    factor the model can't fully replace.
- **Phase 2 — encoded science checks:** population-level recommendations kept
  SEPARATE from n-of-1 observations — 80/20 polarization, ~10%/week progression
  caps, taper structure, masters recovery, sleep targets, HRV-guided training.
- **Phase 3 — grounded chat (MVP shipped):** athlete-facing "ask about your
  training" on the portal, grounded in real computed data. Defaults to Haiku
  (grounded narration, not heavy reasoning — cheap/fast). Cost/UX follow-ups:
  **prompt caching** the stable system+context block (biggest cost lever),
  **streaming** responses, a **coach-side** assistant over the roster, and
  grounding in **Heather's methodology corpus** (the differentiator). Original
  design notes below.
- **Phase 3 (orig notes) — grounded chat (RAG, not fine-tuning):** Claude with the athlete's
  structured data + Heather's coaching corpus injected at question time. Start
  with a low-risk "explain my data/plan/readiness" MVP (narrates real computed
  numbers), then open coaching Q&A over a curated corpus. Guardrails: cite the
  data each answer rests on; defer training prescriptions to the engine's
  computed recommendation; "coaching guidance, not medical advice"; conservative
  on injury. Differentiator vs. Strava's Claude chat = Heather's methodology +
  our transparent engine, not generic. Needs an Anthropic API key + the corpus.
- **Heather's coaching corpus:** write her methodology/principles down — feeds
  both the science layer and the chat, and is what makes them *hers*. Ties to
  the original "make Heather a co-creator" goal.

## Wellness integrations (chosen: Garmin first)
- **Garmin (in progress):** provider is data-ready (normalizers + inline webhook
  + tests). BLOCKED on the B2B Health API application/approval + license fee
  (Peter to apply). Finish the OAuth token exchange against the eval-env docs
  once approved; add Connect-Garmin UI + backfill.
- **Whoop:** self-serve OAuth (~Strava-shaped: Recovery=HRV/RHR, Sleep stages,
  webhooks). Build when Peter's device arrives. Free ≤10 users; approval + ~60–80
  user rate cap beyond that.
- **Oura:** easiest (self-serve OAuth, cleanest data) — only if someone gets a ring.
- **Apple Health:** no cloud API. Opt-in only, for Apple-Watch-only athletes,
  via the Health Auto Export bridge (paid app; flaky while phone locked). Not a
  primary channel. Could also carry Garmin-sourced metrics as a stopgap.

## Multi-source dedup — LOGIC (foundation done)
Foundation shipped: every record is `provider`-tagged; constraints unchanged.
- **Activity dedup:** collapse the same workout arriving from >1 source by
  provider priority + fuzzy fingerprint (day + ~distance). Needed when an
  athlete's log and Strava OVERLAP. (Heather's don't — log is 2013–15, Strava is
  2025–26 — so not urgent for her; build against the first real overlap.)
- **Wellness source-of-truth:** cross-device HRV/RHR are NOT interchangeable, so
  this is *source selection*, not merging — pick one authoritative provider per
  signal per athlete. Relax the `(athlete, day)` unique constraint → `(athlete,
  day, provider)` and add read-side preferred-source. Needed when a 2nd wearable
  connects.

## Competitive-analysis features (Tier 3, not yet built)
See `docs/competitive-analysis.md`. Notifications (Resend: today's workout,
low-readiness nudge, missed session), coach↔athlete messaging (Heather
touchpoint), structured strength sessions, structured-workout push to watch
(.fit / Garmin) — `.ics` calendar feed already shipped.

## Platform / housekeeping
- **Strava athlete capacity:** at 10 now; request an increase before scaling
  past it (webhooks live, which helps approval).
- **Neon password rotation:** the connection string was shared in chat; rotate +
  update Vercel env. (One-time reminder set.)
- **`TODAY` is a fixed demo date** (`src/server/console.ts`) — switch to the real
  current date once past the seeded 2026-06 demo timeline.
- **Athlete portal chrome:** `/me/[id]` currently renders inside the *coach*
  console header/nav — give it an athlete-appropriate layout.
- **Coach athlete page is ~3s:** it recomputes PMC over full history + anchor
  candidates + compliance per load. Consider precomputing/caching (the
  `fitness_fatigue_states` table exists but isn't populated) and/or moving heavy
  analytics to the insights page.
- **Inngest:** Garmin webhook normalizes inline (no Inngest dependency); only
  wire Inngest cloud if we need durable background jobs at scale.
- **Global model settings editor:** let Heather tune the global pace model /
  masters defaults (Daniels calibration) from the UI.
- **Readiness validation harness on real data** once wellness flows.
