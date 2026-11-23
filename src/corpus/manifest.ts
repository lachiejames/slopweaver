/**
 * The CROSS-SOURCE CONSERVATION MANIFEST — a snapshot of the corpus's shape, and a comparison that names what
 * a rebuild lost.
 *
 * ## Why "non-empty" is not a check
 *
 * The natural way to verify a rebuild is "did the source I rebuilt come back?", and it is exactly the check
 * that cannot fail usefully. `derive` overwrites SHARED artefacts — the silver directory, the identity
 * resolution, the token graph and the curated graph are all one file each, computed over every source at once.
 * So a rebuild that discarded one source's bronze and re-pulled it can be fully green on that source while
 * silently having erased three others from every derived artefact, and every per-source count it reports will
 * look healthy.
 *
 * The check that does fail usefully is CONSERVATION: whatever the corpus held for the sources you did NOT
 * touch, it must still hold afterwards. That requires a snapshot taken before, which is what this is.
 *
 * ## What is compared, and why identities are stored in full
 *
 * Counts catch the coarse loss — a source that went to zero, a record kind that vanished. They do not catch a
 * source whose count is unchanged because it lost 400 records and gained 400 others, which is precisely what a
 * mis-keyed rebuild produces. So the identity SET is stored per source, not just its size, and the comparison
 * can name the identities that disappeared instead of reporting a number that moved.
 *
 * That makes the manifest large — roughly one line per record — and it lives under `$SLOPWEAVER_HOME`, never in
 * the repository. It is a disposable measurement artefact, not a tracked contract.
 *
 * ## Why it also counts ORIGIN survival
 *
 * Conservation compares a corpus to itself. It cannot see the other way a lane stops being rebuildable: the
 * lane was scanned off a local tree, and that tree has since been pruned. Nothing in a before/after comparison
 * moves when that happens — the records are all still there — so a rebuild verdict computed from counts alone
 * reads a lane holding the only copy of thousands of deleted files as freely re-scannable.
 *
 * Measured on this install: the `self` lane held 59,670 records scanned from 5,019 distinct files,
 * of which 1,037 still existed and 3,982 did not. Reproduce the shape of that reading on any corpus with
 * `slopweaver dev manifest`, whose `origin survival` lines are exactly {@link ./survival.laneSurvival} over
 * the two tallies below.
 *
 * So the manifest counts, per source, how many DISTINCT local origin files a lane's records came from and how
 * many of those still exist. {@link isLocalOrigin} decides which `url`s are origins at all, and a lane with no
 * local origins reports neither number rather than a reassuring zero — a fetched lane is not "intact", it is
 * outside what this reading can speak to.
 */
import { absentAsEmpty } from "#lib/absent.js";
import { recordIdentity } from "./latestRecords.js";
import type { CorpusRecord } from "./types.js";

/** How many identities a comparison will NAME before it starts counting instead. */
export const NAMED_LOSS_LIMIT = 20;

/** A snapshot of the corpus's cross-source shape. */
export interface CorpusManifest {
  readonly version: 2;
  /** Total records in the logical-latest view. */
  readonly records: number;
  /** Records per source. */
  readonly bySource: Readonly<Record<string, number>>;
  /** Records per `<source>/<kind>` — finer than per-source, so a lost KIND is visible. */
  readonly bySourceKind: Readonly<Record<string, number>>;
  /** Distinct containers per source (repos, Slack channels, Linear teams). */
  readonly containersBySource: Readonly<Record<string, number>>;
  /**
   * The full identity SET per source. Stored rather than counted so a comparison can name what disappeared —
   * a source that lost 400 records and gained 400 others has an unchanged count.
   */
  readonly identitiesBySource: Readonly<Record<string, readonly string[]>>;
  /** Total encoded curated edges across every record — the edge-set size the curated graph is built from. */
  readonly curatedEdges: number;
  /**
   * Per source, the number of DISTINCT local origin files whose records this corpus holds and which still
   * exist on disk. A source with no local origins is absent rather than zero.
   */
  readonly originsPresentBySource: Readonly<Record<string, number>>;
  /**
   * Per source, the number of DISTINCT local origin files that are GONE — the count a rebuildable verdict has
   * to cite, because re-running the scan cannot bring these back. Absent, not zero, for a source with no
   * local origins.
   */
  readonly originsMissingBySource: Readonly<Record<string, number>>;
}

/** The attrs key curated edges are stored under (duplicated from `curated/types` to keep this module leaf). */
const CURATED_EDGES = "curatedEdges";

/**
 * Whether a record's `url` names a file on THIS machine rather than a page on a provider. Pure.
 *
 * The criterion is deliberately narrow — an absolute POSIX path, which is what a local scan writes and what no
 * provider connector ever produces, since those all write an `https:` URL. A `//` prefix is excluded because it
 * is a protocol-relative URL, not a path.
 *
 * @param url the record's `url` field
 * @returns true when the record was scanned from a local file
 */
export function isLocalOrigin({ url }: { url: string }): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

/** Increment a counter in a plain tally. */
function bump({ tally, key }: { tally: Record<string, number>; key: string }): void {
  tally[key] = (tally[key] ?? 0) + 1;
}

/** A manifest built one record at a time — so a caller streaming the corpus never holds it. */
export interface CorpusManifestFold {
  /** Absorb one record of the latest view. */
  readonly add: (args: { record: CorpusRecord }) => void;
  /** The manifest of every record absorbed so far. */
  readonly finish: () => CorpusManifest;
}

/**
 * Start a manifest fold over a record set's cross-source shape. Pure apart from the `exists` probe it is handed.
 *
 * Feed it the LOGICAL-LATEST view, not raw bronze lines: comparing physical versions would report a rebuild as
 * lossy simply because it wrote fewer duplicate versions than the append-only original had accumulated.
 *
 * `exists` is REQUIRED rather than defaulted, and that is the point of it: origin survival is the one reading
 * here that needs to touch the disk, and a default would let a caller obtain a manifest reporting every lane
 * intact without ever having decided how existence is judged. The seam is a plain function, so this stays a
 * pure function under test.
 *
 * @param exists judges whether one absolute path is still on disk — `existsSync` in the shell, a fake in a test
 * @returns the fold
 */
export function corpusManifestFold({ exists }: { exists: (input: { path: string }) => boolean }): CorpusManifestFold {
  const bySource: Record<string, number> = {};
  const bySourceKind: Record<string, number> = {};
  const containers: Record<string, Set<string>> = {};
  const identities: Record<string, string[]> = {};
  const origins: Record<string, Set<string>> = {};
  let curatedEdges = 0;
  let records = 0;
  return {
    add: ({ record }) => {
      records += 1;
      bump({ key: record.source, tally: bySource });
      bump({ key: `${record.source}/${record.kind}`, tally: bySourceKind });
      (containers[record.source] ??= new Set()).add(record.container);
      (identities[record.source] ??= []).push(recordIdentity({ record }));
      if (isLocalOrigin({ url: record.url })) {
        // DISTINCT paths, not records: a scanned file is chunked into many records, and counting those would
        // report a lane as far more lost than it is purely because its files are long.
        (origins[record.source] ??= new Set()).add(record.url);
      }
      const edges = record.attrs?.[CURATED_EDGES];
      curatedEdges += Array.isArray(edges) ? edges.length : 0;
    },
    finish: () => {
      const originsPresentBySource: Record<string, number> = {};
      const originsMissingBySource: Record<string, number> = {};
      for (const [source, paths] of Object.entries(origins)) {
        const present = [...paths].filter((path) => exists({ path })).length;
        originsPresentBySource[source] = present;
        originsMissingBySource[source] = paths.size - present;
      }
      return {
        bySource,
        bySourceKind,
        containersBySource: Object.fromEntries(Object.entries(containers).map(([source, set]) => [source, set.size])),
        curatedEdges,
        identitiesBySource: Object.fromEntries(
          Object.entries(identities).map(([source, keys]) => [source, keys.toSorted()]),
        ),
        originsMissingBySource,
        originsPresentBySource,
        records,
        version: 2,
      };
    },
  };
}

/**
 * Snapshot an in-memory record set's cross-source shape — {@link corpusManifestFold} over a list. Pure.
 *
 * @internal — the unit tests' way in; `dev manifest` streams through the fold directly.
 * @param records the records to snapshot (the latest view)
 * @param exists judges whether one absolute path is still on disk
 * @returns the manifest
 */
export function buildCorpusManifest({
  records,
  exists,
}: {
  records: readonly CorpusRecord[];
  exists: (input: { path: string }) => boolean;
}): CorpusManifest {
  const fold = corpusManifestFold({ exists });
  for (const record of records) {
    fold.add({ record });
  }
  return fold.finish();
}

/** A `Record<string, number>` off an unknown value, keeping only numeric entries. Pure. */
function numberTally({ value }: { value: unknown }): Record<string, number> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner === "number" && Number.isFinite(inner)) {
      out[key] = inner;
    }
  }
  return out;
}

/** A `Record<string, string[]>` off an unknown value, keeping only string-array entries. Pure. */
function stringListMap({ value }: { value: unknown }): Record<string, readonly string[]> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const out: Record<string, readonly string[]> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (Array.isArray(inner)) {
      out[key] = inner.filter((item): item is string => typeof item === "string");
    }
  }
  return out;
}

/**
 * Decode a stored manifest, or `undefined` when it is not one. Pure.
 *
 * A real decode rather than a cast. The house rule against a double cast earns its keep even here, where the
 * file was written by this same module minutes earlier: a stale manifest from an older layout would otherwise
 * be trusted field-by-field and produce a conservation verdict computed over `undefined`s — a green result
 * that checked nothing, which is exactly the defect class this whole mechanism is aimed at.
 *
 * The version marker went to 2 when origin survival was added, and a version-1 snapshot is REFUSED rather
 * than filled in. Every other missing collection defaults to empty safely, because an absent tally can only
 * make a comparison report more loss than there was; an absent origin tally is the opposite — it reads as
 * "this lane has no local origins", which is the exact false reassurance the field was added to prevent.
 *
 * @param value the parsed JSON value
 * @returns the manifest, or undefined when the version marker is wrong
 */
export function parseCorpusManifest({ value }: { value: unknown }): CorpusManifest | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const fields: Record<string, unknown> = { ...value };
  if (fields["version"] !== 2) {
    return undefined;
  }
  return {
    bySource: numberTally({ value: fields["bySource"] }),
    bySourceKind: numberTally({ value: fields["bySourceKind"] }),
    containersBySource: numberTally({ value: fields["containersBySource"] }),
    curatedEdges: typeof fields["curatedEdges"] === "number" ? fields["curatedEdges"] : 0,
    identitiesBySource: stringListMap({ value: fields["identitiesBySource"] }),
    originsMissingBySource: numberTally({ value: fields["originsMissingBySource"] }),
    originsPresentBySource: numberTally({ value: fields["originsPresentBySource"] }),
    records: typeof fields["records"] === "number" ? fields["records"] : 0,
    version: 2,
  };
}

/** One conservation finding. `lost` is a failure; `grew` is informational. */
export interface ManifestFinding {
  readonly severity: "lost" | "grew";
  readonly message: string;
}

/**
 * Compare two manifests and report what changed, failure-first. Pure.
 *
 * A source that had records and now has NONE is reported first and on its own, because it is the failure this
 * whole mechanism exists for: it is what a rebuild looks like when it wiped the sources it was not rebuilding.
 *
 * @param before the manifest taken before the rebuild
 * @param after the manifest taken after
 * @returns the findings, `lost` ones first
 */
export function compareManifests({
  before,
  after,
}: {
  before: CorpusManifest;
  after: CorpusManifest;
}): readonly ManifestFinding[] {
  const findings: ManifestFinding[] = [
    ...vanishedSources({ after, before }),
    ...lostIdentities({ after, before }),
    ...lostKinds({ after, before }),
    ...shrunkContainers({ after, before }),
    ...lostEdges({ after, before }),
    ...growth({ after, before }),
  ];
  return findings;
}

/** Sources that had records before and have none at all now — the failure this mechanism is for. Pure. */
function vanishedSources({ before, after }: { before: CorpusManifest; after: CorpusManifest }): ManifestFinding[] {
  const findings: ManifestFinding[] = [];
  for (const [source, count] of Object.entries(before.bySource)) {
    if (count > 0 && (after.bySource[source] ?? 0) === 0) {
      findings.push({
        message: `source ${source} is GONE: ${String(count)} record(s) before, none now`,
        severity: "lost",
      });
    }
  }
  return findings;
}

/** Identities present before and absent now, named up to the cap then counted. Pure. */
function lostIdentities({ before, after }: { before: CorpusManifest; after: CorpusManifest }): ManifestFinding[] {
  const findings: ManifestFinding[] = [];
  for (const [source, keys] of Object.entries(before.identitiesBySource)) {
    const present = new Set(absentAsEmpty({ value: after.identitiesBySource[source] }));
    const missing = keys.filter((key) => !present.has(key));
    if (missing.length === 0) {
      continue;
    }
    findings.push({
      message: `source ${source} lost ${String(missing.length)} identity/identities: ${describeMissing({ missing })}`,
      severity: "lost",
    });
  }
  return findings;
}

/**
 * The missing identities, named up to {@link NAMED_LOSS_LIMIT}.
 *
 * The keys carry container and source ids, which for a real corpus means private identifiers — so this is
 * for a LOCAL diagnostic, and a run whose output is going anywhere public wants the counts only. Pure.
 */
function describeMissing({ missing }: { missing: readonly string[] }): string {
  const shown = missing.slice(0, NAMED_LOSS_LIMIT);
  const rest = missing.length - shown.length;
  // The identity key joins its parts with a NUL, which no terminal renders; show it as a readable separator.
  const readable = shown.map((key) => key.replaceAll("\u0000", "/"));
  return rest > 0 ? `${readable.join(", ")} (+${String(rest)} more)` : readable.join(", ");
}

/** `<source>/<kind>` buckets whose count fell. Pure. */
function lostKinds({ before, after }: { before: CorpusManifest; after: CorpusManifest }): ManifestFinding[] {
  const findings: ManifestFinding[] = [];
  for (const [key, count] of Object.entries(before.bySourceKind)) {
    const now = after.bySourceKind[key] ?? 0;
    if (now < count) {
      findings.push({ message: `${key} fell from ${String(count)} to ${String(now)}`, severity: "lost" });
    }
  }
  return findings;
}

/** Sources whose distinct-container count fell — a lost repo, channel or team. Pure. */
function shrunkContainers({ before, after }: { before: CorpusManifest; after: CorpusManifest }): ManifestFinding[] {
  const findings: ManifestFinding[] = [];
  for (const [source, count] of Object.entries(before.containersBySource)) {
    const now = after.containersBySource[source] ?? 0;
    if (now < count) {
      findings.push({
        message: `source ${source} containers fell from ${String(count)} to ${String(now)}`,
        severity: "lost",
      });
    }
  }
  return findings;
}

/** A fallen curated-edge total — the curated graph is one shared artefact, so this is a cross-source signal. */
function lostEdges({ before, after }: { before: CorpusManifest; after: CorpusManifest }): ManifestFinding[] {
  return after.curatedEdges < before.curatedEdges
    ? [
        {
          message: `curated edges fell from ${String(before.curatedEdges)} to ${String(after.curatedEdges)}`,
          severity: "lost",
        },
      ]
    : [];
}

/** What GREW, reported so a rebuild's gain is visible next to its losses rather than inferred. Pure. */
function growth({ before, after }: { before: CorpusManifest; after: CorpusManifest }): ManifestFinding[] {
  const findings: ManifestFinding[] = [];
  for (const [source, count] of Object.entries(after.bySource)) {
    const was = before.bySource[source] ?? 0;
    if (count > was) {
      findings.push({ message: `source ${source} grew from ${String(was)} to ${String(count)}`, severity: "grew" });
    }
  }
  for (const [key, count] of Object.entries(after.bySourceKind)) {
    if (!Object.hasOwn(before.bySourceKind, key)) {
      findings.push({ message: `${key} is NEW: ${String(count)} record(s)`, severity: "grew" });
    }
  }
  return findings;
}

/**
 * Whether a comparison passed — no `lost` finding. Pure.
 *
 * @param findings every finding from the comparison
 * @returns true when nothing was LOST; a finding of any other kind does not fail conservation
 */
export function manifestConserved({ findings }: { findings: readonly ManifestFinding[] }): boolean {
  return !findings.some((finding) => finding.severity === "lost");
}

/**
 * The human summary of a comparison, failures first. Numbers-only except for the identity names, which are
 * withheld when `numbersOnly` is set. Pure.
 *
 * @param findings the comparison findings
 * @param numbersOnly withhold identity names (for output that may be pasted somewhere public)
 * @returns the ordered lines
 */
export function renderManifestComparison({
  findings,
  numbersOnly = false,
}: {
  findings: readonly ManifestFinding[];
  numbersOnly?: boolean;
}): readonly string[] {
  const lost = findings.filter((finding) => finding.severity === "lost");
  const grew = findings.filter((finding) => finding.severity === "grew");
  const scrub = ({ message }: { message: string }): string => {
    const colon = message.indexOf(": ");
    return numbersOnly && colon > 0 ? `${message.slice(0, colon)}: [withheld]` : message;
  };
  return [
    lost.length === 0 ? "conservation: OK (nothing the rebuild did not touch was lost)" : `conservation: FAIL`,
    ...lost.map((finding) => `  LOST  ${scrub({ message: finding.message })}`),
    ...grew.map((finding) => `  grew  ${finding.message}`),
  ];
}
