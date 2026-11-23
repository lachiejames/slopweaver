/**
 * The incident read's deadline, held on EVERY Slack call rather than checked between them: a check before each thread bounds nothing while one history page or one reply page hangs. Each call races
 * the time the read has left, so the read ends inside {@link READ_DEADLINE_MS} whatever Slack does, and the 30s
 * between that and the supervisor's 120s child budget is the time reserved for writing `unmeasurable`.
 *
 * A call that lost the race is abandoned, not cancelled — the Slack seam takes no signal — and dies with the process,
 * which `main.ts` exits explicitly once the verb returns.
 *
 * Pure but for the two seams it is handed: the clock and the timer.
 */
import type { SlackApi } from "../corpus/slack/fetch.js";

import { READ_DEADLINE_MS } from "./policy.js";

/** The Slack calls an incident read makes, which `./read.ts` names `IncidentReadApi`. */
type IncidentReadApi = Pick<SlackApi, "history" | "replies">;

/** The read's deadline as it stands: the api bound to it, and how far past it the read went when it was spent. */
export interface DeadlineBound {
  readonly api: IncidentReadApi;
  /** The elapsed ms when a call found the deadline spent, or undefined while it has not been. */
  readonly spentAtMs: () => number | undefined;
}

/**
 * The Slack read seam with every call raced against the time the read has left.
 *
 * @param api the Slack read seam to bound
 * @param clock the wall clock, in epoch ms; the read's time starts at the first reading of it
 * @param wait the timer: resolves once the given ms have passed
 * @returns the bound api, and whether a call found the deadline spent
 */
export function deadlineBound({
  api,
  clock,
  wait,
}: {
  api: IncidentReadApi;
  clock: () => number;
  wait: (ms: number) => Promise<void>;
}): DeadlineBound {
  const startedMs = clock();
  let spentAtMs: number | undefined;
  const raced = async <T>({ call }: { call: () => Promise<T> }): Promise<T> => {
    const leftMs = READ_DEADLINE_MS - (clock() - startedMs);
    if (leftMs <= 0) {
      spentAtMs = clock() - startedMs;
      throw new Error("the read's deadline was spent before this call");
    }
    // The timer RESOLVES rather than rejects, so a call that wins leaves nothing to reject unobserved afterwards.
    const outcome = await Promise.race([call().then((value) => ({ value })), wait(leftMs).then(() => undefined)]);
    // A response that lands past the deadline can still win the race while the due timer has yet to run, so the
    // clock is read again on the way out rather than trusting which branch settled first.
    const elapsedMs = clock() - startedMs;
    if (outcome === undefined || elapsedMs >= READ_DEADLINE_MS) {
      spentAtMs = elapsedMs;
      throw new Error("the read's deadline passed during this call");
    }
    return outcome.value;
  };
  return {
    api: {
      history: (args) => raced({ call: () => api.history(args) }),
      replies: (args) => raced({ call: () => api.replies(args) }),
    },
    spentAtMs: () => spentAtMs,
  };
}
