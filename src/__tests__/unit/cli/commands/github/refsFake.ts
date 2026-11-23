/**
 * A plain in-memory remote for the two ref verbs' run tests: branches and tags held in maps, every call
 * appended to `calls` in order, and a per-step failure or state change injectable by name. Not a mock — the
 * verbs read and write it through the same `GithubRefsApi` seam production uses.
 */
import { errAsync, okAsync } from "neverthrow";

import type { IngestError } from "../../../../../lib/ingestError.js";
import type { GithubRefsApi } from "../../../../../outbound/github/refs.js";

/** The remote's state, mutated by the fake's writes. */
export interface FakeRemote {
  readonly defaultBranch: string;
  readonly branches: Map<string, string>;
  readonly tags: Map<string, string>;
  readonly commits: Set<string>;
  readonly openPrs: Map<string, readonly number[]>;
  readonly calls: string[];
  /** Calls, by `method:arg`, that fail with a provider error instead of acting. */
  readonly failing: Set<string>;
  /** Calls, by `method:arg`, that fail only once the fake has performed a write — a read-back that errors. */
  readonly failingAfterWrite: Set<string>;
  /** Writes, by `method:arg`, that LAND and then answer with a failure — a response lost after the commit. */
  readonly lostAnswer: Set<string>;
  /** Runs after the Nth `branchTip` read (1-based), to model a writer racing the verb. */
  readonly afterTipRead: Map<number, () => void>;
  /** Runs just before the atomic write checks its preconditions, to model a push racing the write itself. */
  beforeAtomicWrite: (() => void) | undefined;
  /** Runs once a write has LANDED, before it answers — a writer or an access change right after it. */
  afterAcceptedWrite: (() => void) | undefined;
  /** The caller lost access: GitHub answers every ref read 404 (absent) and fails the repository read and every write. */
  accessLost: boolean;
}

/**
 * A fresh remote with one default branch.
 *
 * @returns an empty remote whose default branch is `main`
 */
export function fakeRemote(): FakeRemote {
  return {
    accessLost: false,
    afterAcceptedWrite: undefined,
    afterTipRead: new Map(),
    beforeAtomicWrite: undefined,
    branches: new Map([["main", "m".repeat(40)]]),
    calls: [],
    commits: new Set(["m".repeat(40)]),
    defaultBranch: "main",
    failing: new Set(),
    failingAfterWrite: new Set(),
    lostAnswer: new Set(),
    openPrs: new Map(),
    tags: new Map(),
  };
}

function providerError({ operation }: { operation: string }): IngestError {
  return { kind: "http", message: `${operation} answered 500`, operation, status: 500 };
}

/** The fake's shared call log and write flag — a failure listed "after write" fires only once one landed. */
interface FakeState {
  readonly fails: (args: { key: string }) => boolean;
  written: boolean;
}

/** The annotation object sha every annotated create in the fake answers with. */
export const FAKE_ANNOTATION = "f".repeat(40);

/** A tag create that lands, then answers — or loses its answer when listed in `lostAnswer`. */
function fakeCreateTag({ remote, state }: { remote: FakeRemote; state: FakeState }): GithubRefsApi["createTag"] {
  return ({ tag, sha, message }) => {
    if (state.fails({ key: `createTag:${tag}` })) {
      return errAsync(providerError({ operation: "github.git.createRef" }));
    }
    remote.tags.set(tag, sha);
    state.written = true;
    remote.afterAcceptedWrite?.();
    if (remote.lostAnswer.has(`createTag:${tag}`)) {
      return errAsync(providerError({ operation: "github.git.createRef" }));
    }
    return okAsync(message === undefined ? undefined : FAKE_ANNOTATION);
  };
}

/** Compare-and-swap, as GitHub's updateRefs applies it: every precondition holds or nothing changes. */
function fakeDeleteBranchAtTip({
  remote,
  state,
}: {
  remote: FakeRemote;
  state: FakeState;
}): GithubRefsApi["deleteBranchAtTip"] {
  const { fails } = state;
  return ({ branch, tip, createTag, holdTag }) => {
    if (fails({ key: `deleteBranchAtTip:${branch}` })) {
      return errAsync(providerError({ operation: "github.graphql.updateRefs" }));
    }
    remote.beforeAtomicWrite?.();
    if (remote.accessLost) {
      return errAsync(providerError({ operation: "github.repos.get" }));
    }
    const tagTaken = createTag !== undefined && remote.tags.has(createTag);
    const tagLost = holdTag !== undefined && remote.tags.get(holdTag) !== tip;
    if (remote.branches.get(branch) !== tip || tagTaken || tagLost) {
      return errAsync(providerError({ operation: "github.graphql.updateRefs" }));
    }
    if (createTag !== undefined) {
      remote.tags.set(createTag, tip);
    }
    remote.branches.delete(branch);
    state.written = true;
    remote.afterAcceptedWrite?.();
    if (remote.lostAnswer.has(`deleteBranchAtTip:${branch}`)) {
      return errAsync(providerError({ operation: "github.graphql.updateRefs" }));
    }
    return okAsync(undefined);
  };
}

/**
 * The ref surface over a fake remote.
 *
 * @param remote the state it reads and mutates
 * @returns a `GithubRefsApi` that records every call
 */
export function fakeRefsApi({ remote }: { remote: FakeRemote }): GithubRefsApi {
  let tipReads = 0;
  const state: FakeState = {
    fails: ({ key }) => {
      remote.calls.push(key);
      return remote.failing.has(key) || (state.written && remote.failingAfterWrite.has(key));
    },
    written: false,
  };
  const { fails } = state;
  return {
    branchTip: ({ branch }) => {
      if (fails({ key: `branchTip:${branch}` })) {
        return errAsync(providerError({ operation: "github.git.getRef" }));
      }
      const tip = remote.accessLost ? undefined : remote.branches.get(branch);
      tipReads += 1;
      remote.afterTipRead.get(tipReads)?.();
      return okAsync(tip);
    },
    commitExists: ({ sha }) => {
      if (fails({ key: `commitExists:${sha}` })) {
        return errAsync(providerError({ operation: "github.git.getCommit" }));
      }
      return okAsync(remote.commits.has(sha));
    },
    createTag: fakeCreateTag({ remote, state }),
    deleteBranchAtTip: fakeDeleteBranchAtTip({ remote, state }),
    defaultBranch: () => {
      remote.calls.push("defaultBranch");
      if (remote.accessLost) {
        return errAsync(providerError({ operation: "github.repos.get" }));
      }
      return okAsync(remote.defaultBranch);
    },
    openPrsOnBranch: ({ branch }) => {
      remote.calls.push(`openPrsOnBranch:${branch}`);
      const open = remote.openPrs.get(branch);
      if (open === undefined) {
        return okAsync([]);
      }
      return okAsync(open);
    },
    tagCommit: ({ tag }) => {
      if (fails({ key: `tagCommit:${tag}` })) {
        return errAsync(providerError({ operation: "github.git.getRef" }));
      }
      return okAsync(remote.accessLost ? undefined : remote.tags.get(tag));
    },
  };
}
