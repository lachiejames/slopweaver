/**
 * The derive PIPELINE — read bronze, resolve identities, synthesise silver, write it, stamp it.
 *
 * It lives here rather than inside the CLI verb because `derive` now has two callers, not one: the verb, and
 * any consumer whose freshness check chose JIT refresh (see `./freshness.ts`). A consumer that had to shell
 * out to the verb would be starting a process to do something the same process can do, and a consumer that
 * re-implemented the steps would be a second derive that drifts from the first.
 *
 * The stamp is written in {@link writeSilverArtifacts}, in the same step as the artefacts and from the
 * observation taken BEFORE they were read. Both halves are deliberate: a stamp written separately could
 * describe a derive that did not finish, and an observation taken afterwards would record any ingest that
 * landed DURING the derive as though this derive had seen it.
 */

import { join } from "node:path";
import { guardHeap, type HeapGuard } from "#lib/heapBudget.js";
import { readCorpusDir } from "../../corpus/corpusDirRead.js";
import {
  silverIdentitiesPath,
  silverIndexDir,
  silverPeoplePath,
  silverStructuresPath,
} from "../../corpus/corpusPaths.js";
import { resolveCorpusDir } from "../../corpus/corpusResolve.js";
import { latestRecords, supersededCount } from "../../corpus/latestRecords.js";
import { memberIdentityCandidates } from "../../corpus/members/project.js";
import { readAllMembers } from "../../corpus/members/store.js";
import type { MemberBronzeRow } from "../../corpus/members/types.js";
import { readAllStructures } from "../../corpus/structures/store.js";
import { excludeFromSync, loadSyncExclusion } from "../../corpus/syncExclusion.js";
import type { CorpusRecord } from "../../corpus/types.js";
import { writeJsonFile } from "../../lib/jsonFile.js";
import { err, ok, type Result } from "../../lib/result.js";
import { deriveSilver, type SilverArtifacts } from "../deriveSilver.js";
import { buildIdentityMap, type IdentityMap, type IdentityRecord, type IdentityResolution } from "../identity.js";
import type { IdentityRosterSnapshot } from "../identityRoster.js";
import { buildPersonDossiers } from "../personDossier.js";
import { resolveFromRecords } from "../personResolver.js";
import type { ArtefactWitness, FreshnessObservation } from "./freshness.js";
import {
  freshnessStampPath,
  observeCorpus,
  observeSources,
  readArtefactWitness,
  writeFreshnessStamp,
} from "./stamp.js";
import { synthesisHeapProjection, synthesisHeapRefusal } from "./synthesisHeap.js";

/** One watchable step of the pipeline, reported as it starts or finishes. */
export interface DerivePhaseEvent {
  readonly phase: "read-corpus" | "resolve-identities" | "build-directory" | "build-graphs";
  readonly done?: number;
  readonly total?: number;
  readonly metrics?: Readonly<Record<string, number>>;
}

/** Everything one derive produced, plus what it was derived FROM. */
export interface DerivePipelineResult {
  readonly artifacts: SilverArtifacts;
  readonly identityMap: IdentityMap;
  readonly resolution: IdentityResolution;
  readonly memberRows: readonly MemberBronzeRow[];
  readonly records: readonly CorpusRecord[];
  /** How many superseded record versions the logical-latest collapse hid. */
  readonly hiddenSuperseded: number;
  /** Non-fatal reader warnings, in the order they were produced. */
  readonly warnings: readonly string[];
  /** The source witness taken before anything was read — what {@link writeSilverArtifacts} stamps. */
  readonly observation: FreshnessObservation;
  /** When that witness was taken, read just before it — so a send can tell whether this derive saw its ask. */
  readonly observedAtIso: string;
}

/** Resolve + read the corpus, collapsing every entity to its logical-latest version. */
function readLatest({
  home,
  corpus,
}: {
  home: string;
  corpus?: string;
}): Result<{ records: readonly CorpusRecord[]; hidden: number; warnings: readonly string[] }> {
  const dir = resolveCorpusDir({ home, ...(corpus !== undefined ? { corpus } : {}) });
  if (dir.isErr()) {
    return err([dir.error.message]);
  }
  // The `derive` projection, not `bronze`: silver reads neither the record bodies nor the opaque `raw`
  // payload wholesale, and those are 80.8% of bronze's bytes. Loading them is what made this verb refuse at
  // the heap ceiling on every refresh once the corpus passed 8 GB. See `corpusStore.CorpusProjection`.
  const read = readCorpusDir({ dir: dir.value, home, projection: "derive" });
  if (read.isErr()) {
    return err([read.error.message]);
  }
  // REFUSE on an unreadable file rather than derive from what happened to be readable. Every artefact
  // downstream of here — the directory, the cross-ref graph, the roster — is written to disk and read back
  // as fact by later runs, so a silently partial input becomes a durable wrong answer with nothing on it to
  // say so. A corrupt LINE still only warns: that loss is bounded and counted.
  if (read.value.unreadable.length > 0) {
    return err([
      `refusing to derive: ${String(read.value.unreadable.length)} corpus path(s) could not be read, and silver artefacts built from a partial corpus read as complete — ${read.value.unreadable.join(", ")}`,
    ]);
  }
  // The install's author denylist applies to silver exactly as it applies to the lexical index: a directory,
  // a cross-ref graph and an opportunity list built over a million monitor alerts describe a workspace whose
  // busiest correspondent is a robot. A load failure refuses rather than deriving with the denylist off.
  const exclusion = loadSyncExclusion({ home });
  if (exclusion.isErr()) {
    return err(exclusion.error);
  }
  const admitted = excludeFromSync({ exclusion: exclusion.value, records: read.value.records });
  const stored = admitted.kept;
  const records = latestRecords({ records: stored });
  return ok({
    hidden: supersededCount({ collapsed: records, records: stored }),
    records,
    warnings: read.value.warnings,
  });
}

/** The resolve-identities step: link every source's identities into people, reporting before and after. */
function resolveIdentitiesPhase({
  records,
  memberRows,
  roster,
  onPhase,
}: {
  records: readonly CorpusRecord[];
  memberRows: readonly MemberBronzeRow[];
  roster: readonly IdentityRecord[];
  onPhase?: (event: DerivePhaseEvent) => void;
}): IdentityResolution {
  onPhase?.({ done: 0, phase: "resolve-identities", total: records.length });
  const resolution = resolveFromRecords({
    extraCandidates: memberIdentityCandidates({ rows: memberRows }),
    records,
    roster,
  });
  onPhase?.({
    done: resolution.people.length,
    metrics: {
      conflicts: resolution.conflicts.length,
      held: resolution.candidates.length,
      linked: resolution.people.filter((person) => person.confidence !== "single-source").length,
      members: memberRows.length,
    },
    phase: "resolve-identities",
    total: records.length,
  });
  return resolution;
}

/** The source witness a derive stamps, taken BEFORE anything is read (see the file header). */
function observeInputs({
  home,
  corpus,
  rosterRevision,
}: {
  home: string;
  corpus?: string;
  rosterRevision: number | null;
}): FreshnessObservation {
  return {
    ...observeSources({ home, rosterRevision }),
    corpus: observeCorpus({ home, ...(corpus !== undefined ? { corpus } : {}) }),
  };
}

/**
 * Run the whole deterministic synthesis over one home. No network, no model — bounded local compute.
 *
 * @param home the Slopweaver home
 * @param corpus an explicit bronze directory, when the caller overrides the home's own
 * @param roster the identity roster snapshot the caller read ONCE: its records resolve people and its revision
 *   is what the stamp witnesses, so the two can never come from different reads
 * @param onPhase a watcher for each step, for a caller that renders progress
 * @param heapGuard what judges whether the synthesis fits under the ceiling — the real isolate's unless a test
 *   passes a plain fake
 * @returns the artefacts plus the observation to stamp them with, or the reason the corpus could not be read
 *   or the synthesis could not fit
 */
export function runDerivePipeline({
  home,
  corpus,
  roster: { records: roster, revision: rosterRevision },
  onPhase,
  heapGuard = guardHeap,
}: {
  home: string;
  corpus?: string;
  roster: IdentityRosterSnapshot;
  onPhase?: (event: DerivePhaseEvent) => void;
  heapGuard?: HeapGuard;
}): Result<DerivePipelineResult> {
  const observedAtIso = new Date().toISOString();
  const corpusOverride = corpus !== undefined ? { corpus } : {};
  const observation = observeInputs({ home, rosterRevision, ...corpusOverride });
  const read = readLatest({ home, ...corpusOverride });
  if (read.isErr()) {
    return err(read.error);
  }
  const { records, hidden } = read.value;
  const members = readAllMembers({ home });
  const structures = readAllStructures({ home });
  onPhase?.({ done: records.length, phase: "read-corpus" });
  const resolution = resolveIdentitiesPhase({
    memberRows: members.rows,
    records,
    roster,
    ...(onPhase ? { onPhase } : {}),
  });

  // REFUSE before the synthesis rather than die inside it: the read above is guarded, `deriveSilver` is not,
  // and it is the step that ran out of heap (`./synthesisHeap.ts` carries the measurement).
  const synthesis = heapGuard({ projectedBytes: synthesisHeapProjection({ recordCount: records.length }) });
  if (!synthesis.fits) {
    return err([synthesisHeapRefusal({ recordCount: records.length, shortfall: synthesis })]);
  }
  onPhase?.({ phase: "build-directory" });
  const identityMap = buildIdentityMap({ records: roster });
  const artifacts = deriveSilver({
    identityMap,
    memberRows: members.rows,
    records,
    resolution,
    structureRows: structures.rows,
  });
  onPhase?.({ metrics: { edges: artifacts.graph.edges.length }, phase: "build-graphs" });
  return ok({
    artifacts,
    hiddenSuperseded: hidden,
    identityMap,
    memberRows: members.rows,
    observation,
    observedAtIso,
    records,
    resolution,
    warnings: [...read.value.warnings, ...members.warnings, ...structures.warnings],
  });
}

/**
 * Every file {@link writeSilverArtifacts} writes, the freshness stamp included — the ONE list the writer and
 * a refresh deciding whether silver is complete both read, so the two cannot disagree about what "all of it"
 * means.
 *
 * @param home the Slopweaver home
 * @returns each artefact's absolute path, by name
 */
export function silverArtefactPaths({ home }: { home: string }): {
  readonly directory: string;
  readonly opportunities: string;
  readonly identities: string;
  readonly people: string;
  readonly structures: string;
  readonly stamp: string;
} {
  const indexDir = silverIndexDir({ home });
  return {
    directory: join(indexDir, "directory.json"),
    identities: silverIdentitiesPath({ home }),
    opportunities: join(indexDir, "opportunities.json"),
    people: silverPeoplePath({ home }),
    stamp: freshnessStampPath({ home }),
    structures: silverStructuresPath({ home }),
  };
}

/**
 * The write-to-disk shape of the resolution — drops the derived `index` (a rebuildable lookup) and persists
 * the KINDED people, so the audit can count bots/integrations exactly instead of guessing from a login suffix.
 */
function serialisableResolution({
  artifacts,
  observedAtIso,
}: {
  artifacts: SilverArtifacts;
  observedAtIso: string;
}): unknown {
  const { candidates, conflicts } = artifacts.identities;
  // The same instant the stamp records, so a reader can tell whether the roster and the stamp beside it came
  // from ONE derive — two running at once each write both files, and their writes can interleave.
  return { candidates, conflicts, observedAtIso, people: artifacts.kindedPeople };
}

/**
 * Write the silver artefacts AND the freshness stamp that says what they were built from.
 *
 * ## NOTHING under `silver/graph/` is written here any more, and its absence is the point
 *
 * Both graphs are consumed IN PROCESS by the `derive` that computes them — `artifacts.graph` feeds the
 * opportunity detectors and the directory, and `artifacts.curated`'s capped-edge count is reported by the
 * verb — before this function is reached. The 282 MiB `silver/graph/graph.json` and the 3.6 MiB
 * `silver/graph/curated.json` it used to dump beside them had no reader anywhere: not in `src`, not in
 * `docs`, not in `skills`.
 *
 * Dumping it cost more than the disk. Measured on the owner's corpus (1,046,923 edges),
 * `writeJsonFile` took 3,982 MiB of RSS to write that one file, because `JSON.stringify(value, null, 2)`
 * builds a 295,737,335-character string, the trailing-newline concat copies it, and `Buffer.from` copies it
 * again. That was the entire difference between a writing `derive` (5,701 MiB) and a `--dry-run` one
 * (3,184 MiB), and the 1.1 GiB swing between identical runs was collector timing over the same transient.
 *
 * It was also 55% of the way into V8's 536,870,888-character maximum string length — the wall that stopped
 * `slopweaver compact` against the 5.9 GiB Slack window, on an append-only corpus that only grows.
 *
 * The rule: that massive chunk of junk on disk slows everything down, takes up space and provides no value, so
 * it is deleted. Deleted rather than streamed, so nothing rebuilds it.
 *
 * `curated.json` went the same way on the owner's explicit word rather than by inference. It had the identical no-reader status and was deliberately LEFT standing at the
 * time, named here rather than removed in passing, because the earlier ruling was about the massive dump
 * and widening it silently would have been a decision nobody made. 3,810,381 bytes freed on the owner's
 * home; the directory itself is gone, so `silverGraphDir` went with it.
 *
 * @param home the Slopweaver home
 * @param result what {@link runDerivePipeline} produced
 * @param derivedAtIso when this derive ran
 * @returns the stamp path, so a caller can name it
 */
export function writeSilverArtifacts({
  home,
  result,
  derivedAtIso,
}: {
  home: string;
  result: DerivePipelineResult;
  derivedAtIso: string;
}): string {
  const { artifacts, memberRows } = result;
  const paths = silverArtefactPaths({ home });
  // Each file is stat'd the moment it lands, so the stamp records exactly what THIS derive wrote and refresh's
  // skip can tell a file another derive wrote afterwards. One that cannot be stat'd is left out, which reads
  // as unpaired: a rebuild, never a vouch.
  const written: Record<string, ArtefactWitness> = {};
  const write = ({ path, value }: { path: string; value: unknown }): void => {
    writeJsonFile({ path, value });
    const witness = readArtefactWitness({ path });
    if (witness !== undefined) {
      written[path] = witness;
    }
  };
  write({ path: paths.directory, value: artifacts.directory });
  write({ path: paths.opportunities, value: artifacts.opportunities });
  write({ path: paths.identities, value: serialisableResolution({ artifacts, observedAtIso: result.observedAtIso }) });
  write({
    path: paths.people,
    value: { people: buildPersonDossiers({ memberRows, people: artifacts.identities.people }) },
  });
  write({ path: paths.structures, value: artifacts.structures });
  return writeFreshnessStamp({
    artefacts: written,
    derivedAtIso,
    home,
    observation: result.observation,
    observedAtIso: result.observedAtIso,
  });
}
