/**
 * The posting half of one call's voice-record watcher: each grounding posted to whichever plan call the page holds,
 * retried, and written down once kept or given up, with the routes and the timer the watcher runs on. Split from
 * `voiceRecordWiring.ts` to keep it under the line cap.
 */
import { claimGroundingPlanCall, countGroundingPlanCall, type PlanPost, spokenRecordPlanCall } from "./planCallClient";
import type { HeldPlanCall } from "./planWiringHeld";
import { afterWhileLive } from "./sendWatchWiring";

/** The wait before a grounding whose post was lost, or that found no plan call, is posted again. */
export const GROUNDING_RETRY_MS = 1_500;

/**
 * How many times one grounding is posted before it is written down unkept. The route answers from memory and refuses
 * only an ended call, so a retry is for a post lost on the wire or the gap around a plan call's hand-over.
 */
export const GROUNDING_TRIES = 4;

/** The seams one watcher runs on; the real routes and timers unless a test passes its own. */
export interface VoiceRecordSeams {
  readonly countGrounding: typeof countGroundingPlanCall;
  readonly claimGrounding: typeof claimGroundingPlanCall;
  readonly record: typeof spokenRecordPlanCall;
  /** Run `run` after `ms` while `live` holds; returns its cancel. */
  readonly after: (input: { ms: number; run: () => void; live: () => boolean }) => () => void;
}

/** The real seams: the three routes, and a wait that ends itself with its call. */
export const REAL_VOICE_RECORD_SEAMS: VoiceRecordSeams = {
  after: ({ ms, run, live }) =>
    afterWhileLive({
      every: ({ ms: tickMs, tick }) => {
        const timer = setInterval(tick, tickMs);
        return () => {
          clearInterval(timer);
        };
      },
      live,
      ms,
      nowMs: () => Date.now(),
      run,
    }),
  claimGrounding: claimGroundingPlanCall,
  countGrounding: countGroundingPlanCall,
  record: spokenRecordPlanCall,
};

/** How one grounding ended: kept by the server, or given up and why. */
type GroundingSettled = { readonly kind: "recorded" } | { readonly kind: "not-recorded"; readonly why: string };

/** One grounding still being posted: how to post it, and what to write once it is kept or given up. */
interface OwedGrounding {
  readonly post: (input: { callId: string }) => Promise<PlanPost>;
  readonly settled: (input: { outcome: GroundingSettled }) => void;
}

/**
 * The posting half of one call's watcher: each grounding is posted to whichever plan call the page holds as it goes,
 * and written down once kept, refused, or past {@link GROUNDING_TRIES}. Posts run side by side — the route keeps each
 * once under its key and holds no floor — and the call's end writes down every one still unkept.
 *
 * @param held the plan call the page holds now
 * @param current whether the session this watcher was made for is still the live one
 * @param after the timer a retry waits on
 * @returns `owe`, which posts one, and `end`, which writes down what is still unkept
 */
export function groundingPoster({
  held,
  current,
  after,
}: {
  held: () => HeldPlanCall | undefined;
  current: () => boolean;
  after: VoiceRecordSeams["after"];
}): { owe: (input: { owed: OwedGrounding }) => void; end: () => void } {
  const unkept = new Set<OwedGrounding>();
  const settle = ({ owed, outcome }: { owed: OwedGrounding; outcome: GroundingSettled }): void => {
    if (unkept.delete(owed)) {
      owed.settled({ outcome });
    }
  };
  const attempt = ({ owed, tries }: { owed: OwedGrounding; tries: number }): void => {
    if (!unkept.has(owed)) {
      return;
    }
    const retry = ({ why }: { why: string }): void => {
      if (tries + 1 >= GROUNDING_TRIES) {
        settle({ outcome: { kind: "not-recorded", why: `${why}, after ${String(GROUNDING_TRIES)} tries` }, owed });
        return;
      }
      after({
        live: current,
        ms: GROUNDING_RETRY_MS,
        run: () => {
          attempt({ owed, tries: tries + 1 });
        },
      });
    };
    const on = held();
    if (on === undefined) {
      retry({ why: "this page holds no plan call" });
      return;
    }
    void owed.post({ callId: on.callId }).then((posted: PlanPost) => {
      if (!current()) {
        return undefined;
      }
      if (posted.kind === "taken") {
        settle({ outcome: { kind: "recorded" }, owed });
      } else if (posted.kind === "refused") {
        settle({ outcome: { kind: "not-recorded", why: posted.why }, owed });
      } else {
        retry({ why: posted.why });
      }
      return undefined;
    });
  };
  return {
    end: () => {
      // `settle` deletes each from the set; a Set visits what remains, so deleting the current entry is safe.
      for (const owed of unkept) {
        settle({ outcome: { kind: "not-recorded", why: "the call ended first" }, owed });
      }
    },
    owe: ({ owed }) => {
      unkept.add(owed);
      attempt({ owed, tries: 0 });
    },
  };
}
