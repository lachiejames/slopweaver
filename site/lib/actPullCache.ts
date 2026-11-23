/**
 * The by-branch pull-request lookups the queue has already answered, kept for the page's life — pure over an
 * injected read, so the dedupe and the keep rule are unit tests.
 *
 * MEASURED: a finding act's lookup is two verbs in series — `github search "is:pr head:<branch>"`
 * (6.6 s) and then `github pr summary <url>` per candidate (5.9 s, run together) — so a card read it on opening
 * waited 12.5 s. Reproduce each with `time SLOPWEAVER_LAUNCHER_QUIET=1 slopweaver github search "is:pr
 * head:<branch>" --json` and `… github pr summary <url> --json`. The queue now reads the lookups of the acts it
 * DRAWS ahead of any opening (`useActPullPrefetch`, `../components/console/useActPull.ts`), one at a time, and a card opened
 * on a branch already answered draws that answer at once while it reads the branch again.
 *
 * Only a `ready` answer is kept, and a lookup that failed keeps the ready answer before it rather than dropping it:
 * the card draws that answer marked stale with the failure's reason (`../components/console/useActPull.ts`). A
 * failure is never kept, so a card never opens on a stale failure — it reads the branch again.
 */

import type { ActPullState } from "./actPullVerb";

/** A settled answer: never idle, never loading. */
export type SettledActPull = Exclude<ActPullState, { readonly phase: "idle" } | { readonly phase: "loading" }>;

/** The cache and its one read, shared by every card and the prefetch on the page. */
export interface ActPullCache {
  /**
   * The answer kept for a branch, if a lookup of it has ever come back ready.
   *
   * @returns the kept answer, or `undefined`
   */
  readonly kept: (branch: string) => SettledActPull | undefined;
  /**
   * Read a branch, riding a read of it already in flight rather than starting a second.
   *
   * @returns the settled answer
   */
  readonly read: (branch: string) => Promise<SettledActPull>;
  /**
   * Whether a read of a branch is in flight now.
   *
   * @returns true while one is
   */
  readonly reading: (branch: string) => boolean;
  /**
   * Ask the page's ONE prefetch walk to read these branches, replacing whatever it was asked before. The walk
   * reads one branch at a time, skips any answered or in flight, re-asks `paused` before each read and stops when
   * nothing is left; an ask while it walks changes what it reads next and never starts a second walk.
   *
   * @returns nothing
   */
  readonly prefetch: (ask: { readonly branches: readonly string[]; readonly paused: () => boolean }) => void;
}

/**
 * What a card draws once its own read of a branch settles: that answer, or — when the read failed over a ready answer
 * the page already holds — that ready answer marked stale with the failure's reason.
 *
 * @param answer what the card's own read settled to
 * @param kept the page's last ready answer for the branch, if it holds one
 * @returns the lookup the card draws
 */
export function drawnActPull({
  answer,
  kept,
}: {
  answer: SettledActPull;
  kept: SettledActPull | undefined;
}): ActPullState {
  if (answer.phase === "not-measured" && kept?.phase === "ready") {
    return { ...kept, stale: { why: answer.why } };
  }
  return answer;
}

/**
 * A cache over one read. The read must settle rather than reject: a failure is a `not-measured` answer.
 *
 * @param lookup reads one branch's pull requests through the route
 * @returns the cache
 */
export function actPullCache({ lookup }: { lookup: (branch: string) => Promise<SettledActPull> }): ActPullCache {
  const answers = new Map<string, SettledActPull>();
  const inFlight = new Map<string, Promise<SettledActPull>>();
  const read: ActPullCache["read"] = (branch) => {
    const riding = inFlight.get(branch);
    if (riding !== undefined) {
      return riding;
    }
    const started = lookup(branch).then((answer) => {
      inFlight.delete(branch);
      if (answer.phase === "ready") {
        answers.set(branch, answer);
      }
      return answer;
    });
    inFlight.set(branch, started);
    return started;
  };
  const known: Pick<ActPullCache, "kept" | "reading"> = {
    kept: (branch) => answers.get(branch),
    reading: (branch) => inFlight.has(branch),
  };
  // One walk for the page, so a changed ask while a read is pending redirects it rather than starting another
  // beside it (two effects' walks overlapped when the drawn set changed mid-read).
  let asked: { readonly branches: readonly string[]; readonly paused: () => boolean } = {
    branches: [],
    paused: () => false,
  };
  let walking = false;
  // Every branch the walk has read, whatever came back: a failed lookup keeps no answer, so without this the walk
  // would read it again at once, forever. Its card still reads it when it opens.
  const walked = new Set<string>();
  const walk = async (): Promise<void> => {
    walking = true;
    try {
      for (;;) {
        const next = branchesToPrefetch({ branches: asked.branches, cache: known }).find((one) => !walked.has(one));
        if (next === undefined || asked.paused()) {
          return;
        }
        walked.add(next);
        await read(next);
      }
    } finally {
      walking = false;
    }
  };
  const prefetch: ActPullCache["prefetch"] = (ask) => {
    asked = ask;
    if (!walking) {
      void walk();
    }
  };
  return { ...known, prefetch, read };
}

/**
 * The branches a prefetch reads next: each drawn act's branch once, in drawn order, skipping any already answered
 * or in flight.
 *
 * @param branches the drawn acts' lookup branches, `undefined` for an act with none
 * @param cache the page's cache
 * @returns the branches to read
 */
export function branchesToPrefetch({
  branches,
  cache,
}: {
  branches: readonly (string | undefined)[];
  cache: Pick<ActPullCache, "kept" | "reading">;
}): readonly string[] {
  const out: string[] = [];
  for (const branch of branches) {
    if (branch === undefined || out.includes(branch)) {
      continue;
    }
    if (cache.kept(branch) !== undefined || cache.reading(branch)) {
      continue;
    }
    out.push(branch);
  }
  return out;
}
