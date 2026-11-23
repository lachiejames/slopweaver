/**
 * An atlas is routable because it is REGISTERED, not because somebody remembered to write a row for it.
 *
 * ## The failure this closes
 *
 * Capability rows are hand-authored into each install's own `capability-profile.json` and merged with
 * `slopweaver route capabilities-merge`. So a source is unroutable until a human writes a row, and an atlas
 * landed today is invisible to every live turn forever. MEASURED on this install: the profile held
 * 47 rows naming **13** platforms, while `atlasPlatforms()` registered **37** that day — leaving 24 registered
 * atlases that no routing judgement could ever be offered, among them aether, airtable, braze, canva,
 * cloudflare, crowdstrike, figma, gemini-ai-studio, graphql-hive, linear, microsoft365, nightfall, notion,
 * nx-cloud, onepassword, prisma-data-platform, slack, trelica and workos. Aether — the pentest portal a turn
 * had just needed — was one of them. Reproduce today's count on any install:
 *
 * ```bash
 * slopweaver route plan --question "what does this build hold" --profile "$SLOPWEAVER_HOME/capability-profile.json"
 * ```
 *
 * ## Why the suppression key is the PLATFORM and not the id
 *
 * An id-keyed rule cannot work here. This install's overlay carries twenty `vanta-*-atlas` rows for the ONE
 * vanta platform, so suppressing by id would add a twenty-first, generic `vanta-atlas` row beside rows that
 * already describe that atlas far better than a derived sentence can. {@link atlasPlatformOf} is the same
 * reader `deriveAtlasCapabilities` already uses, so "which platform does this row read" has exactly one
 * answer in this module tree rather than two that can disagree.
 *
 * A row whose command names no platform — `github-vulnerability-atlas` declares `sourceClass: "atlas"` and
 * runs `slopweaver github vuln list` — suppresses nothing, and that is correct: it is not reading that
 * platform's generation, so it cannot stand in for a row that would.
 *
 * ## What a derived row deliberately does NOT claim
 *
 * It is born `available` carrying its command, because `sourceCapabilitySchema` refuses an available row
 * with no command — and then `./atlasReading.ts`'s grading is what downgrades it. A generation that cannot
 * answer becomes `unavailable` with its own refusal text, exactly as a hand-authored row does. The
 * derivation supplies the row's EXISTENCE; the generation supplies its truth.
 *
 * ## Cost, measured, and why not to "optimise" the loop
 *
 * `./atlasReadings.ts` opens one generation per named platform, so this takes a brief from ~13 reads to one
 * per registered atlas, 37 when it was MEASURED over the real `~/.slopweaver`: **8347 ms**
 * sequentially for all 37 (jumpcloud 4009 ms and cloudflare 1532 ms are most of it), against ~4.9 s for the 13
 * named before. `Promise.all` over the same 37 took **10886 ms** — WORSE — because the work is CPU-bound Zod
 * parsing of whole generations rather than I/O. Repro:
 *
 * ```bash
 * yarn tsx -e 'import {atlasRegistrations} from "./src/atlas/registry.js"; const t=performance.now(); for (const r of atlasRegistrations()) await r.readSnapshot({}); console.log(Math.round(performance.now()-t));'
 * ```
 *
 * The cheap path exists and is deliberately not taken here: `gradeAtlasAnswerability` consumes only
 * `Pick<AtlasReadSnapshot, "generation" | "kinds">`, so a manifest-only grading door would take this back
 * under a second — at the cost of touching every adapter, which turns a routing fix into an atlas-kit one.
 */
import { atlasPlatformOf } from "./atlasReading.js";
import { QUESTION_COMMAND_TOKEN, type SourceCapability } from "./profile.js";

/**
 * One registered atlas, reduced to the fields a routing row needs.
 *
 * A plain shape rather than an `AtlasPlatformRegistration`, for the reason `./atlasReading.ts` gives about
 * its own gradings: `src/route/` plans and calls no source, so the registry is read by
 * `./atlasSources.ts` and handed in here as data. Everything below stays pure and testable with a literal.
 */
export interface RegisteredAtlasSource {
  /** The platform name, as `atlasPlatforms()` spells it — `nx-cloud`, `gemini-ai-studio`. */
  readonly platform: string;
  /** What the atlas says about itself, with the kit's generic sentence already substituted for a `null`. */
  readonly summary: string;
}

/**
 * The whole-word terms a derived row is selected by, built from the platform name alone.
 *
 * Deliberately mechanical. Hand-written vocabulary per platform is the thing this module exists to stop
 * needing, and `buildRoutingCapabilities` — the live path — never reads `terms` at all: it offers a catalog
 * and the judging session decides relevance. Only `buildSourcePlan`'s keyword match consults them.
 *
 * @param platform the platform name
 * @returns the terms, deduplicated, in a stable order
 */
export function derivedAtlasTerms({ platform }: { platform: string }): readonly string[] {
  const spaced = platform.replaceAll("-", " ");
  return [...new Set([platform, spaced, `${spaced} atlas`])];
}

/**
 * The routing row one registered atlas gets when nothing else already describes it.
 *
 * @param atlas the registered platform and its own sentence about itself
 * @returns the capability row, born available so the atlas grading is what downgrades it
 */
export function derivedAtlasCapability({ atlas }: { atlas: RegisteredAtlasSource }): SourceCapability {
  const { platform } = atlas;
  return {
    availability: { kind: "available" },
    command: ["slopweaver", "atlas", platform, "read", "--query", QUESTION_COMMAND_TOKEN],
    coverage: {
      detail:
        `whatever the last \`slopweaver atlas ${platform} sync\` or \`walk\` published locally. ` +
        `\`slopweaver atlas ${platform} coverage\` is the per-kind truth — which surfaces are filled, which ` +
        `are declared and unfilled, and what it knows it does NOT know — so an empty read means this ` +
        `generation holds nothing on that kind, never that the platform does`,
      kind: "bounded",
    },
    effect: "read",
    freshness: {
      detail:
        `the generation the last \`slopweaver atlas ${platform}\` sync published locally; nothing schedules ` +
        `the next one, so state the generation's age rather than implying live`,
      kind: "cached",
    },
    id: `${platform}-atlas`,
    owner: "slopweaver",
    sourceClass: "atlas",
    terms: derivedAtlasTerms({ platform }),
    truthMode: "current",
    what: atlas.summary,
  };
}

/**
 * Extend the BASE table with a derived row for every registered atlas nothing already reads.
 *
 * `overlay` is read for coverage and never added to the result, which is what keeps this composable with
 * `mergedCapabilities`: the overlay still overlays the base by id afterwards, and doing that here instead
 * would turn every private row into a base row with a spurious exclusion recorded against it.
 *
 * @param baseCapabilities the generic table to extend
 * @param overlay the private profile's rows, which suppress a derived row for a platform they already read
 * @param atlases every atlas this build registers, in registry order
 * @returns the base table with the uncovered platforms appended, its own rows untouched and in their order
 */
export function withDerivedAtlasCapabilities({
  baseCapabilities,
  overlay = [],
  atlases,
}: {
  baseCapabilities: readonly SourceCapability[];
  overlay?: readonly SourceCapability[] | undefined;
  atlases: readonly RegisteredAtlasSource[];
}): readonly SourceCapability[] {
  const covered = new Set(
    [...baseCapabilities, ...overlay].flatMap((capability) =>
      [atlasPlatformOf({ capability })].filter((platform) => platform !== null),
    ),
  );
  const derived = atlases
    .filter((atlas) => !covered.has(atlas.platform))
    .map((atlas) => derivedAtlasCapability({ atlas }));
  return [...baseCapabilities, ...derived];
}
