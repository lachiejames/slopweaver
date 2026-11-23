# Measuring the call's transcription — `--only transcription-fidelity`

The owner's words can reach the voice wrong, worst at the start or end of
a turn, on a short turn, and when they talk over the voice, and how often is unmeasured. Old transcripts are not evidence: the
transcript carries the same error it would be checked for. A script played into the call's microphone is the one
ground truth that does not.

```bash
slopweaver desktop e2e --call --only transcription-fidelity --call-mic-candidate noise-suppression-off
```

## What one run does

Six calls, about seven minutes each, never part of a default `--call` leg. Rounds 1 to 3 each pair control with the
candidate, and the order inside a round alternates (control first, then candidate first, then control first), so
neither arm always runs warm.

- **The microphone** is one versioned script (`src/desktop/e2eTranscriptFidelityCorpus.ts`, `transcription-fidelity-v1`)
  spoken by `say` in the pinned voice and rate. It is one unscored setup line, then a short line, a start-critical line,
  an end-critical line and a glossary line, each once at ordinary level and once at 0.35 gain. The run is refused when
  the voice is not installed, because `say` silently falls back to another voice and still exits 0. The file is longer
  than the call's cap, because Chromium loops it.
- **The arm** is merged into the console's own `getUserMedia` request from the test page, before Talk is pressed. Each
  opened track's `getSettings()` is recorded. Control asks for all three processing flags as true, explicitly. Echo
  cancellation is never varied.
- **The hold** is a clock, never the transcript: the call stays up from the microphone's open until the script's length
  plus 30s, within 420s, timed on the page's monotonic clock. The call is then hung up, and only once it is off live
  are the microphone captures read.

## What it reports

`transcript-fidelity.json`, beside `report.json`:

- Each trial's final transcript, scored by whole-call word alignment (`src/desktop/e2eTranscriptFidelity.ts`).
- The primary count is **lines with a critical word lost**, broken down by stratum, by gain, and by start and end edge.
- A decision, ruled before any call ran (`src/desktop/e2eTranscriptFidelityVerdict.ts`):
  - `invalid`: an instrument failure, such as not exactly one call file, a skipped line, no end, a setting Chromium
    omitted or did not apply, a different microphone, a call that dropped (its record ends on a reason, not a hang-up) or failed its own checks, a hold
    short of the script, a turn of the owner's the server never ended, or a whole script's worth of extra words (one full repeat: the looped file
    repeating, which the score cannot tell from a hallucination). It voids that call's round, and under three valid pairs voids
    the run. A voided round can only weaken the comparison, never let a candidate win.
  - `stop-control-near-perfect`: control lost a critical word in fewer than two calls, so there is nothing to improve.
  - `candidate-regressed`: any count is worse than control's.
  - `candidate-improved`: fewer overall, better in two of three rounds, and worse nowhere.
  - `inconclusive`: neither of the last two.

## What it cannot see

Every report lists these limits:

- The synthetic voice is not the owner's.
- Only final segments are scored, not the raw fragments a relay carries.
- Talking over the voice is not tested.
- The fake microphone has no echo.
- Six calls show a direction, not a significance.

A result is an instrument result, never a mandate to change a production default on its own.
