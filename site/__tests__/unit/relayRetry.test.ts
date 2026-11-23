/*
 * The console voice's one retry: which refusals it takes, what it posts, and the queue the posts run on.
 */
import { describe, expect, it } from "vitest";

import {
  postLeftTurnUnclaimed,
  relayOutcomeUnknown,
  relayRetryable,
  serialQueue,
  wordsAloneWire,
} from "../../lib/relayRetry";
import type { TalkRelayWire } from "../../lib/talkRelayRequestWire";

const TURN = "a0000017-0000-4000-8000-000000000019";

const HEARD_ONLY: TalkRelayWire = {
  about: "ask:queue-shows-raw-user-id",
  heard: "fix the tab",
  readsAfter: ["context_pack"],
  screen: { dataUrl: "data:image/webp;base64,UklGRg==", kind: "attached" },
  turnId: TURN,
};

describe("relayRetryable", () => {
  it("retries only a first relay the verb refused before claiming its turn", () => {
    expect([
      relayRetryable({ exitCode: 2, wordsAlone: false }),
      relayRetryable({ exitCode: 1, wordsAlone: false }),
      relayRetryable({ exitCode: undefined, wordsAlone: false }),
      relayRetryable({ exitCode: 2, wordsAlone: true }),
    ]).toEqual([true, false, false, false]);
  });
});

describe("relayOutcomeUnknown", () => {
  it("leaves a relay unknown when the verb gave no exit or another run of its turn may yet write", () => {
    expect([
      relayOutcomeUnknown({ exitCode: undefined }),
      relayOutcomeUnknown({ exitCode: 4 }),
      relayOutcomeUnknown({ exitCode: 2 }),
      relayOutcomeUnknown({ exitCode: 1 }),
    ]).toEqual([true, true, false, false]);
  });
});

describe("postLeftTurnUnclaimed", () => {
  it("vouches only for a refusal made before the turn was claimed, so a claimed turn is never retried", () => {
    expect([
      postLeftTurnUnclaimed({ post: { outcome: "refused", wordsAloneRetry: true } }),
      postLeftTurnUnclaimed({ post: { outcome: "refused", wordsAloneRetry: false } }),
      postLeftTurnUnclaimed({ post: { outcome: "unknown", wordsAloneRetry: false } }),
      postLeftTurnUnclaimed({ post: { outcome: "relayed", wordsAloneRetry: false } }),
    ]).toEqual([true, false, false, false]);
  });
});

describe("wordsAloneWire", () => {
  it("keeps the turn, the owner's words, the item and the picture, and drops the reads", () => {
    expect(wordsAloneWire({ wire: HEARD_ONLY })).toEqual({
      about: "ask:queue-shows-raw-user-id",
      heard: "fix the tab",
      readsAfter: [],
      screen: { dataUrl: "data:image/webp;base64,UklGRg==", kind: "attached" },
      turnId: TURN,
      wordsAlone: true,
    });
  });

  it("keeps whether the owner was still speaking, so the retry never reads a cut relay as whole", () => {
    expect(wordsAloneWire({ wire: { ...HEARD_ONLY, heardTail: "cut" } })).toEqual({
      about: "ask:queue-shows-raw-user-id",
      heard: "fix the tab",
      heardTail: "cut",
      readsAfter: [],
      screen: { dataUrl: "data:image/webp;base64,UklGRg==", kind: "attached" },
      turnId: TURN,
      wordsAlone: true,
    });
  });

  it("drops the voice's reading from a full relay", () => {
    expect(wordsAloneWire({ wire: { ...HEARD_ONLY, readsAfter: [], say: "merge it" } })).toEqual({
      about: "ask:queue-shows-raw-user-id",
      heard: "fix the tab",
      readsAfter: [],
      screen: { dataUrl: "data:image/webp;base64,UklGRg==", kind: "attached" },
      turnId: TURN,
      wordsAlone: true,
    });
  });

  it("keeps the check-in the owner's words were a verdict on, and how far it reaches", () => {
    const verdict = { ...HEARD_ONLY, about: "act:ev-2", covers: "rule" as const, say: "that was right" };
    expect(wordsAloneWire({ wire: verdict })).toEqual({
      about: "act:ev-2",
      covers: "rule",
      heard: "fix the tab",
      readsAfter: [],
      screen: { dataUrl: "data:image/webp;base64,UklGRg==", kind: "attached" },
      turnId: TURN,
      wordsAlone: true,
    });
  });

  it("keeps the candidate the owner's words were a ruling on, and the word", () => {
    const ruling = { ...HEARD_ONLY, candidate: "c-105", reaction: "no" as const, say: "not a workstream" };
    expect(wordsAloneWire({ wire: ruling })).toEqual({
      about: "ask:queue-shows-raw-user-id",
      candidate: "c-105",
      heard: "fix the tab",
      reaction: "no",
      readsAfter: [],
      screen: { dataUrl: "data:image/webp;base64,UklGRg==", kind: "attached" },
      turnId: TURN,
      wordsAlone: true,
    });
  });

  it("drops the copy-tray offer, which the voice wrote, so a refusal over it still gets the owner's words through", () => {
    const reacted = { ...HEARD_ONLY, offered: { id: "offer-3", made: "3", text: "Merged, thanks" } };
    // Strict, so an `offered` key left on the retry, even an undefined one, reddens it.
    expect(wordsAloneWire({ wire: reacted })).toStrictEqual({
      about: "ask:queue-shows-raw-user-id",
      heard: "fix the tab",
      readsAfter: [],
      screen: { dataUrl: "data:image/webp;base64,UklGRg==", kind: "attached" },
      turnId: TURN,
      wordsAlone: true,
    });
  });

  // The pass marks the card ruled as the relay is handed off, so the retry must carry the ruling.
  it("keeps the owner's triage verdict and label on the card", () => {
    const ruling = {
      ...HEARD_ONLY,
      label: "waiting-on-me" as const,
      say: "--rewrite",
      triage: "rewrite" as const,
    };
    expect(wordsAloneWire({ wire: ruling })).toEqual({
      about: "ask:queue-shows-raw-user-id",
      heard: "fix the tab",
      label: "waiting-on-me",
      readsAfter: [],
      screen: { dataUrl: "data:image/webp;base64,UklGRg==", kind: "attached" },
      triage: "rewrite",
      turnId: TURN,
      wordsAlone: true,
    });
  });

  // The other cards the owner's words answer are what they concern, so a refused reading keeps them.
  it("keeps the other cards the owner's words answer, in order", () => {
    const also = ["draft:abc-1", "ask:split-files"];
    expect(wordsAloneWire({ wire: { ...HEARD_ONLY, alsoAnswers: also, say: "split them" } })).toEqual({
      about: "ask:queue-shows-raw-user-id",
      alsoAnswers: also,
      heard: "fix the tab",
      readsAfter: [],
      screen: { dataUrl: "data:image/webp;base64,UklGRg==", kind: "attached" },
      turnId: TURN,
      wordsAlone: true,
    });
  });

  // The voice already put the question, or already carried the owner's answer past it: the retry must say the same.
  it("keeps the discuss-first question the relay put", () => {
    const discussFirst = { repository: "acme/acme-admin", status: "put" as const };
    expect(wordsAloneWire({ wire: { ...HEARD_ONLY, discussFirst } })).toEqual({
      about: "ask:queue-shows-raw-user-id",
      discussFirst,
      heard: "fix the tab",
      readsAfter: [],
      screen: { dataUrl: "data:image/webp;base64,UklGRg==", kind: "attached" },
      turnId: TURN,
      wordsAlone: true,
    });
  });
});

describe("serialQueue", () => {
  it("starts a task only after the one before it settles, even when that one rejected", async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const queue = serialQueue();
    const first = queue.run(
      () =>
        new Promise<string>((resolve) => {
          order.push("first started");
          releaseFirst = () => resolve("first");
        }),
    );
    const failing = queue.run(() => {
      order.push("failing started");
      return Promise.reject(new Error("route fell over"));
    });
    const last = queue.run(() => {
      order.push("last started");
      return Promise.resolve("last");
    });
    await Promise.resolve();
    order.push("first still in flight");
    releaseFirst();
    const settled = await Promise.allSettled([first, failing, last]);
    expect(order).toEqual(["first started", "first still in flight", "failing started", "last started"]);
    expect(settled.map((one) => one.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
