/**
 * The probe sweep `handover list` runs, and the wall-clock budget that bounds it.
 *
 * Split out of `./run.ts` under the file-size ratchet. It is a real seam rather than a
 * size-driven cut: the sweep is what actually costs time on a board print, it is the one piece a caller
 * injects a fake clock into, and it knows nothing about how a board is rendered.
 */
import { commandProbeRunner } from "../../../handover/commandProbe.js";
import { type DocProbeState, type HandoverDoc } from "../../../handover/doc.js";
import {
  aheadFromIndex,
  branchCandidates,
  type RepoAheadIndex,
  repoAheadIndex,
  repoProbeSeams,
} from "../../../handover/evaluate.js";
import { computeState, evaluateProbes, outputProbes } from "../../../handover/probe.js";

/**
 * Evaluate every doc's probes against its own repository.
 *
 * Recomputed on every call, with no cache. That is a deliberate decision rather than an oversight: a cache
 * would hide exactly the drift the board exists to surface, and it would have to be very slow before that
 * risk were worth taking. If it ever IS slow, the answer is to measure and report, not to memoise.
 *
 * @param docs every doc on the board
 * @param base the branch commits are counted against, or `undefined` to resolve each repository's own trunk
 * @param runCommands whether `command:` probes may run — false for a bare `list`
 * @returns probe state per doc PATH, omitting docs that declare no probes or name no repo
 */
export function probeStates({
  docs,
  base,
  runCommands,
  deadline,
  onProgress,
}: {
  docs: readonly HandoverDoc[];
  base: string | undefined;
  runCommands: boolean;
  deadline?: Deadline | undefined;
  onProgress?: ((progress: { resolved: number; total: number }) => void) | undefined;
}): ProbeSweep {
  const states = new Map<string, DocProbeState>();
  const indexes = new Map<string, RepoAheadIndex>();
  const withProbes = docs.filter(
    (doc) => (doc.doneWhen.length > 0 || doc.outputs.length > 0) && doc.repo !== undefined,
  );
  // Every candidate of a repository is known BEFORE its index is built, because a scoped index answers 0 for any
  // candidate it was not asked about (`repoAheadIndex`).
  const candidatesByRepo = probeCandidatesByRepo({ docs: withProbes });
  let unresolved = 0;
  let resolved = 0;
  for (const doc of withProbes) {
    // No repo means nothing to resolve a path against. Recorded as absent rather than evaluated against the
    // process's cwd, which would silently answer about whichever tree the board happened to be printed from.
    const repo = doc.repo;
    if (repo === undefined) {
      continue;
    }
    if (deadline?.expired() === true) {
      // Every remaining doc is counted, never quietly dropped: the caller prints that number as a truncation
      // banner, and a board that is short some rows without saying so is the exact failure this sweep's own
      // deadline exists to prevent.
      unresolved = withProbes.length - resolved;
      break;
    }
    const results = evaluateProbes({
      probes: [...doc.doneWhen, ...outputProbes({ outputs: doc.outputs })],
      seams: repoProbeSeams({
        repo,
        runCommand: runCommands ? commandProbeRunner({ repo }) : undefined,
      }),
    });
    const ahead = aheadFromIndex({
      candidates: branchCandidates({ declaredBranch: doc.branch, recordedBranch: undefined, slug: doc.slug }),
      index: aheadIndexFor({ base, candidates: candidatesByRepo.get(repo), indexes, repo }),
    });
    states.set(doc.path, { commitsAhead: ahead, computed: computeState({ commitsAhead: ahead, results }), results });
    resolved += 1;
    onProgress?.({ resolved, total: withProbes.length });
  }
  return { states, total: withProbes.length, unresolved };
}

/** What one sweep resolved, and what it ran out of time for. */
export interface ProbeSweep {
  readonly states: ReadonlyMap<string, DocProbeState>;
  /** Docs that declare probes AND name a repo — the only ones a sweep does any work for. */
  readonly total: number;
  /** Docs the deadline cut the sweep short of. Zero on a complete sweep. */
  readonly unresolved: number;
}

/** A wall-clock budget, injected as a seam so a test can expire one without a real clock. */
export interface Deadline {
  expired(): boolean;
}

/**
 * A deadline that expires `seconds` from now, or one that never expires when `seconds` is 0.
 *
 * @param seconds the budget, where 0 means unbounded
 * @returns the deadline
 */
export function deadlineIn({ seconds }: { seconds: number }): Deadline {
  if (seconds <= 0) {
    return { expired: () => false };
  }
  const at = Date.now() + seconds * 1000;
  return { expired: () => Date.now() >= at };
}

/**
 * Every branch candidate each repository's docs will look up, unioned per exact `repo:` path, each once.
 *
 * @param docs the docs the sweep evaluates — a doc naming no repository contributes nothing
 * @returns the candidates by repository path
 */
export function probeCandidatesByRepo({
  docs,
}: {
  docs: readonly HandoverDoc[];
}): ReadonlyMap<string, readonly string[]> {
  const byRepo = new Map<string, Set<string>>();
  for (const doc of docs) {
    if (doc.repo === undefined) {
      continue;
    }
    let names = byRepo.get(doc.repo);
    if (names === undefined) {
      names = new Set<string>();
      byRepo.set(doc.repo, names);
    }
    for (const name of branchCandidates({ declaredBranch: doc.branch, recordedBranch: undefined, slug: doc.slug })) {
      names.add(name);
    }
  }
  return new Map([...byRepo].map(([repo, names]) => [repo, [...names]]));
}

/**
 * This repository's ahead index, built at most once per sweep, scoped to the candidates of every doc in it.
 *
 * @param candidates the repository's whole candidate union from {@link probeCandidatesByRepo}; `undefined` walks
 *   every ref, which is only ever slower
 */
function aheadIndexFor({
  repo,
  base,
  candidates,
  indexes,
}: {
  repo: string;
  base: string | undefined;
  candidates: readonly string[] | undefined;
  indexes: Map<string, RepoAheadIndex>;
}): RepoAheadIndex {
  const existing = indexes.get(repo);
  if (existing !== undefined) {
    return existing;
  }
  const built = repoAheadIndex({ base, candidates, repo });
  indexes.set(repo, built);
  return built;
}
