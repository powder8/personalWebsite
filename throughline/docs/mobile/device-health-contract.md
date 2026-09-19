# Device-health ingest contract

The native shell (iOS: HealthKit, Android: Health Connect) reads the phone's
health store and pushes it to the server. The server never learns platform
quirks: the app maps each store to this one payload.

- **Endpoint:** `POST /api/athletes/<athleteId>/health/device`
- **Auth:** the athlete's ordinary session cookie (the app's web view shares it).
  No device token.
- **Idempotent:** an identical payload is a no-op (`duplicate: true`).
- **Rate limit:** 60 pushes per athlete per hour (`429`).
- **Size:** at most 400 `days` and 500 `workouts` per push.

## Payload

```jsonc
{
  "source": "healthkit",            // or "health_connect"
  "days": [
    {
      "day": "2026-09-18",          // athlete-local calendar day
      "steps": 9123,
      "restingHr": 48,
      "hrvMs": 61,                  // Apple: SDNN; Health Connect: RMSSD
      "sleep": {                    // keyed by WAKE-UP day
        "totalSeconds": 26100,
        "deepSeconds": 5400, "remSeconds": 6000, "lightSeconds": 13500, "awakeSeconds": 1200
      },
      "weightKg": 74.2,
      "bodyFatPct": 14.1,
      "vo2max": 52.3                // stored as the running estimate
    }
  ],
  "workouts": [
    {
      "sourceRef": "HK-UUID",       // the store's stable id
      "start": "2026-09-18T07:00:00Z",
      "sport": "run",               // run | bike | swim | strength | walk | other
      "durationSeconds": 1800,
      "distanceMeters": 6000, "avgHr": 150, "maxHr": 172,
      "elevationGainMeters": 40, "name": "Morning Run"
    }
  ]
}
```

Every field except `source`, `day`, and the workout keys is optional. Send
what the store has; omit what it does not.

## Response

```jsonc
{
  "ok": true,
  "duplicate": false,
  "counts": { "days": 1, "sleep": 1, "hrv": 1, "restingHr": 1, "workouts": 1, "workoutsDeduped": 0 },
  "skipped": ["2026-09-19 restingHr"]   // implausible values, dropped per field
}
```

`400` for a malformed body (`{ "error": "..." }`), `403` for another athlete's id.

## Semantics

- A push refreshes the day: steps and other daily values grow through the day;
  the first sleep / HRV / resting-HR record for a day wins.
- Values outside plausible bounds (a 900 bpm resting HR) drop that one field
  and are listed in `skipped`. The rest of the push still lands.
- Workouts are deduplicated against other sources in both directions: a watch
  run that Strava also has yields to the Strava copy (richer record), whichever
  arrives first.
- `walk` lands as `cross_train` load; it never counts as a run.

## Suggested app behaviour

Push on app foreground and after a HealthKit / Health Connect background
delivery, covering the last 7 days (the server handles the overlap). The
Health Connect declaration must list the read types used here: steps, resting
heart rate, HRV, sleep, weight, body fat, VO2max, exercise sessions.
