/**
 * `slopweaver workstreams react` — record their word on the candidates, stated or mined; a yes becomes a register entry.
 *
 * Two spellings of one act. Their own words, by number (`12 yes, 13 no 14-16 sort of`), are what a session relays
 * when they speak or types them (`--via word`, with `--anchor` naming where); one id and one reaction is what a
 * console press sends (`--via console`). Every rule is in `../../../workstreams/candidates.ts` and the write is
 * one critical section in `../../../workstreams/reactionStore.ts`; the flags a word carries beyond itself are
 * parsed in `./reactPlacement.ts`.
 */
import { randomUUID } from "node:crypto";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import type { CandidateCatalog } from "../../../workstreams/candidateCatalog.js";
import type { CandidatesError } from "../../../workstreams/candidateErrors.js";
import { readCandidateCatalog } from "../../../workstreams/candidateStore.js";
import { REACTION_VIAS, REACTIONS, type ReactionVia } from "../../../workstreams/candidates.js";
import { parseReactionBatch, type ReactionPick } from "../../../workstreams/reactionBatch.js";
import { type ReactionReceipt, recordReactions } from "../../../workstreams/reactionStore.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { productionWorkstreamRegister } from "../../../workstreams/store/register.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseWorkstreamsReactArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { placementFor, reasonFor, type Stop } from "./reactPlacement.js";
import { WORKSTREAMS_REACT_USAGE } from "./usage.js";

/** Everything `workstreams react` touches outside itself, injected so a test drives the whole verb. */
export interface WorkstreamsReactDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The instant they reacted. */
  readonly now: () => string;
  /** The workstream register a yes is promoted into. */
  readonly store: WorkstreamStore;
  /** A fresh canonical UUID for each new entry. */
  readonly mintId: () => string;
}

/** Who a row names when `--by-session` is not given. */
const UNNAMED_SESSION = "unnamed session";

/**
 * The member of a closed list a flag's value names.
 *
 * @returns the member, or `undefined` when the value is none of them
 */
function memberOf<T extends string>({ list, value }: { list: readonly T[]; value: string }): T | undefined {
  return list.find((one) => one === value);
}

/**
 * Where the reaction came from, from `--via`; a session's own read when the flag is absent.
 *
 * @returns the source, or the usage refusal naming a value outside the list
 */
export function viaOf({ viaFlag }: { viaFlag: string | undefined }): Result<ReactionVia, Stop> {
  if (viaFlag === undefined) {
    return ok("session");
  }
  const via = memberOf({ list: REACTION_VIAS, value: viaFlag });
  if (via === undefined) {
    return err({ exit: EXIT_USAGE, line: `--via is one of ${REACTION_VIAS.join(", ")}, not ${viaFlag}` });
  }
  return ok(via);
}

/**
 * The picks one press names: one candidate id and one word, both checked against what exists.
 *
 * @param candidateFlag the `--candidate` value
 * @param asFlag the `--as` value
 * @returns the one pick, or why it was refused
 */
function pressPick({
  candidateFlag,
  asFlag,
  catalog,
}: {
  candidateFlag: string | undefined;
  asFlag: string | undefined;
  catalog: CandidateCatalog;
}): Result<readonly ReactionPick[], Stop> {
  if (candidateFlag === undefined || asFlag === undefined) {
    return err({ exit: EXIT_USAGE, line: "--candidate and --as go together" });
  }
  const reaction = memberOf({ list: REACTIONS, value: asFlag });
  if (reaction === undefined) {
    return err({ exit: EXIT_USAGE, line: `--as is one of ${REACTIONS.join(", ")}, not ${asFlag}` });
  }
  if (!catalog.candidates.some((one) => one.id === candidateFlag)) {
    return err({ exit: EXIT_ERROR, line: `no candidate has the id ${candidateFlag} — nothing recorded` });
  }
  return ok([{ candidate: candidateFlag, reaction }]);
}

/**
 * The picks this call names: one press, or their words parsed against the candidates.
 *
 * @param single whether the press flags were given rather than their words
 * @param words their words, joined, for the batch path
 * @returns the picks, or why they were refused
 */
function picksFor({
  single,
  candidateFlag,
  asFlag,
  words,
  catalog,
}: {
  single: boolean;
  candidateFlag: string | undefined;
  asFlag: string | undefined;
  words: string;
  catalog: CandidateCatalog;
}): Result<readonly ReactionPick[], Stop> {
  if (single) {
    return pressPick({ asFlag, candidateFlag, catalog });
  }
  return parseReactionBatch({ candidates: catalog.candidates, text: words }).mapErr((error): Stop => ({
    exit: EXIT_ERROR,
    line: error.message,
  }));
}

/**
 * Who recorded the reaction and where they said it: a session's name when `--by-session` is absent, and no anchor for
 * a press.
 *
 * @param anchorFlag the `--anchor` value
 * @param byFlag the `--by-session` value
 * @returns the two row fields
 */
function provenance({ anchorFlag, byFlag }: { anchorFlag: string | undefined; byFlag: string | undefined }): {
  readonly anchor: string | null;
  readonly bySession: string;
} {
  let anchor: string | null = null;
  if (anchorFlag !== undefined) {
    anchor = anchorFlag;
  }
  return { anchor, bySession: sessionNamed({ by: byFlag }) };
}

/**
 * The session a row names as its recorder: the `--by-session` value, else the stated unnamed one.
 *
 * @param by the `--by-session` value, when given
 * @returns the session's name
 */
export function sessionNamed({ by }: { by: string | undefined }): string {
  if (by === undefined) {
    return UNNAMED_SESSION;
  }
  return by;
}

/**
 * Their words as heard, kept on every row: `--heard` when given, else their words by number, else nothing — a press
 * carries no words.
 *
 * @param heardFlag the `--heard` value
 * @param words the positional words, joined; empty on a press
 * @returns the words to keep, or the usage refusal for an empty `--heard`
 */
function heardOf({ heardFlag, words }: { heardFlag: string | undefined; words: string }): Result<string | null, Stop> {
  if (heardFlag !== undefined) {
    if (heardFlag.trim().length === 0) {
      return err({ exit: EXIT_USAGE, line: "--heard carries the owner's words, and it was empty" });
    }
    return ok(heardFlag.trim());
  }
  if (words.length > 0) {
    return ok(words);
  }
  return ok(null);
}

/**
 * Where a failed catalog read stops: always an error — an empty catalog reads, so a failed read is never "no candidates
 * yet".
 *
 * @returns the stop
 */
function readStop({ error }: { error: CandidatesError }): Stop {
  return { exit: EXIT_ERROR, line: error.message };
}

/** Print what was written: the receipt whole under `--json`, else one line per row, promotion, ending and existing tile. */
function printReceipt({
  json,
  receipt,
  writeOut,
}: {
  json: boolean;
  receipt: ReactionReceipt;
  writeOut: (line: string) => void;
}): void {
  if (json) {
    writeOut(JSON.stringify(receipt));
    return;
  }
  for (const row of receipt.rows) {
    writeOut(`${row.candidate}  ${row.reaction}`);
  }
  const ended = new Set(receipt.ended.map((one) => one.candidate));
  for (const one of receipt.promoted) {
    const as = ended.has(one.candidate) ? "abandoned" : "discovery";
    writeOut(`${one.candidate} is now on the register as ${one.as} (${as}; the seat owes its story)`);
  }
  for (const one of receipt.ended) {
    // Every ended candidate has its abandoned row in this receipt, and the row schema requires its reason.
    const reason = receipt.rows.find((row) => row.candidate === one.candidate)!.reason!;
    writeOut(`${one.candidate} is abandoned on the register as ${one.as}: ${reason}`);
  }
  for (const one of receipt.alreadyHeld) {
    writeOut(`${one.candidate} was already on the register as ${one.as}`);
  }
  for (const one of receipt.placed) {
    writeOut(`${one.candidate} is noted on ${one.as} (${one.word})`);
  }
}

/**
 * Their words as heard, the channel the word arrived through, the candidates, and their picks against them — each
 * refused as the verb prints it.
 *
 * @param scope the `--home` the call named, or nothing for the resolved one
 * @param single whether the call named one candidate with `--candidate`/`--as` rather than giving their words
 * @param words their words, joined, when the call gave them
 * @returns their words as heard, the via, the catalog and the picks, or the refusal
 */
function readPicks({
  scope,
  single,
  values,
  words,
}: {
  scope: { home?: string };
  single: boolean;
  values: Readonly<Record<string, unknown>>;
  words: string;
}): Result<
  { catalog: CandidateCatalog; heard: string | null; picks: readonly ReactionPick[]; via: ReactionVia },
  Stop
> {
  const candidateFlag = stringFlag({ name: "candidate", values });
  const asFlag = stringFlag({ name: "as", values });
  return heardOf({ heardFlag: stringFlag({ name: "heard", values }), words }).andThen((heard) =>
    viaOf({ viaFlag: stringFlag({ name: "via", values }) }).andThen((via) =>
      readCandidateCatalog(scope)
        .mapErr((error) => readStop({ error }))
        .andThen((catalog) =>
          picksFor({ asFlag, candidateFlag, catalog, single, words }).map((picks) => ({
            catalog,
            heard,
            picks,
            via,
          })),
        ),
    ),
  );
}

/**
 * The argv parsed, and which of the two ways to react it takes; every refusal printed here, so a failure is only its
 * exit code.
 *
 * @param rest the argv tail after `workstreams react`
 * @returns the flag values, the words heard and whether one candidate was named, or the exit code to end on
 */
function reactArgv({
  deps,
  rest,
}: {
  deps: Pick<WorkstreamsReactDeps, "writeDiagnostic" | "writeOut">;
  rest: readonly string[];
}): Result<{ single: boolean; values: Readonly<Record<string, unknown>>; words: string }, number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WORKSTREAMS_REACT_USAGE);
    return err(EXIT_OK);
  }
  const parsed = parseWorkstreamsReactArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WORKSTREAMS_REACT_USAGE);
    return err(EXIT_USAGE);
  }
  const { values, positionals } = parsed.value;
  const words = positionals.join(" ").trim();
  const single =
    stringFlag({ name: "candidate", values }) !== undefined || stringFlag({ name: "as", values }) !== undefined;
  if (single === words.length > 0) {
    deps.writeDiagnostic("workstreams react: give their words, or --candidate with --as — exactly one of the two");
    deps.writeDiagnostic(WORKSTREAMS_REACT_USAGE);
    return err(EXIT_USAGE);
  }
  return ok({ single, values, words });
}

/**
 * Run `workstreams react` against injected seams.
 *
 * @param rest the argv tail after `workstreams react`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runWorkstreamsReact({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: WorkstreamsReactDeps;
}): Promise<number> {
  const argv = reactArgv({ deps, rest });
  if (argv.isErr()) {
    return argv.error;
  }
  const { single, values, words } = argv.value;
  const home = stringFlag({ name: "home", values });
  const scope = home === undefined ? {} : { home };
  const read = readPicks({ scope, single, values, words });
  if (read.isErr()) {
    deps.writeDiagnostic(`workstreams react: ${read.error.line}`);
    return read.error.exit;
  }
  const anchorFlag = stringFlag({ name: "anchor", values });
  const { picks } = read.value;
  const said = reasonFor({ anchorFlag, picks, reasonFlag: stringFlag({ name: "reason", values }) }).andThen((reason) =>
    placementFor({ picks, values }).map((placement) => ({ placement, reason })),
  );
  if (said.isErr()) {
    deps.writeDiagnostic(`workstreams react: ${said.error.line} — nothing recorded`);
    return said.error.exit;
  }
  const recorded = await recordReactions({
    ...scope,
    ...provenance({ anchorFlag, byFlag: stringFlag({ name: "by-session", values }) }),
    ...said.value,
    catalog: read.value.catalog,
    heard: read.value.heard,
    mintId: deps.mintId,
    nowIso: deps.now(),
    picks,
    store: deps.store,
    via: read.value.via,
  });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`workstreams react: ${recorded.error.message}`);
    // A fresh install's first yes starts the register, so a refusal here is never "not there yet".
    return EXIT_ERROR;
  }
  printReceipt({ json: values["json"] === true, receipt: recorded.value, writeOut: deps.writeOut });
  return EXIT_OK;
}

/**
 * The real seams: the two output channels, the clock, the register and the id minter.
 *
 * @returns the production dependencies for {@link runWorkstreamsReact}
 */
export function productionWorkstreamsReactDeps(): WorkstreamsReactDeps {
  return {
    mintId: () => randomUUID(),
    now: () => new Date().toISOString(),
    store: productionWorkstreamRegister(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver workstreams react`. */
export const workstreamsReactCommand = defineCommand({
  run: (argv) => runWorkstreamsReact({ deps: productionWorkstreamsReactDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
