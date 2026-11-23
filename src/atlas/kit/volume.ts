/**
 * What every atlas has decided about the VOLUME of each family it holds, and the publish refusal that
 * makes the decision structural rather than a convention.
 *
 * ## The rule this enforces, and the measurement that forced it
 *
 * Owner ruling: an atlas includes everything reachable EXCEPT highly voluminous
 * data, which is stored as catalogued SHAPES — the shape of what the operation returns and how much of it
 * there is — and never as a row per record. The motivating case is the JumpCloud per-device telemetry,
 * one row per observation in a single kind file, which should not have entered the atlas as rows, and the
 * rule applies to every atlas rather than to that one.
 *
 * `docs/atlas-intent/06-holdings.md` already carried the criterion — a family is voluminous when its records are
 * time-series OBSERVATIONS, emitted by the platform rather than created by a person, unbounded, growing
 * with the clock, and identified by an INSTANT rather than by a name somebody chose, with CONFIGURATION as
 * the complement — and §9 already made `shape-index` the one admissible exclusion ground. What neither had
 * was a reader. MEASURED on one install, which is the whole reason this module exists:
 * `~/.slopweaver/atlas/jumpcloud/systeminsights.jsonl` held **one published entity row per per-device osquery
 * observation** from the `v2-systeminsights-list-*` operations, every row carrying a
 * `detail.collection_time` instant — and its own coverage cell read `state: "synced"`. The atlas was not
 * merely wrong; it reported itself healthy. Re-derive the whole distribution:
 *
 * ```bash
 * find ~/.slopweaver/atlas -mindepth 2 -name '*.jsonl' ! -name '_resume.jsonl' \
 *   ! -path '*_superseded*' -exec sh -c 'echo "$(wc -l < "$1") $1"' _ {} \; | sort -rn | head -20
 * ```
 *
 * The declaration beside it — `events` and `commandresults`, both correctly `shape-index` with a measured
 * basis — sat in `AtlasDescriptor.excludes` as free prose that no code reads, in the same atlas, while the
 * sibling family published every observation as a row. A rule stated in prose beside prose cannot tell a
 * family somebody judged from one nobody looked at.
 *
 * ## Why this is a REQUIRED field on the spec, not an optional one
 *
 * `AtlasStoreSpec.kindObligations` is the precedent, and it carries the same reasoning: a change belongs in the
 * kit so it applies to all atlases rather than to one, and the code makes it structurally impossible to have an
 * integration or atlas with no policy set. A required field is that rule in the type system — a new atlas cannot reach
 * `publishAtlas` without having decided. An atlas with nothing voluminous declares `{ verdicts: [] }`, one
 * line, the same shape `kindObligations: { exceptions: {} }` already takes.
 *
 * ## The criterion cuts THROUGH a family, so a verdict may name an OPERATION
 *
 * §6 is explicit that the rule is applied per operation and not per family, and this tree proves it twice
 * over. JumpCloud's `assets` kind holds device-asset entities beside `v2-list-device-asset-history`
 * rows that are pure time series; its `policies` kind holds the policies somebody authored beside
 * `v2-policyresults-list` rows reporting what happened on each device at an instant. A per-kind-only
 * declaration would have to choose between dropping the entities and keeping the telemetry. So a verdict
 * may name an operation inside an otherwise-entity kind, and a platform that wants that enforcement hands
 * the kit an {@link AtlasRowOperation} reader — the kit cannot know where a platform records which call
 * produced a row.
 *
 * ## The ceiling is a TRIPWIRE, and its absence means nothing
 *
 * {@link UNDECLARED_ROW_CEILING} does not decide what is voluminous — §6's criterion does, applied by
 * somebody reading the records. What the ceiling catches is the family nobody CLASSIFIED: a kind publishing
 * more rows than it can plausibly be an enumerable inventory of, carrying no verdict either way. It is the
 * `AGENTS.md` rule-3 shape — a tripwire, not a fence — and passing it proves nothing at all. Cloudflare's
 * `audit-log` stood under the ceiling on the day this landed and was unambiguously an observation family;
 * it is declared because somebody read it, not because a number caught it.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchRefusalLines } from "../../hatch/render.js";
import type { AtlasVolumeBasis } from "./contract.js";
import type { KindEvidenceChange } from "./evidenceLoss.js";
import type { AtlasKindFileLike, AtlasManifestLike, AtlasStoreSpec } from "./store.js";

/**
 * How many published rows a kind may carry before it must say which side of §6 it falls on.
 *
 * MEASURED across every published generation in `~/.slopweaver/atlas` (repro in this module's
 * header): every kind file standing above the ceiling is judged by name in this repository's own
 * declarations, and the ceiling sits in the gap below the smallest of them. The number is where a kind file stops
 * plausibly being an enumerable inventory of things somebody created and starts being accretion — it is a
 * prompt to classify, never a definition of voluminous. Ratchet it against the distribution rather than
 * restating a count in prose.
 */
export const UNDECLARED_ROW_CEILING = 5_000;

/**
 * A family this atlas reaches and deliberately does not store whole.
 *
 * `because` is §6's criterion applied to THIS family — why its records are observations rather than
 * configuration — and is not a restatement of the family's name. The basis beside it is what the coverage
 * gate reads, and an `unmeasured` one is already refused there.
 * @internal
 */
export interface AtlasShapeIndexed {
  readonly because: string;
  readonly volume: AtlasVolumeBasis;
}

/**
 * A family that publishes more rows than {@link UNDECLARED_ROW_CEILING} and is configuration anyway.
 *
 * The count it was judged at is required, not decorative: a family admitted at nine thousand rows and
 * silently grown to nine hundred thousand has stopped being the thing that was judged, and `judgedAtRows`
 * is what lets a reader see that without re-deriving the verdict. This is the arm that keeps the ceiling
 * honest — without it every large configuration family would be pressure to raise the number.
 * @internal
 */
export interface AtlasBulkEntity {
  readonly because: string;
  readonly judgedAtRows: number;
}

/**
 * A family whose records ARE observations and which the provider itself keeps small enough to hold whole.
 *
 * This arm exists because the alternative was making an atlas lie, and the case that forced it is on
 * record. The Cloudflare atlas carried `access-authentication-log`, `dex-test` and `dex-fleet-status` as
 * deferred on the ground that they were a time series rather than configuration; that ground is REJECTED once
 * they are measured against the live account, and `cloudflare/inventory.ts` carries the table:
 * `dex-fleet-status` is weighed in rows and bytes over the provider's WHOLE 7-day retention, against a
 * terabyte as the owner's own example of a qualifying volume.
 *
 * So the §6 criterion identifies which families are candidates and volume is still the bound. A family with
 * a provider-side retention window is bounded by the PROVIDER rather than by the clock, which is exactly
 * what `unboundedBecause` cannot be written for — and calling one `bulk-entity` would assert it is
 * configuration somebody created, which is false. Both halves are required: the bound that makes it finite,
 * and the measurement taken against it.
 * @internal
 */
export interface AtlasBoundedObservation {
  readonly because: string;
  /** The provider-side limit that makes this family finite — a retention window, a fixed fleet, a cap. */
  readonly boundedBy: string;
  /** The figure a reader can check, taken against that bound. */
  readonly magnitude: string;
  /** The command, endpoint or vendor page that re-establishes {@link magnitude}. */
  readonly establishedBy: string;
}

/**
 * One family's verdict under §6.
 *
 * A `shape-index` verdict may narrow to a single operation inside an otherwise-entity kind; the other two
 * never do, because each is a statement about what the whole kind file is allowed to hold.
 */
export type AtlasVolumeVerdict<TKind extends string> =
  | ({ readonly kind: TKind; readonly disposition: "shape-index"; readonly operation?: string } & AtlasShapeIndexed)
  | ({ readonly kind: TKind; readonly disposition: "bounded-observation" } & AtlasBoundedObservation)
  | ({ readonly kind: TKind; readonly disposition: "bulk-entity" } & AtlasBulkEntity);

/**
 * How a platform says which operation produced one published row.
 *
 * Optional on the declaration, because `AtlasKindFileLike` promises the kit an `id` and nothing else — where
 * a row records its own provenance is a per-platform fact. A platform that supplies none gets whole-kind
 * enforcement and no operation-level enforcement, visibly, rather than by inheriting a guess.
 *
 * The row arrives as `unknown` and the platform narrows it with a guard, which is the house rule rather than
 * a shortcut. Threading the platform's own row TYPE through here was tried and does not survive: inside
 * `publishAtlas`'s generic the kind file still reads at the `{ id: string }` constraint, so the only way to
 * hand a platform its real record was a narrowing `as`, which `oxlint`'s `no-unsafe-type-assertion` refuses
 * everywhere in this tree — correctly, since the kit cannot prove what a platform's row is. A reader that
 * does not recognise what it is given answers `null` and that kind loses operation-level enforcement only.
 */
export type AtlasRowOperation = (input: { row: unknown }) => string | null;

/** What a whole atlas has decided about volume, as the list of families it has judged. */
export interface AtlasVolumeDeclaration<TKind extends string> {
  readonly verdicts: readonly AtlasVolumeVerdict<TKind>[];
  readonly operationOf?: AtlasRowOperation;
}

/** One kind's published row count, as the census and the publish refusal both see it. */
export interface AtlasKindRows<TKind extends string> {
  readonly kind: TKind;
  readonly rows: number;
  /** How many of those rows came from each operation, for a platform that can say. Empty when it cannot. */
  readonly byOperation: ReadonlyMap<string, number>;
}

/** What the rule says about one kind, once its verdicts and its row count are both in hand. */
export interface AtlasVolumeFinding<TKind extends string> {
  readonly kind: TKind;
  readonly rows: number;
  /** `shape-index-published` and `undeclared-volume` are refusals; `declared` and `clear` are not. */
  readonly state: "clear" | "declared" | "shape-index-published" | "undeclared-volume";
  /** One sentence a reader can act on. */
  readonly detail: string;
}

/** The hatch row this refusal renders, looked up once so the reader and the text cannot name different rows. */
const ROW_VOLUME_HATCH = hatchFor({ id: "atlas-row-volume" });

/**
 * Whether the operator has opened the row-volume hatch for this run.
 *
 * Written as a statement rather than a parameter default deliberately — `hatch-release` in `yarn lint`
 * refuses a defaulted hatch read anywhere in this tree, because a caller passing its own argument skips a
 * default and can therefore CLOSE a hatch the operator opened.
 *
 * @returns whether the ambient variable this hatch declares is set to `1`
 */
export function rowVolumeHatchOpen(): boolean {
  return process.env["SLOPWEAVER_ALLOW_ATLAS_ROW_VOLUME"] === "1";
}

/**
 * Count a kind file's rows, and how many came from each operation the platform can name.
 *
 * @param kind the kind being counted, carried through so a finding can name it
 * @param entities the kind file's own rows
 * @param operationOf the platform's provenance reader, when it has one
 * @returns the counts this kind contributes to a census or a publish refusal
 */
export function countKindRows<TKind extends string>({
  kind,
  entities,
  operationOf,
}: {
  kind: TKind;
  entities: readonly unknown[];
  operationOf?: AtlasRowOperation;
}): AtlasKindRows<TKind> {
  const byOperation = new Map<string, number>();
  if (operationOf !== undefined) {
    for (const row of entities) {
      const operation = operationOf({ row });
      if (operation !== null) {
        const seen = byOperation.get(operation);
        byOperation.set(operation, seen === undefined ? 1 : seen + 1);
      }
    }
  }
  return { byOperation, kind, rows: entities.length };
}

/**
 * Judge one kind against what its atlas declared about it.
 *
 * The order of the two refusals is the order they are worth knowing in. A shape-indexed family publishing
 * rows is the defect the rule names — the atlas HAS a verdict and the generation contradicts it — while
 * an undeclared volume is only ever the tripwire saying nobody has looked. Reporting the second over the
 * first would bury the real one.
 *
 * @param counts the kind's published row counts
 * @param verdicts every verdict this atlas declared, whatever kind they name
 * @returns what the rule says about this kind
 */
export function judgeKindVolume<TKind extends string>({
  counts,
  verdicts,
}: {
  counts: AtlasKindRows<TKind>;
  verdicts: readonly AtlasVolumeVerdict<TKind>[];
}): AtlasVolumeFinding<TKind> {
  const mine = verdicts.filter((verdict) => verdict.kind === counts.kind);
  const whole = mine.find((verdict) => verdict.disposition === "shape-index" && verdict.operation === undefined);
  if (whole !== undefined && counts.rows > 0) {
    return {
      detail:
        `${String(counts.rows)} row(s) published for a family this atlas declares shape-indexed — ` +
        `its records are catalogued as a SHAPE and never one at a time. ${whole.because}`,
      kind: counts.kind,
      rows: counts.rows,
      state: "shape-index-published",
    };
  }
  const perOperation = operationBreach({ counts, verdicts: mine });
  if (perOperation !== null) {
    return perOperation;
  }
  const held = mine.find(
    (verdict) => verdict.disposition === "bulk-entity" || verdict.disposition === "bounded-observation",
  );
  if (counts.rows > UNDECLARED_ROW_CEILING && held === undefined && whole === undefined) {
    return {
      detail:
        `${String(counts.rows)} row(s) published and nothing says which side of docs/atlas-intent/06-holdings.md ` +
        "this family falls on. Declare it shape-index when its records are unbounded time-series " +
        "observations, bounded-observation when the provider's own retention keeps them finite and they " +
        "have been measured against it, or bulk-entity with the count it was judged at when they are " +
        "configuration somebody created",
      kind: counts.kind,
      rows: counts.rows,
      state: "undeclared-volume",
    };
  }
  return {
    detail: declaredDetail({ held, rows: counts.rows, whole }),
    kind: counts.kind,
    rows: counts.rows,
    state: mine.length > 0 ? "declared" : "clear",
  };
}

/**
 * The refusal for one kind whose rows include an operation declared shape-indexed, or `null`.
 *
 * Split out so {@link judgeKindVolume} stays inside the `max-function-lines` budget, and because it is the
 * one half that reads the per-operation breakdown — a platform supplying no {@link AtlasRowOperation} has an
 * empty map here and this function is a no-op for it, which is the visible degradation rather than a guess.
 *
 * @param counts the kind's published row counts
 * @param verdicts this kind's own verdicts
 * @returns the finding, or `null` when no shape-indexed operation published a row
 */
function operationBreach<TKind extends string>({
  counts,
  verdicts,
}: {
  counts: AtlasKindRows<TKind>;
  verdicts: readonly AtlasVolumeVerdict<TKind>[];
}): AtlasVolumeFinding<TKind> | null {
  for (const verdict of verdicts) {
    if (verdict.disposition !== "shape-index" || verdict.operation === undefined) {
      continue;
    }
    // An `if` rather than a coalesce or a ternary, because the two gates disagree here: `no-silent-fallback`
    // refuses `?? 0` and oxlint's `prefer-nullish-coalescing` refuses the ternary that replaces it. Naming
    // the absent case outright is what both of them are actually asking for.
    const published = counts.byOperation.get(verdict.operation);
    if (published !== undefined && published > 0) {
      return {
        detail:
          `${String(published)} row(s) published by ${verdict.operation}, an operation this atlas declares ` +
          `shape-indexed inside an otherwise-entity kind. ${verdict.because}`,
        kind: counts.kind,
        rows: counts.rows,
        state: "shape-index-published",
      };
    }
  }
  return null;
}

/**
 * What a non-refusing finding says about itself.
 *
 * @param whole the kind's whole-kind shape-index verdict, when it has one
 * @param held the kind's bulk-entity or bounded-observation verdict, when it has one
 * @param rows the published row count
 * @returns one sentence for the census to print
 */
function declaredDetail<TKind extends string>({
  whole,
  held,
  rows,
}: {
  whole: AtlasVolumeVerdict<TKind> | undefined;
  held: AtlasVolumeVerdict<TKind> | undefined;
  rows: number;
}): string {
  if (whole !== undefined) {
    return "shape-indexed and publishing no rows, as declared";
  }
  if (held?.disposition === "bulk-entity") {
    return `${String(rows)} row(s), declared bulk-entity at ${String(held.judgedAtRows)}: ${held.because}`;
  }
  if (held?.disposition === "bounded-observation") {
    return `${String(rows)} row(s), observations bounded by ${held.boundedBy} — ${held.magnitude}`;
  }
  return `${String(rows)} row(s)`;
}

/**
 * Every reason this generation may not be published, on volume grounds.
 *
 * @param findings one per kind this publish writes
 * @param platform the atlas's own platform name, so a refusal says which atlas
 * @returns the refusal lines, ending in the hatch, or nothing when the generation is clean
 */
export function refuseRowVolume<TKind extends string>({
  findings,
  platform,
}: {
  findings: readonly AtlasVolumeFinding<TKind>[];
  platform: string;
}): readonly string[] {
  const breaches = findings.filter(
    (finding) => finding.state === "shape-index-published" || finding.state === "undeclared-volume",
  );
  if (breaches.length === 0) {
    return [];
  }
  return [
    `slopweaver atlas ${platform} sync blocked because ${String(breaches.length)} kind(s) would publish ` +
      "highly voluminous data as rows. The rule: an atlas holds everything reachable EXCEPT highly " +
      "voluminous data, which is catalogued as a SHAPE and never stored a row at a time.",
    ...breaches.map((finding) => `  ${finding.kind}: ${finding.detail}`),
    ...hatchRefusalLines({ hatch: ROW_VOLUME_HATCH }),
  ];
}

/**
 * Drop every whole-kind shape-indexed family from what the evidence-loss guard judges.
 *
 * The two guards would otherwise deadlock the first atlas that adopts a verdict, and JumpCloud is that
 * atlas. Declaring `systeminsights` shape-indexed means the next publish writes zero entities for it — while
 * every row it published before sits in the generation on disk, which is exactly the shape `refuseEvidenceLoss` exists to
 * refuse. Both guards would be right on their own terms and the sync would never publish again.
 *
 * Emptying a shape-indexed kind is the DECLARED INTENT rather than degradation — it is the volume rule
 * being carried out — so the resolution is that the volume declaration wins for those kinds and the
 * evidence-loss guard keeps every other one. Filtered here rather than inside `./evidenceLoss.ts` so the two
 * declarations that interact are visible in one place; that module still refuses on its own criterion.
 *
 * An OPERATION-scoped verdict is deliberately not dropped: the kind keeps its entity half, so a publish
 * emptying it whole is still the loss it looks like. Its own half of the deadlock is closed one layer down
 * instead — `./evidenceLoss.ts`'s `keptRows` takes the retired operation's rows off BOTH sides of
 * the comparison, so the kind stays judged on the rows a walk may still produce. That module's
 * `retiredOperations` carries the measurement: a JumpCloud resync refused against the policy-result and
 * asset-history rows already on disk that this repository forbids the walk to fetch.
 *
 * @param changes what the evidence guard was about to judge
 * @param volumes the atlas's own volume declaration
 * @returns the changes for every kind that is not declared shape-indexed whole
 */
export function shapeIndexedDropped<TKind extends string>({
  changes,
  volumes,
}: {
  changes: readonly KindEvidenceChange[];
  volumes: AtlasVolumeDeclaration<TKind>;
}): readonly KindEvidenceChange[] {
  const emptied = new Set<string>(
    volumes.verdicts
      .filter((verdict) => verdict.disposition === "shape-index" && verdict.operation === undefined)
      .map((verdict) => verdict.kind),
  );
  return changes.filter((change) => !emptied.has(change.kind));
}

/**
 * The volume refusal for one publish, or no lines when every family it writes is where its atlas put it.
 *
 * Judged over the files this publish WRITES rather than over the whole generation on disk, for the same
 * reason {@link refuseUnacquiredMandatory} is: a partial publish is not responsible for a kind it is not
 * touching, and refusing on one would make every narrow sync inherit the backlog of every other family.
 * A census over the whole generation on disk is the other half, and it is not built yet — the sweep was done
 * by hand for every published atlas when this landed, and every finding became a declaration above.
 *
 * @param files the kind files this publish is writing
 * @param spec the platform's own contract, carrying the verdicts it declared and its provenance reader
 * @returns the refusal lines, or an empty list when nothing is voluminous
 */
export function refuseVoluminousRows<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  files,
  spec,
}: {
  files: Readonly<Partial<Record<TKind, TFile>>>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
}): readonly string[] {
  const findings = spec.kinds.flatMap((kind) => {
    const file = files[kind];
    if (file === undefined) {
      return [];
    }
    const operationOf = spec.kindVolumes.operationOf;
    const counts = countKindRows({
      entities: file.entities,
      kind,
      ...(operationOf === undefined ? {} : { operationOf }),
    });
    return [judgeKindVolume({ counts, verdicts: spec.kindVolumes.verdicts })];
  });
  return refuseRowVolume({ findings, platform: spec.platform });
}
