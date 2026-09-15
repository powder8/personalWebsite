# Throughline: daily experience and recovery review

Reviewed 14–15 September 2026. This review combines current official competitor documentation, the Throughline implementation, and local browser testing. It is not a hands-on review of paid competitor accounts. The June competitive analyses in this repository describe an older product and should not be used as the current feature inventory.

## Product judgement

Throughline has more capability than its daily experience communicates. The portal already contains goal projections, workout debriefs, training calendars, consistency, injury controls, strength support, and device connections. Adding more disconnected cards would not solve the central problem: athletes need a short, credible answer to **how am I responding, what should I do today, and what does that mean for my goal?**

The product should make a daily loop visible: observe → interpret → choose → see the plan change → reassess. Goal progress is the long horizon; recovery is the permission to execute today's work. Increased training load must not be presented as proof that someone is healthier or certain to reach a race target.

## Competitor lessons

| Product | Verified mechanism | Implication for Throughline |
| --- | --- | --- |
| Runna | Its “Not Feeling 100%” flow offers temporary reductions, easy-only training or rest, a duration, and a subsequent return phase. | An instruction to ease off needs a real plan control, a visible duration, and a way to undo. Our new control covers easy/rest windows; a graduated return phase remains future work. |
| Runna Pace Insights | Compares prescribed and achieved paces across speed sessions, reports a status, and offers a pace change when there is a trend. Athletes choose whether to accept it. | Connect observations to an explainable action; keep performance recalibration separate from a recovery adjustment. Existing debriefs and pace controls provide a foundation. |
| Garmin | Training readiness combines recent sleep, recovery time, HRV, acute load, and multi-day sleep/stress history. | Show context over time and distinguish daily readiness from long-term fitness. A single number should not overrule the athlete. |
| WHOOP | Frames training and lifestyle through recovery, strain and sleep; its Journal helps members examine relationships between behaviors and recovery. | Ask about life stress, make the source of advice visible, and eventually examine repeated personal patterns without claiming causality. |
| Oura | Readiness considers overnight observations alongside longer-term sleep, HRV and activity balance. | Freshness and baseline maturity matter. A stale observation or missing day must not masquerade as current evidence. |
| TrainingPeaks | Distinguishes perceived workout exertion from overall subjective feeling, interpreted alongside external load. | Keep yesterday's RPE separate from today's energy, soreness and stress. They answer different questions. |

Sources: [Runna adjustments](https://support.runna.com/en/articles/13531498-how-to-use-not-feeling-100), [Runna Pace Insights](https://support.runna.com/en/articles/10854865-what-are-pace-insight-recommendations-and-how-do-they-work), [Garmin training readiness](https://www8.garmin.com/manuals/webhelp/GUID-E3AB50C9-691D-4482-8387-7EEB3961CA87/EN-US/GUID-C21BE0C8-A08E-4DA1-B6C6-2E0E2DDDB372.html), [WHOOP recovery and habits](https://www.whoop.com/us/en/thelocker/member-averages-recovery-strain-sleep-hrv/), [Oura readiness](https://support.ouraring.com/hc/en-us/articles/360025589793-Readiness-Score), [TrainingPeaks subjective feedback](https://www.trainingpeaks.com/learn/articles/what-are-rpe-and-subjective-feedback/).

## Concrete defects found and addressed

1. The portal imported its daily check-in form but did not render it. Athletes could not routinely contribute subjective signals from their daily page. The form now appears prominently, including between goals, and collapses after saving.
2. Live recovery returned early without wearable history, ignoring valid check-ins. Subjective-only readiness now works and is labeled accordingly.
3. Latest historical HRV, resting HR and sleep could feed today's guidance indefinitely. Current physiology now requires a reading today or yesterday and at least seven distinct baseline days. Historical tiles retain their own dates. Duplicate daily readings are averaged deterministically; future/non-finite/non-positive numeric observations are excluded from readiness inputs.
4. A “normal” default with no signals sounded like clearance. Missing evidence now prompts a check-in, without publishing a fabricated assessment.
5. Good wearable values could average away severe subjective fatigue. Conservative rules cap readiness at easy for very high soreness, very low energy, or high stress combined with poor restorative sleep. The exact cutoffs are engineering/coaching defaults, not validated medical thresholds.
6. Check-in updates replaced omitted fields with null. Partial submissions now preserve existing answers and notes. Values and dates are validated.
7. “Take today down a notch” had no corresponding plan action. Athletes can now select easy effort or rest for today, three days or seven days, see the active window, and undo it. Repeated requests update one choice rather than multiplying reductions.
8. Volume adjustments changed distance but not cycling duration, and the portal could retain original interval targets. Adjusted duration now flows through the portal, calendar, compliance and coach view. The portal/coach view removes stale structured targets from adjusted sessions. The easy overlay removes pace/power prescriptions; stronger reductions and rest directives remain authoritative.
9. The daily monitor treated sparse stored assessments as consecutive days and depended on portal visits to create them. It now reconstructs a seven-day calendar history from source observations and check-ins, leaving missing days unknown.
10. The multisport portal could mark the whole day finished after logging one sport. Remaining planned disciplines now stay visible.
11. The calendar exposed several full future weeks in the daily flow. It now leads with the current week, with upcoming weeks behind an expander. Navigation points directly to progress and body; the feedback button is raised above mobile navigation.
12. The trajectory sparkline equated increasing modeled load with being on track. Its caption now states the measurement's limitation and acknowledges taper/recovery weeks. Post-race copy no longer pressures athletes to train immediately to avoid losing fitness.

## Recovery mechanisms: what is implemented

The daily check-in collects energy, muscle soreness, restorative sleep and life stress, with optional prior-day RPE and notes. Unanswered signals stay unknown. Saving recomputes and persists readiness immediately; the portal refreshes without a full-page reload.

The engine produces inspectable drivers. The recovery panel explains recent low-readiness patterns and surfaces specific actions for sleep, life stress and soreness. A seven-day strip distinguishes observed low days, other observed days and gaps. Wearable recovery scores are labeled WHOOP and are not fed back into the engine alongside their raw ingredients.

The new adjustment is an input overlay. Stored workouts remain intact; removing the input restores the original plan. It covers every planned discipline and does not move missed work into later days. Choosing easy training uses at most 70% of original volume and no hard targets. Rest overrides the easy choice. Existing injury/coach directives are not removed by undoing an athlete recovery choice.

## Important remaining work

- **Graduated return after illness or a longer break.** These windows expire into the original plan; the interface explicitly asks athletes to reassess. A return phase should use duration of the interruption, symptoms, current load and coach review, with extension controls. Do not describe the current implementation as a medically validated return-to-training protocol.
- **Goal-specific progress.** Existing race and multisport trackers remain. General “Build fitness” goals now have their own card without race verdicts or target-time nudges. They still need richer success criteria such as sustainable consistency, appropriate progression, enjoyment and recovery. Forecast calibration and honest confidence intervals matter more than a decorative completion percentage.
- **Training tolerance beyond readiness.** Compare perceived effort for similar sessions, sleep/energy trends and discipline-specific load. Avoid one universal acute:chronic ratio threshold or interpreting increasing CTL as physiological improvement. The new check-in history is a useful input, but it does not yet establish individual tolerance curves or causal lifestyle effects.
- **Device reliability and delivery.** Validate real device ingestion, freshness, permissions and watch workout delivery with provider accounts. The local synthetic test cannot establish Garmin/WHOOP production access or end-to-end device sync.
- **A longitudinal change log.** “What changed since yesterday, why, and what happened next?” should become a durable user-visible record spanning workouts, goals and recovery. Current adjustments have reasons and windows, but there is not yet a unified timeline.
- **Measure actual usefulness.** Track check-in completion, successful adjustments, return visits and athlete-reported clarity. Favor a few athlete interviews and observed daily use over assuming more notifications create value. No notifications were added by this change.

## Validation and rollout

The new nullable check-in fields are in migration `0036_daily_recovery_checkin.sql`, with a generated Drizzle snapshot and journal entry. The migration was exercised against isolated PGlite databases, not the hosted database. Apply it through the normal deployment migration step before the updated application runs.

Testing covers no-wearable check-ins, partial updates, validation, physiological freshness, duplicate dates, strong fatigue overrides, calendar-day trends, idempotent adjustments, expiry, cycling duration, undo, and preservation of coach constraints. Browser checks exercise the synthetic athlete portal, save a check-in, apply an easy day, verify the session and calendar change, and undo back to the original workout. Desktop and phone layouts were inspected.

This work is local and has not been deployed. Production deployment was previously blocked by missing `DATABASE_URL`; pulling development variables does not resolve the preview deployment's environment configuration.

Final verification: **750/750 tests passed**, `npm run typecheck` passed, and the production `npm run build` passed (with database access disabled for the local build). The build needed network access for the project's existing Google Fonts. ESLint on the changed TypeScript files passed with no errors and one existing unused-parameter warning. Repository-wide lint remains non-green because of existing errors in ConnectStrava/RunDebriefCard and a nested `.claude/worktrees` checkout. The existing middleware deprecation warning also remains. No hosted migration, deployment, or external athlete-data mutation was performed.
