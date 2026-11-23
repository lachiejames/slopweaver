/**
 * The atlas-content-coverage gate — refuses an atlas that declares a surface it cannot divide, and ratchets
 * the debt of the ones that already do.
 *
 * ## The defect this closes, measured
 *
 * **The rule**: an atlas hits every GET endpoint that exists, and says honestly which API endpoints exist but
 * are never hit and which browser URLs exist but are never hit. The same gap recurring is why this is a gate:
 * the miss has to be impossible to repeat.
 *
 * MEASURED when it landed. The Vanta atlas declared BOTH its surfaces `filled` while calling **24 of the
 * 107 GET operations Vanta's own published document declares**. One of the eighty-three was
 * `GET /knowledge-base/resources`, which serves every policy document this organisation holds. A session had
 * spent the previous evening establishing, correctly, that nine content-shaped routes under
 * `/v1/policies/{id}` answer HTTP 404, and had concluded from that the Manage API held no policy body.
 * Nothing was wrong with the reasoning. What was missing was a DENOMINATOR: the atlas divided its coverage
 * by its own list of what it calls, so an endpoint nobody had thought of was not a gap but an absence, and
 * absences appear in no coverage report. `inventory.ts` had gone further and declared the whole knowledge
 * base absent from the Manage API off two more guessed paths.
 *
 * The same shape stood across the tree: **71 of 118 declared surfaces were `declared-unfilled`** and not one
 * of the 36 descriptors carried any count of what exists.
 *
 * ## The criterion, stated so it can be argued with
 *
 * Three rules, over every registered atlas's own descriptor:
 *
 * 1. **A surface with `denominator.known === false` is DEBT.** The count of them across the whole tree may
 *    never rise and the recorded baseline may never go stale — so a new atlas cannot land with one, and a
 *    surface that gains a denominator forces the number down in the same pull request.
 * 2. **A `known: true` surface's shortfall (`exists - reached`) is DEBT, per platform.** Same ratchet, same
 *    staleness refusal. This is the number that answers "which endpoints exist but you never hit", and
 *    `reached` counts CALLS — a good reason for not calling something belongs on that thing's own row and
 *    never reduces this number.
 * 3. **A surface may not be `filled` while its own denominator says it reached nothing.** No baseline and no
 *    debt: a fresh instance of the original defect can never land at all.
 *
 * Rule 3 is the one that makes the class impossible to repeat; rules 1 and 2 are what let today's debt be
 * numbered and visible rather than forgiven. That split is deliberate — a gate whose only move is to forbid
 * new instances leaves the existing ones invisible, and a gate that refuses everything cannot be landed and
 * so protects nothing.
 *
 * ## How a finding is retired
 *
 * By reaching the thing, by giving the surface a real denominator, or by a MEASURED refusal recorded on the
 * row — never by widening a baseline, adding an exemption marker or deleting a denominator row. There is
 * deliberately no exemption marker at all, which is the same contract `whole-file-json` and
 * `atlas-manifest-clock` carry. A baseline that no longer matches fails in BOTH directions for exactly this
 * reason: a debt allowed to sit at its recorded number after the work is done is a debt nobody has to pay.
 */
import { atlasPlatforms, findAtlasPlatform } from "../atlas/registry.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * One known surface's two recorded numbers, ratcheted SEPARATELY.
 *
 * ## Why they are separate, which is the whole point of this shape
 *
 * An earlier version recorded one composite per platform — `exists - reached` — and refused any increase.
 * That number cannot tell two opposite things apart: coverage REGRESSED because `reached` fell, and
 * discovery IMPROVED because `exists` grew. It refused both, so recording a newly found part of a platform
 * read as losing coverage, and the only way to land the honest number was to not write it down.
 *
 * Worse, the composite could be satisfied by SHRINKING the denominator: drop an endpoint from the
 * catalogue and the shortfall falls, and the gate congratulates you for paying a debt you deleted. That is
 * the exact self-flattering arithmetic `AtlasSurface.denominator` exists to end, and the composite left it
 * wide open.
 *
 * **The rule on a grown denominator**: it is recorded, never refused, because it serves honesty and maximum
 * coverage, and it happens when a SaaS adds features and endpoints or the owner is granted additional access.
 * So a denominator legitimately moves for two reasons that are nobody's fault, and a gate
 * that treats movement as failure is a gate that gets routed around.
 *
 * Split, each number carries its own rule and the pair is strictly STRONGER than the composite was:
 * `reached` may never fall, `exists` may never fall either, and a rise in either is RECORDED here in the
 * same change rather than refused.
 *
 * @internal
 */
export interface AtlasKnownSurfaceBaseline {
  /**
   * What the provider's own catalogue declares exists. It may GROW — a vendor ships endpoints, or this
   * installation is granted access it did not have — and a growth is recorded with its reason. It may
   * never SHRINK, because that is how a shortfall gets hidden rather than paid.
   */
  readonly exists: number;
  /** How many of them this atlas CALLS. It may never fall. */
  readonly reached: number;
  /** Why `exists` is what it is, and what moved it last. Read by a person; the gate never parses it. */
  readonly because: string;
}

/** The recorded debt this gate ratchets, per rule.
 * @internal
 */
export interface AtlasContentDebt {
  readonly surfacesWithNoDenominator: number;
  /** Every surface carrying a real denominator, keyed `<platform>/<surface>`. */
  readonly knownSurfaces: Readonly<Record<string, AtlasKnownSurfaceBaseline>>;
}

/**
 * The recorded debt, per rule, as it stood when this gate landed.
 *
 * MEASURED — reproduce with `yarn tsx src/devLint/atlasContentCoverage.entry.ts`, whose failure
 * message prints the current numbers whenever they disagree with these. Every entry may only go DOWN.
 *
 * @internal
 */
export const ATLAS_CONTENT_DEBT: AtlasContentDebt = {
  /** Surfaces across every atlas whose coverage has nothing independent to divide by (rule 1). */
  surfacesWithNoDenominator: 98,
  /**
   * Every surface carrying a real denominator, keyed `<platform>/<surface>` (rule 2). A surface whose
   * descriptor declares `known: true` and is absent here fails, and so does a row here whose surface is gone.
   *
   * `reached` counts CALLS and nothing else. Every unreached thing may carry a perfectly good reason on its
   * own row — a detail read a walked collection already covers, an entitlement measured at HTTP 403 — and
   * none of those reasons raises this number. That is deliberate: a Codex review pass caught the Vanta row
   * counting 42 reached where 25 had been called by adding exactly those two classes, which is the
   * arithmetic this whole gate exists to end.
   */
  knownSurfaces: {
    "datadog/console": {
      because:
        "the console's own left nav, read live in the owner's Chrome and declared in `src/atlas/datadog/consolePages.ts` — 239 pages across 20 top-level entries after the org's own dashboards, a team link and the mobile-login QR are excluded by rule. Datadog publishes no sitemap; this read is the bounded denominator, and `atlas datadog walk` re-reads the nav every run so drift is a gap",
      exists: 239,
      reached: 0,
    },
    "aether/aether-portal": {
      because:
        "the atlas's own enumerated portal route set (`src/atlas/aether/pages.ts`), as measured — Aether publishes no read catalogue, so the denominator is the 7 routes this walk visits (3 human pages, plus the stats endpoint and the open/closed/ignored finding tabs), every one reached each walk",
      exists: 7,
      reached: 7,
    },
    "google-secops/chronicle-api-v1": {
      because:
        "googleapis' own google/cloud/chronicle/v1 protos and chronicle_v1.yaml, pinned by commit in `atlas/googleSecops/generated/protoLock.ts` — 39 GET methods of 92, as counted. The fill calls six lists; fifteen more readonly GETs are left uncalled with a reason each in `atlas/googleSecops/fill/plan.ts`, and eighteen accept only cloud-platform, which the owner declined",
      exists: 39,
      reached: 6,
    },
    "make/make-api-v2": {
      because:
        "@makehq/sdk@1.6.20's own MakeTools census — 203 tools, 92 annotated readOnlyHint, and `atlas/make/descriptor.test.ts` recomputes it from the installed package. The fill calls eight of them (`atlas/make/fill/plan.ts`): the scenario-and-schedule, team, folder, connection, hook and execution-list reads the offboarding and Vanta-KnowBe4 hunt needed, and nothing that reads a run's data or a credential",
      exists: 92,
      reached: 8,
    },
    "knowbe4/kmsat-console": {
      because:
        "this repository's own declared list of read-only KMSAT console routes, `KNOWBE4_CONSOLE_ROUTES` in `atlas/knowbe4/descriptor.ts`, restored from the first KnowBe4 atlas (`0589d87087^:src/atlas/knowbe4/consolePages.ts`) — KnowBe4 publishes no sitemap. Nothing walks the console: the Reporting API answers the training and phishing questions",
      exists: 16,
      reached: 0,
    },
    "knowbe4/reporting-api-v1": {
      because:
        "KnowBe4's first-party Reporting API OpenAPI document (developer.knowbe4.com/elvis-swagger.yml), sha256-pinned in `atlas/knowbe4/descriptor.ts` — 24 GET path templates, as counted. The sync calls the eleven list paths; the thirteen by-id and risk-history reads are uncalled with a reason each in `atlas/knowbe4/fill/plan.ts`",
      exists: 24,
      reached: 11,
    },
    "vanta/auditor-api": {
      because:
        "Vanta's own published Auditor API document — 38 GET operations, disjoint from Manage's 107. It is the clearest case for why the ratchet is split: this surface existed all along and declaring it raised the shortfall by 38 without one call being lost",
      exists: 38,
      reached: 0,
    },
    "vanta/build-integrations-api": {
      because: "Vanta's own published Build Integrations document — 12 GET operations, also disjoint from Manage's",
      exists: 12,
      reached: 0,
    },
    "vanta/manage-api": {
      because:
        "Vanta's own published Manage OpenAPI document, pinned by digest in `atlas/vanta/generated/specLock.ts` — 107 GET operations, unchanged by the latest re-pin, whose only movement was one added PATCH and four unreferenced schemas",
      exists: 107,
      reached: 46,
    },
    "vanta/webhooks": {
      because:
        "Vanta's own published webhook document — 24 outbound topics and ZERO GET operations, so its read denominator is a measured zero rather than an unknown",
      exists: 0,
      reached: 0,
    },
  },
};

/** One surface name declared twice on the same platform, which would collapse to a single ratcheted row.
 * @internal
 */
export interface DuplicateSurface {
  readonly platform: string;
  readonly surface: string;
}

/** One rule-3 violation: a surface claiming to be filled while its denominator says it reached nothing.
 * @internal
 */
export interface FilledButEmptySurface {
  readonly platform: string;
  readonly surface: string;
}

/** What one sweep of every registered atlas found. */
export interface AtlasContentCoverageScan {
  readonly filledButEmpty: readonly FilledButEmptySurface[];
  /**
   * Surface names declared twice on one platform. Refused rather than tolerated: two rows keyed the same
   * collapse into ONE ratcheted entry, and a Codex review pass showed that collapse hiding a shrunk
   * denominator — a row with `exists: 106` overwritten by a second `manage-api` row with `exists: 107`
   * passed the ratchet with the shortfall quietly deleted.
   */
  readonly duplicateSurfaces: readonly DuplicateSurface[];
  readonly platformsScanned: number;
  readonly surfacesWithNoDenominator: number;
  /** What each known surface declares right now, keyed `<platform>/<surface>`. */
  readonly knownSurfaces: Readonly<Record<string, { readonly exists: number; readonly reached: number }>>;
}

/** One platform's descriptor, reduced to the fields this gate reads. */
export interface ScannedPlatform {
  readonly platform: string;
  readonly surfaces: readonly {
    readonly denominator:
      { readonly known: true; readonly exists: number; readonly reached: number } | { readonly known: false };
    readonly name: string;
    readonly status: string;
  }[];
}

/**
 * Reduce every platform's surfaces to the three numbers the rules are judged on.
 *
 * Pure over an already-read list of descriptors, so the whole criterion is settled by unit tests rather
 * than by importing every atlas module inside an assertion.
 *
 * @param platforms every registered atlas, reduced to the fields this gate reads
 * @returns the counts each rule compares against its baseline
 */
export function scanAtlasContentCoverage({
  platforms,
}: {
  platforms: readonly ScannedPlatform[];
}): AtlasContentCoverageScan {
  const filledButEmpty: FilledButEmptySurface[] = [];
  const duplicateSurfaces: DuplicateSurface[] = [];
  const knownSurfaces: Record<string, { exists: number; reached: number }> = {};
  let surfacesWithNoDenominator = 0;
  for (const entry of platforms) {
    duplicateSurfaces.push(...repeatedSurfaceNames({ entry }));
    for (const surface of entry.surfaces) {
      if (!surface.denominator.known) {
        surfacesWithNoDenominator += 1;
        continue;
      }
      knownSurfaces[`${entry.platform}/${surface.name}`] = {
        exists: surface.denominator.exists,
        reached: surface.denominator.reached,
      };
      // A surface with nothing to reach cannot be the original defect, and declaring it `filled` is the
      // honest answer rather than a false claim: Vanta's webhook document declares 24 outbound topics and
      // no GET at all, so `exists: 0` with `reached: 0` is a measurement, not an empty surface.
      if (surface.status === "filled" && surface.denominator.exists > 0 && surface.denominator.reached === 0) {
        filledButEmpty.push({ platform: entry.platform, surface: surface.name });
      }
    }
  }
  return {
    duplicateSurfaces,
    filledButEmpty,
    knownSurfaces,
    platformsScanned: platforms.length,
    surfacesWithNoDenominator,
  };
}

/**
 * Every surface name one platform declares more than once.
 *
 * Its own function because the ratchet keys on `<platform>/<surface>`, so a repeated name is not a style
 * complaint — it is two rows collapsing into one entry, with the later row's numbers silently standing for
 * the earlier row's.
 *
 * @param entry one platform's surfaces, as the gate reads them
 * @returns one row per name seen again, in declaration order
 */
function repeatedSurfaceNames({ entry }: { entry: ScannedPlatform }): readonly DuplicateSurface[] {
  const seen = new Set<string>();
  const repeated: DuplicateSurface[] = [];
  for (const surface of entry.surfaces) {
    if (seen.has(surface.name)) {
      repeated.push({ platform: entry.platform, surface: surface.name });
    }
    seen.add(surface.name);
  }
  return repeated;
}

/**
 * Every way a scan disagrees with the recorded debt, in the order a reader should act on them.
 *
 * @param scan what the sweep found
 * @param debt the recorded baseline
 * @returns one line per disagreement, empty when the gate passes
 */
export function atlasContentCoverageProblems({
  scan,
  debt,
}: {
  scan: AtlasContentCoverageScan;
  debt: AtlasContentDebt;
}): readonly string[] {
  const problems: string[] = [];
  for (const hit of scan.duplicateSurfaces) {
    problems.push(
      `${hit.platform}: surface "${hit.surface}" is declared more than once. Two rows with one name collapse into a single ratcheted entry, so the later one silently replaces the earlier — which is enough to hide a denominator that shrank. Give each surface its own name; there is no baseline for this.`,
    );
  }
  for (const hit of scan.filledButEmpty) {
    problems.push(
      `${hit.platform}: surface "${hit.surface}" is declared filled while its own denominator says it reached 0 of what exists. That is the defect this gate exists for and it has no baseline — reach the surface, or stop calling it filled.`,
    );
  }
  if (scan.surfacesWithNoDenominator > debt.surfacesWithNoDenominator) {
    problems.push(
      `${String(scan.surfacesWithNoDenominator)} surface(s) have no denominator, against a recorded ${String(debt.surfacesWithNoDenominator)}. A new surface may not land without one: give it \`denominator: { known: true, exists, reached, source }\` from the provider's own catalogue.`,
    );
  }
  if (scan.surfacesWithNoDenominator < debt.surfacesWithNoDenominator) {
    problems.push(
      `${String(scan.surfacesWithNoDenominator)} surface(s) have no denominator, against a recorded ${String(debt.surfacesWithNoDenominator)}. The debt came down — lower ATLAS_CONTENT_DEBT.surfacesWithNoDenominator to ${String(scan.surfacesWithNoDenominator)} in the same change, so it can never sit above what is owed.`,
    );
  }
  const keys = [...new Set([...Object.keys(scan.knownSurfaces), ...Object.keys(debt.knownSurfaces)])].toSorted();
  for (const key of keys) {
    problems.push(...knownSurfaceProblems({ found: scan.knownSurfaces[key], key, recorded: debt.knownSurfaces[key] }));
  }
  return problems;
}

/**
 * Every way ONE known surface disagrees with its recorded baseline.
 *
 * Split out of {@link atlasContentCoverageProblems} because the four movements below are the whole rule and
 * reading them beside the denominator-less ratchet made both harder to follow.
 *
 * @param key the surface, as `<platform>/<surface>`
 * @param found what its descriptor declares now, or undefined when no descriptor declares it any more
 * @param recorded its baseline, or undefined when it has none yet
 * @returns one line per disagreement, empty when the surface sits exactly at its baseline
 */
function knownSurfaceProblems({
  key,
  found,
  recorded,
}: {
  key: string;
  found: { readonly exists: number; readonly reached: number } | undefined;
  recorded: AtlasKnownSurfaceBaseline | undefined;
}): readonly string[] {
  const problems: string[] = [];
  {
    if (found === undefined) {
      problems.push(
        `${key}: a baseline is recorded for a surface no descriptor declares with a real denominator any more. If the surface is gone, delete its row from ATLAS_CONTENT_DEBT.knownSurfaces; if its denominator became \`known: false\`, that is a denominator being deleted and is refused.`,
      );
      return problems;
    }
    if (recorded === undefined) {
      problems.push(
        `${key}: declares a real denominator (${String(found.exists)} exist, ${String(found.reached)} reached) and has no recorded baseline. Add it to ATLAS_CONTENT_DEBT.knownSurfaces in this change, with \`because\` naming where \`exists\` came from.`,
      );
      return problems;
    }
    if (found.reached < recorded.reached) {
      problems.push(
        `${key}: reach FELL — ${String(found.reached)} called against a recorded ${String(recorded.reached)}. This is the one movement that is never acceptable: a thing this atlas used to call and no longer does. Restore the call, or explain it to the owner rather than to this file.`,
      );
    }
    if (found.reached > recorded.reached) {
      problems.push(
        `${key}: reach ROSE — ${String(found.reached)} called against a recorded ${String(recorded.reached)}. Raise ATLAS_CONTENT_DEBT.knownSurfaces["${key}"].reached to ${String(found.reached)} in the same change, so the floor can never sit below what is owed.`,
      );
    }
    if (found.exists < recorded.exists) {
      problems.push(
        `${key}: the denominator SHRANK — ${String(found.exists)} declared against a recorded ${String(recorded.exists)}. A shortfall is paid by calling things, never by deleting them from the catalogue you divide by. If the provider genuinely retired them, say so on the surface and bring the owner the number.`,
      );
    }
    if (found.exists > recorded.exists) {
      problems.push(
        `${key}: the denominator GREW — ${String(found.exists)} declared against a recorded ${String(recorded.exists)}. This is expected and is not a regression: record it by raising ATLAS_CONTENT_DEBT.knownSurfaces["${key}"].exists to ${String(found.exists)} in the same change, with \`because\` naming what moved it.`,
      );
    }
  }
  return problems;
}

/**
 * Read every registered atlas's descriptor and judge it against the recorded debt.
 *
 * @returns the process exit code — 0 when every rule holds
 */
export async function runAtlasContentCoverage(): Promise<number> {
  const platforms: ScannedPlatform[] = [];
  for (const platform of atlasPlatforms()) {
    const registration = findAtlasPlatform({ platform });
    if (registration === null) {
      process.stderr.write(
        `${lintGateRefusal({
          declaration: lintDeclarationFor({ id: "atlas-content-coverage-platform" }),
          detail: `${platform} resolves to no registry`,
        })}\n`,
      );
      return 1;
    }
    const descriptor = await registration.readDescriptor();
    platforms.push({ platform, surfaces: descriptor.surfaces });
  }
  const scan = scanAtlasContentCoverage({ platforms });
  const problems = atlasContentCoverageProblems({ debt: ATLAS_CONTENT_DEBT, scan });
  if (problems.length === 0) {
    process.stdout.write(
      `atlas-content-coverage: ${String(scan.platformsScanned)} atlas(es), ${String(scan.surfacesWithNoDenominator)} surface(s) with no denominator, ${String(Object.keys(scan.knownSurfaces).length)} that can divide, ${String(Object.values(scan.knownSurfaces).reduce((total, value) => total + (value.exists - value.reached), 0))} documented thing(s) never called — all at their recorded debt\n`,
    );
    return 0;
  }
  for (const problem of problems) {
    process.stderr.write(`  ${problem}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "atlas-content-coverage" }),
      detail: `${String(problems.length)} problem(s)`,
    })}\n`,
  );
  return 1;
}
