import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { SlackOwedReadInput } from "../../../../live/slack/owedDocument.js";
import {
  parseSlackOwedDocument,
  renderSlackOwedJson,
  renderSlackOwedText,
  slackOwedDocument,
} from "../../../../live/slack/owedDocument.js";
import type { SlackThread } from "../../../../sessionStart/slackLeg.js";

const NOW = "2026-09-26T00:00:00.000Z";
const CORPUS_LINE =
  "your Slack rows are the corpus's own copy, 14 days back, and nothing was re-read live — somebody may have replied for you since";

const thread = (over: Partial<SlackThread> = {}): SlackThread => ({
  channelId: "C0SYNCHANNEL1",
  channelName: "#a-channel",
  lastAuthorIsHuman: true,
  lastAuthorIsSelf: false,
  lastAuthorName: "Alex",
  lastIso: "2026-09-25T03:04:05.000Z",
  lastNamesAnybody: false,
  lastText: "shipped it",
  mentionsOwner: false,
  ownerLastIso: "2026-09-24T22:10:00.000Z",
  ownerLatestTagsLastAuthor: false,
  ownerStartedThread: false,
  permalink: "https://example.slack.com/archives/C0SYNCHANNEL1/p1790305445000100",
  threadTs: "1790300000.000100",
  ...over,
});

const read = (over: Partial<SlackOwedReadInput> = {}): SlackOwedReadInput => ({
  couldNotSee: [CORPUS_LINE],
  movedWithoutOwner: 0,
  movementThreads: [],
  status: "complete",
  taggedWithoutOwner: 0,
  threadsSpokenIn: 0,
  windowDays: 14,
  ...over,
});

const ADDRESSED_QUESTION = thread({
  channelId: "D0SYNDIRECT01",
  lastIso: "2026-09-24T09:00:00.000Z",
  lastText: "can you review?",
  permalink: "https://example.slack.com/archives/D0SYNDIRECT01/p1790240400000100",
  threadTs: "1790200000.000100",
});
const AMBIENT = thread();
const BOT_LAST = thread({ channelId: "C0SYNCHANNEL2", lastAuthorIsHuman: false, lastAuthorIsSelf: true });

describe("slackOwedDocument", () => {
  it("builds the exact document for one addressed question and one ambient row", () => {
    const document = slackOwedDocument({
      nowIso: NOW,
      read: read({
        movedWithoutOwner: 3,
        movementThreads: [ADDRESSED_QUESTION, AMBIENT, BOT_LAST],
        taggedWithoutOwner: 2,
        threadsSpokenIn: 9,
      }),
    });
    expect(document).toStrictEqual({
      counts: {
        mentionOnlyOutstanding: 2,
        movedWithoutOwner: 3,
        nonHumanLastWords: 1,
        owedToHumans: 2,
        threadsSpokenIn: 9,
      },
      coverage: {
        kind: "bounded",
        residue: [
          CORPUS_LINE,
          "only threads you spoke in during the last 14 days qualify",
          "a record with no author at all — a file share, a huddle, a canvas — is read as nobody's word, so a reply posted that way is not seen",
          "a direct message you never answered is invisible here: the reader reaches a thread only through a message of yours",
          "2 thread(s) that tagged you and you have not spoken in are not listed here — `slopweaver slack tagged` lists every tag",
          "1 thread(s) whose last word is a bot, an app or Slackbot are excluded",
        ],
        sinceIso: "2026-09-12T00:00:00.000Z",
        windowDays: 14,
      },
      observedAtIso: NOW,
      producer: "slack owed",
      schemaVersion: 1,
      status: "complete",
      threads: [
        {
          asksQuestion: false,
          audience: "ambient",
          channelId: "C0SYNCHANNEL1",
          channelName: "#a-channel",
          lastAuthorName: "Alex",
          lastText: "shipped it",
          lastWordAtIso: "2026-09-25T03:04:05.000Z",
          nativeId: "C0SYNCHANNEL1:1790300000.000100",
          ownerLastWordAtIso: "2026-09-24T22:10:00.000Z",
          permalink: "https://example.slack.com/archives/C0SYNCHANNEL1/p1790305445000100",
          threadTs: "1790300000.000100",
        },
        {
          asksQuestion: true,
          audience: "addressed",
          channelId: "D0SYNDIRECT01",
          channelName: "#a-channel",
          lastAuthorName: "Alex",
          lastText: "can you review?",
          lastWordAtIso: "2026-09-24T09:00:00.000Z",
          nativeId: "D0SYNDIRECT01:1790200000.000100",
          ownerLastWordAtIso: "2026-09-24T22:10:00.000Z",
          permalink: "https://example.slack.com/archives/D0SYNDIRECT01/p1790240400000100",
          threadTs: "1790200000.000100",
        },
      ],
    });
  });

  it("keeps audience binary: an addressed message with no question is addressed, not asked", () => {
    const document = slackOwedDocument({
      nowIso: NOW,
      read: read({ movementThreads: [thread({ lastText: "thanks", mentionsOwner: true })] }),
    });
    expect(document.threads.map((row) => [row.audience, row.asksQuestion])).toStrictEqual([["addressed", false]]);
  });

  it("marks a question naming nobody under the owner's own post as asking, while its audience stays ambient", () => {
    const document = slackOwedDocument({
      nowIso: NOW,
      read: read({
        movementThreads: [thread({ lastText: "what are you trying to achieve there?", ownerStartedThread: true })],
      }),
    });
    expect(document.threads.map((row) => [row.audience, row.asksQuestion])).toStrictEqual([["ambient", true]]);
  });

  it("marks an untagged question from the person the owner's latest word tagged as asking — the sign-off case", () => {
    const document = slackOwedDocument({
      nowIso: NOW,
      read: read({
        movementThreads: [
          thread({
            lastText: "Is it fixed cost or variable cost? I'm happy to approve that",
            ownerLatestTagsLastAuthor: true,
          }),
        ],
      }),
    });
    expect(document.threads.map((row) => [row.audience, row.asksQuestion])).toStrictEqual([["ambient", true]]);
  });

  it("never marks an ambient message as asking, even when it carries a question mark", () => {
    const document = slackOwedDocument({
      nowIso: NOW,
      read: read({ movementThreads: [thread({ lastText: "anyone know?" })] }),
    });
    expect(document.threads.map((row) => [row.audience, row.asksQuestion])).toStrictEqual([["ambient", false]]);
  });

  it("orders newest last word first, breaking a tie by nativeId", () => {
    const document = slackOwedDocument({
      nowIso: NOW,
      read: read({
        movementThreads: [
          thread({ channelId: "C0B", lastIso: "2026-09-20T00:00:00.000Z" }),
          thread({ channelId: "C0C", lastIso: "2026-09-25T00:00:00.000Z" }),
          thread({ channelId: "C0A", lastIso: "2026-09-25T00:00:00.000Z" }),
        ],
      }),
    });
    expect(document.threads.map((row) => row.channelId)).toStrictEqual(["C0A", "C0C", "C0B"]);
  });

  it("still carries the whole residue when nothing is owed", () => {
    const document = slackOwedDocument({ nowIso: NOW, read: read() });
    expect(document.status).toBe("complete");
    expect(document.threads).toStrictEqual([]);
    expect(document.coverage.residue).toHaveLength(6);
  });

  it("drops every thread and leads the residue with the reason when the read was unavailable", () => {
    const document = slackOwedDocument({
      nowIso: NOW,
      read: read({
        couldNotSee: ["your Slack threads are not here: profile.json declares no `slackBot.ownerUserId`"],
        movementThreads: [AMBIENT],
        status: "unavailable",
      }),
    });
    expect(document.status).toBe("unavailable");
    expect(document.threads).toStrictEqual([]);
    expect(document.coverage.residue[0]).toBe(
      "your Slack threads are not here: profile.json declares no `slackBot.ownerUserId`",
    );
  });

  it("keeps the threads it could read, and the lost-lines reason first, when the read was incomplete", () => {
    const document = slackOwedDocument({
      nowIso: NOW,
      read: read({ couldNotSee: ["1 corpus line(s) did not parse"], movementThreads: [AMBIENT], status: "incomplete" }),
    });
    expect(document.status).toBe("incomplete");
    expect(document.threads).toHaveLength(1);
    expect(document.coverage.residue[0]).toBe("1 corpus line(s) did not parse");
  });

  it("reads a thread a person spoke last in that makes no row as INCOMPLETE, never a complete zero", () => {
    const document = slackOwedDocument({ nowIso: NOW, read: read({ movementThreads: [thread({ permalink: "" })] }) });
    expect(document.status).toBe("incomplete");
    expect(document.threads).toStrictEqual([]);
    expect(document.coverage.residue[0]).toBe(
      "1 thread(s) where a person spoke last could not be listed (a field such as the permalink is missing), so one may be owed and not shown",
    );
  });
});

describe("parseSlackOwedDocument", () => {
  const produced = slackOwedDocument({ nowIso: NOW, read: read({ movementThreads: [ADDRESSED_QUESTION, AMBIENT] }) });

  it("accepts the document the builder produced, after a JSON round trip", () => {
    const parsed = parseSlackOwedDocument({ value: JSON.parse(renderSlackOwedJson({ document: produced })) });
    expect(unwrap(parsed)).toStrictEqual(produced);
  });

  it("refuses an unknown schema version", () => {
    const parsed = parseSlackOwedDocument({ value: { ...produced, schemaVersion: 2 } });
    expect(unwrapErr(parsed)[0]).toContain("schemaVersion");
  });

  it("refuses a malformed instant", () => {
    const parsed = parseSlackOwedDocument({ value: { ...produced, observedAtIso: "yesterday" } });
    expect(unwrapErr(parsed)[0]).toContain("observedAtIso");
  });

  it("refuses a document with no residue", () => {
    const parsed = parseSlackOwedDocument({ value: { ...produced, coverage: { ...produced.coverage, residue: [] } } });
    expect(unwrapErr(parsed)[0]).toContain("coverage.residue");
  });

  it("refuses a thread record carrying a field the contract does not name", () => {
    const threads = [{ ...produced.threads[0]!, score: 3 }];
    const parsed = parseSlackOwedDocument({ value: { ...produced, threads } });
    expect(unwrapErr(parsed)[0]).toContain("threads.0");
  });

  it("reads a stored document whose moved count carries the pronoun key as movedWithoutOwner", () => {
    const { movedWithoutOwner, ...rest } = produced.counts;
    const stored = { ...produced, counts: { ...rest, movedWithoutHim: 7 } };
    expect(movedWithoutOwner).toBe(0);
    expect(unwrap(parseSlackOwedDocument({ value: stored })).counts.movedWithoutOwner).toBe(7);
  });

  it("refuses a document declaring the moved count under both keys", () => {
    const stored = { ...produced, counts: { ...produced.counts, movedWithoutHim: 7 } };
    expect(unwrapErr(parseSlackOwedDocument({ value: stored }))[0]).toContain("counts");
  });
});

describe("renderSlackOwedText", () => {
  it("prints each row's room, author, both instants and permalink, then every residue line", () => {
    const document = slackOwedDocument({
      nowIso: NOW,
      read: read({ movementThreads: [ADDRESSED_QUESTION, AMBIENT], threadsSpokenIn: 4 }),
    });
    expect(renderSlackOwedText({ document })).toStrictEqual([
      "slack owed: 2 thread(s) you spoke in where a person has the last word (4 spoken in since 2026-09-12T00:00:00.000Z)",
      "AMBIENT · #a-channel · Alex spoke last 2026-09-25T03:04:05.000Z",
      "  you last spoke 2026-09-24T22:10:00.000Z",
      "  https://example.slack.com/archives/C0SYNCHANNEL1/p1790305445000100",
      "ADDRESSED · asks a question · a direct message · Alex spoke last 2026-09-24T09:00:00.000Z",
      "  you last spoke 2026-09-24T22:10:00.000Z",
      "  https://example.slack.com/archives/D0SYNDIRECT01/p1790240400000100",
      "residue:",
      `  - ${CORPUS_LINE}`,
      "  - only threads you spoke in during the last 14 days qualify",
      "  - a record with no author at all — a file share, a huddle, a canvas — is read as nobody's word, so a reply posted that way is not seen",
      "  - a direct message you never answered is invisible here: the reader reaches a thread only through a message of yours",
      "  - 0 thread(s) that tagged you and you have not spoken in are not listed here — `slopweaver slack tagged` lists every tag",
      "  - 0 thread(s) whose last word is a bot, an app or Slackbot are excluded",
    ]);
  });

  it("opens an incomplete document by saying it is not an all-clear", () => {
    const document = slackOwedDocument({
      nowIso: NOW,
      read: read({ movementThreads: [AMBIENT], status: "incomplete" }),
    });
    expect(renderSlackOwedText({ document })[0]).toBe(
      "slack owed: INCOMPLETE — 1 thread(s) listed from what could be read, and a reply may be missing, so this is NOT an all-clear (reason under residue)",
    );
  });

  it("opens an unavailable document by saying it is not an all-clear", () => {
    const document = slackOwedDocument({ nowIso: NOW, read: read({ status: "unavailable" }) });
    expect(renderSlackOwedText({ document })[0]).toBe(
      "slack owed: UNAVAILABLE — the read could not see, so this is NOT an all-clear (reason under residue)",
    );
  });
});
