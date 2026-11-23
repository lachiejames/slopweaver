/**
 * Pure argument handling and rendering for `slopweaver atlas coverage`.
 *
 * This is the verb `docs/atlas-intent/settled-decisions.md` is describing when it records _"Coverage has to be a first class
 * property"_ and _"honest about how much it thinks it knows and where it thinks it's got gaps"_. Both are
 * the owner's own words, and neither was answerable before: coverage cells and gaps were written to disk by
 * every sync and read back by nothing.
 *
 * It reports most things rather than judging them. A surface that has never been filled, a kind that has
 * never succeeded and a generation older than its own limit are all STATES this prints; none of them is an
 * error, because an atlas saying what it does not know is the atlas working.
 *
 * ## The one thing it DOES judge — the coverage gate
 *
 * **Standing rule**: an atlas missing coverage is unacceptable, and the only
 * convincing reason to exclude a kind is that pulling it is highly voluminous. Saying that in a report and
 * exiting 0 anyway is how the Cloudflare atlas came to carry nine bare noun phrases nobody read as a
 * problem. So three shapes make this verb exit {@link EXIT_EXPECTED_EMPTY} — a declared exclusion on the
 * `not-fetched` ground, one claiming `shape-index` on an `unmeasured` volume basis, and a kind whose
 * coverage cell is still `deferred` — and each is a FACT rather than a reading of prose, so the refusal is
 * falsifiable and the same in every atlas.
 *
 * `deferred` is in that set because it means the same thing the other two do: MEASURED across the 24
 * published generations in `~/.slopweaver`, 44 cells stood `deferred` and exactly two carried
 * any volume reason at all — the rest read `17 of 32 declared page(s) reached`, which is a walk that has not
 * finished rather than a decision anybody made. Re-derive with
 * `slopweaver atlas <platform> coverage --state deferred`.
 *
 * The gate reads the WHOLE atlas, never the narrowed view: a `--kind` or `--state` filter selects what is
 * printed and must never be able to select a green exit.
 *
 * ## This gate is about ONE atlas, and the fleet-wide view deliberately is not a gate
 *
 * The refused rows across the estate are a backlog to work through, not a wall to stop at. This verb keeps its exit 3 because the question it
 * answers is whether THIS atlas is complete today. `slopweaver atlas backlog` answers the other question —
 * what to work on next, across every atlas, in the owner's order — and always exits 0, so it can be read
 * on a schedule without ever failing an atlas pull request. See `src/atlas/kit/backlog.ts`.
 */

import type { AtlasCoverageState, AtlasExclusion } from "../../../atlas/kit/contract.js";
import { isRefusedExclusion, unfilledSurfaces } from "../../../atlas/kit/contract.js";
import { coverageStatesWorstLast } from "../../../atlas/kit/coverageOrder.js";
import type { AtlasKindView, AtlasReadSnapshot } from "../../../atlas/kit/read.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** Every flag this verb accepts. The spec is local; {@link ATLAS_COVERAGE_FLAG_NAMES} is what leaves. */
const ATLAS_COVERAGE_FLAGS: FlagSpec = {
  boolean: ["json", "open-only"],
  string: ["kind", "surface", "state", "home"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const ATLAS_COVERAGE_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: ATLAS_COVERAGE_FLAGS }),
  ...stringFlagsOf({ spec: ATLAS_COVERAGE_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const ATLAS_COVERAGE_USAGE =
  "usage: slopweaver atlas <platform> coverage [--kind <kind>] [--surface <name>]\n" +
  "                                           [--state <coverage-state>] [--open-only] [--json] [--home <dir>]\n" +
  "  <platform>        the atlas to report on — run `slopweaver atlas` to list them\n" +
  "  --kind            only this kind's cells and gaps\n" +
  "  --surface         only cells this surface produced\n" +
  "  --state           only cells in this coverage state, e.g. unreadable, deferred, excluded\n" +
  "  --open-only       only the gaps still open, and the kinds carrying them\n" +
  "  reads only what a sync already stored; it makes no network call\n" +
  "  exits 3 when the coverage gate refuses: a declared exclusion nobody fetched, one claiming to be too\n" +
  "  voluminous to hold without ever weighing it, or a kind left `deferred`";

/** The resolved invocation.
 * @internal
 */
export interface AtlasCoverageOptions {
  readonly kind: string | undefined;
  readonly surface: string | undefined;
  readonly state: string | undefined;
  readonly openOnly: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `atlas coverage`
 * @returns the resolved options, or `err` with every usage problem found
 */
export function parseAtlasCoverageArgs({ rest }: { rest: readonly string[] }): Result<AtlasCoverageOptions> {
  const parsed = parseFlags({ args: rest, spec: ATLAS_COVERAGE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const stringOf = ({ name }: { name: string }): string | undefined =>
    typeof values[name] === "string" ? values[name] : undefined;
  return ok({
    home: stringOf({ name: "home" }),
    json: values["json"] === true,
    kind: stringOf({ name: "kind" }),
    openOnly: values["open-only"] === true,
    state: stringOf({ name: "state" }),
    surface: stringOf({ name: "surface" }),
  });
}

/** One kind's coverage, summarised.
 * @internal
 */
export interface AtlasKindCoverageSummary {
  readonly kind: string;
  readonly entityCount: number;
  readonly publishedCount: number;
  readonly lastSuccessAt: string | null;
  readonly latestAttemptFailed: boolean;
  /** How many cells sit in each state, worst last. Absent states are omitted rather than zero-filled. */
  readonly states: Readonly<Record<string, number>>;
  readonly openGaps: number;
}

/** The whole report, as `--json` emits it.
 * @internal
 */
export interface AtlasCoverageJson {
  readonly schemaVersion: 2;
  readonly platform: string;
  readonly generation: AtlasReadSnapshot["generation"];
  readonly surfaces: AtlasReadSnapshot["descriptor"]["surfaces"];
  readonly excludes: readonly AtlasExclusion[];
  readonly refused: AtlasCoverageRefusal;
  readonly visibilityScope: string;
  readonly kinds: readonly AtlasKindCoverageSummary[];
  readonly gaps: readonly {
    readonly kind: string;
    readonly id: string;
    readonly condition: string;
    readonly scope: string;
    readonly reason: string;
    readonly status: "open" | "closed";
    readonly lastDetectedAt: string;
  }[];
}

/**
 * Narrow one kind's cells and gaps by the caller's filters.
 *
 * @param view the kind to narrow
 * @param surface only cells this surface produced, when given
 * @param state only cells in this state, when given
 * @param openOnly drop closed gaps
 * @returns the narrowed view
 */
export function narrowCoverage({
  view,
  surface,
  state,
  openOnly,
}: {
  view: AtlasKindView;
  surface: string | undefined;
  state: string | undefined;
  openOnly: boolean;
}): AtlasKindView {
  return {
    ...view,
    coverage: view.coverage.filter(
      (cell) => (surface === undefined || cell.surface === surface) && (state === undefined || cell.state === state),
    ),
    gaps: view.gaps.filter((gap) => !openOnly || gap.status === "open"),
  };
}

/**
 * Summarise one kind.
 *
 * @param view the kind to summarise
 * @returns its summary
 */
export function summariseKind({ view }: { view: AtlasKindView }): AtlasKindCoverageSummary {
  const states: Record<string, number> = {};
  for (const cell of view.coverage) {
    const tallied = states[cell.state];
    states[cell.state] = tallied === undefined ? 1 : tallied + 1;
  }
  return {
    entityCount: view.entities.length,
    kind: view.kind,
    lastSuccessAt: view.lastSuccessAt,
    latestAttemptFailed: view.latestAttemptFailed,
    openGaps: view.gaps.filter((gap) => gap.status === "open").length,
    publishedCount: view.publishedCount,
    states,
  };
}

/**
 * Build the `--json` document.
 *
 * @param snapshot the platform's whole atlas
 * @param kinds the narrowed kind views
 * @returns the document to print
 */
export function atlasCoverageJson({
  snapshot,
  kinds,
}: {
  snapshot: AtlasReadSnapshot;
  kinds: readonly AtlasKindView[];
}): AtlasCoverageJson {
  return {
    excludes: snapshot.descriptor.excludes,
    gaps: kinds.flatMap((view) =>
      view.gaps.map((gap) => ({
        condition: gap.condition,
        id: gap.id,
        kind: view.kind,
        lastDetectedAt: gap.lastDetectedAt,
        reason: gap.reason,
        scope: gap.scope,
        status: gap.status,
      })),
    ),
    generation: snapshot.generation,
    kinds: kinds.map((view) => summariseKind({ view })),
    platform: snapshot.generation.platform,
    refused: refusedCoverage({ snapshot }),
    schemaVersion: 2,
    surfaces: snapshot.descriptor.surfaces,
    visibilityScope: snapshot.descriptor.visibilityScope,
  };
}

/** One kind left `deferred` — missing coverage with no volume reason, by construction.
 * @internal
 */
export interface AtlasDeferredCell {
  readonly kind: string;
  readonly surface: string;
  readonly scope: string;
  readonly reason: string;
}

/** What the coverage gate refuses about one atlas.
 * @internal
 */
export interface AtlasCoverageRefusal {
  readonly exclusions: readonly AtlasExclusion[];
  readonly deferred: readonly AtlasDeferredCell[];
}

/**
 * Everything about one atlas the coverage gate refuses.
 *
 * Reads `snapshot.kinds` rather than any narrowed view — see this file's header on why a filter must not be
 * able to buy a green exit.
 *
 * @param snapshot the platform's whole atlas
 * @returns the refused exclusions and the deferred cells, in declaration order
 */
export function refusedCoverage({ snapshot }: { snapshot: AtlasReadSnapshot }): AtlasCoverageRefusal {
  return {
    deferred: snapshot.kinds.flatMap((view) =>
      view.coverage
        .filter((cell) => cell.state === "deferred")
        .map((cell) => ({ kind: view.kind, reason: cell.reason, scope: cell.scope, surface: cell.surface })),
    ),
    exclusions: snapshot.descriptor.excludes.filter((exclusion) => isRefusedExclusion({ exclusion })),
  };
}

/**
 * Whether the gate refuses this atlas at all.
 *
 * @param refusal what {@link refusedCoverage} found
 * @returns `true` when anything was refused, which is what decides the exit code
 */
export function coverageGateRefuses({ refusal }: { refusal: AtlasCoverageRefusal }): boolean {
  return refusal.exclusions.length > 0 || refusal.deferred.length > 0;
}

/**
 * The REFUSED block, printed last because it is what a reader has to act on.
 *
 * @param refusal what {@link refusedCoverage} found
 * @returns the block's lines, or none when the gate is clean
 */
export function renderCoverageRefusal({ refusal }: { refusal: AtlasCoverageRefusal }): readonly string[] {
  if (!coverageGateRefuses({ refusal })) {
    return ["", "COVERAGE GATE  clean — every declared exclusion is grounded and no kind is deferred"];
  }
  const lines = [
    "",
    `COVERAGE GATE REFUSES (${String(refusal.exclusions.length)} exclusion(s), ${String(refusal.deferred.length)} deferred kind(s))`,
    "  an atlas missing coverage is unacceptable; only a MEASURED volume reason excludes a kind",
  ];
  for (const exclusion of refusal.exclusions) {
    if (exclusion.ground === "not-fetched") {
      lines.push(`  not-fetched     ${exclusion.because}`);
      lines.push(`    would be closed by: ${exclusion.wouldBeClosedBy}`);
      continue;
    }
    lines.push(`  unmeasured      ${exclusion.because}`);
    if (exclusion.ground === "shape-index" && exclusion.volume.basis === "unmeasured") {
      lines.push(`    would be measured by: ${exclusion.volume.wouldBeMeasuredBy}`);
    }
  }
  for (const cell of refusal.deferred) {
    lines.push(`  deferred        ${cell.kind}  ${cell.surface}  ${cell.scope}`);
    lines.push(`    ${cell.reason}`);
  }
  return lines;
}

/**
 * Whether the STORE holds a filled cell for one surface, whatever the descriptor declares about it.
 *
 * A descriptor's surface status is a static declaration written when the atlas was designed, and it goes
 * stale the moment a live channel first succeeds. MEASURED: the google-admin atlas read thousands of
 * records through its `admin-api` surface and the SURFACES header went on printing `declared-unfilled`,
 * because nothing compared the declaration against what was on disk. That is the exact dishonesty this
 * verb exists to prevent, pointed the other way — an atlas underclaiming what it holds is still an atlas
 * misdescribing itself.
 *
 * The comparison is ONE-DIRECTIONAL on purpose. A declared-unfilled surface the store has cells for is
 * reported filled; a declared-filled surface the store is silent about keeps its declaration, because a
 * kind filter narrow enough to select no cell must never make a whole surface read as empty.
 *
 * @param surface the declared surface name
 * @param kinds the kind views in this snapshot, whose cells are the evidence
 * @returns true when at least one cell for that surface has actually succeeded
 */
export function surfaceHasFilledCell({
  surface,
  kinds,
}: {
  surface: string;
  kinds: readonly AtlasKindView[];
}): boolean {
  return kinds.some((view) => view.coverage.some((cell) => cell.surface === surface && cell.lastSuccessAt !== null));
}

/**
 * The SURFACES block, with each declared surface graded against what is actually on disk.
 *
 * @param descriptor the platform's own surface declarations
 * @param kinds the kind views whose cells are the evidence
 * @returns the block's lines, header included
 */
function renderSurfaces({
  descriptor,
  kinds,
}: {
  descriptor: AtlasReadSnapshot["descriptor"];
  kinds: readonly AtlasKindView[];
}): readonly string[] {
  // What the STORE says wins over what the descriptor declared — see `surfaceHasFilledCell`.
  const observedNames = new Set(
    descriptor.surfaces
      .filter(
        (surface) => surface.status === "declared-unfilled" && surfaceHasFilledCell({ kinds, surface: surface.name }),
      )
      .map((surface) => surface.name),
  );
  const lines = ["SURFACES"];
  for (const surface of descriptor.surfaces) {
    const filledByStore = observedNames.has(surface.name);
    lines.push(
      `  ${surface.name}  ${surface.acquisition}  ${surface.role}  ${filledByStore ? "filled" : surface.status}`,
    );
    if (filledByStore) {
      lines.push("    filled since it was declared unfilled — this reads the stored cells, not the declaration");
    }
    if (surface.unfilledBecause !== null && !filledByStore) {
      lines.push(`    unfilled because: ${surface.unfilledBecause}`);
    }
  }
  const unfilled = unfilledSurfaces({ descriptor }).filter((surface) => !observedNames.has(surface.name));
  if (unfilled.length > 0) {
    lines.push(
      `  ${String(unfilled.length)} declared surface(s) have never been filled — this atlas is incomplete and SAYS so`,
    );
  }
  return lines;
}

/** When this atlas generation was published — an atlas nothing has ever published has no such instant. */
function publishedAt({ generation }: { generation: AtlasReadSnapshot["generation"] }): string {
  if (generation.updatedAt === null) {
    return "never published";
  }
  return generation.updatedAt;
}

/** When one kind last synced successfully — a kind no sync has ever completed has no such instant. */
function lastSucceededAt({ summary }: { summary: AtlasKindCoverageSummary }): string {
  if (summary.lastSuccessAt === null) {
    return "never";
  }
  return summary.lastSuccessAt;
}

/**
 * Render the human report.
 *
 * The surfaces come FIRST and an unfilled one is called out by name, because that is the question the
 * owner's both-surfaces ruling makes worth asking and the one a coverage fraction over filled surfaces
 * alone would hide entirely.
 *
 * @param snapshot the platform's whole atlas
 * @param kinds the narrowed kind views
 * @returns every line to print
 */
export function renderAtlasCoverage({
  snapshot,
  kinds,
}: {
  snapshot: AtlasReadSnapshot;
  kinds: readonly AtlasKindView[];
}): readonly string[] {
  const { descriptor, generation } = snapshot;
  const lines = [
    `${generation.platform} atlas coverage`,
    `generation ${publishedAt({ generation })}  ·  schema v${String(generation.schemaVersion)}`,
    `claim boundary: ${descriptor.visibilityScope}`,
    "",
  ];
  lines.push(...renderSurfaces({ descriptor, kinds }));

  lines.push("", "KINDS");
  const order = coverageStatesWorstLast();
  for (const view of kinds) {
    const summary = summariseKind({ view });
    const cells = order
      .flatMap((state: AtlasCoverageState) => {
        const count = summary.states[state];
        return count === undefined || count <= 0 ? [] : [`${state}=${String(count)}`];
      })
      .join(" ");
    const failed = summary.latestAttemptFailed ? "  LATEST ATTEMPT FAILED" : "";
    lines.push(
      `  ${view.kind.padEnd(26)} ${String(summary.entityCount).padStart(6)} entities  last success ${lastSucceededAt({ summary })}${failed}`,
    );
    if (cells.length > 0) {
      lines.push(`    ${cells}`);
    }
  }

  const gaps = kinds.flatMap((view) => view.gaps.map((gap) => ({ ...gap, kind: view.kind })));
  lines.push("", `GAPS (${String(gaps.length)})`);
  for (const gap of gaps) {
    lines.push(`  ${gap.status.toUpperCase()}  ${gap.kind}  ${gap.condition}  ${gap.scope}`);
    lines.push(`    ${gap.reason}`);
  }

  lines.push("", `DECLARED EXCLUSIONS (${String(descriptor.excludes.length)})`);
  for (const exclude of descriptor.excludes) {
    lines.push(`  ${exclude.ground.padEnd(16)} ${exclude.because}`);
  }
  lines.push(...renderCoverageRefusal({ refusal: refusedCoverage({ snapshot }) }));
  return lines;
}
