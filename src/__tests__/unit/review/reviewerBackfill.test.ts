/*
 * The reviewer register's backfill, pure half: which pull requests are the owner's, how mentions group, which pull
 * requests are owed a GitHub read, and the exact `asked` rows — one per certified ask, none for a pull request
 * whose teams were not read.
 */
import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../corpus/types.js";
import { findPrLinkSpans, firstLinkStart, mentionRunsIn } from "../../../review/prLink.js";
import {
  askGroupsOf,
  authoredPrRefsOf,
  backfillAskedRowsOf,
  mentionsByPr,
  prKeysNeedingTeamsOf,
} from "../../../review/reviewerBackfill.js";
import type { ReviewerAskedRow, ReviewerReadRow } from "../../../review/reviewerRegister.js";
import type { SlackMention } from "../../../review/slackEvidenceTypes.js";

/** A batch shape — one reviewer per LINE, two pull requests in one message. */
const BATCH =
  "fresh batch for your review:\n" +
  "• <@U0SYN000004> <https://github.com/acme/acme-admin/pull/16996|#16996> bump relay\n" +
  "• <@U0SYN000002> <https://github.com/acme/acme-admin/pull/17001|#17001> bump simple-git";

/** A status line naming nobody — never an ask. */
const STATUS = "merged <https://github.com/acme/acme-admin/pull/17001|#17001> this morning";

/**
 * One message about one pull request, measured off its own text the way the corpus scan measures it.
 *
 * @returns the mention
 */
function mention({
  text,
  number,
  atIso,
  messageKey,
}: {
  text: string;
  number: number;
  atIso: string;
  messageKey: string;
}): SlackMention {
  const spans = findPrLinkSpans({ text });
  return {
    association: "linked",
    atIso,
    authorId: "U0SYN000001",
    authorRole: "owner",
    authoredPrCount: new Set(spans.map((entry) => entry.ref.number)).size,
    authoredText: text,
    channel: "#dev-alerts",
    conversation: "channel",
    counterpartId: "",
    excerpt: text.slice(0, 40),
    firstLinkAt: firstLinkStart({ spans }),
    isDirectMessage: false,
    leg: "corpus",
    linkSpans: spans.filter((entry) => entry.ref.number === number).map((entry) => entry.span),
    mentions: mentionRunsIn({ text }),
    messageKey,
    permalink: `https://acme.slack.com/archives/${messageKey.replace(":", "/p").replace(".", "")}`,
    prKey: `acme/acme-admin#${String(number)}`,
    quotedPrKeys: [],
    tagged: mentionRunsIn({ text }).map((run) => run.id),
    threadKey: messageKey,
    threadPrKeys: [],
    versionsDisagree: false,
  };
}

const BATCH_16996 = mention({ atIso: "2026-06-01T01:00:00.000Z", messageKey: "C1:1.1", number: 16996, text: BATCH });
const BATCH_17001 = mention({ atIso: "2026-06-01T01:00:00.000Z", messageKey: "C1:1.1", number: 17001, text: BATCH });
const STATUS_17001 = mention({ atIso: "2026-06-02T01:00:00.000Z", messageKey: "C1:2.2", number: 17001, text: STATUS });

/**
 * A GitHub bronze pull-request record.
 *
 * @returns the record
 */
function pr({ url, author, kind = "pr" }: { url: string; author: string; kind?: CorpusRecord["kind"] }): CorpusRecord {
  return {
    author,
    container: "acme/acme-admin",
    kind,
    refs: [],
    source: "github",
    sourceId: url.slice(url.lastIndexOf("/")),
    text: "",
    tsIso: "2026-06-01T00:00:00Z",
    url,
  };
}

describe("authoredPrRefsOf", () => {
  it("keeps the author's pull requests in the one repository, once each, by number", () => {
    const records = [
      pr({ author: "ada", url: "https://github.com/acme/acme-admin/pull/17001" }),
      pr({ author: "ada", url: "https://github.com/acme/acme-admin/pull/16996" }),
      pr({ author: "ada", url: "https://github.com/acme/acme-admin/pull/17001" }),
      pr({ author: "someone", url: "https://github.com/acme/acme-admin/pull/17002" }),
      pr({ author: "ada", url: "https://github.com/lachiejames/slopweaver/pull/12" }),
      pr({ author: "ada", kind: "issue", url: "https://github.com/acme/acme-admin/issues/9" }),
    ];
    expect(authoredPrRefsOf({ author: "ada", records, repo: "acme/acme-admin" })).toEqual([
      { number: 16996, owner: "acme", repo: "acme-admin" },
      { number: 17001, owner: "acme", repo: "acme-admin" },
    ]);
  });

  it("answers empty for an author with no pull request there", () => {
    const records = [pr({ author: "ada", url: "https://github.com/acme/acme-admin/pull/17001" })];
    expect(authoredPrRefsOf({ author: "nobody", records, repo: "acme/acme-admin" })).toEqual([]);
  });
});

describe("mentionsByPr", () => {
  it("groups by pull request, newest first", () => {
    const grouped = mentionsByPr({ mentions: [BATCH_17001, BATCH_16996, STATUS_17001] });
    expect([...grouped].map(([prKey, group]) => [prKey, group.map((entry) => entry.messageKey)])).toEqual([
      ["acme/acme-admin#17001", ["C1:2.2", "C1:1.1"]],
      ["acme/acme-admin#16996", ["C1:1.1"]],
    ]);
  });
});

describe("prKeysNeedingTeamsOf", () => {
  const grouped = mentionsByPr({ mentions: [BATCH_16996, BATCH_17001, STATUS_17001] });

  it("names every pull request carrying an ask the register does not hold", () => {
    expect(prKeysNeedingTeamsOf({ grouped, held: new Set() })).toEqual([
      "acme/acme-admin#16996",
      "acme/acme-admin#17001",
    ]);
  });

  it("skips a pull request whose every ask is held, so a rerun reads only what is owed", () => {
    expect(prKeysNeedingTeamsOf({ grouped, held: new Set(["acme/acme-admin#16996|C1:1.1"]) })).toEqual([
      "acme/acme-admin#17001",
    ]);
  });

  it("skips a pull request that only a status line reaches", () => {
    const statusOnly = mentionsByPr({ mentions: [STATUS_17001] });
    expect(prKeysNeedingTeamsOf({ grouped: statusOnly, held: new Set() })).toEqual([]);
  });
});

describe("askGroupsOf", () => {
  /** A visible session's reading that the batch is NOT an ask on the first pull request. */
  const nonAsk: ReviewerReadRow = {
    atIso: BATCH_16996.atIso,
    bySession: "s1",
    channel: "#dev-alerts",
    isDirectMessage: false,
    kind: "read",
    messageKey: "C1:1.1",
    number: 16996,
    permalink: BATCH_16996.permalink,
    prKey: "acme/acme-admin#16996",
    quote: "fresh batch for your review:",
    readAtIso: "2026-09-25T03:00:00.000Z",
    recipients: [],
    repoSlug: "acme/acme-admin",
    schema: 1,
    verdict: "non-ask",
    why: "a status line",
  };
  /** An ask on the second pull request the register already holds. */
  const asked: ReviewerAskedRow = {
    atIso: BATCH_17001.atIso,
    authorLogin: "ada",
    channel: "#dev-alerts",
    codeOwnerTeams: [],
    isDirectMessage: false,
    kind: "asked",
    messageKey: "C1:1.1",
    names: {},
    number: 17001,
    permalink: BATCH_17001.permalink,
    prKey: "acme/acme-admin#17001",
    recipients: ["U0SYN000002"],
    recordedAtIso: "2026-09-25T03:00:00.000Z",
    repoSlug: "acme/acme-admin",
    schema: 1,
  };

  it("lays a recorded non-ask over the scan and holds every asked row, so nothing is owed", () => {
    const { grouped, held } = askGroupsOf({
      mentions: [BATCH_16996, BATCH_17001, STATUS_17001],
      rows: [nonAsk, asked],
    });
    expect([...held]).toEqual(["acme/acme-admin#17001|C1:1.1"]);
    expect(prKeysNeedingTeamsOf({ grouped, held })).toEqual([]);
    expect(prKeysNeedingTeamsOf({ grouped, held: new Set() })).toEqual(["acme/acme-admin#17001"]);
  });
});

describe("backfillAskedRowsOf", () => {
  const grouped = mentionsByPr({ mentions: [BATCH_16996, BATCH_17001, STATUS_17001] });

  it("writes one row per ask, scoped to its own line's reviewer, with GitHub's teams and the roster's names", () => {
    const rows = backfillAskedRowsOf({
      authorLogin: "ada",
      grouped,
      nameForSlackId: new Map([["U0SYN000002", "Rosa"]]),
      recordedAtIso: "2026-09-29T00:00:00.000Z",
      teamsByPr: new Map([["acme/acme-admin#17001", ["@acme/security"]]]),
    });
    expect(rows).toEqual([
      {
        atIso: "2026-06-01T01:00:00.000Z",
        authorLogin: "ada",
        channel: "#dev-alerts",
        codeOwnerTeams: ["@acme/security"],
        isDirectMessage: false,
        kind: "asked",
        messageKey: "C1:1.1",
        names: { U0SYN000002: "Rosa" },
        number: 17001,
        permalink: "https://acme.slack.com/archives/C1/p11",
        prKey: "acme/acme-admin#17001",
        recipients: ["U0SYN000002"],
        recordedAtIso: "2026-09-29T00:00:00.000Z",
        repoSlug: "acme/acme-admin",
        schema: 1,
      },
    ]);
  });

  it("writes nothing for a pull request whose teams were not read", () => {
    const rows = backfillAskedRowsOf({
      authorLogin: "ada",
      grouped,
      nameForSlackId: new Map(),
      recordedAtIso: "2026-09-29T00:00:00.000Z",
      teamsByPr: new Map(),
    });
    expect(rows).toEqual([]);
  });

  it("keeps an empty team list GitHub really answered, and names nobody it cannot resolve", () => {
    const rows = backfillAskedRowsOf({
      authorLogin: "ada",
      grouped,
      nameForSlackId: new Map(),
      recordedAtIso: "2026-09-29T00:00:00.000Z",
      teamsByPr: new Map([["acme/acme-admin#16996", []]]),
    });
    expect(rows.map((row) => [row.prKey, row.recipients, row.codeOwnerTeams, row.names])).toEqual([
      ["acme/acme-admin#16996", ["U0SYN000004"], [], {}],
    ]);
  });
});
