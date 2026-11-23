"use client";

/*
 * The pull request a finding act opened, read through `app/api/act-pull` — the by-branch read `useLive` has no
 * shape for, for `./useThread.ts`'s reason. Nothing here polls: the queue reads each DRAWN act's branch once,
 * one at a time, and a card reads its own branch again when it opens (`../../lib/actPullCache.ts` carries the
 * measurement that moved the read ahead of the opening).
 */

import { useEffect, useState } from "react";

import { actPullCache, drawnActPull, type SettledActPull } from "../../lib/actPullCache";
import { type ActPullState, actPullStateOf } from "../../lib/actPullVerb";
import { liveQuietHeld } from "../live/useLive";

/** One branch's lookup through the route, settled either way — a thrown fetch is a `not-measured` answer. */
const fetchActPull: (branch: string) => Promise<SettledActPull> = async (branch) => {
  try {
    const response = await fetch(`/api/act-pull?${new URLSearchParams({ branch }).toString()}`, {
      cache: "no-store",
    });
    const state = actPullStateOf({ body: await response.json(), branch });
    if (state.phase === "idle" || state.phase === "loading") {
      return { branch, phase: "not-measured", why: `the route answered a ${state.phase} state` };
    }
    return state;
  } catch (cause: unknown) {
    return { branch, phase: "not-measured", why: cause instanceof Error ? cause.message : String(cause) };
  }
};

/** The page's lookups: every card and the prefetch share one answer per branch and one read in flight. */
const lookups = actPullCache({ lookup: fetchActPull });

/**
 * Look up the pull requests opened from one branch, or nothing when there is no branch to look up.
 *
 * Opening reads the branch again, riding a prefetch already in flight. Until that read settles the card draws the
 * last ready answer the page holds for the branch, else `loading`. Only an answer this card's own read settled is
 * state, cleared when the branch changes, so A, then B, then A again never reads the first A answer as the card's.
 *
 * @param branch the branch `actPullLookupBranch` (`../../lib/queueActRow.ts`) chose, or `undefined`
 * @returns the lookup as it stands
 */
export function useActPull({ branch }: { branch: string | undefined }): ActPullState {
  const [settled, setSettled] = useState<SettledActPull | undefined>(undefined);
  useEffect(() => {
    if (branch === undefined) {
      return undefined;
    }
    let live = true;
    const settle = async (): Promise<void> => {
      const answer = await lookups.read(branch);
      if (live) {
        setSettled(answer);
      }
    };
    void settle();
    return () => {
      live = false;
      setSettled(undefined);
    };
  }, [branch]);
  if (branch === undefined) {
    return { phase: "idle" };
  }
  const kept = lookups.kept(branch);
  if (settled?.branch === branch) {
    // A re-read that failed over an answer the page holds draws that answer, marked stale with the failure's reason.
    return drawnActPull({ answer: settled, kept });
  }
  if (kept !== undefined) {
    return kept;
  }
  return { branch, phase: "loading" };
}

/**
 * Read one branch as a card opened on it draws it once its own read settles — riding a read already in flight — so
 * the voice reads an Alignment act as the page draws it (`./AlignmentAct.tsx`).
 *
 * @param branch the branch `actPullLookupBranch` (`../../lib/queueActRow.ts`) chose
 * @returns the lookup the card draws, settled
 */
export async function readActPull({ branch }: { branch: string }): Promise<ActPullState> {
  const answer = await lookups.read(branch);
  return drawnActPull({ answer, kept: lookups.kept(branch) });
}

/**
 * Read the drawn acts' lookups ahead of any opening, one at a time, so a card opened on one draws at once.
 *
 * One page-wide walk, one lookup at a time (`ActPullCache.prefetch`), because each lookup is a search and up to five summaries, and the page shares the machine with
 * the registers' own reads. Nothing is read while a voice call holds the page quiet, and nothing is re-read: a
 * branch already answered or in flight is skipped, and a changed set of drawn acts reads only what is new. The
 * trade, named: a lookup skipped for a call is read when its card opens, at the old cost.
 *
 * @param branches the drawn acts' lookup branches, `undefined` for an act with none
 */
export function useActPullPrefetch({ branches }: { branches: readonly (string | undefined)[] }): void {
  // A string, so a fresh array of the same branches every poll does not restart the walk.
  const wanted = [...new Set(branches.filter((branch) => branch !== undefined))].join("\n");
  useEffect(() => {
    if (wanted === "") {
      return undefined;
    }
    lookups.prefetch({ branches: wanted.split("\n"), paused: liveQuietHeld });
    return () => {
      // The walk finishes the read in hand and reads nothing after it.
      lookups.prefetch({ branches: [], paused: liveQuietHeld });
    };
  }, [wanted]);
}
