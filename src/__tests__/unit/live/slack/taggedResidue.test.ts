import { describe, expect, it } from "vitest";

import { taggedResidue } from "../../../../live/slack/taggedResidue.js";
import { type TaggedCorpusLeg, UNREAD_NOT_EXPOSED } from "../../../../live/slack/taggedTypes.js";

const READ_CORPUS: TaggedCorpusLeg = {
  candidates: [],
  channelReach: new Map([["C0CHAN1", "2026-09-29T12:00:00.000Z"]]),
  kind: "read",
  newestIso: "2026-09-29T12:00:00.000Z",
  trail: { byDm: new Map(), byThread: new Map() },
  unparsed: 0,
};

/**
 * The residue with every optional fact absent, overridable field by field.
 *
 * @param over the facts to change
 * @returns the lines
 */
const residueOf = (over: Partial<Parameters<typeof taggedResidue>[0]> = {}): readonly string[] =>
  taggedResidue({
    corpus: READ_CORPUS,
    excludedNonHuman: 0,
    live: { kind: "skipped" },
    membersProblem: null,
    tailUnreadFrom: null,
    unknownAuthors: 0,
    unreachedRows: 0,
    ...over,
  });

describe("taggedResidue", () => {
  it("opens on unread state, then the unread tail, then the members problem, before either leg", () => {
    const lines = residueOf({
      membersProblem: "this home holds no Slack members index",
      tailUnreadFrom: "2026-09-29T12:00:00.000Z",
    });
    expect(lines.slice(0, 4)).toStrictEqual([
      UNREAD_NOT_EXPOSED,
      "nothing after 2026-09-29T12:00:00.000Z was read — the corpus stops there and the live search did not run — so a tag after it is not listed",
      "this home holds no Slack members index, so a bot's or an app's tag may be listed as a person's",
      `the corpus reaches 2026-09-29T12:00:00.000Z — its pooled watermark, capped by the furthest any channel was crawled; each row's "no later word" holds only as far as its own channel was read`,
    ]);
  });

  it("names a corpus with no channel cursor, and counts rows in a channel with none, only when there are some", () => {
    const bare = residueOf({ corpus: { ...READ_CORPUS, channelReach: new Map() }, unreachedRows: 2 });
    const clean = residueOf();
    expect(bare).toContain(
      "the Slack corpus records no channel's own crawl cursor, so how far any channel was read is unknown",
    );
    expect(bare).toContain(
      '2 listed tag(s) sit in a channel that records no reach of its own, so how far their "no later word" holds is unknown',
    );
    expect(clean.filter((line) => line.includes("crawl cursor") || line.includes("no reach"))).toStrictEqual([]);
  });

  it("gives an unreadable corpus's reason in place of every corpus line", () => {
    const lines = residueOf({
      corpus: { kind: "unavailable", reason: "the Slack corpus could not be listed: EACCES" },
    });
    expect(lines.slice(0, 3)).toStrictEqual([
      UNREAD_NOT_EXPOSED,
      "the Slack corpus could not be listed: EACCES",
      "the live search was skipped (--corpus-only), so a tag newer than the corpus is not listed, and a reply of yours newer than it is not seen",
    ]);
  });
});
