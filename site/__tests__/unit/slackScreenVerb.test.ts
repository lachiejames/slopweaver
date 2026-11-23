/*
 * The verb seam the console voice runs through puts a Slack thread in front of the owner once per call, and a thread
 * read that is not the one in front of them says so. Replayed over a call where an `open_card` put a card's thread up
 * and two more looks reached for the same thread, so the owner heard the same thread opened over again.
 */
import { describe, expect, it } from "vitest";

import { slackScreenForCall } from "../../components/voice/slackScreenVerb";
import type { runVerbTool } from "../../components/voice/talkToolCalls";
import { NO_THREADS_SHOWN } from "../../lib/slackThreadsShown";

const THREAD_X = "https://acme.slack.com/archives/C0SYNENGINEER/p1759730000123456";
const REPLY_X =
  "https://acme.slack.com/archives/C0SYNENGINEER/p1759730900654321?thread_ts=1759730000.123456&cid=C0SYNENGINEER";
const THREAD_Y = "https://acme.slack.com/archives/C0SYNOBSERVE1/p1759720000111111";
const OPENED_AT = "2026-10-06T07:54:22.000Z";

/** One call the fake verb saw. */
interface Seen {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/**
 * The provider's own guarded seam over a fake verb, on a fixed clock.
 *
 * @param verb the fake round trip
 * @returns the guarded seam, what its record holds now, and the fresh-call reset
 */
function callScreen({ verb }: { verb: typeof runVerbTool }): ReturnType<typeof slackScreenForCall> {
  return slackScreenForCall({ nowIso: () => OPENED_AT, verb });
}

/**
 * A verb that records every call and answers each with a fixed result, refusing the urls named.
 *
 * @param refuse urls a `browser_open` is refused for
 * @returns the verb and what it saw
 */
function fakeVerb({ refuse = [] }: { refuse?: readonly string[] } = {}): { verb: typeof runVerbTool; seen: Seen[] } {
  const seen: Seen[] = [];
  const verb: typeof runVerbTool = async ({ name, args }) => {
    seen.push({ args, name });
    if (refuse.includes(String(args["url"]))) {
      return { answer: { refused: "the tab did not open" }, detail: "the tab did not open", refused: true };
    }
    if (name === "slack_open") {
      return { answer: { answer: "A thread Jonah started", total: 4 }, detail: "read with slack_open", refused: false };
    }
    return { answer: { landed: args["url"] }, detail: "read with browser_open", refused: false };
  };
  return { seen, verb };
}

describe("guardSlackScreen, replaying a call that reopens one thread", () => {
  it("opens the card's thread once, answers the next two opens as already open, and flags a read of another thread", async () => {
    const { verb, seen } = fakeVerb();
    const { verb: guarded, held } = callScreen({ verb });
    // open_card's thread.
    const first = await guarded({ args: { url: THREAD_X }, name: "browser_open" });
    // The same thread again, once by a reply's link.
    const second = await guarded({ args: { url: THREAD_X }, name: "browser_open" });
    const third = await guarded({ args: { url: REPLY_X }, name: "browser_open" });
    // The voice then talked about a different thread.
    const read = await guarded({ args: { url: THREAD_Y }, name: "slack_open" });

    expect(seen).toEqual([
      { args: { url: THREAD_X }, name: "browser_open" },
      { args: { url: THREAD_Y }, name: "slack_open" },
    ]);
    expect(first).toEqual({ answer: { landed: THREAD_X }, detail: "read with browser_open", refused: false });
    const already = {
      answer: {
        alreadyOnOwnerScreen: true,
        openedAtIso: OPENED_AT,
        url: THREAD_X,
        why:
          "that Slack thread is already on the owner's screen from earlier in this call, so nothing was opened again; walk " +
          "them through it (read it whole with slack_open if you have not), and never open it again",
      },
      detail: "already on the owner's screen this call, not opened again",
      refused: false,
    };
    expect(second).toEqual(already);
    expect(third).toEqual(already);
    expect(read).toEqual({
      answer: {
        answer: "A thread Jonah started",
        notOnOwnerScreen:
          `this is NOT the thread on the owner's screen: the one put in front of them in this call is ${THREAD_X}, opened at ` +
          `${OPENED_AT}. Say which thread you are talking about before you talk about it, and never speak of this ` +
          "one as the one they are looking at",
        total: 4,
      },
      detail: "read with slack_open",
      refused: false,
    });
    expect(held()).toEqual({
      threads: [{ atIso: OPENED_AT, key: "acme/C0SYNENGINEER:1759730000.123456", url: THREAD_X }],
    });
  });
});

describe("guardSlackScreen", () => {
  it("leaves a read of the thread on the owner's screen untouched, and a read with nothing shown", async () => {
    const { verb } = fakeVerb();
    const { verb: guarded } = callScreen({ verb });
    const before = await guarded({ args: { url: THREAD_Y }, name: "slack_open" });
    await guarded({ args: { url: THREAD_X }, name: "browser_open" });
    const same = await guarded({ args: { url: REPLY_X }, name: "slack_open" });
    const plain = {
      answer: { answer: "A thread Jonah started", total: 4 },
      detail: "read with slack_open",
      refused: false,
    };
    expect([before, same]).toEqual([plain, plain]);
  });

  it("records nothing for a refused open, so the next open of that thread runs", async () => {
    const { verb, seen } = fakeVerb({ refuse: [THREAD_X] });
    const { verb: guarded, held } = callScreen({ verb });
    const refused = await guarded({ args: { url: THREAD_X }, name: "browser_open" });
    const again = await guarded({ args: { url: THREAD_X }, name: "browser_open" });
    expect([refused.refused, again.refused, seen.length, held()]).toEqual([true, true, 2, NO_THREADS_SHOWN]);
  });

  it("opens another thread, which then becomes the one a read is judged against, and never reopens the first", async () => {
    const { verb, seen } = fakeVerb();
    const { verb: guarded, held } = callScreen({ verb });
    await guarded({ args: { url: THREAD_X }, name: "browser_open" });
    await guarded({ args: { url: THREAD_Y }, name: "browser_open" });
    const backToX = await guarded({ args: { url: REPLY_X }, name: "browser_open" });
    const readX = await guarded({ args: { url: THREAD_X }, name: "slack_open" });
    expect(seen.map((one) => [one.name, one.args["url"]])).toEqual([
      ["browser_open", THREAD_X],
      ["browser_open", THREAD_Y],
      ["slack_open", THREAD_X],
    ]);
    expect(backToX.detail).toBe("already on the owner's screen this call, not opened again");
    expect(held().threads.map((thread) => thread.url)).toEqual([THREAD_X, THREAD_Y]);
    expect((readX.answer as { notOnOwnerScreen: string }).notOnOwnerScreen).toBe(
      `this is NOT the thread on the owner's screen: the one put in front of them in this call is ${THREAD_Y}, opened at ` +
        `${OPENED_AT}. Say which thread you are talking about before you talk about it, and never speak of this ` +
        "one as the one they are looking at",
    );
  });

  it("leaves a refused read and every non-Slack call exactly as the verb answered, recording nothing", async () => {
    const { verb, seen } = fakeVerb({ refuse: [THREAD_Y] });
    const { verb: guarded, held } = callScreen({ verb });
    const page = await guarded({ args: { page: "orb-mockup" }, name: "browser_open" });
    const github = await guarded({
      args: { url: "https://github.com/acme/acme-admin/pull/1" },
      name: "browser_open",
    });
    const destination = await guarded({ args: { destination: "datadog" }, name: "browser_open" });
    const after = await guarded({ args: { url: THREAD_X }, name: "slack_thread_after" });
    expect([page.answer, github.answer, destination.answer, after.answer]).toEqual([
      { landed: undefined },
      { landed: "https://github.com/acme/acme-admin/pull/1" },
      { landed: undefined },
      { landed: THREAD_X },
    ]);
    expect(held()).toEqual(NO_THREADS_SHOWN);
    await guarded({ args: { url: THREAD_X }, name: "browser_open" });
    const refusedRead = await guarded({ args: { url: THREAD_Y }, name: "slack_open" });
    expect(refusedRead).toEqual({
      answer: { refused: "the tab did not open" },
      detail: "the tab did not open",
      refused: true,
    });
    expect(seen.length).toBe(6);
  });

  it("keeps the payload of a read that is not an object under read", async () => {
    const verb: typeof runVerbTool = async () => ({ answer: "plain text", detail: "read", refused: false });
    const { verb: guarded } = callScreen({ verb });
    await guarded({ args: { url: THREAD_X }, name: "browser_open" });
    const read = await guarded({ args: { url: THREAD_Y }, name: "slack_open" });
    expect(Object.keys(read.answer as object)).toEqual(["notOnOwnerScreen", "read"]);
    expect((read.answer as { read: unknown }).read).toBe("plain text");
  });

  it("opens a thread once when two opens of it overlap", async () => {
    const seen: Seen[] = [];
    let release: (value: Awaited<ReturnType<typeof runVerbTool>>) => void = () => undefined;
    const verb: typeof runVerbTool = ({ name, args }) => {
      seen.push({ args, name });
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const { verb: guarded } = callScreen({ verb });
    const first = guarded({ args: { url: THREAD_X }, name: "browser_open" });
    const second = guarded({ args: { url: REPLY_X }, name: "browser_open" });
    release({ answer: { landed: THREAD_X }, detail: "read with browser_open", refused: false });
    const [one, two] = await Promise.all([first, second]);
    expect(seen.length).toBe(1);
    expect([one.detail, two.detail]).toEqual([
      "read with browser_open",
      "already on the owner's screen this call, not opened again",
    ]);
  });

  it("opens nothing for a waiting open whose call ended while it waited, and records nothing in the fresh call", async () => {
    const seen: Seen[] = [];
    let release: (value: Awaited<ReturnType<typeof runVerbTool>>) => void = () => undefined;
    const verb: typeof runVerbTool = ({ name, args }) => {
      seen.push({ args, name });
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const { verb: guarded, held, freshSlackScreen } = callScreen({ verb });
    const first = guarded({ args: { url: THREAD_X }, name: "browser_open" });
    const waiting = guarded({ args: { url: REPLY_X }, name: "browser_open" });
    freshSlackScreen();
    release({ answer: { landed: THREAD_X }, detail: "read with browser_open", refused: false });
    const [, waited] = await Promise.all([first, waiting]);
    expect(seen.length).toBe(1);
    expect(waited).toEqual({
      answer: { refused: "the call this open was asked in has ended, so nothing was opened" },
      detail: "the call this open was asked in has ended, so nothing was opened",
      refused: true,
    });
    expect(held()).toEqual(NO_THREADS_SHOWN);
  });

  it("opens a thread again in a fresh call the owner starts", async () => {
    const { verb, seen } = fakeVerb();
    const { verb: guarded, freshSlackScreen } = callScreen({ verb });
    await guarded({ args: { url: THREAD_X }, name: "browser_open" });
    freshSlackScreen();
    const again = await guarded({ args: { url: THREAD_X }, name: "browser_open" });
    expect([seen.length, again.detail]).toEqual([2, "read with browser_open"]);
  });

  it("records nothing into a fresh call from an open that settles after it started", async () => {
    let release: (value: Awaited<ReturnType<typeof runVerbTool>>) => void = () => undefined;
    const verb: typeof runVerbTool = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const { verb: guarded, held, freshSlackScreen } = callScreen({ verb });
    const late = guarded({ args: { url: THREAD_X }, name: "browser_open" });
    freshSlackScreen();
    release({ answer: { landed: THREAD_X }, detail: "read with browser_open", refused: false });
    await late;
    expect(held()).toEqual(NO_THREADS_SHOWN);
  });
});
