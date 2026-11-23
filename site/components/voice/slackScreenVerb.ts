/**
 * The voice's verb seam, wrapped so a Slack thread goes in front of the owner ONCE per call and a thread read that is
 * not the one in front of them says so (`../../lib/slackThreadsShown.ts` holds the rule and its reason).
 *
 * Every way the voice puts a thread on the owner's screen reaches the one verb seam as `browser_open`: the model's own
 * call, `open_card`'s thread (`./openCardRun.ts`) and `triage_next`, which opens through `open_card`. So this wraps that
 * seam rather than each caller. It cannot see the owner moving Slack themselves, nor anything outside this call.
 *
 * Two opens of one thread can be in flight at once — a plan call starts its tool calls without waiting on the last —
 * so a second open of a thread already OPENING waits on the first and answers from its outcome, rather than both
 * reaching the owner's screen. The record is per call the owner started: `slackScreenForCall` bumps `epoch` on a fresh call, and an
 * opening that settles after that writes nothing into the new call's record. The provider holds one for its life
 * (`./useOpenCardSeams.ts`), so the record of openings in flight is never rebuilt on a render.
 */
import { isBag } from "../../lib/bag";
import {
  alreadyShownAnswer,
  NO_THREADS_SHOWN,
  noteThreadShown,
  otherThreadNotice,
  type ThreadsShown,
  threadShownKey,
} from "../../lib/slackThreadsShown";
import type { runVerbTool } from "./talkToolCalls";

/** One verb round trip, as the seam types it. */
type VerbRun = typeof runVerbTool;

/** What one round trip came to. */
type VerbRan = Awaited<ReturnType<VerbRun>>;

/**
 * What an open waiting on another answers when the owner started a fresh call while it waited: the call it was asked in
 * is over, so it opens nothing rather than reaching the owner's screen a second time for a thread the new call never asked for.
 */
const CALL_ENDED = "the call this open was asked in has ended, so nothing was opened";

/** Where this call's record lives, and the clock its openings are stamped with. */
export interface SlackScreenSeam {
  /** The call's record and which call it is; `epoch` changes only when the owner starts a fresh call. */
  readonly read: () => { readonly epoch: number; readonly shown: ThreadsShown };
  /** Replace the record, only while `epoch` is still the current call's. */
  readonly write: (input: { readonly epoch: number; readonly shown: ThreadsShown }) => void;
  readonly nowIso: () => string;
}

/**
 * The Slack thread a call names, when it is one of the two this guard judges: `browser_open` or `slack_open` with a
 * Slack message link.
 *
 * @param name the tool
 * @param args its arguments
 * @returns the link and its thread key, or `undefined` for every other call
 */
function slackCallOf({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown>;
}): { readonly url: string; readonly key: string } | undefined {
  const url = args["url"];
  if ((name !== "browser_open" && name !== "slack_open") || typeof url !== "string") {
    return undefined;
  }
  const key = threadShownKey({ link: url });
  if (key === undefined) {
    return undefined;
  }
  return { key, url };
}

/**
 * A `slack_open` answer with the sentence saying it is not the thread on the owner's screen, its payload kept whole.
 *
 * @param ran what the read came to
 * @param notice the sentence
 * @returns the answer to hand back
 */
function withNotice({ ran, notice }: { ran: VerbRan; notice: string }): VerbRan {
  if (isBag(ran.answer)) {
    return { ...ran, answer: { ...ran.answer, notOnOwnerScreen: notice } };
  }
  return { ...ran, answer: { notOnOwnerScreen: notice, read: ran.answer } };
}

/**
 * Wrap the verb seam. A `browser_open` of a thread this call already showed the owner answers {@link alreadyShownAnswer}
 * and runs nothing; any other Slack thread it opens is recorded once it opened. A `slack_open` always runs, and its
 * answer carries `notOnOwnerScreen` when it read a thread other than the one this call last put in front of the owner. Every
 * other call passes through untouched.
 *
 * @param verb the real round trip
 * @param screen this call's record
 * @returns the guarded round trip, with the same contract
 */
export function guardSlackScreen({ verb, screen }: { verb: VerbRun; screen: SlackScreenSeam }): VerbRun {
  // Openings still running, by call and thread — each settles only once its outcome is recorded — so a second open
  // of the same thread waits on the first and then judges the record it left.
  const opening = new Map<string, Promise<unknown>>();
  const open = async ({
    args,
    url,
    key,
    epoch,
  }: {
    args: Record<string, unknown>;
    url: string;
    key: string;
    /** The call this open was asked in; a waiter keeps it, so it never re-judges against a fresh call's record. */
    epoch: number;
  }): Promise<VerbRan> => {
    const { epoch: current, shown } = screen.read();
    if (current !== epoch) {
      return { answer: { refused: CALL_ENDED }, detail: CALL_ENDED, refused: true };
    }
    const flightKey = `${String(epoch)}|${key}`;
    const inFlight = opening.get(flightKey);
    if (inFlight !== undefined) {
      // Its outcome is the record's, never this call's to rethrow: a failed first open leaves this one free to try.
      await inFlight.catch(() => undefined);
      return open({ args, epoch, key, url });
    }
    const already = alreadyShownAnswer({ shown, url });
    if (already !== undefined) {
      return { answer: already, detail: "already on the owner's screen this call, not opened again", refused: false };
    }
    const job = (async (): Promise<VerbRan> => {
      const ran = await verb({ args, name: "browser_open" });
      const now = screen.read();
      if (!ran.refused && now.epoch === epoch) {
        screen.write({ epoch, shown: noteThreadShown({ atIso: screen.nowIso(), shown: now.shown, url }) });
      }
      return ran;
    })();
    const settled = job.finally(() => {
      opening.delete(flightKey);
    });
    opening.set(flightKey, settled);
    return settled;
  };
  return async ({ name, args }) => {
    const slack = slackCallOf({ args, name });
    if (slack === undefined) {
      return verb({ args, name });
    }
    if (name === "browser_open") {
      return open({ args, epoch: screen.read().epoch, key: slack.key, url: slack.url });
    }
    const ran = await verb({ args, name });
    if (ran.refused) {
      return ran;
    }
    const notice = otherThreadNotice({ shown: screen.read().shown, url: slack.url });
    if (notice === undefined) {
      return ran;
    }
    return withNotice({ notice, ran });
  };
}

/**
 * One guarded seam holding its own record, for the provider's life: `freshSlackScreen` starts a new record when the
 * owner starts a call, and a reconnect or rollover, which carries on the same conversation on the same screen, keeps it.
 *
 * @param verb the real round trip
 * @param nowIso the clock an opening is stamped with
 * @returns the guarded seam, the reset a fresh call makes, and what the record holds now
 */
export function slackScreenForCall({ verb, nowIso }: { verb: VerbRun; nowIso: () => string }): {
  readonly verb: VerbRun;
  readonly freshSlackScreen: () => void;
  readonly held: () => ThreadsShown;
} {
  let shown: ThreadsShown = NO_THREADS_SHOWN;
  let epoch = 0;
  const screen: SlackScreenSeam = {
    nowIso,
    read: () => ({ epoch, shown }),
    write: ({ epoch: at, shown: next }) => {
      if (at === epoch) {
        shown = next;
      }
    },
  };
  return {
    freshSlackScreen: () => {
      epoch += 1;
      shown = NO_THREADS_SHOWN;
    },
    held: () => shown,
    verb: guardSlackScreen({ screen, verb }),
  };
}
