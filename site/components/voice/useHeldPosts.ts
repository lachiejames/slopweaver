/**
 * The three posts the page makes on the plan call it holds outside a tool call: the owner's nudge, asking the voice to take its
 * turn when the owner's words went unanswered, and the page's own nudge over a promise the voice never started. Each is posted
 * only on the call held when it was asked for, and what it came to is logged only if that call is still the one held
 * when the answer lands.
 */
import { type RefObject, useCallback, useMemo, useRef } from "react";

import type { ActivityInput } from "../../lib/voiceActivity";
import type { ResumeGateObservation } from "../../lib/voiceResumeTrace";
import { stillMine } from "../live/talkSession";
import type { HeldPlanCall } from "./planWiringHeld";
import {
  keepPromiseOnHeld,
  nudgeOnHeld,
  resumeGateLine,
  resumeOnHeld,
  transientResumeRefusal,
} from "./planWiringLines";
import type { ToolLine } from "./voiceContext";

/** The three posts, each fired and forgotten: it logs what it came to itself — and the line a held resume leaves. */
export interface HeldPosts {
  readonly keepPromise: () => void;
  readonly nudge: () => void;
  readonly resumeQuiet: () => void;
  readonly observeResumeGate: (input: { readonly observation: ResumeGateObservation }) => void;
}

/** The posts before the plan call's wiring exists: each sends nothing. */
export const NO_HELD_POSTS: HeldPosts = {
  keepPromise: () => undefined,
  nudge: () => undefined,
  observeResumeGate: () => undefined,
  resumeQuiet: () => undefined,
};

/**
 * The owner's nudge, the quiet resume and the kept promise, bound to the plan call held now.
 *
 * @param planCall the plan call this page holds, `undefined` with none
 * @param generation the current call attempt, so an answer to an older call is never logged on a newer one
 * @param closing the attempt the owner has hung up on, so nothing is posted to it
 * @param offer whether a nudge is on offer now, judged on the live fold rather than the last render
 * @param act feeds the activity fold
 * @param note writes a line in the call's log
 * @returns the nudge, for the owner's press, and the resume and the kept promise, for the activity clock
 */
export function useHeldPosts({
  planCall,
  generation,
  closing,
  offer,
  act,
  note,
}: {
  planCall: RefObject<HeldPlanCall | undefined>;
  generation: RefObject<number>;
  closing: RefObject<number | undefined>;
  offer: () => unknown;
  act: (input: { input: ActivityInput }) => void;
  note: (input: { line: ToolLine }) => void;
}): HeldPosts {
  /**
   * The owner's nudge, once per silence: the server has the voice answer the owner's last words and stops a Codex turn still running.
   * Judged on the live fold, not the last render, so a press after the stall cleared sends nothing.
   */
  const nudge = useCallback(async (): Promise<void> => {
    const held = planCall.current;
    const mine = generation.current;
    if (held === undefined || closing.current === mine || offer() === undefined) {
      return;
    }
    act({ input: { kind: "nudged" } });
    const line = await nudgeOnHeld({ held });
    if (stillMine({ current: generation.current, mine }) && planCall.current === held) {
      note({ line });
    }
  }, [act, closing, generation, note, offer, planCall]);

  /**
   * Asking the voice to take its turn when the owner's words went unanswered (`resumeDueOf`, `site/lib/voiceActivity.ts`):
   * the activity clock decides when to ask, never whether the voice answers (see `RESUME_MS`); this folds it once,
   * before the first await, and only once a held call will take the post, so a silence with no call to answer it is
   * never marked handled. A GPT-Live call has no plan call, so nothing is sent. A refusal from the server still spends
   * the silence, and is logged. Each post is numbered, so a refusal landing after a newer post re-arms nothing.
   */
  const resumePosts = useRef(0);
  const resumeQuiet = useCallback(async (): Promise<void> => {
    const held = planCall.current;
    const mine = generation.current;
    if (held === undefined || closing.current === mine) {
      return;
    }
    resumePosts.current += 1;
    const post = resumePosts.current;
    act({ input: { kind: "resumed", post } });
    const { line, posted } = await resumeOnHeld({ held });
    if (stillMine({ current: generation.current, mine }) && planCall.current === held) {
      note({ line });
      // A refusal a moment clears re-arms this silence, a bounded number of times (`RESUME_RETRIES`).
      if (transientResumeRefusal({ posted })) {
        act({ input: { kind: "resume-refused-transient", post } });
      }
    }
  }, [act, closing, generation, note, planCall]);

  /**
   * A silence of the owner's the resume was held through, written once per gate (`foldResumeTrace`): no post is made, so it
   * needs no held plan call — a silence with no call to answer it is one of the states this line exists to show. Only
   * an attempt the owner has hung up on writes nothing.
   */
  const observeResumeGate = useCallback(
    ({ observation }: { observation: ResumeGateObservation }): void => {
      if (closing.current === generation.current) {
        return;
      }
      note({ line: resumeGateLine({ observation }) });
    },
    [closing, generation, note],
  );

  /**
   * The page's own nudge over a promise the voice made and never started (`promiseDueOf`, `site/lib/voiceOwed.ts`):
   * the activity clock decides the moment and folds it once; this only posts it on the plan call held now and logs what
   * it came to. Never consults the offer — it fires before the owner's own nudge is on offer, which stays there if it fails.
   */
  const keepPromise = useCallback(async (): Promise<void> => {
    const held = planCall.current;
    const mine = generation.current;
    if (held === undefined || closing.current === mine) {
      return;
    }
    const line = await keepPromiseOnHeld({ held });
    if (stillMine({ current: generation.current, mine }) && planCall.current === held) {
      note({ line });
    }
  }, [closing, generation, note, planCall]);
  return useMemo(
    () => ({
      keepPromise: () => {
        void keepPromise();
      },
      nudge: () => {
        void nudge();
      },
      observeResumeGate,
      resumeQuiet: () => {
        void resumeQuiet();
      },
    }),
    [keepPromise, nudge, observeResumeGate, resumeQuiet],
  );
}
