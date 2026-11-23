"use client";

/**
 * The one way a candidate card presses: a short run of act rows in order — a definition of done before the word it
 * goes with — stopping at the first that does not come back done, then a re-read of the candidates and, when the
 * run may have added or changed a tile, the register below. Every row is `site/lib/actVerbs.ts`'s; nothing here
 * assembles an argv.
 */
import { useCallback, useState } from "react";

import type { PagePress } from "../../lib/workstreamCandidatesPage";
import { CANDIDATES_SLUG } from "../../lib/workstreamCandidatesTypes";
import { type PressState, pressOnce } from "../console/press";
import { refreshLive } from "./useLive";

/**
 * Press a run of act rows in order and report the last one that ran.
 *
 * @returns the state of the run and the function that starts one
 */
export function useCandidatePress(): {
  readonly state: PressState;
  readonly run: (args: { presses: readonly (PagePress | null)[]; tiles: boolean }) => void;
} {
  const [state, setState] = useState<PressState>({ phase: "idle" });
  const run = useCallback(({ presses, tiles }: { presses: readonly (PagePress | null)[]; tiles: boolean }): void => {
    void (async () => {
      setState({ phase: "sending" });
      let last: PressState = { phase: "idle" };
      for (const one of presses) {
        if (one === null) {
          continue;
        }
        last = await pressOnce({ slots: { ...one.slots }, slug: one.slug });
        if (last.phase !== "done") {
          break;
        }
      }
      setState(last);
      // Either way both are re-read: a done run moved them, and an unknown one may have.
      refreshLive({ slug: CANDIDATES_SLUG });
      if (tiles) {
        refreshLive({ slug: "workstreams" });
      }
    })();
  }, []);
  return { run, state };
}
