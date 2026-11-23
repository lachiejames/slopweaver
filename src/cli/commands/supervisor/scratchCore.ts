/**
 * The flags of the three supervisor-scratch verbs — `tick-capture`, `refresh-run` and `scratch-carry` — and
 * what an invocation of each means. No I/O; `./scratchRun.ts` does the work.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ScratchError, ScratchErrors } from "../../../supervisor/scratch/errors.js";
import { isRepoSlug } from "../../../supervisor/scratch/qualifyRefs.js";
import { isTickLabel } from "../../../supervisor/scratch/tickCapture.js";
import { parseFlagTail } from "../../optionParsers.js";

/** `tick-capture`'s flags. */
const TICK_CAPTURE_FLAG_SPEC = { boolean: ["json"], value: ["dir", "tick", "loop-session-key", "bin", "home"] };

/** `refresh-run`'s flags. */
const REFRESH_RUN_FLAG_SPEC = { boolean: ["json"], value: ["dir", "repo", "bin", "home"] };

/** `scratch-carry`'s flags. */
const SCRATCH_CARRY_FLAG_SPEC = { boolean: ["dry-run", "json"], value: ["from", "to"] };

/**
 * Every flag one spec declares, with the `--`, for the help-truth ratchet.
 *
 * @param spec the spec
 * @returns the flag names
 */
function flagNames({ spec }: { spec: { boolean: readonly string[]; value: readonly string[] } }): readonly string[] {
  return [...spec.value.map((name) => `--${name}`), ...spec.boolean.map((name) => `--${name}`)];
}

export const SUPERVISOR_TICK_CAPTURE_FLAG_NAMES: readonly string[] = flagNames({ spec: TICK_CAPTURE_FLAG_SPEC });
export const SUPERVISOR_REFRESH_RUN_FLAG_NAMES: readonly string[] = flagNames({ spec: REFRESH_RUN_FLAG_SPEC });
export const SUPERVISOR_SCRATCH_CARRY_FLAG_NAMES: readonly string[] = flagNames({ spec: SCRATCH_CARRY_FLAG_SPEC });

export const SUPERVISOR_TICK_CAPTURE_USAGE =
  "usage: slopweaver supervisor tick-capture --dir <scratch dir> --tick <label> --loop-session-key <key> " +
  "[--bin <path>] [--home <dir>] [--json]\n" +
  "\n" +
  "Takes every reading a sweep tick takes — events tail, cmux list, session close-done/watch/depth/standing,\n" +
  "automation due and freshness, machine capacity, claude gauge, velocity, handover reconcile, reflect\n" +
  "friction-review, turn blocked, listen status and github hold --status — one after another, each child's\n" +
  "stdout into its own file\n" +
  "and its stderr into a separate .err, under <dir>/tick-<label>/. Writes capture.json there and prints the\n" +
  "exact `supervisor tick-draft` flags the files supply; a reading that did not complete (an exit its verb\n" +
  "does not use for a finding) is left out, so tick-draft records it unavailable. Exits 0 once\n" +
  "capture.json is written, whatever each reading\n" +
  "exited — read the summary. Refuses a tick directory that already exists. --bin defaults to this build's\n" +
  "own bin/slopweaver. Every completed JSON reading is also appended to the readings ledger\n" +
  "(`slopweaver reading last --producer <verb words>`) as tick-<label>, under --home or the ambient\n" +
  "$SLOPWEAVER_HOME, so a console page shows the tick's own bytes; a refusal there is a diagnostic.\n" +
  "\n" +
  "example: slopweaver supervisor tick-capture --dir ~/.slopweaver/supervisor-scratch/handoff-9271 --tick 4 " +
  "--loop-session-key live-bot-loop-15sep-a";

export const SUPERVISOR_REFRESH_RUN_USAGE =
  "usage: slopweaver supervisor refresh-run --dir <scratch dir> [--repo <owner/name>] [--bin <path>] " +
  "[--home <dir>] [--json]\n" +
  "\n" +
  "Rewrites <dir>/run.json from `session-start --json --no-record`, and <dir>/autonomy-qualified.jsonl from the\n" +
  "store's autonomy ledger, with every bare PR number qualified as <owner/name>#<number> so `briefing render --your-list`\n" +
  "meets no bare reference. Both writes are atomic; a session-start that exits non-zero leaves run.json as it\n" +
  "was, and a store that cannot be read refuses rather than leaving a stale autonomy copy.\n" +
  "--repo defaults to the origin of the checkout this runs in, and the output names it.\n" +
  "\n" +
  "example: slopweaver supervisor refresh-run --dir ~/.slopweaver/supervisor-scratch/handoff-9271";

export const SUPERVISOR_SCRATCH_CARRY_USAGE =
  "usage: slopweaver supervisor scratch-carry --from <predecessor dir> --to <successor dir> [--dry-run] [--json]\n" +
  "\n" +
  "The retention rule for a seat's scratch: copies ONLY form.json, open-pages.json and shell.txt from the\n" +
  "predecessor's directory, and reports what it left behind. Readings are retaken by tick-capture, run.json is\n" +
  "rebuilt by refresh-run, and a script is never inherited. Refuses, copying nothing, when any of those files\n" +
  "already exists in --to.\n" +
  "\n" +
  "example: slopweaver supervisor scratch-carry --from ~/.slopweaver/supervisor-scratch/handoff-9270 " +
  "--to ~/.slopweaver/supervisor-scratch/handoff-9271";

/** A parsed `tick-capture` invocation. */
export interface TickCaptureArgs {
  readonly dir: string;
  readonly tick: string;
  readonly loopSessionKey: string;
  readonly bin: string | undefined;
  /** The state home the readings ledger lives under, when `--home` named one. */
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `refresh-run` invocation. */
export interface RefreshRunArgs {
  readonly dir: string;
  readonly repo: string | undefined;
  readonly bin: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `scratch-carry` invocation. */
export interface ScratchCarryArgs {
  readonly from: string;
  readonly to: string;
  readonly dryRun: boolean;
  readonly json: boolean;
}

/**
 * The refusal for a required flag that was not passed.
 *
 * @param flag the flag, without its `--`
 * @returns the usage error
 */
function missing({ flag }: { flag: string }): ScratchError {
  return ScratchErrors.usage({ message: `--${flag} is required` });
}

/**
 * The refusal for a tokenising failure, joined into one message.
 *
 * @param lines what the shared parser reported
 * @returns the usage error
 */
function unparsed({ lines }: { lines: readonly string[] }): ScratchError {
  return ScratchErrors.usage({ message: lines.join("; ") });
}

/**
 * Parse `supervisor tick-capture`'s argv tail.
 *
 * @param rest the argv after `supervisor tick-capture`
 * @returns the invocation, or the first refusal
 */
export function parseTickCaptureArgs({ rest }: { rest: readonly string[] }): Result<TickCaptureArgs, ScratchError> {
  const parsed = parseFlagTail({ rest, spec: TICK_CAPTURE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(unparsed({ lines: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const dir = values["dir"];
  const tick = values["tick"];
  const loopSessionKey = values["loop-session-key"];
  if (dir === undefined) {
    return err(missing({ flag: "dir" }));
  }
  if (tick === undefined) {
    return err(missing({ flag: "tick" }));
  }
  if (loopSessionKey === undefined) {
    return err(missing({ flag: "loop-session-key" }));
  }
  if (!isTickLabel({ tick })) {
    return err(
      ScratchErrors.usage({
        message: `--tick ${tick} must be letters, digits, '-' or '_', starting with a letter or digit — it names one directory`,
      }),
    );
  }
  return ok({ bin: values["bin"], dir, home: values["home"], json: flags.has("json"), loopSessionKey, tick });
}

/**
 * Parse `supervisor refresh-run`'s argv tail.
 *
 * @param rest the argv after `supervisor refresh-run`
 * @returns the invocation, or the first refusal
 */
export function parseRefreshRunArgs({ rest }: { rest: readonly string[] }): Result<RefreshRunArgs, ScratchError> {
  const parsed = parseFlagTail({ rest, spec: REFRESH_RUN_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(unparsed({ lines: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const dir = values["dir"];
  if (dir === undefined) {
    return err(missing({ flag: "dir" }));
  }
  const repo = values["repo"];
  if (repo !== undefined && !isRepoSlug({ repo })) {
    return err(ScratchErrors.usage({ message: `--repo ${repo} is not owner/name` }));
  }
  return ok({ bin: values["bin"], dir, home: values["home"], json: flags.has("json"), repo });
}

/**
 * Parse `supervisor scratch-carry`'s argv tail.
 *
 * @param rest the argv after `supervisor scratch-carry`
 * @returns the invocation, or the first refusal
 */
export function parseScratchCarryArgs({ rest }: { rest: readonly string[] }): Result<ScratchCarryArgs, ScratchError> {
  const parsed = parseFlagTail({ rest, spec: SCRATCH_CARRY_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(unparsed({ lines: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const from = values["from"];
  const to = values["to"];
  if (from === undefined) {
    return err(missing({ flag: "from" }));
  }
  if (to === undefined) {
    return err(missing({ flag: "to" }));
  }
  return ok({ dryRun: flags.has("dry-run"), from, json: flags.has("json"), to });
}
