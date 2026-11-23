/**
 * `slopweaver turn reach` — before the answer leans on a page in the owner's work Chrome, check the page is signed in.
 *
 * The aim: anything useful is reachable before the bot answers, which can mean a floating note and a high
 * priority queue card saying to log into the origin right now. The pure decision is `./reachCore.ts`; this is the thin
 * shell that visits each origin through the same probe `hand recheck` uses, then writes a receipt or enters
 * `turn block` — the one effect path that verb has, so a block entered here is the same four steps in the same order
 * and fires the same `turn-signed-out` note and card.
 *
 * Origins are visited one at a time: every visit takes the same relay lease on the owner's work Chrome.
 */
import { liveRecheckProbes, type RecheckProbeDeps } from "../../../hand/recheckProbes.js";
import { sessionProbePlatform } from "../../../hand/sessionProbes.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import { appendProgressLogEvent } from "../../../live/turn/progressLog.js";
import type { ProgressReachEvent } from "../../../live/turn/progressReach.js";
import { hostOf } from "../../../monitor/resyncSignedOut.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags, repeatedFlagValues } from "../../parseFlags.js";
import { blockTurn } from "./block.js";
import type { BlockInputs } from "./blockInputs.js";
import { TURN_REACH_USAGE } from "./blockUsage.js";
import { cardEditContext, refuseWith } from "./cardGates.js";
import { TURN_REACH_FLAG_SPEC } from "./core.js";
import { planReach, type ReachObservation, reachOrigins } from "./reachCore.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, reach, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/** The effects one reach makes, so a test drives the whole verb over plain fakes. */
export interface ReachDeps {
  /** Visit one origin through the owner's work Chrome and judge the landing. */
  readonly browserSession: RecheckProbeDeps["browserSession"];
  /** Enter the block on a signed-out page — `turn block`'s own effect path. */
  readonly block: (input: {
    inputs: BlockInputs;
    values: Readonly<Record<string, string | boolean>>;
  }) => Promise<number>;
  /** Write the receipt onto the turn's progress log. */
  readonly record: (input: { askIdentity: AskIdentity; event: ProgressReachEvent; home: string }) => void;
}

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn reach`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnReachArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: {
      boolean: [...TURN_REACH_FLAG_SPEC.boolean],
      repeatable: [...TURN_REACH_FLAG_SPEC.repeatable],
      string: [...TURN_REACH_FLAG_SPEC.string],
    },
  });
}

/**
 * Run one reach over an argv tail, with every effect injected.
 *
 * @param rest the argv tail after `turn reach`
 * @param deps the visit, the block and the receipt write
 * @returns the process exit code
 */
export async function reachTurn({ rest, deps }: { rest: readonly string[]; deps: ReachDeps }): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_REACH_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnReachArgs({ rest });
  if (parsed.isErr()) {
    return refuseWith({ code: EXIT_USAGE, errors: parsed.error, usage: TURN_REACH_USAGE });
  }
  const origins = reachOrigins({ urls: repeatedFlagValues({ name: "url", rest }) });
  if (origins.isErr()) {
    return refuseWith({ code: EXIT_USAGE, errors: origins.error, usage: TURN_REACH_USAGE });
  }
  const values = parsed.value.values;
  const gated = cardEditContext({ usage: TURN_REACH_USAGE, values, verb: "turn reach" });
  if ("code" in gated) {
    return gated.code;
  }
  const { home } = gated;
  const observations = await visitOrigins({ deps, home, origins: origins.value });
  return actOnReach({
    askIdentity: askIdentityOf({ source: gated.askIdentity }),
    deps,
    home,
    observations,
    values,
  });
}

/**
 * Visit each origin in turn — one at a time, because every visit takes the same relay lease on the owner's work Chrome — and
 * record what it found, or that no probe reads its sign-in.
 *
 * @param origins the unique bare origins, in the order given
 * @param home the state home the probe's relay lease lives in
 * @param deps the visit seam
 * @returns one observation per origin, in order
 */
async function visitOrigins({
  origins,
  home,
  deps,
}: {
  origins: readonly string[];
  home: string;
  deps: ReachDeps;
}): Promise<readonly ReachObservation[]> {
  const observations: ReachObservation[] = [];
  for (const origin of origins) {
    const platform = sessionProbePlatform({ origin });
    const outcome = platform === undefined ? undefined : await deps.browserSession({ home, origin });
    observations.push({ origin, outcome, platform });
  }
  return observations;
}

/**
 * Do what the observations decide: name an unread or unsupported origin, block on the first signed-out one, or write
 * the receipt.
 *
 * @param askIdentity the exact ask the receipt is written against
 * @param home the state home the receipt is written under
 * @param observations one per origin, in the caller's order
 * @param values the caller's parsed flags, handed whole to the block
 * @param deps the block and the receipt write
 * @returns the process exit code
 */
async function actOnReach({
  askIdentity,
  home,
  observations,
  values,
  deps,
}: {
  askIdentity: AskIdentity;
  home: string;
  observations: readonly ReachObservation[];
  values: Readonly<Record<string, string | boolean>>;
  deps: ReachDeps;
}): Promise<number> {
  const plan = planReach({ observations });
  if (plan.kind === "unread") {
    logger.error({ msg: `turn reach: could not read ${plan.origin}'s sign-in — ${plan.why}. Not called signed out.` });
    return EXIT_ERROR;
  }
  if (plan.kind === "unsupported") {
    logger.error({
      msg: `turn reach: no probe reads the sign-in at ${plan.origins.join(", ")}, so it was not checked — nothing here calls it reachable`,
    });
    return EXIT_EXPECTED_EMPTY;
  }
  if (plan.kind === "block") {
    logger.out({ line: `turn reach: ${plan.origin} is signed out — ${plan.observed}` });
    const code = await deps.block({
      inputs: {
        need: "sign-in",
        signInOrigin: plan.origin,
        what: `log into ${hostOf({ origin: plan.origin })} in the work Chrome`,
      },
      values,
    });
    return code === EXIT_OK ? EXIT_EXPECTED_EMPTY : code;
  }
  for (const observation of observations) {
    logger.out({ line: `turn reach: ${observation.origin} signed in — ${observedOf({ observation })}` });
  }
  if (values["dry-run"] === true) {
    logger.out({ line: "dry run — every origin is signed in; no receipt was written." });
    return EXIT_OK;
  }
  deps.record({
    askIdentity,
    event: { askIdentity, kind: "reach", origins: plan.origins, tsIso: new Date().toISOString() },
    home,
  });
  return EXIT_OK;
}

/** What a met visit saw, which a reachable plan guarantees every observation carries. */
function observedOf({ observation }: { observation: ReachObservation }): string {
  return observation.outcome?.kind === "met" ? observation.outcome.observed : "signed in";
}

/**
 * Run the reach verb against the owner's real work Chrome.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnReach(argv: readonly string[]): Promise<number> {
  return reachTurn({
    deps: {
      block: ({ inputs, values }) => blockTurn({ inputs, values }),
      browserSession: liveRecheckProbes().browserSession,
      record: ({ askIdentity, event, home }) => {
        appendProgressLogEvent({ askIdentity, event, home });
      },
    },
    rest: argv.slice(VERB_ARG_OFFSET),
  });
}

export const turnReachCommand = defineCommand({ run: runTurnReach });
