/*
 * Whether the owner's typed turn still needs the developer line telling the voice to answer it: only when nothing moved after
 * the session took it — the voice said no word and no Codex turn ran — and the call is still up; and a file the
 * owner attached is owed until a `file_read` call arrives, whatever the voice said.
 */
import { describe, expect, it } from "vitest";

import {
  attachmentPathsOf,
  fileReadPathOf,
  TYPED_IN_ATTACHMENT_KICK_TEXT,
  TYPED_IN_KICK_TEXT,
  type TypedInCall,
  TypedInTurns,
  typedInKickDue,
  voiceWorded,
} from "../../lib/talkPlanTypedIn";

/** A call whose session write throws, as a broken pipe to the app-server does. */
const BROKEN_PIPE: TypedInCall = {
  append: () => Promise.reject(new Error("EPIPE")),
  clock: { after: () => () => undefined, nowMs: () => 1_000 },
  failed: () => undefined,
  kick: () => Promise.resolve(undefined),
  moved: () => ({ ended: false, runningTurns: 0, turnEndedAtMs: undefined }),
  refusal: () => undefined,
  taken: () => undefined,
};

/** Where a brief the owner attached was kept, made synthetic. */
const ATTACHED_PATH = "/home/acme/.slopweaver/talk/attachments/abc/work-computer-handoff.md";

/** The line the page builds for that brief. */
const ATTACHED = `[Attached: "work-computer-handoff.md", a text file of 2.8 KB, saved at "${ATTACHED_PATH}". Read it with file_read.]`;

/** A `file_read` of exactly the attached file, as the session calls it. */
const READ_ATTACHED = { args: JSON.stringify({ path: ATTACHED_PATH }), tool: "file_read" };

/**
 * A call whose writes land, whose clock the test moves by hand, and which records every kick it is handed.
 *
 * @returns the turns, the window ends still to run, the kicks handed, and a setter for the clock
 */
function landingCall(): {
  turns: TypedInTurns;
  ends: (() => void)[];
  kicks: { text: string; why: string }[];
  at: (input: { ms: number }) => void;
} {
  const ends: (() => void)[] = [];
  const kicks: { text: string; why: string }[] = [];
  let nowMs = 1_000;
  const turns = new TypedInTurns({
    call: {
      ...BROKEN_PIPE,
      append: () => Promise.resolve({ kind: "result", result: {} }),
      clock: {
        after: ({ run }) => {
          ends.push(run);
          return () => undefined;
        },
        nowMs: () => nowMs,
      },
      kick: (input) => {
        kicks.push(input);
        return Promise.resolve(undefined);
      },
    },
  });
  return {
    at: ({ ms }) => {
      nowMs = ms;
    },
    ends,
    kicks,
    turns,
  };
}

/**
 * Run the oldest pending window end, and let its kick settle.
 *
 * @param ends the window ends still to run
 */
async function endWindow({ ends }: { ends: (() => void)[] }): Promise<void> {
  ends.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
}

describe("TypedInTurns", () => {
  it("frees the floor when the write itself throws", async () => {
    const turns = new TypedInTurns({ call: BROKEN_PIPE });
    await expect(turns.take({ messageId: "m-1", text: "hello" })).rejects.toThrow("EPIPE");
    expect(turns.holding()).toBe(false);
  });

  it.each([
    { kick: () => Promise.reject(new Error("EPIPE")), shape: "in its promise" },
    {
      kick: (): Promise<string | undefined> => {
        throw new Error("EPIPE");
      },
      shape: "before its promise",
    },
  ])("says a kick write that throws $shape, and frees the floor", async ({ kick }) => {
    const ends: (() => void)[] = [];
    const failures: string[] = [];
    const turns = new TypedInTurns({
      call: {
        ...BROKEN_PIPE,
        append: () => Promise.resolve({ kind: "result", result: {} }),
        clock: {
          after: ({ run }) => {
            ends.push(run);
            return () => undefined;
          },
          nowMs: () => 1_000,
        },
        failed: ({ message }) => {
          failures.push(message);
        },
        kick,
        refusal: ({ writing }) => (writing ? "busy" : undefined),
      },
    });
    await turns.take({ messageId: "m-1", text: "hello" });
    ends.at(0)!();
    await new Promise((resolve) => setImmediate(resolve));
    expect([failures, turns.holding()]).toEqual([
      ["the voice was not asked to answer the owner's message: EPIPE"],
      false,
    ]);
    expect(await turns.take({ messageId: "m-2", text: "again" })).toEqual({ kind: "sent" });
  });

  it("streams the owner's turn when a tool call arrives mid-write, before the append answers, and only once", async () => {
    const streamed: string[] = [];
    let answer: () => void = () => undefined;
    const turns = new TypedInTurns({
      call: {
        ...BROKEN_PIPE,
        append: () =>
          new Promise((resolve) => {
            answer = () => resolve({ kind: "result", result: {} });
          }),
        taken: ({ messageId, text }) => {
          streamed.push(`${messageId}: ${text}`);
        },
      },
    });
    turns.toolCallArrived({ args: "{}", tool: "board_row" });
    const idle = [...streamed];
    const sending = turns.take({ messageId: "m-1", text: "It's triage time." });
    turns.toolCallArrived({ args: "{}", tool: "board_row" });
    const midWrite = [...streamed];
    answer();
    expect(await sending).toEqual({ kind: "sent" });
    turns.toolCallArrived({ args: "{}", tool: "board_row" });
    expect([idle, midWrite, streamed]).toEqual([[], ["m-1: It's triage time."], ["m-1: It's triage time."]]);
  });

  it("ends a window waiting on a later write that throws, kicking for the message that landed", async () => {
    const ends: (() => void)[] = [];
    const kicks: { text: string; why: string }[] = [];
    let failSecond: (cause: Error) => void = () => undefined;
    const appends = [
      Promise.resolve({ kind: "result", result: {} } as const),
      new Promise<never>((_resolve, reject) => {
        failSecond = reject;
      }),
    ];
    const turns = new TypedInTurns({
      call: {
        ...BROKEN_PIPE,
        append: () => appends.shift()!,
        clock: {
          after: ({ run }) => {
            ends.push(run);
            return () => undefined;
          },
          nowMs: () => 1_000,
        },
        kick: (input) => {
          kicks.push(input);
          return Promise.resolve(undefined);
        },
      },
    });
    await turns.take({ messageId: "m-1", text: "first" });
    const second = turns.take({ messageId: "m-2", text: "second" });
    ends.at(0)!();
    failSecond(new Error("EPIPE"));
    await expect(second).rejects.toThrow("EPIPE");
    await new Promise((resolve) => setImmediate(resolve));
    // The kick names why it was handed, which the call's provenance keeps beside its words.
    const why = "the owner typed a message into the call and the voice had not answered it";
    expect([kicks, turns.holding()]).toEqual([[{ text: TYPED_IN_KICK_TEXT, why }], false]);
  });

  it("kicks a typed turn the voice answered only with a wordless '.'", async () => {
    const { turns, ends, kicks, at } = landingCall();
    await turns.take({ messageId: "m-1", text: "what's first on the queue?" });
    at({ ms: 2_500 });
    turns.voiceTranscribed({ text: "." });
    turns.voiceTranscribed({ text: undefined });
    await endWindow({ ends });
    expect(kicks.map((kick) => kick.text)).toEqual([TYPED_IN_KICK_TEXT]);
  });

  it("holds the kick for a typed turn the voice answered in words", async () => {
    const { turns, ends, kicks, at } = landingCall();
    await turns.take({ messageId: "m-1", text: "what's first on the queue?" });
    at({ ms: 2_500 });
    turns.voiceTranscribed({ text: "Sure, hang" });
    await endWindow({ ends });
    expect(kicks).toEqual([]);
  });

  it("kicks an attachment, answered with '.', with the attachment line and its own reason", async () => {
    const { turns, ends, kicks, at } = landingCall();
    await turns.take({ messageId: "m-1", text: ATTACHED });
    at({ ms: 2_500 });
    turns.voiceTranscribed({ text: "." });
    await endWindow({ ends });
    const why = "the owner attached a file in the call and it had not been read";
    expect(kicks).toEqual([{ text: TYPED_IN_ATTACHMENT_KICK_TEXT, why }]);
  });

  it("kicks an attachment the voice answered in words but never read, and one a non-file tool did not read", async () => {
    const { turns, ends, kicks, at } = landingCall();
    await turns.take({ messageId: "m-1", text: ATTACHED });
    at({ ms: 2_500 });
    turns.voiceTranscribed({ text: "Got it." });
    turns.toolCallArrived({ args: "{}", tool: "board_row" });
    await endWindow({ ends });
    expect(kicks.map((kick) => kick.text)).toEqual([TYPED_IN_ATTACHMENT_KICK_TEXT]);
  });

  // A read of another file, then words, must not leave the attachment unread and unkicked.
  it("kicks an attachment when the only file_read was of another file, though the voice answered in words", async () => {
    const { turns, ends, kicks, at } = landingCall();
    await turns.take({ messageId: "m-1", text: ATTACHED });
    at({ ms: 2_500 });
    turns.toolCallArrived({ args: JSON.stringify({ path: "/home/acme/other.txt" }), tool: "file_read" });
    turns.voiceTranscribed({ text: "Got it." });
    await endWindow({ ends });
    expect(kicks.map((kick) => kick.text)).toEqual([TYPED_IN_ATTACHMENT_KICK_TEXT]);
  });

  // A kicked, still unread attachment must not re-fire its kick at the owner's later plain "thanks".
  it("asks about an attachment once: a later plain message answered in words gets no second kick", async () => {
    const { turns, ends, kicks, at } = landingCall();
    await turns.take({ messageId: "m-1", text: ATTACHED });
    at({ ms: 2_500 });
    await endWindow({ ends });
    await turns.take({ messageId: "m-2", text: "thanks" });
    at({ ms: 3_000 });
    turns.voiceTranscribed({ text: "You're welcome." });
    await endWindow({ ends });
    expect(kicks.map((kick) => kick.text)).toEqual([TYPED_IN_ATTACHMENT_KICK_TEXT]);
  });

  it("keeps an attachment owed when its kick was not taken, and asks again at the owner's next message's window", async () => {
    const ends: (() => void)[] = [];
    const kicks: string[] = [];
    const fates = ["the voice was busy", undefined];
    let nowMs = 1_000;
    const turns = new TypedInTurns({
      call: {
        ...BROKEN_PIPE,
        append: () => Promise.resolve({ kind: "result", result: {} }),
        clock: {
          after: ({ run }) => {
            ends.push(run);
            return () => undefined;
          },
          nowMs: () => nowMs,
        },
        kick: ({ text }) => {
          kicks.push(text);
          return Promise.resolve(fates.shift());
        },
      },
    });
    await turns.take({ messageId: "m-1", text: ATTACHED });
    await endWindow({ ends });
    await turns.take({ messageId: "m-2", text: "did you get it?" });
    nowMs = 3_000;
    turns.voiceTranscribed({ text: "One moment." });
    await endWindow({ ends });
    expect(kicks).toEqual([TYPED_IN_ATTACHMENT_KICK_TEXT, TYPED_IN_ATTACHMENT_KICK_TEXT]);
  });

  it("holds the kick once a file_read arrived for the attachment", async () => {
    const { turns, ends, kicks, at } = landingCall();
    await turns.take({ messageId: "m-1", text: ATTACHED });
    at({ ms: 2_500 });
    turns.toolCallArrived(READ_ATTACHED);
    turns.voiceTranscribed({ text: "Got it." });
    await endWindow({ ends });
    expect(kicks).toEqual([]);
  });

  it.each([
    { kicked: [], read: READ_ATTACHED, shape: "the attachment's own path" },
    {
      kicked: [TYPED_IN_ATTACHMENT_KICK_TEXT],
      read: { args: JSON.stringify({ path: "/home/acme/other.md" }), tool: "file_read" },
      shape: "another path",
    },
  ])("settles a file_read of $shape that beat the append's reply exactly as one after it", async ({ kicked, read }) => {
    // The session reads the file before the write's reply landed, so no path was owed yet.
    const ends: (() => void)[] = [];
    const kicks: string[] = [];
    let answer: () => void = () => undefined;
    let nowMs = 1_000;
    const turns = new TypedInTurns({
      call: {
        ...BROKEN_PIPE,
        append: () =>
          new Promise((resolve) => {
            answer = () => resolve({ kind: "result", result: {} });
          }),
        clock: {
          after: ({ run }) => {
            ends.push(run);
            return () => undefined;
          },
          nowMs: () => nowMs,
        },
        kick: ({ text }) => {
          kicks.push(text);
          return Promise.resolve(undefined);
        },
      },
    });
    const sending = turns.take({ messageId: "m-1", text: ATTACHED });
    turns.toolCallArrived(read);
    answer();
    expect(await sending).toEqual({ kind: "sent" });
    nowMs = 2_000;
    turns.voiceTranscribed({ text: "Got it." });
    await endWindow({ ends });
    expect(kicks).toEqual(kicked);
  });

  it("carries an unread attachment into the window of a later plain message that replaced its own", async () => {
    const { turns, ends, kicks, at } = landingCall();
    await turns.take({ messageId: "m-1", text: ATTACHED });
    at({ ms: 1_500 });
    await turns.take({ messageId: "m-2", text: "have a look at that" });
    at({ ms: 3_000 });
    turns.voiceTranscribed({ text: "Sure." });
    await endWindow({ ends });
    await endWindow({ ends });
    expect(kicks.map((kick) => kick.text)).toEqual([TYPED_IN_ATTACHMENT_KICK_TEXT]);
  });

  it("owes one read per attachment: two attached and read once still kicks, read twice does not", async () => {
    const run = async ({ reads }: { reads: number }) => {
      const { turns, ends, kicks, at } = landingCall();
      await turns.take({ messageId: "m-1", text: ATTACHED });
      await turns.take({ messageId: "m-2", text: ATTACHED });
      at({ ms: 2_500 });
      for (let read = 0; read < reads; read += 1) {
        turns.toolCallArrived(READ_ATTACHED);
      }
      turns.voiceTranscribed({ text: "Got them." });
      await endWindow({ ends });
      await endWindow({ ends });
      return kicks.map((kick) => kick.text);
    };
    expect([await run({ reads: 1 }), await run({ reads: 2 })]).toEqual([[TYPED_IN_ATTACHMENT_KICK_TEXT], []]);
  });

  it.each([
    { append: () => Promise.resolve({ kind: "timeout" } as const), fate: "unanswered" },
    { append: () => Promise.resolve({ kind: "error", message: "refused" } as const), fate: "failed" },
  ])("owes no read for an attachment whose write $fate", async ({ append }) => {
    const ends: (() => void)[] = [];
    const kicks: { text: string; why: string }[] = [];
    let nowMs = 1_000;
    const appends = [append, () => Promise.resolve({ kind: "result", result: {} } as const)];
    const turns = new TypedInTurns({
      call: {
        ...BROKEN_PIPE,
        append: () => appends.shift()!(),
        clock: {
          after: ({ run }) => {
            ends.push(run);
            return () => undefined;
          },
          nowMs: () => nowMs,
        },
        kick: (input) => {
          kicks.push(input);
          return Promise.resolve(undefined);
        },
      },
    });
    await turns.take({ messageId: "m-0", text: ATTACHED });
    await turns.take({ messageId: "m-1", text: "plain" });
    nowMs = 2_500;
    turns.voiceTranscribed({ text: "Sure." });
    await endWindow({ ends });
    expect(kicks).toEqual([]);
  });

  it.each([
    { fate: "unanswered", finish: (write: Write) => write.resolve({ kind: "timeout" }) },
    { fate: "failed", finish: (write: Write) => write.resolve({ kind: "error", message: "refused" }) },
    { fate: "threw", finish: (write: Write) => write.reject(new Error("EPIPE")) },
  ])(
    "drops a read made while a write that $fate was in flight, never answering a later attachment",
    async ({ finish }) => {
      // The read of m-0's file must not answer m-1's attachment saved at the same path.
      const ends: (() => void)[] = [];
      const kicks: string[] = [];
      let nowMs = 1_000;
      let first: Write | undefined;
      const turns = new TypedInTurns({
        call: {
          ...BROKEN_PIPE,
          append: () => {
            if (first !== undefined) {
              return Promise.resolve({ kind: "result", result: {} });
            }
            return new Promise((resolve, reject) => {
              first = { reject, resolve };
            });
          },
          clock: {
            after: ({ run }) => {
              ends.push(run);
              return () => undefined;
            },
            nowMs: () => nowMs,
          },
          kick: ({ text }) => {
            kicks.push(text);
            return Promise.resolve(undefined);
          },
        },
      });
      const sending = turns.take({ messageId: "m-0", text: ATTACHED }).catch(() => undefined);
      turns.toolCallArrived(READ_ATTACHED);
      finish(first!);
      await sending;
      await turns.take({ messageId: "m-1", text: ATTACHED });
      nowMs = 2_500;
      turns.voiceTranscribed({ text: "Got it." });
      await endWindow({ ends });
      expect(kicks).toEqual([TYPED_IN_ATTACHMENT_KICK_TEXT]);
    },
  );
});

/** One write held open, which the test lands or breaks by hand. */
interface Write {
  resolve: (outcome: { kind: "timeout" } | { kind: "error"; message: string }) => void;
  reject: (cause: Error) => void;
}

/** The owner's turn taken at 1000 ms, and nothing since. */
const QUIET = {
  ended: false,
  runningTurns: 0,
  takenMs: 1_000,
  turnEndedAtMs: undefined,
  unreadAttachments: 0,
  voiceWordAtMs: undefined,
};

describe("typedInKickDue", () => {
  it("is due when only silence followed the owner's words", () => {
    expect(typedInKickDue(QUIET)).toBe(true);
  });

  it("is due when the voice last spoke, and a turn last ended, before the owner's words or in their own millisecond", () => {
    expect([
      typedInKickDue({ ...QUIET, turnEndedAtMs: 999, voiceWordAtMs: 999 }),
      typedInKickDue({ ...QUIET, turnEndedAtMs: 1_000, voiceWordAtMs: 1_000 }),
    ]).toEqual([true, true]);
  });

  it("is not due once the voice spoke after the owner's words", () => {
    expect(typedInKickDue({ ...QUIET, voiceWordAtMs: 1_001 })).toBe(false);
  });

  it("is not due while a Codex turn runs, nor once one ended after the owner's words", () => {
    expect([typedInKickDue({ ...QUIET, runningTurns: 1 }), typedInKickDue({ ...QUIET, turnEndedAtMs: 1_001 })]).toEqual(
      [false, false],
    );
  });

  it("is not due once the call has ended, an unread attachment included", () => {
    expect([
      typedInKickDue({ ...QUIET, ended: true }),
      typedInKickDue({ ...QUIET, ended: true, unreadAttachments: 1 }),
    ]).toEqual([false, false]);
  });

  it("is due for an unread attachment whatever the voice said, and while a Codex turn runs", () => {
    const moved = { ...QUIET, runningTurns: 1, turnEndedAtMs: 1_001, unreadAttachments: 1, voiceWordAtMs: 1_001 };
    expect(typedInKickDue(moved)).toBe(true);
  });
});

describe("attachmentPathsOf", () => {
  it("reads each attachment line's saved path, escapes decoded, and none in words that only mention one", () => {
    const quoted =
      '[Attached: "a \\"b\\".md", a text file of 3 B, saved at "/home/acme/a \\"b\\".md". Read it with file_read.]';
    expect([
      attachmentPathsOf({ text: ATTACHED }),
      attachmentPathsOf({ text: `look at this ${ATTACHED}\n${quoted}` }),
      attachmentPathsOf({ text: "I attached the brief earlier" }),
      attachmentPathsOf({ text: "" }),
    ]).toEqual([[ATTACHED_PATH], [ATTACHED_PATH, '/home/acme/a "b".md'], [], []]);
  });
});

describe("fileReadPathOf", () => {
  it("reads the path a file_read asked for, and none from arguments without one or that are not JSON", () => {
    expect([
      fileReadPathOf({ args: READ_ATTACHED.args }),
      fileReadPathOf({ args: '{"path":"/home/acme/other.txt","from":200}' }),
      fileReadPathOf({ args: "{}" }),
      fileReadPathOf({ args: '{"path":7}' }),
      fileReadPathOf({ args: "null" }),
      fileReadPathOf({ args: "not json" }),
    ]).toEqual([ATTACHED_PATH, "/home/acme/other.txt", undefined, undefined, undefined, undefined]);
  });
});

describe("voiceWorded", () => {
  it("holds a letter or digit in any script, and nothing else, as a word", () => {
    expect([
      voiceWorded({ text: "." }),
      voiceWorded({ text: " … " }),
      voiceWorded({ text: "" }),
      voiceWorded({ text: undefined }),
      voiceWorded({ text: "Hi" }),
      voiceWorded({ text: "4" }),
      voiceWorded({ text: "はい" }),
    ]).toEqual([false, false, false, false, true, true, true]);
  });
});
