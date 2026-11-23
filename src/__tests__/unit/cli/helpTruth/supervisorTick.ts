/**
 * The help-truth tables' rows for `supervisor`'s tick verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseSweepPromptOptions, SWEEP_PROMPT_FLAG_SPEC } from "../../../../cli/commands/supervisor/run.js";
import {
  parseRefreshRunArgs,
  parseTickCaptureArgs,
  SUPERVISOR_REFRESH_RUN_FLAG_NAMES,
  SUPERVISOR_TICK_CAPTURE_FLAG_NAMES,
} from "../../../../cli/commands/supervisor/scratchCore.js";
import { parseSupervisorTickArgs, SUPERVISOR_TICK_FLAG_NAMES } from "../../../../cli/commands/supervisor/tickCore.js";
import {
  parseSupervisorTickDraftArgs,
  SUPERVISOR_TICK_DRAFT_FLAG_NAMES,
} from "../../../../cli/commands/supervisor/tickDraftCore.js";
import {
  parseSupervisorTickRecordArgs,
  SUPERVISOR_TICK_RECORD_FLAG_NAMES,
} from "../../../../cli/commands/supervisor/tickRecordCore.js";
import { parseTickResealOptions, TICK_RESEAL_FLAG_SPEC } from "../../../../cli/commands/supervisor/tickResealRun.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/** `supervisor tick-reseal`'s advertised flags, derived from the spec the verb parses with. */
const TICK_RESEAL_FLAG_NAMES: readonly string[] = [
  ...TICK_RESEAL_FLAG_SPEC.value.map((name) => `--${name}`),
  ...TICK_RESEAL_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** A valid `supervisor tick-reseal --apply` invocation: its digest and reason belong to `--apply` alone. */
const TICK_RESEAL_APPLY_PROBE: readonly string[] = [
  "--apply",
  "--source-sha256",
  "a".repeat(64),
  "--reason",
  "carried home",
];

/** `supervisor sweep-prompt`'s advertised flags, derived from the spec the verb parses with. */
const SWEEP_PROMPT_FLAG_NAMES: readonly string[] = [
  ...SWEEP_PROMPT_FLAG_SPEC.value.map((name) => `--${name}`),
  ...SWEEP_PROMPT_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `supervisor tick-record`'s advertised flags, derived from the constant the verb's usage line is built from. */
const TICK_RECORD_FLAG_NAMES: readonly string[] = SUPERVISOR_TICK_RECORD_FLAG_NAMES;

/** `supervisor tick-draft`'s advertised flags, derived from the spec the verb parses with. */
const TICK_DRAFT_FLAG_NAMES: readonly string[] = SUPERVISOR_TICK_DRAFT_FLAG_NAMES;

/** A valid `supervisor tick seat` invocation, every required flag present. */
const TICK_SEAT_BASE_PROBE: readonly string[] = [
  "seat",
  "--dir",
  "/tmp/handoff-9292",
  "--workspace",
  "workspace:93",
  "--model",
  "fable",
  "--pinned-at",
  "2026-09-23T14:36:00Z",
  "--loop-session-key",
  "live-loop-a",
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "supervisor tick-record": TICK_RECORD_FLAG_NAMES,
  "supervisor tick-draft": TICK_DRAFT_FLAG_NAMES,
  "supervisor tick-reseal": TICK_RESEAL_FLAG_NAMES,
  "supervisor tick": SUPERVISOR_TICK_FLAG_NAMES,
  "supervisor tick-capture": SUPERVISOR_TICK_CAPTURE_FLAG_NAMES,
  "supervisor refresh-run": SUPERVISOR_REFRESH_RUN_FLAG_NAMES,
  "supervisor sweep-prompt": SWEEP_PROMPT_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "supervisor sweep-prompt": {
    "--budget": ["--budget"],
    "--json": ["--json"],
    "--shift": ["--shift", "ws 971 landing #231"],
    "--shift-file": ["--shift-file", "/tmp/shift.txt"],
  },
  "supervisor tick-record": {
    "--draft": ["--draft", "/tmp/draft.json"],
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-10T12:20:00.000Z"],
    "--reconcile": ["--reconcile", "/tmp/reconcile.json"],
  },
  "supervisor tick-draft": {
    "--actions": ["--actions", "/tmp/a.json"],
    "--captured": ["--captured", "2026-09-12T21:25:00Z"],
    "--capacity": ["--capacity", "/tmp/capacity.json"],
    "--close-done": ["--close-done", "/tmp/close-done.json"],
    "--friction": ["--friction", "/tmp/friction.json"],
    "--gauge": ["--gauge", "/tmp/gauge.json"],
    "--handoff": ["--handoff", "handoff-9249"],
    "--json": ["--json"],
    "--judgements": ["--judgements", "/tmp/j.json"],
    "--listener": ["--listener", "/tmp/listener.json"],
    "--out": ["--out", "/tmp/draft.json"],
    "--recipe-due": ["--recipe-due", "/tmp/recipe-due.json"],
    "--reconcile": ["--reconcile", "/tmp/reconcile.json"],
    "--seat-ceiling": ["--seat-ceiling", "/tmp/seat-ceiling.json"],
    "--started": ["--started", "2026-09-12T21:18:42Z"],
    "--tick-id": ["--tick-id", "handoff-9249-tick-7"],
    "--velocity": ["--velocity", "/tmp/velocity.json"],
    "--watch": ["--watch", "/tmp/watch.json"],
    "--workspace": ["--workspace", "workspace:55"],
  },
  // Each probe names its subaction, because the three take different flags; `--dir` and `--tick` probe `open`.
  "supervisor tick": {
    "--actions": ["fill", "--dir", "/tmp/s", "--actions", "/tmp/s/actions.json"],
    "--alignment-detail": ["fill", "--dir", "/tmp/s", "--alignment-detail", "One detail."],
    "--alignment-summary": ["fill", "--dir", "/tmp/s", "--alignment-summary", "Aligned."],
    "--carry-from": ["fill", "--dir", "/tmp/s", "--tick", "4", "--carry-from", "3"],
    "--drop-action": ["fill", "--dir", "/tmp/s", "--drop-action", "a1"],
    "--drop-card": ["fill", "--dir", "/tmp/s", "--drop-card", "pr-"],
    "--drop-judgement": ["fill", "--dir", "/tmp/s", "--drop-judgement", "j1"],
    "--earlier-summary": ["fill", "--dir", "/tmp/s", "--earlier-summary", "Earlier today."],
    "--fold": ["fill", "--dir", "/tmp/s", "--fold", "A fold."],
    "--fold-at": ["fill", "--dir", "/tmp/s", "--fold", "A fold.", "--fold-at", "0"],
    "--fold-file": ["fill", "--dir", "/tmp/s", "--fold-file", "/tmp/s/f1.txt"],
    "--fold-summary": ["fill", "--dir", "/tmp/s", "--fold-summary", "What the sweep read."],
    "--headline-sentence": ["fill", "--dir", "/tmp/s", "--headline-sentence", "The queue is clear."],
    "--judgements": ["fill", "--dir", "/tmp/s", "--judgements", "/tmp/s/judgements.json"],
    "--lede": ["fill", "--dir", "/tmp/s", "--lede", "A lede."],
    "--open-pages-reviewed": ["fill", "--dir", "/tmp/s", "--open-pages-reviewed", "true"],
    "--quiet-shift": ["fill", "--dir", "/tmp/s", "--quiet-shift"],
    "--shift": ["fill", "--dir", "/tmp/s", "--shift", "Next shift."],
    "--shift-file": ["fill", "--dir", "/tmp/s", "--shift-file", "/tmp/s/shift.txt"],
    "--sleeping": ["fill", "--dir", "/tmp/s", "--sleeping", "false"],
    "--bin": ["close", "--dir", "/tmp/s", "--bin", "/tmp/bin/slopweaver"],
    "--dir": ["open", "--dir", "/tmp/s"],
    "--handoff": [...TICK_SEAT_BASE_PROBE, "--handoff", "handoff-9292"],
    "--home": ["close", "--dir", "/tmp/s", "--home", "/tmp/home"],
    "--landing-repos": [...TICK_SEAT_BASE_PROBE, "--landing-repos", "o/r,o/s"],
    "--loop-session-key": TICK_SEAT_BASE_PROBE,
    "--model": TICK_SEAT_BASE_PROBE,
    "--pinned-at": TICK_SEAT_BASE_PROBE,
    "--replace": [...TICK_SEAT_BASE_PROBE, "--replace"],
    "--tick": ["open", "--dir", "/tmp/s", "--tick", "4"],
    "--workspace": TICK_SEAT_BASE_PROBE,
    "--your-list": ["close", "--dir", "/tmp/s", "--your-list", "/tmp/s/run.fresh.json"],
  },
  "supervisor tick-reseal": {
    "--apply": TICK_RESEAL_APPLY_PROBE,
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
    "--now": [...TICK_RESEAL_APPLY_PROBE, "--now", "2026-11-17T10:20:30Z"],
    "--reason": TICK_RESEAL_APPLY_PROBE,
    "--source-sha256": TICK_RESEAL_APPLY_PROBE,
  },
  "supervisor tick-capture": {
    "--bin": ["--bin", "/tmp/bin/slopweaver"],
    "--dir": ["--dir", "/tmp/scratch"],
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
    "--loop-session-key": ["--loop-session-key", "live-loop-a"],
    "--tick": ["--tick", "4"],
  },
  "supervisor refresh-run": {
    "--bin": ["--bin", "/tmp/bin/slopweaver"],
    "--dir": ["--dir", "/tmp/scratch"],
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
    "--repo": ["--repo", "o/r"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "supervisor sweep-prompt": ({ fragment }) => parseSweepPromptOptions({ rest: [...fragment] }),
  // Both documents are required, so a fragment probing any OTHER flag has to carry them or every probe
  // reports the same missing-flag error instead of the one it was testing.
  "supervisor tick-record": ({ fragment }) =>
    parseSupervisorTickRecordArgs({
      rest: dedupeFlags({ base: ["--draft", "/tmp/draft.json", "--reconcile", "/tmp/reconcile.json"], fragment }),
    }),
  // Eight flags are required, so a fragment probing any flag has to carry the rest of them — `dedupeFlags`
  // drops the base copy of a flag the fragment supplies, which is what lets a fragment probe a required flag too.
  "supervisor tick-draft": ({ fragment }) =>
    parseSupervisorTickDraftArgs({
      rest: dedupeFlags({
        base: [
          "--tick-id",
          "t",
          "--workspace",
          "workspace:1",
          "--handoff",
          "h",
          "--started",
          "2026-09-12T21:18:42Z",
          "--captured",
          "2026-09-12T21:25:00Z",
          "--actions",
          "/tmp/a.json",
          "--judgements",
          "/tmp/j.json",
          "--out",
          "/tmp/draft.json",
        ],
        fragment,
      }),
    }),
  "supervisor tick-reseal": ({ fragment }) =>
    parseTickResealOptions({ rest: [...fragment] }).mapErr((error) => [...error.reasons]),
  // Each scratch verb reports ONE typed usage error rather than a list; the probe reads its message. Required
  // flags ride along so a fragment probes its own flag, not a missing one.
  "supervisor tick": ({ fragment }) =>
    parseSupervisorTickArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "supervisor tick-capture": ({ fragment }) =>
    parseTickCaptureArgs({
      rest: dedupeFlags({ base: ["--dir", "/tmp/s", "--tick", "1", "--loop-session-key", "k"], fragment }),
    }).mapErr((error) => [error.message]),
  "supervisor refresh-run": ({ fragment }) =>
    parseRefreshRunArgs({ rest: dedupeFlags({ base: ["--dir", "/tmp/s"], fragment }) }).mapErr((error) => [
      error.message,
    ]),
};

/** The rows for `supervisor`'s tick verbs. */
export const supervisorTickSlice: HelpTruthSlice = { guarded, probes, parsers };
