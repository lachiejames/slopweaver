import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  parseSlackAwaitingDocument,
  renderSlackAwaitingJson,
  renderSlackAwaitingText,
  type SlackAwaitingReadInput,
  slackAwaitingDocument,
} from "../../../../live/slack/awaitingDocument.js";
import { writeSlackAwaitingDocument } from "../../../../live/slack/awaitingStore.js";
import {
  replyAskOf,
  type SlackAwaitingCandidate,
  type SlackThreadPerson,
} from "../../../../sessionStart/slackAwaiting.js";
import { stateHomePaths } from "../../../../stateHome.js";

const OWNER = "U0SYNOWNER1234";
const ALICE = "U0SYNALICE1234";
const BOB = "U0SYNBOB123456";
/** A weekday 11:00 Melbourne. */
const NOW = "2026-09-30T01:00:00.000Z";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A channel thread whose last human word is the owner's, typed at `tsIso`.
 *
 * @param threadTs the root ts, which also names the thread
 * @param tsIso when the owner spoke last
 * @param says what the owner typed, mention runs intact
 * @returns the candidate
 */
function waitingThread({
  threadTs,
  tsIso,
  says,
  people = [],
}: {
  threadTs: string;
  tsIso: string;
  says: string;
  people?: readonly SlackThreadPerson[];
}): SlackAwaitingCandidate {
  return {
    channelId: "C0SYNCHANNEL1",
    channelName: "a-channel",
    hasReplies: people.length > 0,
    ownerWords: [
      {
        ask: replyAskOf({ authoredText: says, ownerId: OWNER, selfIds: new Set() }),
        ownTs: Date.parse(tsIso) / 1000,
        permalink: `https://example.slack.com/archives/C0SYNCHANNEL1/p${threadTs.replace(".", "")}`,
        pullRequests: [{ number: 17_316, owner: "acme", repo: "acme-admin" }],
        quote: says,
        reactedBy: [],
        tsIso,
      },
    ],
    people,
    threadTs,
  };
}

const ALICE_SPOKE: SlackThreadPerson = {
  id: ALICE,
  isHuman: true,
  lastIso: "2026-09-27T23:00:00.000Z",
  lastOwnTs: 1_790_550_000,
  name: "Alice",
  taggable: true,
};
const BOB_TAGGED: SlackThreadPerson = { id: BOB, isHuman: true, name: "Bob", taggable: true };

/**
 * The reader's result over some candidates.
 *
 * @param status the read's own verdict
 * @returns the read input
 */
function read({
  candidates,
  status = "complete",
}: {
  candidates: readonly SlackAwaitingCandidate[];
  status?: SlackAwaitingReadInput["status"];
}): SlackAwaitingReadInput {
  return {
    awaitingCandidates: candidates,
    couldNotSee: [],
    status,
    threadsSpokenIn: candidates.length,
    windowDays: 14,
  };
}

describe("slackAwaitingDocument", () => {
  it("rows a thread quiet on the owner's ask, the people tagged first and the linked pull request carried", () => {
    const document = slackAwaitingDocument({
      nowIso: NOW,
      read: read({
        candidates: [
          waitingThread({
            people: [ALICE_SPOKE, BOB_TAGGED],
            says: `<@${BOB}> is this still blocked?`,
            threadTs: "1790500000.000100",
            tsIso: "2026-09-28T00:00:00.000Z",
          }),
        ],
      }),
    });
    expect(document.status).toBe("complete");
    expect(document.threads).toStrictEqual([
      {
        asksQuestion: true,
        businessHoursQuiet: 49,
        channelId: "C0SYNCHANNEL1",
        channelName: "a-channel",
        hasReplies: true,
        nativeId: "C0SYNCHANNEL1:1790500000.000100",
        ownerLastText: `<@${BOB}> is this still blocked?`,
        ownerLastWordAtIso: "2026-09-28T00:00:00.000Z",
        people: [
          { id: BOB, name: "Bob", tagged: true, taggable: true },
          { id: ALICE, lastWordAtIso: "2026-09-27T23:00:00.000Z", name: "Alice", tagged: false, taggable: true },
        ],
        permalink: "https://example.slack.com/archives/C0SYNCHANNEL1/p1790500000000100",
        pullRequests: [{ number: 17_316, owner: "acme", repo: "acme-admin" }],
        tagsGroup: false,
        threadTs: "1790500000.000100",
      },
    ]);
  });

  it("orders rows longest quiet first and counts every thread it left out", () => {
    const document = slackAwaitingDocument({
      nowIso: NOW,
      read: read({
        candidates: [
          waitingThread({ says: "ready?", threadTs: "1790500000.000200", tsIso: "2026-09-28T00:00:00.000Z" }),
          waitingThread({ says: "ready?", threadTs: "1790400000.000100", tsIso: "2026-09-24T00:00:00.000Z" }),
          waitingThread({ says: "ready?", threadTs: "1790600000.000100", tsIso: "2026-09-29T00:00:00.000Z" }),
          waitingThread({ says: "thanks", threadTs: "1790600000.000200", tsIso: "2026-09-24T00:00:00.000Z" }),
        ],
      }),
    });
    expect(document.threads.map((row) => [row.threadTs, row.businessHoursQuiet])).toStrictEqual([
      ["1790400000.000100", 97],
      ["1790500000.000200", 49],
    ]);
    expect(document.counts).toStrictEqual({
      answered: 0,
      awaiting: 2,
      directMessagesNotJudged: 0,
      insideChaseWait: 1,
      noAsk: 1,
      threadsSpokenIn: 4,
      undated: 0,
    });
  });

  it("marks the read incomplete and says so first when an instant could not be read", () => {
    const document = slackAwaitingDocument({
      nowIso: NOW,
      read: read({ candidates: [waitingThread({ says: "ok?", threadTs: "1790500000.000100", tsIso: "zzzz" })] }),
    });
    expect(document.status).toBe("incomplete");
    expect(document.coverage.residue[0]).toBe(
      "1 thread(s) carry an instant the business clock cannot read, so one may be awaiting and not shown",
    );
  });

  it("rows nothing on a read that could not see, never an all-clear", () => {
    const document = slackAwaitingDocument({
      nowIso: NOW,
      read: {
        ...read({
          candidates: [
            waitingThread({ says: "ok?", threadTs: "1790500000.000100", tsIso: "2026-09-24T00:00:00.000Z" }),
          ],
          status: "unavailable",
        }),
        couldNotSee: ["the profile declares no slackBot.ownerUserId"],
      },
    });
    expect([document.status, document.threads]).toStrictEqual(["unavailable", []]);
    expect(document.coverage.residue[0]).toBe("the profile declares no slackBot.ownerUserId");
    expect(renderSlackAwaitingText({ document })[0]).toBe(
      "slack awaiting: UNAVAILABLE — the read could not see, so this is NOT an all-clear (reason under residue)",
    );
  });
});

describe("renderSlackAwaitingText", () => {
  it("prints one block per row naming the taggable people, then the residue", () => {
    const document = slackAwaitingDocument({
      nowIso: NOW,
      read: read({
        candidates: [
          waitingThread({
            people: [ALICE_SPOKE],
            says: "<!here> who owns this?",
            threadTs: "1790500000.000100",
            tsIso: "2026-09-28T00:00:00.000Z",
          }),
        ],
      }),
    });
    const lines = renderSlackAwaitingText({ document });
    expect(lines.slice(1, 5)).toStrictEqual([
      "49h quiet · #a-channel · you spoke last 2026-09-28T00:00:00.000Z · asks · tags a group",
      '  "<!here> who owns this?"',
      "  people: Alice",
      "  https://example.slack.com/archives/C0SYNCHANNEL1/p1790500000000100",
    ]);
    expect(lines[5]).toBe("residue:");
  });
});

describe("parseSlackAwaitingDocument", () => {
  it("round-trips its own JSON rendering", () => {
    const document = slackAwaitingDocument({ nowIso: NOW, read: read({ candidates: [] }) });
    const parsed = parseSlackAwaitingDocument({ value: JSON.parse(renderSlackAwaitingJson({ document })) });
    expect(unwrap(parsed)).toStrictEqual(document);
  });

  it("refuses another schema version by its path, the retired version 1 included", () => {
    const document = slackAwaitingDocument({ nowIso: NOW, read: read({ candidates: [] }) });
    const refused = parseSlackAwaitingDocument({ value: { ...document, schemaVersion: 1 } });
    expect(unwrapErr(refused)[0]).toContain("schemaVersion");
  });
});

describe("writeSlackAwaitingDocument", () => {
  it("replaces live/slack/awaiting.json with the document", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-awaitingstore-"));
    homes.push(home);
    const document = slackAwaitingDocument({ nowIso: NOW, read: read({ candidates: [] }) });
    const written = unwrap(writeSlackAwaitingDocument({ document, home }));
    expect(written.path).toBe(stateHomePaths({ home }).live.slack.awaitingJson);
    expect(written.path).toBe(join(home, "live", "slack", "awaiting.json"));
    expect(JSON.parse(readFileSync(written.path, "utf8"))).toStrictEqual(document);
  });
});
