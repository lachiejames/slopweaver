/**
 * The flags of `slopweaver supervisor tick seat|open|fill|close`, and what an invocation of each means. No I/O;
 * `./tickRun.ts` does the work. `fill`'s own flags are parsed in `./tickFillArgs.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ScratchError, ScratchErrors } from "../../../supervisor/scratch/errors.js";
import { parseFlagTail } from "../../optionParsers.js";
import { missing, tickNumberOf } from "./tickArgParts.js";
import { FILL_FLAG_SPEC, parseFill, type TickFillArgs } from "./tickFillArgs.js";

/** Each subaction's flags. */
const SEAT_FLAG_SPEC = {
  boolean: ["replace"],
  value: ["dir", "workspace", "handoff", "model", "pinned-at", "loop-session-key", "landing-repos"],
};
const OPEN_FLAG_SPEC = { boolean: [], value: ["dir", "tick", "bin", "home"] };
const CLOSE_FLAG_SPEC = { boolean: [], value: ["dir", "tick", "bin", "home", "your-list"] };

/**
 * Every flag one spec declares, with the `--`, for the help-truth ratchet.
 *
 * @param spec the spec
 * @returns the flag names
 */
function flagNames({ spec }: { spec: { boolean: readonly string[]; value: readonly string[] } }): readonly string[] {
  return [...spec.value.map((name) => `--${name}`), ...spec.boolean.map((name) => `--${name}`)];
}

/** Every flag any `supervisor tick` subaction takes. */
export const SUPERVISOR_TICK_FLAG_NAMES: readonly string[] = [
  ...new Set([
    ...flagNames({ spec: SEAT_FLAG_SPEC }),
    ...flagNames({ spec: OPEN_FLAG_SPEC }),
    ...flagNames({ spec: CLOSE_FLAG_SPEC }),
    ...flagNames({ spec: FILL_FLAG_SPEC }),
  ]),
];

export const SUPERVISOR_TICK_USAGE =
  "usage: slopweaver supervisor tick seat --dir <scratch dir> --workspace <workspace:n> --model <model> " +
  "--pinned-at <iso> --loop-session-key <key> [--handoff <handoff-n>] [--landing-repos <owner/name,...>] [--replace]\n" +
  "       slopweaver supervisor tick open --dir <scratch dir> [--tick <n>] [--bin <path>] [--home <dir>]\n" +
  "       slopweaver supervisor tick close --dir <scratch dir> [--tick <n>] [--bin <path>] [--home <dir>] " +
  "[--your-list <path>]\n" +
  "       slopweaver supervisor tick fill --dir <scratch dir> [--tick <n>] [--carry-from <n>] " +
  "[--headline-sentence <text>]... [--fold <text>... | --fold-file <path>...] [--fold-at <i>] " +
  "[--fold-summary <text>] [--lede <text>] [--alignment-summary <text>] [--earlier-summary <text>] " +
  "[--alignment-detail <text>]... [--drop-card <prefix>]... [--sleeping true|false] " +
  "[--open-pages-reviewed true|false] [--shift <text> | --shift-file <path> | --quiet-shift] " +
  "[--actions <json path>] [--judgements <json path>] [--drop-action <id>]... [--drop-judgement <id>]...\n" +
  "\n" +
  "One chair sweep as two verbs and a file. `seat` writes <dir>/seat.json ONCE per seat: the header constants\n" +
  "and the loop session key every pass used to retype. `open` takes the next tick-<n> (one past the highest),\n" +
  "runs every reading with its own time budget, writes the whole digest to tick-<n>/digest.txt, and prints what\n" +
  "CHANGED since tick n-1 first, then every obligation still standing (the queue leader, CHAIR and REACT NOW, a\n" +
  "BROKEN or absent automation, any unknown), then ONE line folding the unchanged rest behind that file — every\n" +
  "line on the seat's first tick or when tick n-1 left no digest. It writes\n" +
  "tick-<n>/tick.json: the template the chair fills — headline.sentences (at most four, one sentence each, no\n" +
  "path, seat number, 'tick' or 'row'), folds, foldSummary, actions, judgements, shift, openPagesReviewed.\n" +
  "`close` refuses a malformed tick.json naming each field, then refreshes the owner's list, archives the form,\n" +
  "adds the sweep block, renders and checks the page, and only then — past the chair gate — writes: the\n" +
  "form, the page (published and frozen), the tick ledger row. Each write is a stage in\n" +
  "tick-<n>/close-state.json, so re-running the same close resumes where it stopped. The next sweep prompt\n" +
  "prints LAST on stdout. --tick defaults to the highest tick in <dir>.\n" +
  "--your-list hands close a list `session-start --json --no-record` already wrote, so close launches no\n" +
  "refresh child of its own: the route when the machine is loaded and that child overruns its budget. The\n" +
  "render still refuses a list over ninety minutes old, judged by the document's own instant.\n" +
  "`fill` writes tick-<n>/tick.json itself — never jq, never a redirect. --carry-from copies an earlier tick's\n" +
  "folds, foldSummary, judgements and sleeping first; every other flag lands on top. A list flag replaces its\n" +
  "list; --fold-at <i> sets the ONE fold given at index i (the length appends). --actions and --judgements name\n" +
  "a JSON array file whose rows replace the row with the same actionId / judgementId, or are appended; every\n" +
  "row is judged against the ledger's shape and one bad row writes nothing. It then prints what close would\n" +
  "still refuse, or that close will take the form. It refuses a tick whose close already began.\n" +
  "\n" +
  "example: slopweaver supervisor tick close --dir ~/.slopweaver/supervisor-scratch/handoff-9292";

/** A parsed `tick seat`. */
export interface TickSeatArgs {
  readonly subaction: "seat";
  readonly dir: string;
  readonly workspace: string;
  /** The handoff when `--handoff` named one; otherwise the directory's own name decides it. */
  readonly handoff: string | undefined;
  readonly model: string;
  readonly pinnedAt: string;
  readonly loopSessionKey: string;
  readonly landingRepos: readonly string[];
  readonly replace: boolean;
}

/** A parsed `tick open`. */
export interface TickOpenArgs {
  readonly subaction: "open";
  readonly dir: string;
  readonly tick: number | undefined;
  readonly bin: string | undefined;
  readonly home: string | undefined;
}

/** A parsed `tick close`. */
export interface TickCloseArgs {
  readonly subaction: "close";
  readonly dir: string;
  readonly tick: number | undefined;
  readonly bin: string | undefined;
  readonly home: string | undefined;
  /** A `session-start --json` document already on disk, rendered in place of the close's own refresh child. */
  readonly yourList: string | undefined;
}

/** One parsed `supervisor tick` invocation. */
export type TickArgs = TickSeatArgs | TickOpenArgs | TickCloseArgs | TickFillArgs;

/**
 * Parse `tick seat`'s flags.
 *
 * @param rest the argv after `supervisor tick seat`
 * @returns the invocation, or the first refusal
 */
function parseSeat({ rest }: { rest: readonly string[] }): Result<TickSeatArgs, ScratchError> {
  const parsed = parseFlagTail({ rest, spec: SEAT_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(ScratchErrors.usage({ message: parsed.error.join("; ") }));
  }
  const { values, flags } = parsed.value;
  const required = ["dir", "workspace", "model", "pinned-at", "loop-session-key"] as const;
  const absent = required.find((flag) => values[flag] === undefined);
  if (absent !== undefined) {
    return err(missing({ flag: absent, subaction: "seat" }));
  }
  const repos = values["landing-repos"];
  return ok({
    dir: values["dir"]!,
    handoff: values["handoff"],
    landingRepos: repos === undefined ? [] : repos.split(",").map((repo) => repo.trim()),
    loopSessionKey: values["loop-session-key"]!,
    model: values["model"]!,
    pinnedAt: values["pinned-at"]!,
    replace: flags.has("replace"),
    subaction: "seat",
    workspace: values["workspace"]!,
  });
}

/**
 * Parse `tick open`'s or `tick close`'s flags.
 *
 * @param rest the argv after the subaction
 * @param subaction which of the two
 * @returns the invocation, or the first refusal
 */
function parseOpenOrClose({
  rest,
  subaction,
}: {
  rest: readonly string[];
  subaction: "open" | "close";
}): Result<TickOpenArgs | TickCloseArgs, ScratchError> {
  const parsed = parseFlagTail({ rest, spec: subaction === "open" ? OPEN_FLAG_SPEC : CLOSE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(ScratchErrors.usage({ message: parsed.error.join("; ") }));
  }
  const { values } = parsed.value;
  const dir = values["dir"];
  if (dir === undefined) {
    return err(missing({ flag: "dir", subaction }));
  }
  const tick = tickNumberOf({ raw: values["tick"] });
  if (tick.isErr()) {
    return err(tick.error);
  }
  const common = { bin: values["bin"], dir, home: values["home"], tick: tick.value };
  if (subaction === "open") {
    return ok({ ...common, subaction });
  }
  return ok({ ...common, subaction, yourList: values["your-list"] });
}

/**
 * Parse `supervisor tick`'s argv tail: the subaction, then its flags.
 *
 * @param rest the argv after `supervisor tick`
 * @returns the invocation, or the first refusal
 */
export function parseSupervisorTickArgs({ rest }: { rest: readonly string[] }): Result<TickArgs, ScratchError> {
  const [subaction, ...flags] = rest;
  if (subaction === "seat") {
    return parseSeat({ rest: flags });
  }
  if (subaction === "open" || subaction === "close") {
    return parseOpenOrClose({ rest: flags, subaction });
  }
  if (subaction === "fill") {
    return parseFill({ rest: flags });
  }
  const named = subaction === undefined ? "no subaction" : `"${subaction}"`;
  return err(ScratchErrors.usage({ message: `${named} — tick takes seat, open, fill or close` }));
}
