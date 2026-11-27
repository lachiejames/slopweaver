# The state home an app launch names

`cmux spawn --harness app --home <h>` puts an absolute `stateHome` on the launch spec (`launchSpecWire.ts`, in both
trees and held equal by the mirror test), and `SLOPWEAVER_HOME` is set to it LAST at every scrub: the worker's own,
and the Codex adapter's or native Claude process's second scrub of the worker's mutable environment
(`confineToStateHome`, `desktop/src/sessionWorker/workerWire.ts`). Every `slopweaver` verb the seat runs then reads
and writes that home, never the app's own. A spawn without `--home` sends no `stateHome`, and the worker inherits
the app's environment as before.

## No protocol bump, and why

The field is optional, so every launch an older app accepted is unchanged. An older app's strict key check
refuses only a launch that carries it, as `BAD_REQUEST`, and the CLI appends that the installed app most likely
predates `stateHome` and the current build must be installed (`src/sessionHarness/appLaunch.ts`). A bump would
have refused EVERY launch to an older app, confined or not, to protect a case that already fails closed.

## Resume

A resume asked under a different `stateHome` from the one the session opened with is refused as `state home`
(`desktop/src/sessionResume.ts`), the same way a different ledger home is.

## What it does not move

`SLOPWEAVER_HOME` only. `CODEX_HOME`, the Claude config directory and the cmux socket are routed exactly as
before, so a seat that resolves a path from one of those still reaches the machine's own. A plain cmux seat (no
`--harness app`) gets no exported `SLOPWEAVER_HOME` at all; its pickup line's `--home` covers the `handover`
lifecycle verb only. How a trial uses it: [the confined harness trial](../../skills/desktop/reference/confined-harness-trial.md).
