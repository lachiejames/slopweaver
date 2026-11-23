/**
 * `slopweaver handover rule` — record the owner's ruling on a row, in the register every reader derives from.
 *
 * ## Why a ruling is its own verb and not a settlement
 *
 * A settlement ENDS an ask. A ruling does the opposite: it records what the owner decided, and on a FINDING row it
 * is what lets the work continue past the one door that was holding it. A finding-sourced row that would
 * produce team-facing output — a pull request on a team-reviewed base, a review ask, anything that reaches a
 * teammate — asks the owner first, because they may not want it: a pull request raised that way, which the owner
 * had no memory of asking for, shows the cost of skipping the question. Presenting the finding itself is useful
 * to the owner; the outward action is what waits.
 *
 * ## Why it writes an event
 *
 * It writes an EVENT and touches no document: the ruling is derived from state the way the board derives
 * everything else, not carried in lossier forms of communication or state tracking. Two
 * consequences, and both are the point rather than side effects:
 *
 * - **Any row kind may be ruled on.** A ruling's only place to LAND would otherwise be a front-matter field
 *   `../../../handover/askRow.ts` allows on a finding alone. A register event has no such restriction, and
 *   MEASURED: the rows losing rulings were overwhelmingly not findings: of the 31 rows in the standing backfill,
 *   **none** declares `origin: finding`.
 * - **A second ruling is appended, not refused.** The owner does rule twice on one row, and the earlier ruling is
 *   history rather than an error. `../../../handover/ruling.ts` decides which one a row READS — the latest
 *   by decision instant — and refuses only an exact duplicate of one already recorded.
 * - **A line this checkout cannot decode is skipped and STATED, never a refusal.** MEASURED: a
 *   `parked` line written by an unmerged branch made this verb refuse the owner's read of a briefing from a chair
 *   whose checkout predated that kind, so their words landed on a fresh row instead of the one they were looking at.
 *   `../../../handover/staleReader.ts`'s `skippedLinesNote` names the count, the lines and the word.
 *
 * ## What it enforces, and what it deliberately does not
 *
 * It enforces that the ruling is ATTRIBUTABLE — the owner's words plus a pointer to where they gave them. It does NOT
 * claim to verify whose hand typed the anchor: nothing here authenticates a human
 * (`.claude/rules/cross-session-messages.md`), so the honest shape is the same as `settle --as declined` —
 * a recorded, checkable pointer, and a board that prints the row as unruled until one exists.
 *
 * **Rollout order matters and it is not this verb's to enforce.** A build whose decoder predates the
 * `ruling` kind reads a ruling line as UNREADABLE, so it cannot see the decision. It is no longer WEDGED by
 * one: `../../../handover/ledger.ts` § "A word this build has never heard is not a corrupt file" splits an
 * unknown kind out of the ownership set, so every lifecycle verb keeps working over such a line. Getting this
 * verb onto `main` everywhere reading the shared home is still what makes the ruling legible there.
 */

import { slopweaverHome } from "../../../config.js";
import type { AttachUploadRuling } from "../../../handover/attachUploadRulingTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { ExplicitSteer } from "../../../handover/explicitSteerTypes.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { isCanonicalInstant } from "../../../handover/ruling.js";
import { parseGateSelectors, parseGateSubjects, rulingGateId } from "../../../handover/rulingGate.js";
import { RulingGateErrors } from "../../../handover/rulingGateErrors.js";
import { rebuildStandingGates, writeStandingGates } from "../../../handover/rulingGateStore.js";
import type { RulingGate } from "../../../handover/rulingGateTypes.js";
import { skippedLinesNote } from "../../../handover/staleReader.js";
import type { StandingSession } from "../../../handover/standingSessionTypes.js";
import { lookupArchivedDoc, scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { NOUN_ALIASES } from "../../nounAliases.js";
import { NOUN_GROUPS } from "../../nounGroups.js";
import { parseFlags } from "../../parseFlags.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { attachUploadAnnouncement, attachUploadPlan } from "./ruleAttachUpload.js";
import { standingSessionAnnouncement, standingSessionPlan } from "./ruleStandingSession.js";
import { announceExplicitSteer, escalateExplicitSteer, explicitSteerPlan } from "./ruleSteer.js";
import { HANDOVER_RULE_USAGE, RULE_FLAGS } from "./ruleUsage.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse `handover rule`'s own flags — exported for the help-truth ratchet. Positionals are allowed because
 * the slug is one.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverRuleArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: RULE_FLAGS });
}

/** What one invocation asked to record. */
interface RulePlan {
  readonly slug: string;
  readonly anchor: string;
  readonly words: string;
  /** When the owner decided: `--decided-iso` for a ruling relayed later than it was given, else the moment of recording. */
  readonly decided: { readonly at: "flag"; readonly iso: string } | { readonly at: "now" };
  /** The gate this ruling places, or `undefined` when it gates nothing. */
  readonly gate: RulingGate | undefined;
  /** The explicit steer this ruling is, or `undefined` when it is an ordinary ruling. */
  readonly explicitSteer: ExplicitSteer | undefined;
  /** The standing session this ruling makes or ends, or `undefined` when it touches none. */
  readonly standingSession: StandingSession | undefined;
  /** The owner's word on `github attach upload`, or `undefined` when this ruling decides nothing about it. */
  readonly attachUpload: AttachUploadRuling | undefined;
}

/**
 * Every `"<noun> <verb>"` this build registers, for {@link parseGateSelectors} to check a gate against.
 *
 * Read off the manifest's own metadata, so a gate can never name a verb that does not exist — the manifest
 * is eager metadata and lazy loaders, so this costs no command module (`.claude/rules/area-cli.md`). A noun's
 * earlier name is a registered spelling too, and the gate binds it (`../../nounAliases.ts`).
 */
function registeredVerbs(): ReadonlySet<string> {
  const known = new Set<string>();
  const spellings = Object.entries(NOUN_ALIASES).map(([alias, noun]) => ({ alias, noun }));
  for (const [noun, verbs] of Object.entries(NOUN_GROUPS)) {
    for (const verb of Object.keys(verbs)) {
      known.add(`${noun} ${verb}`);
      for (const spelling of spellings.filter((entry) => entry.noun === noun)) {
        known.add(`${spelling.alias} ${verb}`);
      }
    }
  }
  return known;
}

/** The gate one invocation declares, `undefined` when it declares none, or the refusal to print. */
function gatePlan({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): { readonly refusal: string } | { readonly gate: RulingGate | undefined } {
  const declared = values["gates"];
  if (typeof declared !== "string") {
    return { gate: undefined };
  }
  const verbs = parseGateSelectors({ known: registeredVerbs(), value: declared });
  if (verbs.isErr()) {
    return { refusal: verbs.error.message };
  }
  const subjects = parseGateSubjects({
    value: typeof values["gate-subject"] === "string" ? values["gate-subject"] : undefined,
  });
  const until = typeof values["gate-until"] === "string" ? values["gate-until"].trim() : "";
  if (until.length === 0) {
    return { gate: { subjects, verbs: verbs.value } };
  }
  if (!isCanonicalInstant({ iso: until })) {
    return { refusal: RulingGateErrors.untilInvalid({ untilIso: until }).message };
  }
  return { gate: { subjects, untilIso: until, verbs: verbs.value } };
}

/** When the owner decided it: now, the instant `--decided-iso` names, or the refusal for a spelling nothing can order. */
function decidedPlan({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): { readonly refusal: string } | { readonly decided: RulePlan["decided"] } {
  const declared = typeof values["decided-iso"] === "string" ? values["decided-iso"].trim() : "";
  if (declared.length === 0) {
    return { decided: { at: "now" } };
  }
  // Held to the canonical `toISOString()` spelling, exactly as `--gate-until` is: every reader orders rulings
  // through `Date.parse`, which reads `0001-01-01 00:00:00.000Z` as the year 2001, so a loose spelling here
  // could date a ruling after the question it predates.
  if (!isCanonicalInstant({ iso: declared })) {
    return {
      refusal:
        `--decided-iso "${declared}" is not a canonical UTC instant (YYYY-MM-DDTHH:MM:SS.sssZ, as toISOString() ` +
        "writes it) — a decision time nothing can order exactly is worse than none",
    };
  }
  return { decided: { at: "flag", iso: declared } };
}

/** What `handover rule` was asked to record, or the usage refusal to print instead. */
function rulePlan({
  positionals,
  values,
}: {
  positionals: readonly string[];
  values: Readonly<Record<string, unknown>>;
}): { readonly refusal: string } | RulePlan {
  const slug = positionals[0];
  if (slug === undefined) {
    return { refusal: "which row? Pass its slug" };
  }
  const anchor = typeof values["anchor"] === "string" ? values["anchor"].trim() : "";
  if (anchor.length === 0) {
    return { refusal: "--anchor is required — where the owner gave the ruling, so a reader can go and check it" };
  }
  // The owner's words are recorded EXACTLY as given, never trimmed into the event: leading or trailing whitespace is
  // part of what they said. Only the emptiness test looks at the trimmed form.
  const words = typeof values["words"] === "string" ? values["words"] : "";
  if (words.trim().length === 0) {
    return {
      refusal:
        "--words is required — what the owner actually said, so the row carries their ruling and not a paraphrase",
    };
  }
  const decided = decidedPlan({ values });
  if ("refusal" in decided) {
    return decided;
  }
  const gate = gatePlan({ values });
  if ("refusal" in gate) {
    return gate;
  }
  const steer = explicitSteerPlan({ values });
  if ("refusal" in steer) {
    return steer;
  }
  const standing = standingSessionPlan({ values });
  if ("refusal" in standing) {
    return standing;
  }
  const attachUpload = attachUploadPlan({ values });
  if (attachUpload.isErr()) {
    return { refusal: attachUpload.error.message };
  }
  return {
    anchor,
    attachUpload: attachUpload.value,
    decided: decided.decided,
    explicitSteer: steer.explicitSteer,
    gate: gate.gate,
    slug,
    standingSession: standing.standingSession,
    words,
  };
}

/**
 * The row this ruling is about, or why the board could not find it.
 *
 * A pure exact-slug resolver: there is no finding-only or already-ruled exclusion,
 * because recording what the owner decided is not the same act as clearing a door. An ARCHIVED row
 * still resolves — its journal is live even when its document has been filed away, and one of the 39
 * standing rulings sits on exactly such a row.
 *
 * @param docs every row on the active board
 * @param archived the archived row of that slug, when one exists
 * @param slug the row named
 * @returns the row, or the refusal
 * @internal — exported so the refusals are unit-testable without a filesystem.
 */
export function ruleTarget({
  docs,
  archived,
  slug,
}: {
  docs: readonly HandoverDoc[];
  archived: HandoverDoc | undefined;
  slug: string;
}): { readonly refusal: string } | { readonly row: HandoverDoc } {
  const row = docs.find((doc) => doc.slug === slug);
  if (row !== undefined) {
    return { row };
  }
  if (archived !== undefined) {
    return { row: archived };
  }
  return { refusal: `no row on the board claims the slug "${slug}"` };
}

/**
 * Record the owner's ruling on a row.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverRule(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HANDOVER_RULE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverRuleArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: HANDOVER_RULE_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const plan = rulePlan({ positionals: parsed.value.positionals, values });
  if ("refusal" in plan) {
    logger.error({ msg: `handover rule: ${plan.refusal}` });
    logger.error({ msg: HANDOVER_RULE_USAGE });
    return EXIT_USAGE;
  }
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const handoverDir = resolveHandoverDir({ dir: typeof values["dir"] === "string" ? values["dir"] : undefined, home });
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    logger.error({ msg: `handover rule: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const target = ruleTarget({
    archived: lookupArchivedDoc({ handoverDir, slug: plan.slug }),
    docs: scan.value.docs,
    slug: plan.slug,
  });
  if ("refusal" in target) {
    logger.error({ msg: `handover rule: ${target.refusal}` });
    return EXIT_ERROR;
  }
  return record({ home, plan, row: target.row });
}

/** Append the ruling to the row's register, then say what a reader will now see. */
async function record({ home, plan, row }: { home: string; plan: RulePlan; row: HandoverDoc }): Promise<number> {
  const paths = stateHomePaths({ home });
  // ONE clock sample, used for both instants when the owner ruled just now: a live ruling is decided when it is
  // recorded, and two samples would put a few milliseconds between two fields that describe one moment.
  const atIso = new Date().toISOString();
  const written = applyRowEvent({
    event: {
      anchor: plan.anchor,
      atIso,
      ...(plan.attachUpload === undefined ? {} : { attachUpload: plan.attachUpload }),
      decidedIso: plan.decided.at === "flag" ? plan.decided.iso : atIso,
      ...(plan.explicitSteer === undefined ? {} : { explicitSteer: plan.explicitSteer }),
      ...(plan.gate === undefined ? {} : { gate: plan.gate }),
      kind: "ruling",
      ruling: plan.words,
      ...(plan.standingSession === undefined ? {} : { standingSession: plan.standingSession }),
    },
    runsDir: paths.runs,
    slug: row.slug,
  });
  if (written.isErr()) {
    logger.error({ msg: `handover rule: ${written.error.message}` });
    return EXIT_ERROR;
  }
  if (plan.explicitSteer !== undefined) {
    await escalateExplicitSteer({ home, slug: row.slug });
  }
  logger.out({ line: `handover rule: ${row.slug} now carries the owner's ruling (${plan.anchor})` });
  logger.out({ line: `  recorded in ${written.value.path} — the row document is untouched, every reader derives it` });
  const skipped = skippedLinesNote({ skipped: written.value.skipped });
  if (skipped !== undefined) {
    logger.out({ line: `  ${skipped}` });
  }
  if (row.origin === "finding") {
    logger.out({ line: `  the team-facing doors will accept its branch; a pull request goes up as usual` });
  }
  if (plan.explicitSteer !== undefined) {
    announceExplicitSteer({ explicitSteer: plan.explicitSteer });
  }
  if (plan.standingSession !== undefined) {
    logger.out({ line: standingSessionAnnouncement({ atIso, standingSession: plan.standingSession }) });
  }
  if (plan.attachUpload !== undefined) {
    logger.out({ line: attachUploadAnnouncement({ attachUpload: plan.attachUpload }) });
  }
  return projectGate({ atIso, paths, plan, slug: row.slug });
}

/**
 * Reproject the standing gates after a ruling, and say what the gate now refuses — or, when the ruling
 * placed none, name the flag once.
 *
 * The nudge is ADVISORY and never blocks, the shape `../../main.ts`'s `maybeRemindGovernedVerb` uses. It is
 * what keeps recording a gate the path of least resistance rather than a step to remember: the chair already
 * runs this verb when the owner rules, so the gate is a flag on a verb already in the loop.
 *
 * A failed reprojection is a REAL failure rather than a warning: the journal now holds a gate the dispatch
 * boundary cannot see, which is exactly the silent non-firing this mechanism exists to remove.
 */
function projectGate({
  atIso,
  paths,
  plan,
  slug,
}: {
  atIso: string;
  paths: ReturnType<typeof stateHomePaths>;
  plan: RulePlan;
  slug: string;
}): number {
  if (plan.gate === undefined) {
    logger.out({
      line:
        '  it gates no verb, so nothing refuses on it — add --gates "<noun> <verb>" if this ruling should ' +
        "bite at run time rather than wait to be remembered (owner turn 291-9x)",
    });
    return EXIT_OK;
  }
  const gates = rebuildStandingGates({ runsDir: paths.runs });
  const written = writeStandingGates({ builtAtIso: atIso, gates, indexPath: paths.rulingGatesJson });
  if (written.isErr()) {
    logger.error({ msg: `handover rule: the ruling is recorded, but ${written.error.message}` });
    logger.error({ msg: "  the gate will NOT fire until `slopweaver handover gate rebuild` succeeds" });
    return EXIT_ERROR;
  }
  const verbs = plan.gate.verbs.map((pair) => `${pair.noun} ${pair.verb}`).join(", ");
  logger.out({ line: `  it now GATES ${verbs} — id ${rulingGateId({ atIso, slug })}` });
  logger.out({
    line: `  ${String(gates.length)} gate(s) standing; lift this one with \`slopweaver handover gate release\``,
  });
  return EXIT_OK;
}

export const handoverRuleCommand = defineCommand({ run: runHandoverRule });
