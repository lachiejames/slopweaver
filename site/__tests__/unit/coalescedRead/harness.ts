/*
 * The in-memory controls the coalesced-read test files share: a read that answers only when released, a clock moved
 * by hand, a pause that ends only when fired or aborted, and a signal nobody aborts. They moved here when
 * `coalescedRead.test.ts` was split one file per describe. None touches disk.
 */
import type { Pause } from "../../../lib/coalescedRead";

/** A read that answers only when told to, counting how often it was started. */
function heldRead({ starts, answer }: { starts: string[]; answer: string }): {
  run: () => Promise<string>;
  release: () => void;
} {
  let release = (): void => undefined;
  const settled = new Promise<string>((resolve) => {
    release = () => {
      resolve(answer);
    };
  });
  return {
    release: () => {
      release();
    },
    run: () => {
      starts.push(answer);
      return settled;
    },
  };
}

/** A clock the test moves by hand. */
function handClock(): { now: () => number; advance: (args: { ms: number }) => void } {
  let at = 1_000_000;
  return {
    advance: ({ ms }) => {
      at += ms;
    },
    now: () => at,
  };
}

/** A pause that ends only when the test fires it or its signal aborts, recording every wait it was asked for. */
function handPause(): {
  pause: Pause;
  calls: { readonly ms: number; readonly signal: AbortSignal }[];
  fire: () => void;
} {
  const calls: { readonly ms: number; readonly signal: AbortSignal }[] = [];
  const fires: (() => void)[] = [];
  return {
    calls,
    fire: () => {
      for (const fire of fires) {
        fire();
      }
    },
    pause: ({ ms, signal }) => {
      calls.push({ ms, signal });
      return new Promise<void>((resolve) => {
        fires.push(resolve);
        signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
    },
  };
}

/** A signal nobody aborts. */
function live(): AbortSignal {
  return new AbortController().signal;
}

export { handClock, handPause, heldRead, live };
