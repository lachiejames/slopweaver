/*
 * The calls half of continuity. A console-voice call that dropped lost the steers the owner had given it when
 * continuity read only what was RELAYED. Each case pins one thing a fresh call must be able to say about the last
 * one: the owner's words after their last relay, how that call ended, and that the half fits.
 */
import { describe, expect, it } from "vitest";

import type { CallRecord } from "../../../talk/callRecord.js";
import type { TalkContinuity } from "../../../talk/continuity.js";
import { callsSince, lastSpokenCall, unrelayedWords } from "../../../talk/continuityCalls.js";
import { readingLine } from "../../../talk/continuityReading.js";
import { continuityOpener, renderContinuity } from "../../../talk/continuityRender.js";
import { CONTINUITY_MAX_BYTES, continuityForTool } from "../../../talk/continuityTool.js";
import { mintOpener, reconnectOpener, resumeLines, rolloverOpener } from "../../../talk/mintOpener.js";
import {
  CALL,
  call,
  continuity,
  NO_TYPING,
  RELAYED_AT,
  SILENT_ROLLOVER,
  SINCE,
  segment,
  steer,
} from "./continuityCallsFixture.js";

describe("callsSince", () => {
  it("names a call with no end written as dropped, with when it was last heard", () => {
    const [only] = callsSince({ calls: [call()], sinceIso: SINCE });
    expect(only!.end).toBe("no end recorded — it dropped or the page went away; last heard 2026-09-25T02:29:40.000Z");
    expect(only!.lines.map((line) => line.text)).toEqual([
      "look at the staging pool",
      "on it",
      "and merge the ISO PR once CI is green",
      "then ping Ari about the",
    ]);
  });

  it("drops a call last heard before the window and orders the rest newest first", () => {
    const old = call({ callId: "old", lastIso: "2026-09-21T00:00:00.000Z" });
    const newer = call({ callId: "newer", lastIso: "2026-09-25T03:00:00.000Z" });
    expect(callsSince({ calls: [old, call(), newer], sinceIso: SINCE }).map((kept) => kept.callId)).toEqual([
      "newer",
      CALL,
    ]);
  });

  it("keeps the newest forty lines and counts the rest", () => {
    const segments = Array.from({ length: 45 }, (_, index) =>
      segment({ id: `s-${String(index)}`, text: `line ${String(index)}` }),
    );
    const [only] = callsSince({ calls: [call({ segments })], sinceIso: SINCE });
    expect(only!.lines.length).toBe(40);
    expect(only!.linesCut).toBe(5);
    expect(only!.lines[0]!.text).toBe("line 5");
  });

  // A sign-off quoted into the next call's prompt teaches it back.
  it("cuts the voice's trailing running-list sign-off from what the next call quotes, never the owner's words", () => {
    const signOff = "That’s on your running list, what do you think?";
    const segments = [
      segment({ text: `is that ${signOff.toLowerCase()}` }),
      segment({
        atIso: "2026-09-25T02:25:30.000Z",
        id: "s-2",
        text: `One shared definition, then. ${signOff}`,
        who: "voice",
      }),
      segment({ atIso: "2026-09-25T02:26:00.000Z", id: "s-3", text: signOff, who: "voice" }),
    ];
    const [only] = callsSince({ calls: [call({ segments })], sinceIso: SINCE });
    expect(only!.lines.map((line) => line.text)).toEqual([
      "is that that’s on your running list, what do you think?",
      "One shared definition, then.",
    ]);
    const opener = rolloverOpener({ continuity: continuity({ calls: [only!] }) });
    expect(opener).toContain('- you: "One shared definition, then."');
    expect(opener).not.toContain('you: "That’s on your running list');
  });

  // The opener clips a quoted line, so a sign-off mid-line could be left at its end.
  it("cuts the voice's running-list sign-off from anywhere in a line, joining what is either side", () => {
    const segments = [
      segment({
        atIso: "2026-09-25T02:25:30.000Z",
        id: "s-2",
        text: "Drafted. It's on your running list… what do you think? Then the ISO PR.",
        who: "voice",
      }),
    ];
    const [only] = callsSince({ calls: [call({ segments })], sinceIso: SINCE });
    expect(only!.lines.map((line) => line.text)).toEqual(["Drafted. Then the ISO PR."]);
  });

  // `slopweaver desktop e2e --call` places real calls through the owner's console: the next call never picks up from one.
  it("passes over a call the desktop test instance placed, and keeps the owner's own and a legacy one", () => {
    const main = { checkoutRoot: "/w/main", defaultPort: 3000, mainWorktree: true, port: 3000 };
    const calls = [
      call({ callId: "legacy" }),
      call({ callId: "main", origin: main }),
      call({ callId: "test", lastIso: "2026-09-25T03:00:00.000Z", origin: { ...main, instance: "e2e" } }),
    ];
    expect(callsSince({ calls, sinceIso: SINCE }).map((kept) => kept.callId)).toEqual(["legacy", "main"]);
  });
});

describe("unrelayedWords", () => {
  it("is the owner's words on the newest call after their last relay, and never the voice's", () => {
    const found = unrelayedWords({ continuity: continuity() });
    expect(found!.words.map((line) => line.text)).toEqual([
      "and merge the ISO PR once CI is green",
      "then ping Ari about the",
    ]);
  });

  it("is every word of the owner's when nothing was ever relayed", () => {
    const found = unrelayedWords({ continuity: continuity({ steers: [] }) });
    expect(found!.words.length).toBe(3);
  });

  it("is absent when every word the owner said came before their last relay", () => {
    expect(
      unrelayedWords({ continuity: continuity({ steers: [{ ...steer, atIso: "2026-09-25T02:35:00.000Z" }] }) }),
    ).toBe(undefined);
  });
});

// Restarting the desktop app mid-call leaves a call opened and closed on nothing, and the call after it must not
// answer "where were we" from a steer older than the whole last exchange.
describe("a call that wrote nothing never hides the owner's last one", () => {
  const empty = call({
    callId: "empty",
    lastIso: "2026-09-25T02:31:00.000Z",
    openedIso: "2026-09-25T02:30:10.000Z",
    segments: [],
  });
  const withEmpty = (over: Partial<TalkContinuity> = {}): TalkContinuity =>
    continuity({ calls: callsSince({ calls: [call(), empty], sinceIso: SINCE }), ...over });

  it("takes the newest call with a line as the owner's last, and their unrelayed words from it", () => {
    expect(withEmpty().calls[0]!.callId).toBe("empty");
    expect(lastSpokenCall({ continuity: withEmpty() })!.callId).toBe(CALL);
    expect(unrelayedWords({ continuity: withEmpty() })!.words.map((line) => line.text)).toEqual([
      "and merge the ISO PR once CI is green",
      "then ping Ari about the",
    ]);
  });

  it("names the spoken call's link past a newer empty call", () => {
    const LINK = "https://acme.slack.com/archives/C0SYNPLATFORM/p1759813000000100";
    const note = {
      answer: undefined,
      atIso: "2026-09-25T02:25:10.000Z",
      detail: "read",
      kind: "tool" as const,
      name: "slack_thread_after",
      opened: LINK,
      refused: false,
    };
    const read = continuity({ calls: callsSince({ calls: [call({ notes: [note] }), empty], sinceIso: SINCE }) });
    expect(readingLine({ continuity: read, reader: "tool" })).toContain(`you were reading ${LINK}`);
  });

  // A reconnect's subject is the call that dropped, so an older call is never quoted as it; the ordinary opener that
  // follows still carries the spoken call's words.
  it("quotes no older call as a reconnect's or a rollover's dropped call, and the ordinary opener still carries it", () => {
    expect(reconnectOpener({ continuity: withEmpty() }).split("\n").length).toBe(4);
    expect(rolloverOpener({ continuity: withEmpty() }).split("\n")).toEqual(SILENT_ROLLOVER);
    const reopened = mintOpener({ continuity: withEmpty(), conversation: NO_TYPING, mode: "reconnect" })!;
    expect(reopened).toContain('they last said: "and merge the ISO PR once CI is green … then ping Ari about the"');
  });

  // An unreadable call file may be the call that dropped, so a readable older one is never quoted as it.
  it("quotes no call for a reconnect or a rollover when a call file could not be read", () => {
    const partial = continuity({ unread: [{ section: "calls", why: "1 newer call file could not be read" }] });
    expect(reconnectOpener({ continuity: continuity() }).split("\n").length).toBe(11);
    expect(reconnectOpener({ continuity: partial }).split("\n").length).toBe(4);
    expect(rolloverOpener({ continuity: partial }).split("\n")).toEqual(SILENT_ROLLOVER);
  });
});

describe("a call the owner starts minutes after their last resumes from its last exchange", () => {
  /** A read taken the given number of milliseconds after the call's last line. */
  const builtAfter = ({ ms }: { ms: number }): TalkContinuity =>
    continuity({ builtIso: new Date(Date.parse("2026-09-25T02:29:40.000Z") + ms).toISOString() });

  it("quotes the exchange, both sides, then says to carry on from it", () => {
    expect(resumeLines({ continuity: builtAfter({ ms: 98_000 }) })).toEqual([
      "The owner's last call with you (no end recorded — it dropped or the page went away; last heard 2026-09-25T02:29:40.000Z) ended on this exchange, oldest first:",
      '- the owner: "look at the staging pool"',
      '- you: "on it"',
      '- the owner: "and merge the ISO PR once CI is green"',
      '- the owner (cut off mid-sentence): "then ping Ari about the"',
      "When the owner carries on or asks where you were, carry on from this exchange; never recap it unasked.",
    ]);
  });

  it("is inside the window at sixty minutes and out of it one millisecond later, or when stamped after the read", () => {
    expect(resumeLines({ continuity: builtAfter({ ms: 60 * 60 * 1000 }) }).length).toBe(6);
    expect(resumeLines({ continuity: builtAfter({ ms: 60 * 60 * 1000 + 1 }) })).toEqual([]);
    expect(resumeLines({ continuity: builtAfter({ ms: -1 }) })).toEqual([]);
    expect(resumeLines({ continuity: continuity({ builtIso: "not a date" }) })).toEqual([]);
  });

  // `Date.parse` truncates a stamp finer than a millisecond down to the read's own, so the read's
  // millisecond is itself outside the window and only one a millisecond earlier is inside it.
  it("resumes from no call stamped in the read's own millisecond, and from one a millisecond older", () => {
    expect(resumeLines({ continuity: builtAfter({ ms: 0 }) })).toEqual([]);
    expect(resumeLines({ continuity: builtAfter({ ms: 1 }) }).length).toBe(6);
  });

  // A call whose activity stamp does not parse cannot be shown to precede the read.
  it("resumes from no call whose activity stamp does not parse", () => {
    const read = builtAfter({ ms: 98_000 });
    const unparsed = { ...read, calls: read.calls.map((entry) => ({ ...entry, lastIso: "not a date" })) };
    expect(resumeLines({ continuity: read }).length).toBe(6);
    expect(resumeLines({ continuity: unparsed })).toEqual([]);
  });

  it("leads a pressed start's opener, and leaves it as it was outside the window", () => {
    const near = builtAfter({ ms: 98_000 });
    const ordinary = continuityOpener({ continuity: near, conversation: NO_TYPING })!;
    expect(mintOpener({ continuity: near, conversation: NO_TYPING, mode: "fresh" })).toBe(
      `${resumeLines({ continuity: near }).join("\n")}\n\n${ordinary}`,
    );
    const far = builtAfter({ ms: 2 * 60 * 60 * 1000 });
    expect(mintOpener({ continuity: far, conversation: NO_TYPING, mode: "fresh" })).toBe(
      continuityOpener({ continuity: far, conversation: NO_TYPING }),
    );
  });

  // A call file that could not be read may be the newer call, so the readable one is never resumed
  // from, nor called where the owner left off.
  it("resumes from nothing, and calls no readable call the owner's last, when a call file could not be read", () => {
    const partial = continuity({ unread: [{ section: "calls", why: "1 newer call file could not be read" }] });
    expect(resumeLines({ continuity: partial })).toEqual([]);
    const opener = continuityOpener({ continuity: partial, conversation: NO_TYPING })!.split("\n");
    expect(opener[0]).toBe(
      "The owner's earlier calls could not be read: if they ask where you were, say you could not read them — never guess.",
    );
    expect(opener[1]).toBe(
      'On a call with you that may not be the owner\'s last (opened 2026-09-25T02:20:00.000Z, no end recorded — it dropped or the page went away; last heard 2026-09-25T02:29:40.000Z) they said: "and merge the ISO PR once CI is green … then ping Ari about the".',
    );
    expect(opener.filter((line) => line.startsWith("Where you left off: on the owner's last call"))).toEqual([]);
  });

  // A tool or usage line written long after the owner last spoke is not conversation to resume.
  it("measures the window from the owner's last spoken line, never a later activity on the call", () => {
    const quiet = call({
      lastIso: "2026-09-25T04:00:00.000Z",
      segments: [segment({ atIso: "2026-09-25T02:00:00.000Z" })],
    });
    const read = continuity({
      builtIso: "2026-09-25T04:01:00.000Z",
      calls: callsSince({ calls: [quiet], sinceIso: SINCE }),
    });
    expect(resumeLines({ continuity: read })).toEqual([]);
  });

  // A line cut from the kept forty may be the one stamped after the read; the call's activity says so.
  it("resumes from no call whose activity is stamped after the read, even when its kept lines are not", () => {
    const skewed = continuity({
      builtIso: "2026-09-25T02:40:00.000Z",
      calls: callsSince({ calls: [call({ lastIso: "2026-09-25T02:41:00.000Z" })], sinceIso: SINCE }),
    });
    expect(resumeLines({ continuity: skewed })).toEqual([]);
    expect(resumeLines({ continuity: continuity() }).length).toBe(6);
  });

  // A torn line is what a crash leaves, so the call is still resumed from, with the gap said.
  it("says a call's file had a line it could not read, rather than dropping the call", () => {
    const torn = continuity({ calls: callsSince({ calls: [call({ skipped: 1 })], sinceIso: SINCE }) });
    expect(resumeLines({ continuity: torn })[0]).toBe(
      "The owner's last call with you (no end recorded — it dropped or the page went away; last heard 2026-09-25T02:29:40.000Z) ended on this exchange, oldest first — 1 line(s) of its file could not be read, so its last words may be missing; if the owner says otherwise, they are right:",
    );
  });

  it("resumes from the spoken call past a newer one that wrote nothing", () => {
    const empty = call({ callId: "empty", lastIso: "2026-09-25T02:31:00.000Z", segments: [] });
    const read = continuity({
      builtIso: "2026-09-25T02:32:00.000Z",
      calls: callsSince({ calls: [call(), empty], sinceIso: SINCE }),
    });
    expect(resumeLines({ continuity: read })[4]).toBe('- the owner (cut off mid-sentence): "then ping Ari about the"');
  });
});

describe("rendering the calls half", () => {
  it("keeps the owner's NEWEST words when what they said after their last relay is past the bound", () => {
    const long = `OLDEST ${"x".repeat(400)} NEWEST`;
    const read = continuity({
      calls: callsSince({
        calls: [call({ segments: [segment({ atIso: "2026-09-25T02:29:00.000Z", text: long })] })],
        sinceIso: SINCE,
      }),
    });
    const first = continuityOpener({ continuity: read, conversation: NO_TYPING })!.split("\n")[0]!;
    expect(first).toContain('NEWEST".');
    expect(first).not.toContain("OLDEST");
  });

  it("says there is no record of a last call, rather than nothing, when none in the window has a line", () => {
    const opener = continuityOpener({ continuity: continuity({ calls: [], steers: [] }), conversation: NO_TYPING });
    expect(opener!.split("\n")[0]).toBe(
      `No earlier call of yours with the owner is written down since ${SINCE}: if they ask where you were, say you have no record of it — never guess or invent what it was about.`,
    );
  });

  it("says the calls could not be read, never that there were none, when a call file was unreadable", () => {
    const opener = continuityOpener({
      continuity: continuity({
        calls: [],
        steers: [],
        unread: [{ section: "calls", why: "1 call file(s) could not be read" }],
      }),
      conversation: NO_TYPING,
    })!;
    expect(opener.split("\n")[0]).toBe(
      "The owner's earlier calls could not be read: if they ask where you were, say you could not read them — never guess.",
    );
    expect(opener).not.toContain("no record");
  });

  // The line names no relay state: "never relayed" here was a line the voice would say unasked. Which words were not
  // relayed selects the quote; it is never a thing to say.
  it("opens the voice on the owner's unrelayed words and how the call ended, before their last steer", () => {
    const opener = continuityOpener({ continuity: continuity(), conversation: NO_TYPING })!.split("\n");
    expect(opener[0]).toBe(
      'Where you left off: on the owner\'s last call with you (opened 2026-09-25T02:20:00.000Z, no end recorded — it dropped or the page went away; last heard 2026-09-25T02:29:40.000Z) they last said: "and merge the ISO PR once CI is green … then ping Ari about the".',
    );
    expect(opener[1]).toBe(`The owner's last steer to you, at ${RELAYED_AT}, was "Look at the staging pool.".`);
  });

  it("is present for a call that never relayed at all", () => {
    const opener = continuityOpener({ continuity: continuity({ steers: [] }), conversation: NO_TYPING });
    expect(opener!.split("\n")[0]).toContain('"look at the staging pool … and merge the ISO PR');
  });

  it("gives the thinking model the whole call, a cut-off line marked", () => {
    const block = renderContinuity({ continuity: continuity() });
    expect(block).toContain("## Your recent calls with the owner, as transcribed while they ran — 1, newest first");
    expect(block).toContain('  you said: "on it"');
    expect(block).toContain('  the owner said: "then ping Ari about the" (cut off)');
  });

  it("states no total for the calls half when it could not be read whole", () => {
    const block = renderContinuity({
      continuity: continuity({ unread: [{ section: "calls", why: "1 call file(s) could not be read" }] }),
    });
    expect(block).toContain(
      "## Your recent calls with the owner, as transcribed while they ran — NOT wholly read, no total (1 read)",
    );
  });
});

// A call once rolled over at its cap while the owner walked a Slack thread with it, and the next call asked the owner
// to paste a link the voice had read off their Slack reply box — a link in no line they ever said.
describe("the link the last call was reading", () => {
  const LINK = "https://acme.slack.com/archives/C0SYNPLATFORM/p1759813000000100";
  const READ_AT = "2026-09-25T02:26:10.000Z";
  /** The tool line the page writes for an answered read, naming the link it opened. */
  const read = (over: Partial<Extract<CallRecord["notes"][number], { kind: "tool" }>> = {}) => ({
    answer: undefined,
    atIso: READ_AT,
    detail: "read",
    kind: "tool" as const,
    name: "slack_thread_after",
    opened: LINK,
    refused: false,
    ...over,
  });
  /** The call it happened on: a claim walked out of the thread, then an acknowledgement. */
  const walked = (...notes: CallRecord["notes"]): CallRecord =>
    call({
      notes,
      segments: [
        segment(),
        segment({
          atIso: "2026-09-25T02:27:00.000Z",
          id: "s-2",
          text: "Here's one: Rosa says Kieran is already drafting a migration path for the old API.",
          who: "voice",
        }),
        segment({ atIso: "2026-09-25T02:28:00.000Z", id: "s-3", text: "and that rubs me the wrong way" }),
        segment({ atIso: "2026-09-25T02:28:05.000Z", id: "s-4", text: "Mm-hm.", who: "voice" }),
      ],
    });

  it("carries the link, the tool that opened it, and the last claim the voice told the owner from it", () => {
    const [only] = callsSince({ calls: [walked(read())], sinceIso: SINCE });
    expect(only!.reading).toEqual({
      atIso: READ_AT,
      lastTold: "Here's one: Rosa says Kieran is already drafting a migration path for the old API.",
      link: LINK,
      tool: "slack_thread_after",
    });
  });

  it("is the newest answered read, never a refused one nor a tool that opened no link", () => {
    const newerRefused = read({ atIso: "2026-09-25T02:27:30.000Z", opened: `${LINK}9`, refused: true });
    const noLink = read({ atIso: "2026-09-25T02:27:40.000Z", name: "read_screen", opened: undefined });
    const older = read({ atIso: "2026-09-25T02:20:00.000Z", opened: `${LINK}0` });
    const [only] = callsSince({ calls: [walked(older, read(), newerRefused, noLink)], sinceIso: SINCE });
    expect(only!.reading!.link).toBe(LINK);
  });

  it("names no link when the newest read's was too long to carry, never an older one in its place", () => {
    const older = read({ atIso: "2026-09-25T02:20:00.000Z", opened: `${LINK}0` });
    const [only] = callsSince({ calls: [walked(older, read({ opened: null }))], sinceIso: SINCE });
    expect(only!.reading).toBe(undefined);
  });

  // A torn line may have been the newer read, so a file that skipped one vouches for no link.
  it("names no link when a line of the call did not parse", () => {
    const [only] = callsSince({ calls: [{ ...walked(read()), skipped: 1 }], sinceIso: SINCE });
    expect(only!.reading).toBe(undefined);
  });

  // A call file that could not be read at all may have been the last call, read after this one.
  it("names no link when a call file could not be read, since it may have been the last call", () => {
    const calls = callsSince({ calls: [walked(read())], sinceIso: SINCE });
    const torn = continuity({ calls, unread: [{ section: "calls", why: "1 call file(s) could not be read" }] });
    expect(readingLine({ continuity: torn, reader: "voice" })).toBe(undefined);
    expect(readingLine({ continuity: torn, reader: "tool" })).toBe(undefined);
    expect(readingLine({ continuity: continuity({ calls }), reader: "tool" })).toContain(`you were reading ${LINK}`);
  });

  // A clock that stepped back misleads the stamps, and a keepalive batch that overtook an older post misleads the
  // file; the same two lines say both, so a link is named only when the two orders agree.
  it("names no link when the file's order and the stamps' disagree on which read was newer", () => {
    const first = read({ atIso: "2026-09-25T02:27:00.000Z", opened: `${LINK}0` });
    const [only] = callsSince({ calls: [walked(first, read({ atIso: "2026-09-25T02:20:00.000Z" }))], sinceIso: SINCE });
    expect(only!.reading).toBe(undefined);
    const [agreed] = callsSince({
      calls: [walked(read({ atIso: "2026-09-25T02:20:00.000Z" }), first)],
      sinceIso: SINCE,
    });
    expect(agreed!.reading!.link).toBe(`${LINK}0`);
  });

  // Neither order tells two links stamped the same millisecond apart; the same link twice is one.
  it("names no link for two different reads stamped the same newest millisecond, and one for the same link twice", () => {
    const [tied] = callsSince({ calls: [walked(read({ opened: `${LINK}0` }), read())], sinceIso: SINCE });
    expect(tied!.reading).toBe(undefined);
    const [twice] = callsSince({ calls: [walked(read(), read({ detail: "again" }))], sinceIso: SINCE });
    expect(twice!.reading!.link).toBe(LINK);
  });

  // A delegated read's own line writes `null`, and its link rides only the line saying the
  // plan thread took the answer — so a newer read whose answer was lost names none, never the older one.
  it("on a delegated call, carries a read the plan thread took and names none past one whose answer was lost", () => {
    const tookAt = "2026-09-25T02:20:01.000Z";
    const earlier = read({ atIso: "2026-09-25T02:20:00.000Z", opened: null });
    const took = read({ atIso: tookAt, detail: "the plan thread took the answer", opened: `${LINK}0` });
    const [carried] = callsSince({ calls: [walked(earlier, took)], sinceIso: SINCE });
    expect(carried!.reading).toEqual({
      atIso: tookAt,
      lastTold: "Here's one: Rosa says Kieran is already drafting a migration path for the old API.",
      link: `${LINK}0`,
      tool: "slack_thread_after",
    });
    const lostRead = read({ opened: null });
    const lost = read({
      atIso: "2026-09-25T02:26:11.000Z",
      detail: "the answer was lost",
      opened: null,
      refused: true,
    });
    const [past] = callsSince({ calls: [walked(earlier, took, lostRead, lost)], sinceIso: SINCE });
    expect(past!.reading).toBe(undefined);
  });

  it("picks the told line by when it was said, not by where the file put it, and never the owner's own words", () => {
    const late = segment({
      atIso: "2026-09-25T02:29:00.000Z",
      id: "s-0",
      text: "Next one: Jasper found a session replay with eighteen idle minutes.",
      who: "voice",
    });
    const ownerSegment = segment({
      atIso: "2026-09-25T02:29:30.000Z",
      id: "s-9",
      text: "and what did Quinn ask about priority",
    });
    const [only] = callsSince({
      calls: [{ ...walked(read()), segments: [late, ...walked(read()).segments, ownerSegment] }],
      sinceIso: SINCE,
    });
    expect(only!.reading!.lastTold).toBe("Next one: Jasper found a session replay with eighteen idle minutes.");
  });

  it("is absent on a call that opened no link", () => {
    const [only] = callsSince({ calls: [walked(read({ opened: undefined }))], sinceIso: SINCE });
    expect(only!.reading).toBe(undefined);
  });

  it("names no told line when the voice said nothing past an acknowledgement after the read", () => {
    const [only] = callsSince({ calls: [walked(read({ atIso: "2026-09-25T02:27:30.000Z" }))], sinceIso: SINCE });
    expect(only!.reading!.lastTold).toBe(undefined);
  });

  it("tells the voice the link and to delegate for it, and the thinking model to open it with the tool", () => {
    const read1 = continuity({ calls: callsSince({ calls: [walked(read())], sinceIso: SINCE }) });
    const told = "Here's one: Rosa says Kieran is already drafting a migration path for the old API.";
    expect(continuityOpener({ continuity: read1, conversation: NO_TYPING })!.split("\n")[1]).toBe(
      `On the owner's last call with you, you were reading ${LINK} (opened with slack_thread_after at ${READ_AT}). ` +
        `The newest thing you told the owner after opening it was: "${told}". That is what the owner means when they refer back to it: ` +
        "delegate, naming that link, to open it again and carry on from there, and never ask them for the link or to paste it.",
    );
    const block = renderContinuity({ continuity: read1 });
    expect(block).toContain(
      `That is what the owner means when they refer back to it: open it again with slack_open and carry on from there`,
    );
    expect(block).toContain(`  last link it read: ${LINK} (slack_thread_after at ${READ_AT})`);
  });

  it("is no line when the newest call opened no link, and skips the told sentence when nothing was told", () => {
    expect(readingLine({ continuity: continuity(), reader: "tool" })).toBe(undefined);
    const untold = continuity({
      calls: callsSince({ calls: [walked(read({ atIso: "2026-09-25T02:27:30.000Z" }))], sinceIso: SINCE }),
    });
    expect(readingLine({ continuity: untold, reader: "tool" })).toBe(
      `On the owner's last call with you, you were reading ${LINK} (opened with slack_thread_after at 2026-09-25T02:27:30.000Z). ` +
        "That is what the owner means when they refer back to it: open it again with slack_open and carry on from " +
        "there, and never ask them for the link or to paste it.",
    );
  });

  it("reopens a Slack thread whole with slack_open, and any other link with the tool that opened it", () => {
    const pr = "https://github.com/lachiejames/slopweaver/pull/1";
    const browsed = continuity({
      calls: callsSince({
        calls: [walked(read({ atIso: "2026-09-25T02:27:30.000Z", name: "browser", opened: pr }))],
        sinceIso: SINCE,
      }),
    });
    expect(readingLine({ continuity: browsed, reader: "tool" })).toContain("open it again with browser and carry on");
  });

  it("names only the NEWEST call's link, never an older call's", () => {
    const older = call({ callId: "older", lastIso: "2026-09-25T01:00:00.000Z", notes: [read()] });
    const newest = call({ callId: "newest", lastIso: "2026-09-25T03:00:00.000Z" });
    const both = continuity({ calls: callsSince({ calls: [older, newest], sinceIso: SINCE }) });
    expect(readingLine({ continuity: both, reader: "voice" })).toBe(undefined);
  });

  it("rides into a rollover's and a reconnect's opener, after the previous call's exchange", () => {
    const read1 = continuity({ calls: callsSince({ calls: [walked(read())], sinceIso: SINCE }) });
    const rolled = mintOpener({ continuity: read1, conversation: NO_TYPING, mode: "rollover" })!;
    expect(rolled.startsWith(rolloverOpener({ continuity: read1 }))).toBe(true);
    expect(rolled).toContain(`you were reading ${LINK}`);
    const reopened = mintOpener({ continuity: read1, conversation: NO_TYPING, mode: "reconnect" })!;
    expect(reopened.startsWith(reconnectOpener({ continuity: read1 }))).toBe(true);
    expect(reopened).toContain(`you were reading ${LINK}`);
  });

  it("keeps the link whole when the read is cut to the tool cap", () => {
    const bounded = continuityForTool({
      continuity: continuity({ calls: callsSince({ calls: [walked(read())], sinceIso: SINCE }) }),
      maxBytes: CONTINUITY_MAX_BYTES,
    });
    expect(bounded.calls[0]!.reading!.link).toBe(LINK);
  });
});

describe("continuityForTool with calls", () => {
  it("cuts the only call's oldest lines to fit, counting them, rather than dropping the call", () => {
    const long = "w".repeat(2000);
    const segments = Array.from({ length: 40 }, (_, index) =>
      segment({ id: `s-${String(index)}`, text: `${String(index)} ${long}` }),
    );
    const bounded = continuityForTool({
      continuity: continuity({ calls: callsSince({ calls: [call({ segments })], sinceIso: SINCE }), steers: [] }),
      maxBytes: CONTINUITY_MAX_BYTES,
    });
    expect(Buffer.byteLength(JSON.stringify(bounded), "utf8")).toBeLessThanOrEqual(CONTINUITY_MAX_BYTES);
    expect(bounded.calls.length).toBe(1);
    expect(bounded.calls[0]!.lines.length + bounded.calls[0]!.linesCut).toBe(40);
    expect(bounded.calls[0]!.lines.at(-1)!.text.startsWith("39 ")).toBe(true);
    expect(bounded.notShown.calls).toBe(0);
  });
});

// A call that hits its limit reconnects on its own and the conversation carries on as one.
describe("the opener a reconnect is minted with", () => {
  it("says it is a reconnect and quotes the dropped call's last exchange, a cut-off line marked", () => {
    const opener = reconnectOpener({ continuity: continuity() }).split("\n");
    expect(opener[0]).toBe(
      "This call is an AUTOMATIC RECONNECT: the owner's last call with you dropped a moment ago and the console reopened it on",
    );
    expect(opener.slice(4)).toEqual([
      "The dropped call (no end recorded — it dropped or the page went away; last heard 2026-09-25T02:29:40.000Z) ended on this exchange, oldest first:",
      '- the owner: "look at the staging pool"',
      '- you: "on it"',
      '- the owner: "and merge the ISO PR once CI is green"',
      '- the owner (cut off mid-sentence): "then ping Ari about the"',
      "If your own last line was cut off answering the owner, finish that thought; a line they did not ask for stays dropped.",
      "Otherwise answer their last words if they went unanswered, and if not, say nothing until they speak.",
    ]);
  });

  // The reconnect once told the voice to say it was back, a status the owner never asked for.
  it("never has the voice announce the reconnect unasked", () => {
    const opener = reconnectOpener({ continuity: continuity() }).split("\n");
    expect(opener.slice(1, 4)).toEqual([
      "its own, so it is the same conversation carrying on. Never greet the owner as a new call, never say you are back or",
      "reconnected unless they ask, and never ask them to repeat themselves. If they were showing their screen, the share carried",
      "over, so read_screen works without asking them to share again.",
    ]);
    expect(opener.filter((line) => line.includes("that you're back"))).toEqual([]);
  });

  it("quotes only the newest six lines", () => {
    const segments = Array.from({ length: 9 }, (_, index) =>
      segment({ id: `s-${String(index)}`, text: `line ${String(index)}` }),
    );
    const opener = reconnectOpener({
      continuity: continuity({ calls: callsSince({ calls: [call({ segments })], sinceIso: SINCE }) }),
    });
    expect(opener.split("\n").filter((line) => line.startsWith("- the owner"))).toEqual([
      '- the owner: "line 3"',
      '- the owner: "line 4"',
      '- the owner: "line 5"',
      '- the owner: "line 6"',
      '- the owner: "line 7"',
      '- the owner: "line 8"',
    ]);
  });

  it("still says it is a reconnect when no call was written down", () => {
    const opener = reconnectOpener({ continuity: continuity({ calls: [] }) }).split("\n");
    expect(opener.length).toBe(4);
    expect(opener[3]).toBe("over, so read_screen works without asking them to share again.");
  });

  it("leads an ordinary opener with the reconnect's lines, and leaves a pressed start's opener exactly as it was", () => {
    const ordinary = continuityOpener({ continuity: continuity(), conversation: NO_TYPING })!;
    const later = continuity({ builtIso: "2026-09-25T05:00:00.000Z" });
    expect(mintOpener({ continuity: later, conversation: NO_TYPING, mode: "fresh" })).toBe(
      continuityOpener({ continuity: later, conversation: NO_TYPING }),
    );
    expect(mintOpener({ continuity: continuity(), conversation: NO_TYPING, mode: "reconnect" })).toBe(
      `${reconnectOpener({ continuity: continuity() })}\n\n${ordinary}`,
    );
  });

  it("is the reconnect's lines alone when an ordinary start would carry nothing", () => {
    const spokenNoSteer = continuity({
      builtIso: "2026-09-25T05:00:00.000Z",
      calls: callsSince({ calls: [call({ segments: [segment({ who: "voice" })] })], sinceIso: SINCE }),
      steers: [],
    });
    expect(mintOpener({ continuity: spokenNoSteer, conversation: NO_TYPING, mode: "fresh" })).toBe(undefined);
    expect(mintOpener({ continuity: spokenNoSteer, conversation: NO_TYPING, mode: "reconnect" })).toBe(
      reconnectOpener({ continuity: spokenNoSteer }),
    );
  });
});

// The console's own 90-minute limit cut the owner off mid-sentence; a rollover in a pause replaces it.
describe("the opener a rollover is minted with", () => {
  it("quotes the call before it as rolled over, never dropped, and answers the owner's words it left unanswered", () => {
    const opener = rolloverOpener({ continuity: continuity() }).split("\n");
    expect(opener.slice(0, 4)).toEqual(SILENT_ROLLOVER.slice(0, 4));
    expect(opener.slice(4)).toEqual([
      "The call before this one (rolled over onto this call in a pause) ended on this exchange, oldest first:",
      '- the owner: "look at the staging pool"',
      '- you: "on it"',
      '- the owner: "and merge the ISO PR once CI is green"',
      '- the owner (cut off mid-sentence): "then ping Ari about the"',
      "If the owner's last words in it went unanswered, answer them now as the same call; otherwise say NOTHING until they speak.",
    ]);
    expect(opener.filter((line) => line.includes("that you're back"))).toEqual([]);
  });

  // The page releases the old call before its close reaches the file, so the file read alone says it dropped; the
  // successor was told so under "nothing happened" and its recap of the exchange came out wrong.
  it("says the rollover however the call before it reads on disk, while a reconnect keeps the file's own end", () => {
    const [read] = continuity().calls;
    expect(read!.end).toBe("no end recorded — it dropped or the page went away; last heard 2026-09-25T02:29:40.000Z");
    expect(rolloverOpener({ continuity: continuity() })).not.toContain("no end recorded");
    expect(reconnectOpener({ continuity: continuity() })).toContain(
      "The dropped call (no end recorded — it dropped or the page went away; last heard 2026-09-25T02:29:40.000Z) ended",
    );
  });

  it("ends on the conditional whatever the quoted exchange ends on, the voice's answer included", () => {
    const answered = continuity({
      calls: callsSince({
        calls: [
          call({
            segments: [
              segment({ atIso: "2026-09-25T02:25:00.000Z", id: "s-1", text: "is the pool healthy", who: "owner" }),
              segment({ atIso: "2026-09-25T02:25:30.000Z", id: "s-2", text: "yes, all twelve are up", who: "voice" }),
            ],
          }),
        ],
        sinceIso: SINCE,
      }),
    });
    expect(rolloverOpener({ continuity: answered }).split("\n").slice(4)).toEqual([
      "The call before this one (rolled over onto this call in a pause) ended on this exchange, oldest first:",
      '- the owner: "is the pool healthy"',
      '- you: "yes, all twelve are up"',
      "If the owner's last words in it went unanswered, answer them now as the same call; otherwise say NOTHING until they speak.",
    ]);
  });

  it("is the silent lines alone when no call was written down", () => {
    expect(rolloverOpener({ continuity: continuity({ calls: [] }) }).split("\n")).toEqual(SILENT_ROLLOVER);
  });

  it("leads an ordinary opener with the rollover's lines, and is them alone when an ordinary start carries nothing", () => {
    const ordinary = continuityOpener({ continuity: continuity(), conversation: NO_TYPING })!;
    expect(mintOpener({ continuity: continuity(), conversation: NO_TYPING, mode: "rollover" })).toBe(
      `${rolloverOpener({ continuity: continuity() })}\n\n${ordinary}`,
    );
    const spokenNoSteer = continuity({
      builtIso: "2026-09-25T05:00:00.000Z",
      calls: callsSince({ calls: [call({ segments: [segment({ who: "voice" })] })], sinceIso: SINCE }),
      steers: [],
    });
    expect(mintOpener({ continuity: spokenNoSteer, conversation: NO_TYPING, mode: "rollover" })).toBe(
      rolloverOpener({ continuity: spokenNoSteer }),
    );
  });
});
