/**
 * Multi-source planning for one visible supervisor turn.
 *
 * This module chooses sources but calls none of them. Current truth remains required, history can be added
 * as context, and a matched source that is unavailable remains visible with its reason. A private profile
 * overlays the generic table by stable id without putting any installation detail in the public plugin.
 *
 * The TABLE itself lives in `./genericCapabilities.ts` — a document, where this file is behaviour, and a
 * reader arriving for one never wants the other. `GENERIC_SOURCE_CAPABILITIES` is re-exported here because
 * it is this module's own default argument and every caller that plans reaches for the two together.
 */
import { z } from "zod";

import { absentAsEmpty } from "#lib/absent.js";
import { type AtlasRouteReading, deriveAtlasCapabilities } from "./atlasReading.js";
import { CENSUS_MATCH_PREFIX, type CensusServiceMatch, commandRunsDatadog } from "./censusReading.js";
import { type CommandRouteReading, deriveCommandCapabilities } from "./commandReading.js";
import { type ConnectionRouteReading, deriveConnectionCapabilities } from "./connectionReading.js";
import { GENERIC_SOURCE_CAPABILITIES } from "./genericCapabilities.js";
import {
  type CapabilityProfile,
  QUESTION_COMMAND_TOKEN,
  type SourceCapability,
  sourceCapabilitySchema,
} from "./profile.js";

export { GENERIC_SOURCE_CAPABILITIES } from "./genericCapabilities.js";

/** The source-plan version. A stored plan at a different version is not silently reinterpreted. */
const SOURCE_PLAN_SCHEMA_VERSION = 1;

/** One selected source and the terms that selected it. */
export interface SourceLeg {
  readonly capability: SourceCapability;
  readonly matched: readonly string[];
}

/** A generic row replaced by the private profile, retained so the override is auditable. */
export interface SourceExclusion {
  readonly capabilityId: string;
  readonly reason: string;
}

/** The complete, ordered source decision for one question. */
export interface SourcePlan {
  readonly schemaVersion: number;
  readonly question: string;
  readonly required: readonly SourceLeg[];
  readonly optional: readonly SourceLeg[];
  readonly exclusions: readonly SourceExclusion[];
}

const sourceLegSchema = z
  .object({ capability: sourceCapabilitySchema, matched: z.array(z.string()) })
  .strict() satisfies z.ZodType<SourceLeg>;

const sourceExclusionSchema = z
  .object({ capabilityId: z.string().min(1), reason: z.string().min(1) })
  .strict() satisfies z.ZodType<SourceExclusion>;

/** The parse-edge schema for a complete source plan. */
export const sourcePlanSchema = z
  .object({
    exclusions: z.array(sourceExclusionSchema),
    optional: z.array(sourceLegSchema),
    question: z.string().min(1),
    required: z.array(sourceLegSchema).min(1),
    schemaVersion: z.literal(SOURCE_PLAN_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((plan, context) => {
    const seen = new Set<string>();
    for (const [index, leg] of plan.required.entries()) {
      if (seen.has(leg.capability.id)) {
        context.addIssue({ code: "custom", message: "a capability may appear only once", path: ["required", index] });
      }
      seen.add(leg.capability.id);
    }
    for (const [index, leg] of plan.optional.entries()) {
      if (leg.capability.truthMode !== "history") {
        context.addIssue({ code: "custom", message: "only history may be optional", path: ["optional", index] });
      }
      if (seen.has(leg.capability.id)) {
        context.addIssue({ code: "custom", message: "a capability may appear only once", path: ["optional", index] });
      }
      seen.add(leg.capability.id);
    }
  }) satisfies z.ZodType<SourcePlan>;

/** Escape a term before embedding it in a whole-word regular expression. */
function escaped({ term }: { term: string }): string {
  return term.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Whether a question uses a term as a whole word or phrase, case-insensitively.
 *
 * @param question the question as asked
 * @param term the term to find
 * @returns whether the term appears on identifier boundaries
 */
function usesSourceTerm({ question, term }: { question: string; term: string }): boolean {
  return new RegExp(String.raw`(?<![\w-])${escaped({ term })}(?![\w-])`, "i").test(question);
}

/** Match every declared term in declaration order. */
function matchedTerms({ capability, question }: { capability: SourceCapability; question: string }): readonly string[] {
  return capability.terms.filter((term) => usesSourceTerm({ question, term }));
}

/**
 * Replace the profile's typed question token without invoking a shell or re-parsing argument boundaries.
 *
 * @param command the validated command template argv
 * @param question the exact question this plan was built for
 * @returns runnable argv with every question token materialised as one element
 */
function materialiseCommand({
  command,
  question,
}: {
  command: readonly string[];
  question: string;
}): readonly string[] {
  // A question that LOOKS like a flag is fenced behind `--`, and this is why: the
  // question is substituted verbatim into argv, so a question of "-x" reached `ask --store` as a flag and
  // was refused with `unknown flag: --x` before any database opened, while the row advertising it read
  // AVAILABLE. Everything after `--` is positional text to `parseFlags` (measured: `facts --store --limit 1
  // -- -x` selects on "-x"), so the fence preserves the question exactly rather than editing it. Flags must
  // precede the fence — see `./storeReading.ts`'s `withHome`, which inserts before it.
  return command.flatMap((argument) => {
    if (argument !== QUESTION_COMMAND_TOKEN) {
      return [argument];
    }
    return question.startsWith("-") ? ["--", question] : [question];
  });
}

/**
 * Keep profile data immutable while turning its command template into plan output. Exported for the same
 * sharing reason {@link mergedCapabilities} is.
 *
 * @param capability the capability whose command template may need materialising
 * @param question the exact question this plan was built for
 * @param slopweaverCommand the absolute bundled launcher this host resolved
 * @returns the same capability when nothing needed materialising, else a copy with a runnable command
 */
export function materialiseCapability({
  capability,
  question,
  slopweaverCommand,
}: {
  capability: SourceCapability;
  question: string;
  slopweaverCommand: string;
}): SourceCapability {
  const needsQuestion = capability.command.includes(QUESTION_COMMAND_TOKEN);
  const needsBundledLauncher = capability.command[0] === "slopweaver" && slopweaverCommand !== "slopweaver";
  if (!needsQuestion && !needsBundledLauncher) {
    return capability;
  }
  const command = materialiseCommand({ command: capability.command, question });
  return {
    ...capability,
    command: command.map((argument, index) =>
      index === 0 && argument === "slopweaver" ? slopweaverCommand : argument,
    ),
  };
}

/**
 * Overlay private rows by id, preserving generic order and recording every replacement. Exported so
 * `./routingCapabilities.js` shares the exact same overlay mechanics `route plan` uses, rather than a
 * second implementation that could drift.
 *
 * @param baseCapabilities the generic table to overlay
 * @param profile the private overlay, or `undefined` when this installation has none
 * @returns the merged capability rows, and every exclusion the overlay recorded
 */
export function mergedCapabilities({
  baseCapabilities,
  profile,
}: {
  baseCapabilities: readonly SourceCapability[];
  profile: CapabilityProfile | undefined;
}): { readonly capabilities: readonly SourceCapability[]; readonly exclusions: readonly SourceExclusion[] } {
  const privateById = new Map(
    absentAsEmpty({ value: profile?.capabilities }).map((capability) => [capability.id, capability]),
  );
  const capabilities: SourceCapability[] = [];
  const exclusions: SourceExclusion[] = [];
  for (const base of baseCapabilities) {
    const replacement = privateById.get(base.id);
    if (replacement === undefined) {
      capabilities.push(base);
      continue;
    }
    capabilities.push(replacement);
    exclusions.push({
      capabilityId: base.id,
      reason: `the ${base.owner} capability was replaced by the ${replacement.owner} profile capability`,
    });
    privateById.delete(base.id);
  }
  for (const capability of privateById.values()) {
    capabilities.push(capability);
  }
  return { capabilities, exclusions };
}

/**
 * Split the capability table into the legs a question NAMED and the legs the census merely HINTS at.
 *
 * A census NAME match is a hint and rides `optional`; only a declared TERM makes a leg required. Two review
 * passes are why. The first found an ordinary word naming one service (`support`), so the matching rule was
 * narrowed to whole names and hyphenated runs; the second found `asset-management` — a whole census service
 * name that is also ordinary business English — making Datadog REQUIRED on "do we have an asset-management
 * policy for the SOC 2 audit?" and demoting the corpus to optional. 73 of the 349 segment runs in the
 * installed census are all-English-word compounds, so no denylist closes that class. Offering the leg without
 * ranking it above the question's own words does: the session still sees that the telemetry estate holds the
 * name, and a compliance question still reads its history first.
 *
 * @param capabilities the graded, materialised rows
 * @param censusMatches the services the Datadog census says this question names
 * @param question the question as asked
 * @returns the legs a term matched, and the legs only the census offered
 */
function matchedLegs({
  capabilities,
  censusMatches,
  question,
}: {
  capabilities: readonly SourceCapability[];
  censusMatches: readonly CensusServiceMatch[];
  question: string;
}): { readonly named: readonly SourceLeg[]; readonly hinted: readonly SourceLeg[] } {
  const censusTerms = censusMatches.map((match) => `${CENSUS_MATCH_PREFIX}${match.service}`);
  const named: SourceLeg[] = [];
  const hinted: SourceLeg[] = [];
  for (const capability of capabilities) {
    const terms = matchedTerms({ capability, question });
    const census = commandRunsDatadog({ command: capability.command }) ? censusTerms : [];
    if (terms.length > 0) {
      named.push({ capability, matched: [...terms, ...census] });
      continue;
    }
    if (census.length > 0) {
      hinted.push({ capability, matched: census });
    }
  }
  return { hinted, named };
}

/** Find the reserved history capability in a validated base table. */
function historyCapability({ capabilities }: { capabilities: readonly SourceCapability[] }): SourceCapability {
  const capability = capabilities.find((candidate) => candidate.id === "corpus");
  if (capability === undefined) {
    throw new Error("source planning requires the reserved corpus capability");
  }
  return capability;
}

/**
 * How many of a leg's matches are the question's OWN words — the census markers do not count.
 *
 * {@link decisiveOrder} ranks on this rather than on `matched.length`, and a review pass is why: with the
 * census entries counted, "which branch protection and required reviews cover the alerts for jobs-api,
 * core-api and checkout-api?" put both Datadog rows ABOVE `github-control-atlas`, which had matched two of the
 * question's own terms against telemetry's one. Three recognised service slugs bought two ranks. The skill
 * tells a session to consult `required` IN ORDER, so rank is the whole claim — and a census name is a hint,
 * which is the property this keeps true inside `required` as well as between the two lists.
 *
 * @param leg one planned leg
 * @returns how many declared terms of the question it matched
 */
function termMatchCount({ leg }: { leg: SourceLeg }): number {
  return leg.matched.filter((match) => !match.startsWith(CENSUS_MATCH_PREFIX)).length;
}

/** Keep refusals first, then current truth, then history; within a class prefer the strongest term match. */
function decisiveOrder({ left, right }: { left: SourceLeg; right: SourceLeg }): number {
  const leftUnavailable = left.capability.availability.kind === "unavailable";
  const rightUnavailable = right.capability.availability.kind === "unavailable";
  if (leftUnavailable !== rightUnavailable) {
    return leftUnavailable ? -1 : 1;
  }
  if (left.capability.truthMode !== right.capability.truthMode) {
    return left.capability.truthMode === "current" ? -1 : 1;
  }
  return termMatchCount({ leg: right }) - termMatchCount({ leg: left });
}

/**
 * Build the ordered source plan without calling a source or a model.
 *
 * @param question the question to plan
 * @param profile the validated private overlay, when one was explicitly supplied
 * @param baseCapabilities the generic table, replaceable only by compatibility tests and projections
 * @param slopweaverCommand the absolute bundled launcher supplied by the CLI host
 * @param atlasReadings one grading per atlas platform, so an atlas row advertises what its generation
 *   actually holds rather than what it declared — omitted leaves every row exactly as declared
 * @param commandReadings one grading per executable the table names, so a row whose command cannot run on
 *   this host is refused rather than planned — omitted leaves every row exactly as declared
 * @param connectionReadings one grading per door holding a grant, so a door this install never connected is
 *   refused rather than planned — omitted leaves every row exactly as declared
 * @param censusMatches the services the Datadog census says this question names — each becomes a
 *   `census:service:<name>` match on every row whose command runs a Datadog verb, which OFFERS that row
 *   without ranking it above the question's own words ({@link matchedLegs}); omitted matches nothing extra
 * @returns required and optional source legs plus the audited overlay exclusions
 */
export function buildSourcePlan({
  question,
  profile,
  baseCapabilities = GENERIC_SOURCE_CAPABILITIES,
  slopweaverCommand = "slopweaver",
  atlasReadings = new Map<string, AtlasRouteReading>(),
  commandReadings = new Map<string, CommandRouteReading>(),
  connectionReadings = new Map<string, ConnectionRouteReading>(),
  censusMatches = [],
}: {
  question: string;
  profile?: CapabilityProfile;
  baseCapabilities?: readonly SourceCapability[];
  slopweaverCommand?: string;
  atlasReadings?: ReadonlyMap<string, AtlasRouteReading>;
  commandReadings?: ReadonlyMap<string, CommandRouteReading>;
  connectionReadings?: ReadonlyMap<string, ConnectionRouteReading>;
  censusMatches?: readonly CensusServiceMatch[];
}): SourcePlan {
  const merged = mergedCapabilities({ baseCapabilities, profile });
  // Can it RUN comes before what it would hold — `./commandReading.ts` carries the measurement.
  const runnable = deriveCommandCapabilities({ capabilities: merged.capabilities, readings: commandReadings });
  const connected = deriveConnectionCapabilities({ capabilities: runnable, readings: connectionReadings });
  const capabilities = deriveAtlasCapabilities({
    capabilities: connected,
    readings: atlasReadings,
  }).map((capability) => materialiseCapability({ capability, question, slopweaverCommand }));
  const history = historyCapability({ capabilities });
  const { named, hinted } = matchedLegs({ capabilities, censusMatches, question });
  const required =
    named.length === 0
      ? [{ capability: history, matched: [] }]
      : named.toSorted((left, right) => decisiveOrder({ left, right }));
  const needsOptionalHistory =
    required.some((leg) => leg.capability.truthMode === "current") &&
    !required.some((leg) => leg.capability.id === history.id);
  return {
    exclusions: merged.exclusions,
    // History first, then the census hints: a hint is the weakest thing in the plan, and a review pass caught it
    // sitting above the corpus row inside `optional`.
    optional: [
      ...(needsOptionalHistory ? [{ capability: history, matched: [] }] : []),
      ...hinted.toSorted((left, right) => decisiveOrder({ left, right })),
    ],
    question,
    required,
    schemaVersion: SOURCE_PLAN_SCHEMA_VERSION,
  };
}
