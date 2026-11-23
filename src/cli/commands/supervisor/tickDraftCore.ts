/**
 * The pure half of `slopweaver supervisor tick-draft`: what its flags mean, and how the documents a tick
 * redirected become a draft `supervisor tick-record --draft` takes.
 *
 * The twelve observations are `../../../supervisor/tickDraftSources.ts`'s. What this adds is the envelope —
 * the tick's identity, its actions and judgements — and the proof: the assembled draft is put through
 * `finaliseSupervisorTick`, the tick ledger's own door, before anything is written. That run uses an
 * `unavailable` owner-turn snapshot, and the snapshot is never emitted; the draft may not carry owner turns at
 * all, because tick-record takes them off the reconciliation itself.
 *
 * No I/O, no clock. `./tickDraftRun.ts` reads the files and writes the draft.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  type CapturedDocument,
  DRAFTED_SOURCE_KINDS,
  DRAFTED_SOURCES,
  type DraftedSourceKind,
  draftTickSources,
} from "../../../supervisor/tickDraftSources.js";
import {
  DRAFT_VALIDATION_TURNS,
  type SupervisorTickSources,
  TICK_SOURCE_KINDS,
} from "../../../supervisor/tickTypes.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type SupervisorError, SupervisorErrors } from "./errors.js";
import { finaliseSupervisorTick, parseSupervisorTickDraft } from "./tickRecordCore.js";

/** The flags every draft needs, in the order the usage line names them. */
const REQUIRED_FLAGS = [
  "tick-id",
  "workspace",
  "handoff",
  "started",
  "captured",
  "actions",
  "judgements",
  "out",
] as const;

/** The flag spec the verb parses with — the required flags, one per drafted source, and `--json`. */
const TICK_DRAFT_FLAG_SPEC = {
  boolean: ["json"],
  value: [...REQUIRED_FLAGS, ...DRAFTED_SOURCE_KINDS.map((kind) => DRAFTED_SOURCES[kind].flag)],
};

export const SUPERVISOR_TICK_DRAFT_USAGE =
  "usage: slopweaver supervisor tick-draft --tick-id <id> --workspace <ws> --handoff <handoff> --started <iso> " +
  "--captured <iso> --actions <path> --judgements <path> --out <path|-> " +
  "[--capacity <path>] [--seat-ceiling <path>] [--gauge <path>] [--listener <path>] [--reconcile <path>] " +
  "[--watch <path>] [--close-done <path>] [--recipe-due <path>] [--velocity <path>] [--friction <path>] [--json]\n" +
  "\n" +
  "Builds the draft `supervisor tick-record --draft` takes, from the documents this tick already redirected —\n" +
  "each source verb's own JSON, never its text: `machine capacity --json`, `claude gauge --json`, `listen\n" +
  "status --json`, `handover reconcile --json`, `session watch --json-report`, `session close-done --json`,\n" +
  "`automation due --json`, `velocity --json` and `reflect friction-review --json`. Every input is a file path.\n" +
  "A source whose flag is absent is recorded `unavailable`, naming the flag; depth, github and landings are\n" +
  "always `unavailable` here, with the reason. A reading that cannot supply every fact is `unavailable`, never\n" +
  "filled. A document of the wrong shape refuses the whole draft and nothing is written.\n" +
  "\n" +
  "--captured is the instant the undated documents were taken; a document that carries its own instant keeps\n" +
  "it, and one captured before --started is recorded `unavailable`. The draft passes tick-record's own\n" +
  "draft-content checks at the latest instant it carries — every source accounted for, each observation inside\n" +
  "the interval, no duplicate action or judgement id — so tick-record can still refuse it at an earlier --now,\n" +
  "or because the ROW it builds (this draft plus the owner turns it reads off the reconciliation) runs past the\n" +
  "ledger's own 100 MiB serialisation cap, which is a size this verb cannot see from the draft alone.\n" +
  "--out - prints only the draft to stdout; --out <path> writes it atomically and prints one summary line.\n" +
  "\n" +
  "example: slopweaver supervisor tick-draft --tick-id handoff-9249-tick-7 --workspace workspace:55 " +
  "--handoff handoff-9249 --started 2026-09-12T21:18:42Z --captured 2026-09-12T21:25:00Z --actions actions.json " +
  "--judgements judgements.json --capacity capacity.json --reconcile reconcile.json --out draft.json";

/**
 * Every flag the verb takes, WITH the `--`, for the help-truth ratchet.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export const SUPERVISOR_TICK_DRAFT_FLAG_NAMES: readonly string[] = [
  ...TICK_DRAFT_FLAG_SPEC.value.map((name) => `--${name}`),
  ...TICK_DRAFT_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** A parsed invocation. */
export interface SupervisorTickDraftArgs {
  readonly tickId: string;
  readonly workspace: string;
  readonly handoff: string;
  readonly startedIso: string;
  /** The instant the caller asserts its undated documents were captured at. */
  readonly capturedIso: string;
  readonly actionsPath: string;
  readonly judgementsPath: string;
  /** Where the draft goes — a path, or `-` for stdout. */
  readonly out: string;
  /** The document path for each drafted source that was supplied. */
  readonly sourcePaths: Readonly<Partial<Record<DraftedSourceKind, string>>>;
  readonly json: boolean;
}

/**
 * One line per required flag the invocation did not carry.
 *
 * @param values the parsed value flags
 * @returns the missing-flag lines, empty when every required flag was given
 */
function missingFlags({ values }: { values: Readonly<Record<string, string>> }): readonly string[] {
  return REQUIRED_FLAGS.filter((flag) => values[flag] === undefined).map((flag) => `--${flag} is required`);
}

/**
 * The cross-flag checks: both instants readable and in order, no output over an input, one stdout channel.
 *
 * @param required the required values
 * @param sourcePaths the supplied source documents
 * @param json whether `--json` was passed
 * @returns one line per violation, empty when the invocation is coherent
 */
function coherenceDefects({
  args,
  inputs,
}: {
  args: SupervisorTickDraftArgs;
  inputs: readonly string[];
}): readonly string[] {
  const defects: string[] = [];
  const started = Date.parse(args.startedIso);
  const captured = Date.parse(args.capturedIso);
  if (Number.isNaN(started)) {
    defects.push(`--started ${args.startedIso} is not an ISO instant`);
  }
  if (Number.isNaN(captured)) {
    defects.push(`--captured ${args.capturedIso} is not an ISO instant`);
  }
  if (captured < started) {
    defects.push(`--captured ${args.capturedIso} is before --started ${args.startedIso}`);
  }
  if (args.out !== "-" && inputs.includes(args.out)) {
    defects.push(`--out ${args.out} is also an input: writing the draft would overwrite what it was read from`);
  }
  if (args.out === "-" && args.json) {
    defects.push("--json cannot be combined with --out -: stdout already carries the draft itself");
  }
  return defects;
}

/**
 * Parse the verb's argv tail.
 *
 * @param rest the argv after `supervisor tick-draft`
 * @returns the parsed arguments, or every refusal
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export function parseSupervisorTickDraftArgs({ rest }: { rest: readonly string[] }): Result<SupervisorTickDraftArgs> {
  const parsed = parseFlagTail({ rest, spec: TICK_DRAFT_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const missing = missingFlags({ values });
  if (missing.length > 0) {
    return err(missing);
  }
  const sourcePaths: Partial<Record<DraftedSourceKind, string>> = {};
  for (const kind of DRAFTED_SOURCE_KINDS) {
    const path = values[DRAFTED_SOURCES[kind].flag];
    if (path !== undefined) {
      sourcePaths[kind] = path;
    }
  }
  const tickId = values["tick-id"];
  const workspace = values["workspace"];
  const handoff = values["handoff"];
  const startedIso = values["started"];
  const capturedIso = values["captured"];
  const actionsPath = values["actions"];
  const judgementsPath = values["judgements"];
  const out = values["out"];
  if (
    tickId === undefined ||
    workspace === undefined ||
    handoff === undefined ||
    startedIso === undefined ||
    capturedIso === undefined ||
    actionsPath === undefined ||
    judgementsPath === undefined ||
    out === undefined
  ) {
    // Unreachable past `missingFlags`, and spelled out rather than asserted away: the narrowing is the
    // compiler's own, so a required flag added to the list above and forgotten here fails to compile.
    return err(missingFlags({ values }));
  }
  const args: SupervisorTickDraftArgs = {
    actionsPath,
    capturedIso,
    handoff,
    json: flags.has("json"),
    judgementsPath,
    out,
    sourcePaths,
    startedIso,
    tickId,
    workspace,
  };
  const defects = coherenceDefects({ args, inputs: [actionsPath, judgementsPath, ...Object.values(sourcePaths)] });
  if (defects.length > 0) {
    return err(defects);
  }
  return ok(args);
}

/**
 * The draft document, exactly as it is written.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface SupervisorTickDraftDocument {
  readonly tickId: string;
  readonly workspace: string;
  readonly handoff: string;
  readonly startedIso: string;
  readonly sources: SupervisorTickSources;
  readonly actions: readonly unknown[];
  readonly judgements: readonly unknown[];
}

/**
 * A draft that passed the tick ledger's own door, and the instant it was checked at.
 *
 * The guarantee is exactly that: the draft's own CONTENTS are valid at `validatedAtIso`. It is not a promise
 * that `tick-record` will append it, and two limits are outside what this verb can see — an earlier `--now`,
 * and the size of the ROW tick-record assembles, which adds the owner turns read off a reconciliation this
 * verb never opens. A Codex review pass built a 51 MiB draft and a 51 MiB reconciliation that are each fine
 * and together run past the ledger's 100 MiB cap (property `r3-draft-accepted-by-record`).
 */
export interface AssembledTickDraft {
  readonly document: SupervisorTickDraftDocument;
  /** The latest instant the draft carries — the earliest `--now` tick-record could accept it at. */
  readonly validatedAtIso: string;
}

/**
 * The latest of several ISO instants.
 *
 * @param instants the instants, each already parseable
 * @param floor the instant to return when none is later
 * @returns the latest instant, as it was spelled
 */
function latestInstant({ instants, floor }: { instants: readonly string[]; floor: string }): string {
  return instants.reduce((latest, instant) => (Date.parse(instant) > Date.parse(latest) ? instant : latest), floor);
}

/**
 * Assemble one draft and prove it against the tick ledger's schema.
 *
 * @param args the parsed invocation
 * @param captures the source documents read, by source
 * @param actions the parsed `--actions` document
 * @param judgements the parsed `--judgements` document
 * @returns the draft and the instant it was checked at, or every reason it was refused
 */
export function assembleSupervisorTickDraft({
  args,
  captures,
  actions,
  judgements,
}: {
  args: SupervisorTickDraftArgs;
  captures: Readonly<Partial<Record<DraftedSourceKind, CapturedDocument>>>;
  actions: unknown;
  judgements: unknown;
}): Result<AssembledTickDraft, SupervisorError> {
  if (!Array.isArray(actions) || !Array.isArray(judgements)) {
    return err(
      SupervisorErrors.draftInputsNotArrays({
        actionsPath: Array.isArray(actions) ? undefined : args.actionsPath,
        judgementsPath: Array.isArray(judgements) ? undefined : args.judgementsPath,
      }),
    );
  }
  const sources = draftTickSources({ capturedIso: args.capturedIso, captures, startedIso: args.startedIso });
  if (sources.isErr()) {
    return err(SupervisorErrors.draftSourcesRefused({ reasons: sources.error }));
  }
  const document: SupervisorTickDraftDocument = {
    actions,
    handoff: args.handoff,
    judgements,
    sources: sources.value,
    startedIso: args.startedIso,
    tickId: args.tickId,
    workspace: args.workspace,
  };
  const draft = parseSupervisorTickDraft({ document });
  if (draft.isErr()) {
    return err(draft.error);
  }
  const validatedAtIso = latestInstant({
    floor: args.capturedIso,
    instants: TICK_SOURCE_KINDS.map((kind) => sources.value[kind].observedAtIso),
  });
  const checked = finaliseSupervisorTick({
    draft: draft.value,
    finalisedIso: validatedAtIso,
    ownerTurns: DRAFT_VALIDATION_TURNS,
  });
  if (checked.isErr()) {
    return err(SupervisorErrors.draftWouldBeRefused({ refusals: checked.error }));
  }
  return ok({ document, validatedAtIso });
}

/**
 * The source kinds in one status, comma-joined, or `none` when no source landed in it.
 *
 * @param kinds the source kinds in that status
 * @returns the list as the summary line prints it
 */
function kindList({ kinds }: { kinds: readonly string[] }): string {
  if (kinds.length === 0) {
    return "none";
  }
  return kinds.join(", ");
}

/**
 * The one line a written draft prints: how many sources were read, partial and unavailable, and which.
 *
 * @param assembled the written draft
 * @param out where it was written
 * @returns the summary line
 */
export function tickDraftSummaryLine({ assembled, out }: { assembled: AssembledTickDraft; out: string }): string {
  const { sources } = assembled.document;
  const named = ({ status }: { status: "read" | "partial" | "unavailable" }): readonly string[] =>
    TICK_SOURCE_KINDS.filter((kind) => sources[kind].status === status);
  const partial = named({ status: "partial" });
  const unavailable = named({ status: "unavailable" });
  return (
    `supervisor tick-draft: wrote ${out} — ${String(named({ status: "read" }).length)} read, ` +
    `${String(partial.length)} partial (${kindList({ kinds: partial })}), ` +
    `${String(unavailable.length)} unavailable (${kindList({ kinds: unavailable })}); ` +
    `checked against the tick ledger at ${assembled.validatedAtIso}`
  );
}
