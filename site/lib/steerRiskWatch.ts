/**
 * The page's watch for a deliverable the owner explicitly steered going at risk while they are on a call: it asks the call's
 * `steer-risk` route now and every {@link STEER_RISK_POLL_MS} after, one post at a time, and logs what each came to.
 * The route reads the open steer notes and has the voice cut in (`WindowNoticeLines.announceSteerRisk`); this only paces
 * the asks. Every effect is a seam, so the whole loop is a unit test (`site/__tests__/unit/steerRiskWatch.test.ts`); the
 * real timers and fetch are `../components/voice/useSteerRiskWatch.ts`.
 *
 * A steered deliverable at risk gets a floating note AND a voice cut-in the minute it is
 * known. The note goes up at the tick that sees it, or at once when a seat parks, asks or names a risk; a poll every 30
 * seconds says it within half a minute of the note, and a call that starts with one already up says it on its first ask.
 */
import { isBag } from "./bag";
import { type SteerRiskNotice, steerRiskNoticeOf } from "./steerRiskNotice";

/** How often the watch asks while the call is up. */
export const STEER_RISK_POLL_MS = 30_000;

/** How soon a refused ask is tried again: another of this server's own lines was being sent. */
export const STEER_RISK_RETRY_MS = 5_000;

/** What one ask of the route came to. */
export type SteerRiskPost =
  | { readonly kind: "none" }
  | { readonly kind: "said"; readonly notice: SteerRiskNotice; readonly already: boolean }
  | { readonly kind: "retry"; readonly why: string }
  | { readonly kind: "dropped"; readonly why: string };

/**
 * What one answer of the route means: a line said, none owed, the floor taken or the response lost (try again soon),
 * or a refusal the next regular ask may clear.
 *
 * @param status the HTTP status, `undefined` when no response arrived
 * @param body the parsed response body, `undefined` when there was none or it was not JSON
 * @param why the route's own refusal, or the transport's
 * @returns what the watch does next
 */
export function steerRiskPostOf({
  status,
  body,
  why,
}: {
  status: number | undefined;
  body: unknown;
  why: string;
}): SteerRiskPost {
  if (status === undefined || status === 409) {
    return { kind: "retry", why };
  }
  if (status < 200 || status >= 300) {
    return { kind: "dropped", why };
  }
  if (!isBag(body)) {
    return { kind: "dropped", why: "the steer-risk route answered no JSON" };
  }
  if (body["said"] === null) {
    return { kind: "none" };
  }
  const notice = steerRiskNoticeOf({ value: body["said"] });
  if (notice === undefined) {
    return { kind: "dropped", why: "the steer-risk route answered a note this page cannot read" };
  }
  return { already: body["already"] === true, kind: "said", notice };
}

/** What the watch reaches. */
export interface SteerRiskWatchSeams {
  /** Run `run` once `ms` has passed, while the call is live; returns a cancel. */
  readonly after: (input: { readonly ms: number; readonly run: () => void }) => () => void;
  /** Whether the call the watch began on is still the page's. */
  readonly live: () => boolean;
  /** One ask of the route, never a rejection. */
  readonly post: () => Promise<SteerRiskPost>;
  /** Write a line in the call's log. */
  readonly note: (input: { readonly detail: string; readonly refused: boolean }) => void;
}

/**
 * Start the watch: ask now, then on the cadence, until the call is no longer the page's or the returned cancel runs. A
 * line said asks again straight after the retry gap, so a second steered row at risk is not held a whole poll behind.
 *
 * @param seams what the watch reaches
 * @returns a function that stops the watch
 */
export function watchSteerRisk({ seams }: { seams: SteerRiskWatchSeams }): () => void {
  let stopped = false;
  let cancelNext: () => void = () => undefined;
  let lastDropped: string | undefined;
  // A function, not an inline test: the cancel can run while a post is awaited.
  const halted = (): boolean => stopped || !seams.live();
  const next = ({ ms }: { ms: number }): void => {
    if (!halted()) {
      cancelNext = seams.after({
        ms,
        run: () => {
          void ask();
        },
      });
    }
  };
  async function ask(): Promise<void> {
    if (halted()) {
      return;
    }
    const posted = await seams.post();
    if (halted()) {
      return;
    }
    if (posted.kind === "said") {
      const said = posted.already ? "said earlier on this server" : "said";
      seams.note({ detail: `${posted.notice.what}: ${said}`, refused: false });
      next({ ms: posted.already ? STEER_RISK_POLL_MS : STEER_RISK_RETRY_MS });
    } else if (posted.kind === "retry") {
      next({ ms: STEER_RISK_RETRY_MS });
    } else if (posted.kind === "dropped") {
      // Logged once per reason: a register that will not read would otherwise write the same line every poll.
      if (posted.why !== lastDropped) {
        seams.note({ detail: `no steer-risk check: ${posted.why}`, refused: true });
      }
      lastDropped = posted.why;
      next({ ms: STEER_RISK_POLL_MS });
    } else {
      next({ ms: STEER_RISK_POLL_MS });
    }
  }
  void ask();
  return () => {
    stopped = true;
    cancelNext();
  };
}
