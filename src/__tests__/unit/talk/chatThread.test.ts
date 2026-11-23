/*
 * The conversation the messenger opens on: every call's and typed conversation's speech, oldest first, and nothing
 * else. Calls are
 * folded from real call-file lines, so the thread is read the way the verb reads it.
 */
import { describe, expect, it } from "vitest";

import { parseThreadArgs } from "../../../cli/commands/talk/callArgs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type CallEntry, type CallRecord, foldCall } from "../../../talk/callRecord.js";
import { chatThreadOf, THREAD_TURNS_DEFAULT, threadCutOf, threadUnreadableOf } from "../../../talk/chatThread.js";

const EARLY = "a0000006-0000-4000-8000-000000000007";
const LATE = "a0000008-0000-4000-8000-000000000009";

/** A call folded from an open line at `openedIso` and the lines given. */
function call({
  callId,
  openedIso,
  typed,
  lines,
}: {
  callId: string;
  openedIso: string;
  typed: boolean;
  lines: readonly CallEntry[];
}): CallRecord {
  const open: CallEntry = {
    atIso: openedIso,
    kind: "open",
    model: "gpt-live",
    sessionId: "sess_1",
    voice: "marin",
    ...(typed ? { surface: "typed" as const } : {}),
  };
  return foldCall({ callId, entries: [open, ...lines], skipped: 0 })!;
}

/** One stretch of speech. */
function said({
  id,
  who,
  text,
  atIso,
}: {
  id: string;
  who: "owner" | "voice";
  text: string;
  atIso: string;
}): CallEntry {
  return { atIso, final: true, id, kind: "segment", text, who };
}

/** The supervisor-shaped traffic a call file also carries, none of which is speech. */
const NOT_SPEECH: readonly CallEntry[] = [
  {
    atIso: "2026-10-08T09:00:05.000Z",
    detail: "Pass 24 opening: reading the contract",
    kind: "tool",
    name: "supervisor",
    refused: false,
  },
  {
    about: "card",
    atIso: "2026-10-08T09:00:06.000Z",
    detail: "relayed",
    heard: "steer it",
    kind: "relay",
    outcome: "registered",
    say: "relayed",
    turnId: "t-1",
  },
  {
    atIso: "2026-10-08T09:00:07.000Z",
    itemId: "item-1",
    kind: "wrote",
    text: "Machine reads clear (load 14 against 22)",
    turnId: "t-1",
  },
];

describe("chatThreadOf", () => {
  it("joins the calls oldest first, marks a typed conversation, keeps each call's ids and an unfinished turn's state", () => {
    const late = call({
      callId: LATE,
      // A call that dropped mid-sentence: its words stay, unfinished.
      lines: [
        {
          atIso: "2026-10-10T16:45:49.000Z",
          final: false,
          id: "s-1",
          kind: "segment",
          text: "Night-night",
          who: "owner",
        },
      ],
      openedIso: "2026-10-10T16:40:00.000Z",
      typed: false,
    });
    const early = call({
      callId: EARLY,
      lines: [
        said({ atIso: "2026-10-08T09:00:01.000Z", id: "typed-owner-m1", text: "what's waiting on me?", who: "owner" }),
        said({ atIso: "2026-10-08T09:00:09.000Z", id: "typed-item-1", text: "Two cards.", who: "voice" }),
      ],
      openedIso: "2026-10-08T09:00:00.000Z",
      typed: true,
    });
    expect(chatThreadOf({ calls: [late, early], mainCheckoutPaths: [], turns: THREAD_TURNS_DEFAULT })).toEqual([
      {
        atIso: "2026-10-08T09:00:01.000Z",
        beganIso: "2026-10-08T09:00:01.000Z",
        id: `${EARLY}:typed-owner-m1`,
        final: true,
        medium: "typed",
        text: "what's waiting on me?",
        who: "owner",
      },
      {
        atIso: "2026-10-08T09:00:09.000Z",
        beganIso: "2026-10-08T09:00:09.000Z",
        final: true,
        id: `${EARLY}:typed-item-1`,
        medium: "typed",
        text: "Two cards.",
        who: "voice",
      },
      {
        atIso: "2026-10-10T16:45:49.000Z",
        beganIso: "2026-10-10T16:45:49.000Z",
        final: false,
        id: `${LATE}:s-1`,
        medium: "voice",
        text: "Night-night",
        who: "owner",
      },
    ]);
  });

  it("carries no tool line, relay or written message — only what the two of them said", () => {
    const only = call({
      callId: EARLY,
      lines: [...NOT_SPEECH, said({ atIso: "2026-10-08T09:00:08.000Z", id: "s-1", text: "On it.", who: "voice" })],
      openedIso: "2026-10-08T09:00:00.000Z",
      typed: false,
    });
    expect(
      chatThreadOf({ calls: [only], mainCheckoutPaths: [], turns: THREAD_TURNS_DEFAULT }).map((turn) => turn.text),
    ).toEqual(["On it."]);
  });

  it("keeps the newest turns when there are more than asked for, and drops a turn with no words", () => {
    const one = call({
      callId: EARLY,
      lines: [
        said({ atIso: "2026-10-08T09:00:01.000Z", id: "s-1", text: "first", who: "owner" }),
        said({ atIso: "2026-10-08T09:00:02.000Z", id: "s-2", text: "  ", who: "voice" }),
        said({ atIso: "2026-10-08T09:00:03.000Z", id: "s-3", text: " second ", who: "voice" }),
        said({ atIso: "2026-10-08T09:00:04.000Z", id: "s-4", text: "third", who: "owner" }),
      ],
      openedIso: "2026-10-08T09:00:00.000Z",
      typed: false,
    });
    expect(chatThreadOf({ calls: [one], mainCheckoutPaths: [], turns: 2 }).map((turn) => turn.text)).toEqual([
      "second",
      "third",
    ]);
  });

  // A turn begun on an older call after a newer call's turn was drawn above it, grouped with its call.
  it("orders every call's turns by when each began, so the newest turn ends the thread whichever call holds it", () => {
    const older = call({
      callId: EARLY,
      lines: [
        said({ atIso: "2026-10-10T10:01:00.000Z", id: "s-1", text: "A first", who: "owner" }),
        said({ atIso: "2026-10-10T10:12:00.000Z", id: "s-2", text: "A late", who: "voice" }),
      ],
      openedIso: "2026-10-10T10:00:00.000Z",
      typed: false,
    });
    const newer = call({
      callId: LATE,
      lines: [said({ atIso: "2026-10-10T10:11:00.000Z", id: "s-1", text: "B", who: "owner" })],
      openedIso: "2026-10-10T10:10:00.000Z",
      typed: true,
    });
    expect(
      chatThreadOf({ calls: [newer, older], mainCheckoutPaths: [], turns: THREAD_TURNS_DEFAULT }).map(
        (turn) => turn.text,
      ),
    ).toEqual(["A first", "B", "A late"]);
  });

  it("is empty when nothing was ever said", () => {
    expect(chatThreadOf({ calls: [], mainCheckoutPaths: [], turns: THREAD_TURNS_DEFAULT })).toEqual([]);
  });

  // `slopweaver desktop e2e --call` places real calls through the owner's console: a walk's speech is no conversation of theirs.
  it("leaves out a call the desktop test instance placed, and does not count it as history left out", () => {
    const ownerCall = call({
      callId: EARLY,
      lines: [said({ atIso: "2026-10-08T09:00:01.000Z", id: "s-1", text: "the owner's words", who: "owner" })],
      openedIso: "2026-10-08T09:00:00.000Z",
      typed: false,
    });
    const origin = {
      checkoutRoot: "/w/main",
      defaultPort: 3000,
      instance: "e2e",
      mainWorktree: true,
      port: 3000,
    } as const;
    const walk = foldCall({
      callId: LATE,
      entries: [
        { atIso: "2026-10-08T10:00:00.000Z", kind: "open", model: "m", origin, sessionId: "s", voice: "v" },
        said({ atIso: "2026-10-08T10:00:01.000Z", id: "s-1", text: "an automated test", who: "owner" }),
      ],
      skipped: 0,
    })!;
    expect(
      chatThreadOf({ calls: [ownerCall, walk], mainCheckoutPaths: [], turns: THREAD_TURNS_DEFAULT }).map(
        (turn) => turn.text,
      ),
    ).toEqual(["the owner's words"]);
    expect(threadCutOf({ calls: [ownerCall, walk], mainCheckoutPaths: [], passedOver: 0, turns: 1 })).toBe(false);
  });

  // The fold took the LAST open's origin, so a later unmarked open laundered the walk's speech.
  it("leaves out a call the test instance opened even when a later unmarked open of the owner's console follows", () => {
    const owner = { checkoutRoot: "/w/main", defaultPort: 3000, mainWorktree: true, port: 3000 } as const;
    const walk = foldCall({
      callId: LATE,
      entries: [
        {
          atIso: "2026-10-08T10:00:00.000Z",
          kind: "open",
          model: "m",
          origin: { ...owner, instance: "e2e" },
          sessionId: "test",
          voice: "v",
        },
        said({ atIso: "2026-10-08T10:00:01.000Z", id: "s-1", text: "automated test", who: "owner" }),
        { atIso: "2026-10-08T10:01:00.000Z", kind: "open", model: "m", origin: owner, sessionId: "later", voice: "v" },
      ],
      skipped: 0,
    })!;
    expect(walk.origin).toEqual({ ...owner, instance: "e2e" });
    expect(chatThreadOf({ calls: [walk], mainCheckoutPaths: [], turns: THREAD_TURNS_DEFAULT })).toEqual([]);
  });

  // Only the mark sets a call aside, so a seat's unmarked console reads as it always did.
  it("keeps an unmarked call another console recorded, exactly as before the mark existed", () => {
    const seat = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 } as const;
    const kept = foldCall({
      callId: LATE,
      entries: [
        { atIso: "2026-10-08T10:00:00.000Z", kind: "open", model: "m", origin: seat, sessionId: "s", voice: "v" },
        said({ atIso: "2026-10-08T10:00:01.000Z", id: "s-1", text: "keep this", who: "owner" }),
      ],
      skipped: 0,
    })!;
    expect(
      chatThreadOf({ calls: [kept], mainCheckoutPaths: [], turns: THREAD_TURNS_DEFAULT }).map((turn) => turn.text),
    ).toEqual(["keep this"]);
  });
});

/** A call opened by a console serving `checkoutRoot`, its own main checkout or not, with one thing said and `skipped` torn lines. */
function stamped({
  callId,
  checkoutRoot,
  mainWorktree,
  skipped = 0,
  surface,
  text,
}: {
  callId: string;
  checkoutRoot: string;
  mainWorktree: boolean;
  skipped?: number;
  surface?: "typed";
  text: string;
}): CallRecord {
  const origin = { checkoutRoot, defaultPort: 3000, mainWorktree, port: 3000 };
  return foldCall({
    callId,
    entries: [
      {
        atIso: "2026-11-16T09:23:55.000Z",
        kind: "open",
        model: "m",
        origin,
        sessionId: "s",
        voice: "v",
        ...(surface === undefined ? {} : { surface }),
      },
      said({ atIso: "2026-11-16T09:24:17.000Z", id: "s-1", text, who: "owner" }),
    ],
    skipped,
  })!;
}

// A home carried from another Mac drew that Mac's last call as this one's, and warned about its torn lines.
describe("another install's calls", () => {
  const HERE = ["/Users/me/dev/slopweaver"];

  it("leaves out a call another install's main checkout recorded, from the thread, the gaps and the cut", () => {
    const carried = stamped({
      callId: LATE,
      checkoutRoot: "/Users/someone-else/dev/personal/slopweaver",
      mainWorktree: true,
      skipped: 2,
      text: "Cool. All right, see you later",
    });
    const mine = stamped({ callId: EARLY, checkoutRoot: HERE[0]!, mainWorktree: true, text: "hello" });
    expect(
      chatThreadOf({ calls: [carried, mine], mainCheckoutPaths: HERE, turns: 200 }).map((turn) => turn.text),
    ).toEqual(["hello"]);
    expect(threadUnreadableOf({ calls: [carried, mine], mainCheckoutPaths: HERE, unreadable: [] })).toEqual([]);
    expect(threadCutOf({ calls: [carried, mine], mainCheckoutPaths: HERE, passedOver: 0, turns: 1 })).toBe(false);
  });

  it("keeps the same carried call while the home declares no main checkout, so nothing judges it", () => {
    const carried = stamped({ callId: LATE, checkoutRoot: "/elsewhere", mainWorktree: true, skipped: 1, text: "kept" });
    expect(chatThreadOf({ calls: [carried], mainCheckoutPaths: [], turns: 200 }).map((turn) => turn.text)).toEqual([
      "kept",
    ]);
    expect(threadUnreadableOf({ calls: [carried], mainCheckoutPaths: [], unreadable: [] })).toEqual([
      `${LATE}: 1 line(s) did not parse`,
    ]);
  });

  it("keeps a worktree under the declared checkout, a spelling with a trailing slash, and a worktree console anywhere", () => {
    const calls = [
      stamped({
        callId: "a",
        checkoutRoot: "/Users/me/dev/slopweaver/.claude/worktrees.noindex/seat",
        mainWorktree: true,
        text: "nested",
      }),
      stamped({ callId: "b", checkoutRoot: "/Users/me/dev/slopweaver/", mainWorktree: true, text: "trailing" }),
      stamped({ callId: "c", checkoutRoot: "/tmp/elsewhere/worktree", mainWorktree: false, text: "worktree console" }),
    ];
    expect(
      chatThreadOf({ calls, mainCheckoutPaths: HERE, turns: 200 })
        .map((turn) => turn.text)
        .toSorted(),
    ).toEqual(["nested", "trailing", "worktree console"]);
  });

  it("leaves out a sibling whose path only begins like the declared one, and a typed conversation from elsewhere", () => {
    const calls = [
      stamped({ callId: "a", checkoutRoot: "/Users/me/dev/slopweaver-old", mainWorktree: true, text: "sibling" }),
      stamped({ callId: "b", checkoutRoot: "/other/main", mainWorktree: true, surface: "typed", text: "typed" }),
    ];
    expect(chatThreadOf({ calls, mainCheckoutPaths: HERE, turns: 200 })).toEqual([]);
  });

  it("keeps a call with no origin, as every call was before origins were stamped", () => {
    const legacy = call({
      callId: EARLY,
      lines: [said({ atIso: "2026-10-08T09:00:01.000Z", id: "s-1", text: "before origins", who: "owner" })],
      openedIso: "2026-10-08T09:00:00.000Z",
      typed: false,
    });
    expect(chatThreadOf({ calls: [legacy], mainCheckoutPaths: HERE, turns: 200 }).map((turn) => turn.text)).toEqual([
      "before origins",
    ]);
  });

  it("still names a file it could not open at all, which says nothing of whose it is", () => {
    expect(
      threadUnreadableOf({ calls: [], mainCheckoutPaths: HERE, unreadable: ["x: none of its 2 line(s) parsed"] }),
    ).toEqual(["x: none of its 2 line(s) parsed"]);
  });
});

describe("threadCutOf", () => {
  // A page took a turn the thread lacked as aged out when nothing older had been left out at all.
  it("says older history was left out only when a file went unopened or the cut dropped a worded turn", () => {
    const one = call({
      callId: EARLY,
      lines: [
        said({ atIso: "2026-10-08T09:00:01.000Z", id: "s-1", text: "first", who: "owner" }),
        said({ atIso: "2026-10-08T09:00:02.000Z", id: "s-2", text: "  ", who: "voice" }),
        said({ atIso: "2026-10-08T09:00:03.000Z", id: "s-3", text: "second", who: "voice" }),
      ],
      openedIso: "2026-10-08T09:00:00.000Z",
      typed: false,
    });
    expect([
      threadCutOf({ calls: [one], mainCheckoutPaths: [], passedOver: 0, turns: 2 }),
      threadCutOf({ calls: [one], mainCheckoutPaths: [], passedOver: 0, turns: 1 }),
      threadCutOf({ calls: [one], mainCheckoutPaths: [], passedOver: 1, turns: 2 }),
      threadCutOf({ calls: [], mainCheckoutPaths: [], passedOver: 0, turns: 1 }),
    ]).toEqual([false, true, true, false]);
  });
});

describe("threadUnreadableOf", () => {
  // A call whose newest line was torn read as whole, so the history ended on its older turn unflagged.
  it("names every file it could not open, then every call read with a line that did not parse", () => {
    const whole = call({ callId: EARLY, lines: [], openedIso: "2026-10-08T09:00:00.000Z", typed: false });
    const torn = {
      ...call({ callId: LATE, lines: [], openedIso: "2026-10-09T09:00:00.000Z", typed: false }),
      skipped: 1,
    };
    expect([
      threadUnreadableOf({ calls: [whole], mainCheckoutPaths: [], unreadable: [] }),
      threadUnreadableOf({
        calls: [whole, torn],
        mainCheckoutPaths: [],
        unreadable: ["x: none of its 2 line(s) parsed"],
      }),
    ]).toEqual([[], ["x: none of its 2 line(s) parsed", `${LATE}: 1 line(s) did not parse`]]);
  });
});

describe("parseThreadArgs", () => {
  it("defaults the turns and reads --json and --home", () => {
    const parsed = parseThreadArgs({ rest: ["--json", "--home", "/h"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ home: "/h", json: true, turns: THREAD_TURNS_DEFAULT });
  });

  it("refuses a turn count outside its bound", () => {
    const parsed = parseThreadArgs({ rest: ["--turns", "0"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(["talk thread --turns is a whole number from 1 to 1000"]);
  });
});
