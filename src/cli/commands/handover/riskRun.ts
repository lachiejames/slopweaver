/**
 * `slopweaver handover risk` — a seat or the chair NAMES the uncertainty on a row's deliverable, or says it passed.
 *
 * A deliverable the owner explicitly steered, found at risk, reaches them as a floating note and a voice line the
 * moment the risk is known, never at the deadline. Most risks the register can see for itself — a question to the
 * owner, a seat parked on a clock, a seat given up or dead, a deadline passed (`../../../handover/steerRisk.ts`).
 * This verb is the half it cannot: a seat RUNNING on the work that knows it is in trouble — a gate with no hatch, a
 * verb that has not landed, a door that will not open in time. It writes one `steer-risk` event and fires the
 * monitor in-process, so the note lands with the event.
 *
 * It records on ANY row, steered or not, because naming an uncertainty is never wrong. Only a steered row's is
 * escalated, and the verb says which it was.
 */

import { slopweaverHome } from "../../../config.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { lookupArchivedDoc, scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { productionMonitorDeps } from "../monitor/deps.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { ruleTarget } from "./ruleRun.js";
import { fireSteerAtRiskIfSteered } from "./steerRiskCard.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover risk` accepts. */
const RISK_FLAGS: FlagSpec = { boolean: ["clear"], string: ["why", "dir", "home"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_RISK_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: RISK_FLAGS }),
  ...booleanFlagsOf({ spec: RISK_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

export const HANDOVER_RISK_USAGE =
  'usage: slopweaver handover risk <slug> --why "<what the uncertainty is>" [--clear] [--dir <path>] [--home <dir>]\n' +
  "\n" +
  "Names the uncertainty on a row's deliverable as a `steer-risk` event, the moment it is known. On a row whose\n" +
  "standing ruling is the owner's EXPLICIT STEER (`handover rule --explicit-steer`), the `steer-at-risk` monitor fires at\n" +
  "once: a floating note on the owner's screen, and a voice line on their live call. --clear says the risk has passed and\n" +
  "settles that note. The register already sees a question to the owner, a clock-park, a seat given up and a passed\n" +
  "deadline on its own; this is for the risk only the running seat can see — a gate with no hatch, a verb not\n" +
  "landed, a door that will not open in time.\n" +
  "\n" +
  'example: slopweaver handover risk my-row --why "the Linear document verb is not on main; posting the description raw"';

/**
 * Parse `handover risk`'s own flags — exported for the help-truth ratchet. Positionals are allowed because the slug
 * is one.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverRiskArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: RISK_FLAGS });
}

/** What one invocation asked to record. */
interface RiskPlan {
  readonly slug: string;
  readonly standing: "at-risk" | "cleared";
  readonly why: string;
}

/**
 * What `handover risk` was asked to record, or the usage refusal to print instead.
 *
 * @param positionals the slug, and nothing else
 * @param values the parsed flags
 * @returns the plan, or the refusal
 * @internal — exported so the refusals are unit-testable without a filesystem.
 */
export function riskPlan({
  positionals,
  values,
}: {
  positionals: readonly string[];
  values: Readonly<Record<string, unknown>>;
}): { readonly refusal: string } | RiskPlan {
  const [slug, ...extra] = positionals;
  if (slug === undefined) {
    return { refusal: "which row? Pass its slug" };
  }
  if (extra.length > 0) {
    return { refusal: `one row at a time — "${extra.join(" ")}" is not a flag this verb reads` };
  }
  const why = typeof values["why"] === "string" ? values["why"].trim() : "";
  if (why.length === 0) {
    return { refusal: "--why is required — what the uncertainty is, in a sentence the owner can act on" };
  }
  return { slug, standing: values["clear"] === true ? "cleared" : "at-risk", why };
}

/**
 * Record a risk on a row's deliverable, or clear one, and escalate it when the row is explicitly steered.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverRisk(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HANDOVER_RISK_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverRiskArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: HANDOVER_RISK_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const plan = riskPlan({ positionals: parsed.value.positionals, values });
  if ("refusal" in plan) {
    logger.error({ msg: `handover risk: ${plan.refusal}` });
    logger.error({ msg: HANDOVER_RISK_USAGE });
    return EXIT_USAGE;
  }
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const handoverDir = resolveHandoverDir({ dir: typeof values["dir"] === "string" ? values["dir"] : undefined, home });
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    logger.error({ msg: `handover risk: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const target = ruleTarget({
    archived: lookupArchivedDoc({ handoverDir, slug: plan.slug }),
    docs: scan.value.docs,
    slug: plan.slug,
  });
  if ("refusal" in target) {
    logger.error({ msg: `handover risk: ${target.refusal}` });
    return EXIT_ERROR;
  }
  const written = applyRowEvent({
    event: { atIso: new Date().toISOString(), kind: "steer-risk", standing: plan.standing, why: plan.why },
    runsDir: stateHomePaths({ home }).runs,
    slug: target.row.slug,
  });
  if (written.isErr()) {
    logger.error({ msg: `handover risk: ${written.error.message}` });
    return EXIT_ERROR;
  }
  // Fired before any receipt line, so an output channel that fails cannot stop the note it owes the owner.
  const fired = await fireSteerAtRiskIfSteered({
    deps: productionMonitorDeps(),
    home,
    slug: target.row.slug,
    verb: "handover risk",
  });
  const said = plan.standing === "cleared" ? "cleared its named risk" : "carries a named risk";
  logger.out({ line: `handover risk: ${target.row.slug} ${said} — ${plan.why}` });
  if (fired.kind === "not-steered") {
    logger.out({ line: "  no explicit steer stands on this row, so it is recorded and nothing is raised" });
  }
  return EXIT_OK;
}

export const handoverRiskCommand = defineCommand({ run: runHandoverRisk });
