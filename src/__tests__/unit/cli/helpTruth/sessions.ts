/**
 * The help-truth tables' rows for `session`, `session-start` and `machine` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { MACHINE_CAPACITY_FLAG_NAMES, parseMachineCapacityArgs } from "../../../../cli/commands/machine/capacity.js";
import {
  MACHINE_DISPATCHES_FLAG_NAMES,
  parseMachineDispatchesArgs,
} from "../../../../cli/commands/machine/dispatches.js";
import { MACHINE_REAP_FLAG_NAMES, parseMachineReapArgs } from "../../../../cli/commands/machine/reap.js";
import { MACHINE_SERIES_FLAG_NAMES, parseMachineSeriesArgs } from "../../../../cli/commands/machine/series.js";
import { MACHINE_UNUSED_FLAG_NAMES, parseMachineUnusedArgs } from "../../../../cli/commands/machine/unused.js";
import { MACHINE_WATCH_FLAG_NAMES, parseMachineWatchArgs } from "../../../../cli/commands/machine/watch.js";
import { parseSessionArgs, SESSION_FLAG_NAMES } from "../../../../cli/commands/session/core.js";
import {
  parseSessionNoSubagentsArgs,
  SESSION_NO_SUBAGENTS_FLAG_NAMES,
} from "../../../../cli/commands/session/noSubagents.js";
import { parseSessionStartArgs, SESSION_START_FLAG_NAMES } from "../../../../cli/commands/sessionStart/core.js";
import {
  LOCK_IN_FLAG_NAMES,
  lockInOptions,
  parseLockInArgs,
} from "../../../../cli/commands/sessionStart/lockInCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/**
 * A complete, coherent resolution, plus whatever the probe is actually about.
 *
 * `session-start lock-in` refuses an incomplete or incoherent row by design — five required flags, and a
 * `deferred` with no date is rejected rather than defaulted — so no flag on it can be probed alone the way
 * most flags here can. Each probe states the whole invocation it wants; this is the part they share.
 *
 * @param over the flags this probe is about, which replace the defaults they name
 * @returns one complete invocation
 */
function lockInInvocation({ over = [] }: { over?: readonly string[] } = {}): readonly string[] {
  const named = new Set(over.filter((token) => token.startsWith("--")));
  const defaults: readonly (readonly string[])[] = [
    ["--item", "linear:AAA-1"],
    ["--against", "2026-08-20T00:00:00.000Z"],
    ["--proposed", "close it, the work shipped"],
    ["--reply", "do"],
    ["--outcome", "approved-as-proposed"],
  ];
  return [...defaults.filter((pair) => !named.has(pair[0]!)).flat(), ...over];
}

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "session-start": SESSION_START_FLAG_NAMES,
  "session-start lock-in": LOCK_IN_FLAG_NAMES,
  "session-start run": SESSION_START_FLAG_NAMES,
  "machine capacity": MACHINE_CAPACITY_FLAG_NAMES,
  "machine dispatches": MACHINE_DISPATCHES_FLAG_NAMES,
  "machine series": MACHINE_SERIES_FLAG_NAMES,
  "machine unused": MACHINE_UNUSED_FLAG_NAMES,
  "machine watch": MACHINE_WATCH_FLAG_NAMES,
  "machine reap": MACHINE_REAP_FLAG_NAMES,
  "session no-subagents": SESSION_NO_SUBAGENTS_FLAG_NAMES,
  "session reach-grant": SESSION_FLAG_NAMES["reach-grant"]!,
  "session close": SESSION_FLAG_NAMES["close"]!,
  "session compaction": SESSION_FLAG_NAMES["compaction"]!,
  "session spend": SESSION_FLAG_NAMES["spend"]!,
  "session close-done": SESSION_FLAG_NAMES["close-done"]!,
  "session depth": SESSION_FLAG_NAMES["depth"]!,
  "session fallbacks": SESSION_FLAG_NAMES["fallbacks"]!,
  "session list": SESSION_FLAG_NAMES["list"]!,
  "session record": SESSION_FLAG_NAMES["record"]!,
  "session respawn": SESSION_FLAG_NAMES["respawn"]!,
  "session re-seat": SESSION_FLAG_NAMES["re-seat"]!,
  "session standing": SESSION_FLAG_NAMES["standing"]!,
  "session watch": SESSION_FLAG_NAMES["watch"]!,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "session-start lock-in": {
    "--against": lockInInvocation({ over: ["--against", "2026-08-21T00:00:00.000Z"] }),
    "--home": lockInInvocation({ over: ["--home", "/tmp"] }),
    "--item": lockInInvocation({ over: ["--item", "handover:a-run"] }),
    "--json": lockInInvocation({ over: ["--json"] }),
    "--note": lockInInvocation({ over: ["--note", "the owner said the fix landed elsewhere"] }),
    "--now": lockInInvocation({ over: ["--now", "2026-09-01T00:00:00.000Z"] }),
    "--outcome": lockInInvocation({ over: ["--outcome", "noted", "--reply", "note"] }),
    "--proposed": lockInInvocation({ over: ["--proposed", "answer the recorded question"] }),
    "--reason": lockInInvocation({ over: ["--outcome", "rejected", "--reason", "already-done"] }),
    "--reply": lockInInvocation({ over: ["--reply", "skip", "--outcome", "dropped"] }),
    "--until": lockInInvocation({
      over: ["--reply", "defer", "--outcome", "deferred", "--until", "2026-09-05T00:00:00.000Z"],
    }),
  },
  "session-start page": {
    "--form": ["--form", '{"retrospective":[]}'],
    "--list": ["--list", "-"],
    "--out": ["--out", "page.html"],
    "--top": ["--top", "5"],
  },
  "session-start": {
    "--base": ["--base", "origin/main"],
    "--deadline": ["--deadline", "2026-09-01T00:07:00.000Z"],
    "--no-record": ["--no-record"],
    "--no-verify": ["--no-verify"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-01T00:00:00.000Z"],
    "--out": ["--out", "/tmp/run.fresh.json"],
    "--probe": ["--probe"],
    "--top": ["--top", "5"],
  },
  "session close": {
    "--home": ["--home", "/tmp"],
    "--workspace": ["--workspace", "workspace:1"],
  },
  "session reach-grant": {
    "--home": ["--home", "/tmp"],
    "--reason": ["--reason", "verifying the number the atlas walk found"],
    "--tool": ["--tool", "twilio"],
  },
  "session close-done": {
    "--dir": ["--dir", "/tmp"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--keep-worktrees": ["--keep-worktrees"],
  },
  "session compaction": {
    "--alert": ["--alert"],
    "--check": ["--check"],
    "--days": ["--days", "7"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--projects-dir": ["--projects-dir", "/tmp"],
    "--record-reading": ["--record-reading", "a taker"],
    "--tolerance": ["--tolerance", "0.05"],
    "--windows": ["--windows", "300000,400000"],
  },
  "session spend": {
    "--days": ["--days", "7"],
    "--finding": ["--finding"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--min-share": ["--min-share", "0.02"],
    "--projects-dir": ["--projects-dir", "/tmp"],
    "--record-reading": ["--record-reading", "a taker"],
    "--repos": ["--repos", "o/r,o/s"],
    "--tolerance": ["--tolerance", "0.2"],
  },
  "session depth": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--loop-session-key": ["--loop-session-key", "a-doc"],
    "--threshold": ["--threshold", "400000"],
  },
  "session fallbacks": {
    "--json": ["--json"],
  },
  "session list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "session record": {
    "--home": ["--home", "/tmp"],
    "--note": ["--note", "a status note"],
  },
  "session respawn": {
    "--confirm": ["--confirm"],
    "--dry-run": ["--dry-run"],
    "--force": ["--force"],
    "--home": ["--home", "/tmp"],
    "--successor": ["--successor", "a-doc"],
  },
  "session re-seat": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--timeout-seconds": ["--timeout-seconds", "60"],
  },
  "session standing": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--loop-session-key": ["--loop-session-key", "a-doc"],
  },
  "session watch": {
    "--follow": ["--follow"],
    "--home": ["--home", "/tmp"],
    "--idle-minutes": ["--idle-minutes", "15"],
    "--include-stale": ["--include-stale"],
    "--json": ["--json"],
    "--json-report": ["--json-report"],
    "--record-reading": ["--json-report", "--record-reading", "sync-now"],
    "--reset-state": ["--reset-state"],
    "--since": ["--since", "1"],
  },
  "machine capacity": {
    "--brief": ["--brief"],
    "--full": ["--full"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--record-reading": ["--json", "--record-reading", "tick-12"],
    "--timeout-seconds": ["--wait", "--timeout-seconds", "60"],
    "--top": ["--top", "5"],
    "--wait": ["--wait"],
  },
  "machine dispatches": {
    "--all": ["--all"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--witness": ["--witness", "what I found"],
  },
  "machine reap": {
    "--dry-run": ["--dry-run"],
    "--json": ["--json"],
  },
  "machine series": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "machine unused": {
    "--days": ["--days", "7"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "machine watch": {
    "--for-seconds": ["--for-seconds", "60"],
    "--home": ["--home", "/tmp"],
    "--interval-seconds": ["--interval-seconds", "15"],
    "--json": ["--json"],
    "--once": ["--once"],
  },
  "session no-subagents": {
    "--clear": ["--clear"],
    "--home": ["--home", "/tmp"],
    "--hours": ["--why", "w", "--hours", "2"],
    "--why": ["--why", "the fan-out is FLAT"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "session-start lock-in": ({ fragment }) => {
    const parsed = parseLockInArgs({ rest: [...fragment] });
    return parsed.isErr()
      ? parsed
      : lockInOptions({ nowIso: "2026-08-30T12:00:00.000Z", parsed: parsed.value }).mapErr((error) => [error.message]);
  },
  "session-start": ({ fragment }) => parseSessionStartArgs({ rest: [...fragment] }),
  "session-start run": ({ fragment }) => parseSessionStartArgs({ rest: [...fragment] }),
  "machine capacity": ({ fragment }) => parseMachineCapacityArgs({ rest: [...fragment] }),
  "machine dispatches": ({ fragment }) => parseMachineDispatchesArgs({ rest: [...fragment] }),
  "machine reap": ({ fragment }) => parseMachineReapArgs({ rest: [...fragment] }),
  "machine series": ({ fragment }) => parseMachineSeriesArgs({ rest: [...fragment] }),
  "machine unused": ({ fragment }) => parseMachineUnusedArgs({ rest: [...fragment] }),
  "machine watch": ({ fragment }) => parseMachineWatchArgs({ rest: [...fragment] }),
  "session no-subagents": ({ fragment }) => parseSessionNoSubagentsArgs({ rest: [...fragment] }),
  "session reach-grant": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "reach-grant" }),
  "session close": ({ fragment }) => parseSessionArgs({ rest: ["a-doc", ...fragment], verb: "close" }),
  "session close-done": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "close-done" }),
  "session compaction": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "compaction" }),
  "session spend": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "spend" }),
  "session depth": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "depth" }),
  "session fallbacks": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "fallbacks" }),
  "session list": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "list" }),
  "session record": ({ fragment }) => parseSessionArgs({ rest: ["a-doc", ...fragment], verb: "record" }),
  "session respawn": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "respawn" }),
  "session re-seat": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "re-seat" }),
  "session standing": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "standing" }),
  "session watch": ({ fragment }) => parseSessionArgs({ rest: [...fragment], verb: "watch" }),
};

/** The rows for `session`, `session-start` and `machine`. */
export const sessionsSlice: HelpTruthSlice = { guarded, probes, parsers };
