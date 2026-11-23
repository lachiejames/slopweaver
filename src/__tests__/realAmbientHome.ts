/**
 * The ONE way a test-lane file may reach the operator's real `~/.slopweaver` — captured before
 * `setup-ambient-home.ts` takes the variable away, and legitimate only on the RECORD lane and the paid Codex
 * acceptance run (see "The bound" below).
 *
 * ## The failure this closes
 *
 * `setup-ambient-home.ts` points `$SLOPWEAVER_HOME` at a per-file sandbox in `beforeAll`, which is a HOOK.
 * Every setup file's and every test file's MODULE SCOPE has already run by then, so a module-scope
 * `process.env["SLOPWEAVER_HOME"]` read gets the operator's real home and the guard never sees it: the guard
 * watches the sandbox, and a write aimed at the real home lands outside what it can observe. `setup-polly.ts`
 * read the variable exactly that way (`const HOME = process.env["SLOPWEAVER_HOME"]`), which is why an
 * investigation into tests writing the operator's live door ledger named it as the suspected author of 169,230
 * `verb:slack.post` door records. It was NOT — those rows stop dead the day after the
 * ambient-home guard landed: 8,094 the day before, 0 the day after, and single digits since. Count them per day again
 * with
 *
 * ```bash
 * grep '"action":"verb:slack.post"' "${SLOPWEAVER_HOME:-$HOME/.slopweaver}/ledgers/door.jsonl" \
 *   | grep -o '"tsIso":"[0-9-]\{10\}' | sort | uniq -c
 * ```
 *
 * The SEAM the handover pointed at is real and still open, though, and it is the READ half of the same class
 * the guard closed on the write side.
 *
 * ## Why the capture is a resolved home, not the raw variable
 *
 * `slopweaverHome()` is the repo's single resolver: it handles an unset variable (`~/.slopweaver`), a blank
 * one, and a relative one. A raw variable read is what once left the record lane's hygiene denylist EMPTY
 * while real provider traffic was being written to a cassette — the regression `hygiene/scan.test.ts` pins.
 * Capturing the RESOLVED home means an unset variable is the operator's real home rather than "no home at
 * all", so the record-time tripwire is never silently watching for nothing.
 *
 * ## The bound
 *
 * Callers are the RECORD lane, plus the opt-in paid Codex acceptance run
 * (`subprocess/codex/acceptance.test.ts`), which reads the operator's plan register READ-ONLY to spend a registered
 * Codex plan rather than an unregistered ambient login — both are live runs a person starts on purpose against their own
 * state. In replay this must not be consulted at all: a replayed cassette carries
 * only placeholders and synthetic ids, so it needs no denylist, no known-values list and no id map — and
 * reading the real home to answer a question replay does not ask is the whole defect. The `env-home-read`
 * half of the `home-safety` gate refuses any other `$SLOPWEAVER_HOME` read under `src/__tests__/`, so this
 * is a door rather than a convention.
 */
import { slopweaverHome } from "../homeDir.js";

/**
 * The resolved home, captured at module load — before any `beforeAll` can move the variable.
 *
 * A `const` rather than a lazy call on purpose: called later it would return the sandbox, which is exactly
 * the mistake this module exists to make impossible.
 */
const CAPTURED_HOME = slopweaverHome();

/**
 * The operator's real state home, as it was before the ambient-home sandbox replaced it.
 *
 * @returns the absolute resolved home — `$SLOPWEAVER_HOME` as it stood at process start, else `~/.slopweaver`
 */
export function realAmbientHome(): string {
  return CAPTURED_HOME;
}
