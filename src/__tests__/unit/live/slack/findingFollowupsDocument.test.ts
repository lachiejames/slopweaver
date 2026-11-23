/**
 * The `slack finding-followups` document: only a finding coming back gets a row, a claimed fix leads, every in-hand
 * finding is still counted, and an unavailable read is never an empty all-clear.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type FindingFollowupsReadInput,
  findingFollowupsDocument,
  parseFindingFollowupsDocument,
  renderFindingFollowupsJson,
  renderFindingFollowupsText,
} from "../../../../live/slack/findingFollowupsDocument.js";
import type { SharedFinding } from "../../../../outbound/slack/sharedFindings.js";
import type { FindingThreadMessage } from "../../../../sessionStart/findingFollowups.js";

/** A Monday 11:00 Melbourne. */
const NOW = "2026-10-19T00:00:00.000Z";
const CHANNEL = "C0SYN000001";

/** One shared finding landing at `ts` / `postedAtIso`. */
function finding({ id, ts, postedAtIso }: { id: string; ts: string; postedAtIso: string }): SharedFinding {
  return { channelId: CHANNEL, draftId: id, messageTs: ts, postedAtIso, threadTs: ts, why: `the ${id} finding` };
}

/** One person's reply. */
function reply({ ts, tsIso, text }: { ts: string; tsIso: string; text: string }): FindingThreadMessage {
  return { authorId: "U0SYNHUMAN123", permalink: `https://example.slack.com/p${ts}`, role: "person", text, ts, tsIso };
}

const READ: FindingFollowupsReadInput = {
  couldNotSee: [],
  olderThanWindow: 2,
  owed: [
    {
      finding: finding({ id: "sd-aa000001", postedAtIso: "2026-10-15T00:00:00.000Z", ts: "1792000000.000100" }),
      messages: [],
    },
    {
      finding: finding({ id: "sd-aa000002", postedAtIso: "2026-10-16T00:00:00.000Z", ts: "1792100000.000100" }),
      messages: [
        reply({ text: "all sorted, merged the fix", ts: "1792100100.000100", tsIso: "2026-10-18T22:00:00.000Z" }),
      ],
    },
    {
      finding: finding({ id: "sd-aa000003", postedAtIso: "2026-10-16T00:00:00.000Z", ts: "1792200000.000100" }),
      messages: [
        reply({ text: "that's the nightly sync retrying", ts: "1792200100.000100", tsIso: "2026-10-16T01:00:00.000Z" }),
      ],
    },
    {
      finding: finding({ id: "sd-aa000004", postedAtIso: "2026-10-18T23:00:00.000Z", ts: "1792300000.000100" }),
      messages: [],
    },
  ],
  spent: [{ findingId: "sd-aa000009" }],
  status: "complete",
  windowDays: 14,
};

describe("findingFollowupsDocument", () => {
  const document = findingFollowupsDocument({ nowIso: NOW, read: READ });

  it("rows only what comes back — a claimed fix first, then the longest quiet — and counts every finding", () => {
    expect(document.followups.map((row) => [row.findingId, row.verdict, row.businessHoursQuiet])).toStrictEqual([
      ["sd-aa000002", "claimed-fixed", undefined],
      ["sd-aa000001", "quiet", 48],
    ]);
    expect(document.followups[0]!.teamWord).toStrictEqual({
      atIso: "2026-10-18T22:00:00.000Z",
      authorId: "U0SYNHUMAN123",
      permalink: "https://example.slack.com/p1792100100.000100",
      quote: "all sorted, merged the fix",
      ts: "1792100100.000100",
    });
    expect(document.counts).toStrictEqual({
      answered: 1,
      cardSpent: 1,
      claimedFixed: 1,
      insideFirstBusinessDay: 1,
      olderThanWindow: 2,
      owed: 4,
      ownerSpoke: 0,
      quiet: 1,
      stalled: 0,
      timedPromise: 0,
      undated: 0,
    });
    expect(document.coverage.sinceIso).toBe("2026-10-05T00:00:00.000Z");
  });

  it("round-trips through its own strict schema", () => {
    const parsed = parseFindingFollowupsDocument({ value: JSON.parse(renderFindingFollowupsJson({ document })) });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toStrictEqual(document);
  });

  it("refuses a key the schema never declared", () => {
    const parsed = parseFindingFollowupsDocument({ value: { ...document, extra: true } });
    expect(unwrapErr(parsed)).toStrictEqual([': Unrecognized key: "extra"']);
  });

  it("prints a header saying what is listed, one block per row, then the residue", () => {
    const lines = renderFindingFollowupsText({ document });
    expect(lines.slice(0, 5)).toStrictEqual([
      "slack finding-followups: 2 shared finding(s) owed their one follow-up card, of 4 shared since 2026-10-05T00:00:00.000Z with the card unspent",
      "sd-aa000002 · claimed fixed — check the deploy, then the original evidence · C0SYN000001 · shared 2026-10-16T00:00:00.000Z",
      "  the sd-aa000002 finding",
      '  team: "all sorted, merged the fix" https://example.slack.com/p1792100100.000100',
      "  C0SYN000001 1792100000.000100",
    ]);
    expect(lines).toContain("residue:");
  });

  it("is never an all-clear when the read could not see", () => {
    const unavailable = findingFollowupsDocument({
      nowIso: NOW,
      read: { ...READ, couldNotSee: ["the draft register could not be read: EACCES"], status: "unavailable" },
    });
    expect([unavailable.status, unavailable.followups]).toStrictEqual(["unavailable", []]);
    expect(renderFindingFollowupsText({ document: unavailable })[0]).toBe(
      "slack finding-followups: UNAVAILABLE — the read could not see, so this is NOT an all-clear (reason under residue)",
    );
    expect(unavailable.coverage.residue[0]).toBe("the draft register could not be read: EACCES");
  });
});
