# Competitive landscape & differentiation

_Scan of 2026 coverage (marketing/SEO-heavy sources — directional, not gospel;
verify specifics before quoting). Purpose: place Throughline, and decide how the
multi-discipline model (running-first, cycling standalone, up to full triathlon)
should differentiate._

## The map

| Segment | Leaders | Strong at | Gap we can exploit |
|---|---|---|---|
| **Running** | **Runna** ($20/mo; 4.9★, 26k reviews; Strava partnership), Nike Run Club (free, static), Garmin Coach | Adaptive plans 5K–50K, named coaches, strength, polish | Static competitors don't adapt; even Runna is only now "building on previous training instead of resetting" |
| **Triathlon / multisport** | **TrainingPeaks** (industry standard; federations; **reportedly acquired by Garmin, 2026**), TriDot, Humango, Transition | PMC (CTL/ATL/TSB) is the gold-standard load model; huge plan marketplace; coach tooling | TrainingPeaks is coach-facing + analytical, not a friendly autonomous athlete coach |
| **Cycling** | **Zwift** (community/gamified), **TrainerRoad** (Adaptive Training, no-test FTP from ride data), Xert, Rouvy, intervals.icu | Structured indoor training, AI fatigue/progression, immersive rides | Mostly indoor-/power-centric; not goal-time-to-race-plan coaching for an outdoor event |
| **AI coaching (the frontier)** | **TriDot** (data/precision, temp-adjusted zones, no conversational coach), **Humango** (reschedules around life; best single app for tri + road racing), **Athletica** (scientific rigor + education), AI Endurance, Transition | Algorithmic personalization; life-adaptation; periodization science | See gaps below |

## Industry shifts
- **Consolidation**: Garmin reportedly bought TrainingPeaks (2026) — the "still independent" question is now a talking point. Independents (TriDot, Humango, Athletica, intervals.icu) are the field.
- **AI coaching is crowded but shallow**: many "AI" plans are static generators; users "immediately sense when AI lacks real intelligence."

## What users actually complain about (the opening)
From 2026 reviews/criticism, recurring themes:
1. **Generic plans** — "a running log with dates," same pace every day, no real structure.
2. **No explanation** — plans don't tell you *why* a session exists or how it adapts.
3. **Dishonest feasibility** — apps "promise results their plans can't actually deliver."
4. **Poor life-adaptation** — plans that reset or break when you miss a week / have a chaotic schedule.
5. **Shallow AI** — generic chatbots erode trust fast.

## Throughline's differentiation thesis
Our existing engine already answers the top complaints — that's the wedge, and it's rare in the field:

1. **Honest feasibility is our signature.** The binding-leg verdict + the **attainability ceiling** ("4:30 is faster than this race can be for you — here's the honest target") directly counter complaint #3. Almost no competitor tells you a goal is *not possible* and reframes it kindly. This is the most defensible differentiator.
2. **We explain the "why."** Specific-not-judgey gap notes, the limiter, the brick rationale, transition rehearsal — counters #2.
3. **Coordinated multi-discipline in one athlete.** The discipline dimension + goal-time decomposition across swim/bike/run (with cross-sport transfer) is Humango's territory, done with more honesty.
4. **Autonomous, conversational coach.** Assisted + autonomous modes + chat — TriDot notably lacks a conversational coach; TrainingPeaks is coach-tooling, not an athlete's coach.
5. **Real-world schedule-first.** DayBudget/layout (pool days, the long day, life constraints scaling gains) counters #4.

Where we're **behind** and shouldn't pretend otherwise: the PMC/load analytics depth (TrainingPeaks), indoor/ERG ecosystem (Zwift/TrainerRoad), plan marketplaces, and years of cohort-calibrated data (TriDot). We win on **honesty + explanation + one coordinated coach**, not on analytics breadth or an indoor game.

## Implications for the discipline model
- **Running-first must stay pristine** (Runna is the bar — polish, adaptivity, strength). A solo runner should never feel they're in a triathlon app.
- **Cycling deserves standalone**, not only tri-tributary. The cycling market is indoor-/power-centric; a *goal-time-to-outdoor-event* cycling coach with honest feasibility is underserved. Standalone bike = single-sport `setupSeason`-analog on the bike engine we already have (needs a bike goal/onboarding path).
- **Multi-sport is the honest-coordination story** — lead with "is your goal real, and which leg decides it," not with more charts.
- **Don't chase** the indoor-game or the coach-marketplace; chase honesty + the autonomous coach across disciplines.

## Suggested next moves (product)
1. **Standalone cycling goal** — a bike single-sport onboarding + `setupSeason`-style path (mirrors running), so a cyclist is first-class. Then swim standalone.
2. Make "Your sports" **discipline-symmetric** (any sport can be your primary or standalone; adding sports composes toward duathlon/tri).
3. Keep leaning into **honesty/feasibility + explanation** as the brand — it's the clearest wedge against a crowded, chart-heavy, sometimes-dishonest field.

## Sources
- Runna: [marathonscout](https://marathonscout.com/training/runna), [runningwestwardho 2026 updates](https://www.runningwestwardho.co.uk/post/runna-app-updates-2026-smarter-training-plans-adaptive-coaching-new-features-explained), [PulseSignal pricing](https://getpulsesignal.com/pricing/runna)
- TrainingPeaks: [TrainingPeaks coach guide](https://www.trainingpeaks.com/blog/trainingpeaks-guide-for-coaches/), [Cora review](https://www.corahealth.app/compare/training-peaks), [Coachbox review](https://coachbox.app/en/compare/trainingpeaks-review/)
- Cycling: [Cyclist buyers guide](https://www.cyclist.co.uk/buying-guides/buyers-guide-best-cycling-training-apps), [Cyclingnews](https://www.cyclingnews.com/features/indoor-cycling-apps/), [Triathlete top 9](https://www.triathlete.com/training/indoor-training/the-9-top-indoor-cycling-platforms-this-season/)
- AI coaching: [the5krunner — independents after Garmin](https://the5krunner.com/2026/07/24/coach-platforms-still-independent-after-garmin/), [Triathlete AI apps hands-on](https://www.triathlete.com/gear/tech-wearables/ai-triathlon-training-apps/), [Transition comparison](https://www.transition.fun/blog/transition-vs-tridot-athletica-humango-ai-endurance-trainingpeaks/), [besttriathletes TriDot vs Humango](https://besttriathletes.com/tridot-vs-humango/)
- Criticism themes: [APIDots why fitness apps fail](https://apidots.com/blog/fitness-app-development-guide/), [findyouredge 10K apps](https://www.findyouredge.app/news/best-10k-training-apps-2026)
