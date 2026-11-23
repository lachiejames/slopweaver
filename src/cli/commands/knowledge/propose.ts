/**
 * `slopweaver knowledge propose` — record what this session read out of ONE unit of their speech.
 *
 * Two outcomes and both are rows: a candidate belief with the span of their words it came from, or an
 * explicit nothing with the reason. The second is what lets the queue finish — see
 * `../../../knowledge/voice/types.ts`.
 *
 * The verb checks what a verb can check: the domain is one this install holds, the claim fits in a sentence, the batch was
 * not edited since the scan wrote it, and **the quote occurs in their actual words**. Whether the claim is a
 * fair reading of what they meant is the session's judgement, and nothing here pretends otherwise.
 */
import { requireKnowledgeDomain } from "../../../knowledge/row.js";
import { pinnedUnit, readBatch } from "../../../knowledge/voice/batch.js";
import type { BeliefError } from "../../../knowledge/voice/errors.js";
import { buildNoProposal, buildProposal } from "../../../knowledge/voice/propose.js";
import { appendProposal } from "../../../knowledge/voice/store.js";
import {
  BELIEF_HOLDS,
  type BeliefHold,
  type NoProposal,
  type ProposedBelief,
  type VoiceUnit,
} from "../../../knowledge/voice/types.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { PROPOSE_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { parseKnowledgeProposeArgs } from "./flagSpecs.js";
import { installDomainsOrExit, type KnowledgeDomainDeps, productionKnowledgeDomainDeps } from "./installDomainsEdge.js";

/** The run recorded when no `--run` was given. A real value on the row, never an absent field. */
const AD_HOC = "ad-hoc";

/**
 * The run slug this row is recorded against.
 *
 * `--run` is optional and AD_HOC is a real value on the row rather than an absent field, so the
 * substitution is an `if` naming the absent case: `??` is refused by `no-silent-fallback` and a ternary is
 * refused by oxlint's `prefer-nullish-coalescing`, and a statement is what satisfies both.
 *
 * @param values the parsed flag values
 * @returns the named run, or AD_HOC when none was given
 */
function runSlug({ values }: { values: Readonly<Record<string, unknown>> }): string {
  const named = flag({ name: "run", values });
  if (named === undefined) {
    return AD_HOC;
  }
  return named;
}

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Run `knowledge propose` over the production store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgePropose(argv: readonly string[]): Promise<number> {
  return runKnowledgeProposeWithDeps({ argv, deps: productionKnowledgeDomainDeps() });
}

/**
 * Run `knowledge propose` over the dependencies it is handed.
 *
 * @param argv the full process argv
 * @param deps where the install's own domains are read
 * @returns the process exit code
 */
export async function runKnowledgeProposeWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: KnowledgeDomainDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PROPOSE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeProposeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: PROPOSE_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const from = flag({ name: "from", values });
  const unitId = flag({ name: "unit", values });
  if (from === undefined || unitId === undefined) {
    logger.error({ msg: "knowledge propose: --from and --unit are both required" });
    logger.error({ msg: PROPOSE_USAGE });
    return EXIT_USAGE;
  }
  const home = flag({ name: "home", values });
  const built = await rowFor({ deps, from, home, unitId, values });
  if (typeof built === "number") {
    return built;
  }
  if (built.isErr()) {
    logger.error({ msg: `knowledge propose: ${built.error.message}` });
    return EXIT_ERROR;
  }
  const written = appendProposal({ row: built.value, ...(home === undefined ? {} : { home }) });
  if (written.isErr()) {
    logger.error({ msg: `knowledge propose: ${written.error.message}` });
    return EXIT_ERROR;
  }
  report({ path: written.value, row: built.value, json: values["json"] === true });
  return EXIT_OK;
}

/**
 * Turn the flags into a row, or into the usage exit code a caller error has already printed.
 *
 * Returns a NUMBER for an argv-shaped failure and a `Result` for anything the builder rejected, the same
 * split `./record.ts` makes and for the same reason: a usage error prints its own guidance, while a domain
 * error keeps the typed `code` a caller branches on.
 *
 * A proposal's domain is held to the same vocabulary a recorded lesson is — the committed domains plus this
 * home's own, read from its store — so a slug the install never configured is refused with `DOMAIN_NOT_CONFIGURED`
 * here rather than queued for a later answer to trip over.
 *
 * @param deps where the install's own domains are read
 * @param from the batch file the unit was read from
 * @param home the `--home` override whose domains the proposal is checked against and whose queue it joins
 * @param unitId which unit is being answered
 * @param values the parsed flag values
 * @returns the row, the typed failure, or an exit code already reported
 */
async function rowFor({
  deps,
  from,
  home,
  unitId,
  values,
}: {
  deps: KnowledgeDomainDeps;
  from: string;
  home: string | undefined;
  unitId: string;
  values: Readonly<Record<string, unknown>>;
}): Promise<Result<ProposedBelief | NoProposal, BeliefError> | number> {
  // Every argv check first, then the home's domains, then the batch: a caller mistake is a usage refusal and a
  // domain the home never configured is DOMAIN_NOT_CONFIGURED, whatever state the batch file is in.
  const run = runSlug({ values });
  const reviewedAtIso = new Date().toISOString();
  const nothing = flag({ name: "none", values });
  const domain = flag({ name: "domain", values });
  const claim = flag({ name: "claim", values });
  const quote = flag({ name: "quote", values });
  if (nothing !== undefined) {
    const proposing = domain !== undefined || claim !== undefined || quote !== undefined;
    return noProposalFor({ deps, from, home, proposing, reviewedAtIso, run, unitId, why: nothing });
  }
  if (domain === undefined || claim === undefined || quote === undefined) {
    logger.error({
      msg: "knowledge propose: a proposal needs --domain, --claim and --quote; a unit with nothing in it needs --none",
    });
    logger.error({ msg: PROPOSE_USAGE });
    return EXIT_USAGE;
  }
  const held = BELIEF_HOLDS.find((entry) => entry === flag({ name: "held", values }));
  if (held === undefined) {
    logger.error({ msg: `knowledge propose: --held must be one of ${BELIEF_HOLDS.join(", ")}` });
    logger.error({ msg: PROPOSE_USAGE });
    return EXIT_USAGE;
  }
  const installDomains = await installDomainsOrExit({ domains: deps.domains, home, verb: "knowledge propose" });
  if (typeof installDomains === "number") {
    return installDomains;
  }
  const configured = requireKnowledgeDomain({ domain, installDomains });
  if (configured.isErr()) {
    logger.error({ msg: `knowledge propose: ${configured.error.message}` });
    return EXIT_ERROR;
  }
  const unit = unitOrExit({ from, unitId });
  if (typeof unit === "number") {
    return unit;
  }
  return buildProposal({ claim, domain, held: held satisfies BeliefHold, quote, reviewedAtIso, run, unit });
}

/**
 * The `--none` branch: an explicit nothing for one unit, or the usage exit when proposal flags came with it.
 *
 * A no-proposal row carries no domain, but a home whose domains cannot be read from its store is refused on
 * either branch, so the verb never writes into a home it could not fully read.
 *
 * @param deps where the install's own domains are read
 * @param from the batch file the unit was read from
 * @param home the `--home` override whose domains must still read
 * @param proposing whether any of `--domain`, `--claim` or `--quote` was also given
 * @param reviewedAtIso the instant the row records as reviewed
 * @param run the run slug the row is recorded against
 * @param unitId which unit is being answered
 * @param why the reason the unit held nothing
 * @returns the no-proposal row, the typed failure, or an exit code already reported
 */
async function noProposalFor({
  deps,
  from,
  home,
  proposing,
  reviewedAtIso,
  run,
  unitId,
  why,
}: {
  deps: KnowledgeDomainDeps;
  from: string;
  home: string | undefined;
  proposing: boolean;
  reviewedAtIso: string;
  run: string;
  unitId: string;
  why: string;
}): Promise<Result<NoProposal, BeliefError> | number> {
  if (proposing) {
    logger.error({
      msg: "knowledge propose: --none records that a unit held nothing, so it takes no --domain, --claim or --quote",
    });
    logger.error({ msg: PROPOSE_USAGE });
    return EXIT_USAGE;
  }
  const installDomains = await installDomainsOrExit({ domains: deps.domains, home, verb: "knowledge propose" });
  if (typeof installDomains === "number") {
    return installDomains;
  }
  const unit = unitOrExit({ from, unitId });
  if (typeof unit === "number") {
    return unit;
  }
  return buildNoProposal({ reviewedAtIso, run, unitId: unit.id, why });
}

/**
 * The pinned unit out of the batch file, or the exit code once why it could not be read is printed.
 *
 * @param from the batch file the unit was read from
 * @param unitId which unit is being answered
 * @returns the unit, proven to hash to its own id, or `EXIT_ERROR` already reported
 */
function unitOrExit({ from, unitId }: { from: string; unitId: string }): VoiceUnit | number {
  const batch = readBatch({ path: from });
  if (batch.isErr()) {
    logger.error({ msg: `knowledge propose: ${batch.error.message}` });
    return EXIT_ERROR;
  }
  const unit = pinnedUnit({ batch: batch.value, unitId });
  if (unit.isErr()) {
    logger.error({ msg: `knowledge propose: ${unit.error.message}` });
    return EXIT_ERROR;
  }
  return unit.value;
}

/**
 * What the verb prints once the row is on disk.
 *
 * The row type is the pair this verb can WRITE, not the whole union: `knowledge propose` never produces an
 * `answered` row — `knowledge answer` does — and typing it as the union let the else-branch read
 * `domain`, `held`, `claim` and `quote` off an arm that carries none of them.
 */
function report({ row, path, json }: { row: ProposedBelief | NoProposal; path: string; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(row) });
    return;
  }
  if (row.kind === "none") {
    logger.out({ line: `knowledge propose: ${row.unitId} reviewed, nothing proposed — ${row.why}` });
    logger.out({ line: `  ${path}` });
    return;
  }
  logger.out({
    line: `knowledge propose: ${row.proposalId} proposed from ${row.unitId} — ${row.domain} · ${row.held}`,
  });
  logger.out({ line: `  ${row.claim}` });
  logger.out({ line: `  their words: ${row.quote}` });
  logger.out({ line: `  ${path}` });
}

export const knowledgeProposeCommand = defineCommand({ run: runKnowledgePropose });
