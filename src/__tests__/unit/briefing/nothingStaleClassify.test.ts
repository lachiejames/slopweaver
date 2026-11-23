import { describe, expect, it } from "vitest";

import { classifyNothingStale } from "../../../briefing/nothingStaleClassify.js";
import { pullRequestSurface, receiptSlugs } from "../../../briefing/nothingStalePullRequests.js";
import type {
  CycleBriefingDocument,
  DocumentInput,
  LandingBriefingDocument,
  LandingRowView,
  NothingStaleInputs,
  NothingStaleItem,
  RunReceipt,
  SweepBriefingCandidate,
} from "../../../briefing/nothingStaleTypes.js";
import { CYCLE_STANDING_BOUNDS } from "../../../cycle/types.js";
import { type SlackOwedDocument, slackOwedDocument } from "../../../live/slack/owedDocument.js";
import type { SweepBoardCensus } from "../../../sweep/census.js";

const NOW = "2026-09-26T08:00:00.000Z";

const available = <T>({ document }: { document: T }): DocumentInput<T> => ({
  kind: "available",
  value: { cadence: "*/15 * * * *", document, observedAtIso: NOW },
});

const row = (over: Partial<LandingRowView> = {}): LandingRowView => ({
  action: "spawn-ci",
  blockedOn: [],
  boardRowSlug: undefined,
  dispatch: { kind: "act", verdict: "merge-now", why: "green and approved" },
  headOid: "abcdef1234567890",
  latestAskRecipients: [],
  number: 1,
  queueKind: "not-queued",
  repoSlug: "org/repo",
  title: "A change",
  url: "https://github.com/org/repo/pull/1",
  ...over,
});

/** A landing read whose open list, unless given, carries every row and press it holds — all still open. */
const landing = (over: Partial<LandingBriefingDocument> = {}): LandingBriefingDocument => {
  const { rows = [], presses = [] } = over;
  const open = [...rows, ...presses].map((entry) => ({ author: "me", isDraft: false, number: entry.number }));
  return {
    census: [{ kind: "read", pullRequests: open, repo: "org/repo", viewer: "Me" }],
    people: {},
    presses,
    residue: [],
    rows,
    selection: { author: "@me", includeDrafts: true, repos: ["org/repo"] },
    ...over,
  };
};

const owed = ({ status }: { status: "complete" | "incomplete" | "unavailable" }): SlackOwedDocument =>
  slackOwedDocument({
    nowIso: NOW,
    read: {
      couldNotSee: ["the corpus's own copy"],
      movedWithoutOwner: 0,
      movementThreads: [],
      status,
      taggedWithoutOwner: 0,
      threadsSpokenIn: 0,
      windowDays: 14,
    },
  });

const census: SweepBoardCensus = {
  census: {
    CONTRADICTED: 0,
    KEEP: 0,
    ORPHANED: 0,
    OVERTAKEN: 0,
    PR_ENDED: 0,
    SHIPPED: 0,
    SUPERSEDED: 0,
    UNCARDED: 0,
    UNWITNESSED: 7,
  },
  findingsSha256: "0".repeat(64),
  producer: "sweep board",
  scanned: 7,
  schemaVersion: 5,
  swept: 7,
};

const inputs = (over: Partial<NothingStaleInputs> = {}): NothingStaleInputs => ({
  board: available<readonly SweepBriefingCandidate[]>({ document: [] }),
  boardCensus: available({ document: census }),
  followedThreads: available({ document: owed({ status: "complete" }) }),
  linearCycle: available<CycleBriefingDocument>({
    document: { couldNotSee: [...CYCLE_STANDING_BOUNDS], proposals: [] },
  }),
  pullRequests: available({ document: landing() }),
  runs: new Map(),
  ...over,
});

/** The facts of an item a reader would check, its line flattened to text. */
const facts = ({ item }: { item: NothingStaleItem }) => ({
  identity: item.identity,
  lane: item.lane,
  text: item.line.map((run) => run.text).join(""),
});

describe("pullRequestSurface", () => {
  const document = landing({
    people: { U0SYNASKED01: "Ada" },
    presses: [
      { detail: "entered the queue", number: 1, outcome: "pressed", repoSlug: "org/repo", url: "https://x/1" },
      { detail: "dry run", number: 5, outcome: "would-press", repoSlug: "org/repo", url: "https://x/5" },
    ],
    rows: [
      row({ number: 1 }),
      row({ dispatch: { kind: "unread", why: "the checks read failed" }, number: 2 }),
      row({
        blockedOn: ["@org/team"],
        dispatch: { kind: "waiting", why: "review" },
        latestAskRecipients: ["U0SYNASKED01"],
        number: 3,
      }),
      row({
        blockedOn: ["@org/team"],
        dispatch: { kind: "waiting", why: "review" },
        latestAskRecipients: ["U0SYNNOBODY1"],
        number: 4,
      }),
      row({ number: 5 }),
    ],
  });
  const runs = new Map([["land-org-repo-5-abcdef1", { kind: "phase" as const, phase: "open" as const }]]);

  it("reports a pressed pull request once, as moving on the press, and each other row in exactly one lane", () => {
    expect(
      pullRequestSurface({ document, publishedIso: NOW, runs }).items.map((item) => facts({ item })),
    ).toStrictEqual([
      {
        identity: "pull-request:org/repo#1",
        lane: "moving",
        text: "org/repo#1 A change — pressed into the merge queue in the landing read published 2026-09-26T08:00:00.000Z. entered the queue",
      },
      {
        identity: "pull-request:org/repo#3",
        lane: "waiting",
        text: "org/repo#3 A change — waiting on Ada: review",
      },
      {
        identity: "pull-request:org/repo#4",
        lane: "stale",
        text: "org/repo#4 A change — waiting, on nobody named: review",
      },
      {
        identity: "pull-request:org/repo#5",
        lane: "moving",
        text: "org/repo#5 A change — run `land-org-repo-5-abcdef1` is open. green and approved",
      },
    ]);
  });

  it("names the row it could not decide, and never a press that only would have happened", () => {
    expect(pullRequestSurface({ document, publishedIso: NOW, runs }).unseen).toStrictEqual([
      "org/repo#2 could not be decided: the checks read failed",
    ]);
  });

  it("keeps a row decided by an open run or a question, naming the unreadable sibling on its line, never a gap", () => {
    const decided = landing({
      rows: [row({ boardRowSlug: "a-seat-on-7", number: 7 }), row({ boardRowSlug: "a-seat-on-8", number: 8 })],
    });
    const unreadable = { kind: "unreadable" as const, reason: "line(s) 3 could not be decoded" };
    const siblings = new Map<string, RunReceipt>([
      ["land-org-repo-7-abcdef1", unreadable],
      ["a-seat-on-7", { kind: "phase" as const, phase: "open" as const }],
      ["land-org-repo-8-abcdef1", { kind: "phase" as const, phase: "waiting-on-owner" as const }],
      ["a-seat-on-8", unreadable],
    ]);
    const surface = pullRequestSurface({ document: decided, publishedIso: NOW, runs: siblings });
    expect({ items: surface.items.map((item) => facts({ item })), unseen: surface.unseen }).toStrictEqual({
      items: [
        {
          identity: "pull-request:org/repo#7",
          lane: "moving",
          text:
            "org/repo#7 A change — run `a-seat-on-7` is open. green and approved Not seen: its run journal " +
            "`land-org-repo-7-abcdef1` could not be read: line(s) 3 could not be decoded.",
        },
        {
          identity: "pull-request:org/repo#8",
          lane: "needs-word",
          text:
            "org/repo#8 A change — run `land-org-repo-8-abcdef1` holds a question for you on the Queue. green and " +
            "approved Not seen: its run journal `a-seat-on-8` could not be read: line(s) 3 could not be decoded.",
        },
      ],
      unseen: [],
    });
  });

  it("puts a question for the owner above every receipt — queued, stacked, pressed or an open run beside it", () => {
    const asking = { kind: "phase" as const, phase: "waiting-on-owner" as const };
    const receipts = landing({
      presses: [
        { detail: "entered the queue", number: 12, outcome: "pressed", repoSlug: "org/repo", url: "https://x/12" },
      ],
      rows: [
        row({ number: 9, queueKind: "queued" }),
        row({ action: "stacked", number: 10 }),
        row({ boardRowSlug: "a-seat-on-11", number: 11 }),
        row({ number: 12 }),
      ],
    });
    const journals = new Map<string, RunReceipt>([
      ["land-org-repo-9-abcdef1", asking],
      ["land-org-repo-10-abcdef1", asking],
      ["land-org-repo-11-abcdef1", { kind: "phase" as const, phase: "open" as const }],
      ["a-seat-on-11", asking],
      ["land-org-repo-12-abcdef1", asking],
    ]);
    const surface = pullRequestSurface({ document: receipts, publishedIso: NOW, runs: journals });
    expect(surface.items.map((item) => [item.identity, item.lane])).toStrictEqual([
      ["pull-request:org/repo#12", "needs-word"],
      ["pull-request:org/repo#9", "needs-word"],
      ["pull-request:org/repo#10", "needs-word"],
      ["pull-request:org/repo#11", "needs-word"],
    ]);
  });

  it("puts the read's own judgement-reserved verdict above every receipt, a queued objection included", () => {
    const judgement = { kind: "act" as const, verdict: "needs-owner-judgment", why: "a review still requests changes" };
    const receipts = landing({
      presses: [
        { detail: "entered the queue", number: 12, outcome: "pressed", repoSlug: "org/repo", url: "https://x/12" },
      ],
      rows: [
        row({ dispatch: judgement, number: 9, queueKind: "queued" }),
        row({ action: "stacked", dispatch: judgement, number: 10 }),
        row({ dispatch: judgement, number: 11 }),
        row({ dispatch: judgement, number: 12 }),
      ],
    });
    const journals = new Map<string, RunReceipt>([
      ["land-org-repo-11-abcdef1", { kind: "phase" as const, phase: "open" as const }],
    ]);
    const surface = pullRequestSurface({ document: receipts, publishedIso: NOW, runs: journals });
    expect(surface.items.map((item) => facts({ item }))).toStrictEqual(
      [12, 9, 10, 11].map((number) => ({
        identity: `pull-request:org/repo#${String(number)}`,
        lane: "needs-word",
        text: `org/repo#${String(number)} A change — reply \`decide\`: a review still requests changes`,
      })),
    );
  });

  it("puts a question for the owner above a dispatch the read could not decide", () => {
    const undecided = landing({
      rows: [row({ dispatch: { kind: "unread", why: "checks unreadable" }, number: 10, queueKind: "queued" })],
    });
    const asking = new Map([
      ["land-org-repo-10-abcdef1", { kind: "phase" as const, phase: "waiting-on-owner" as const }],
    ]);
    const surface = pullRequestSurface({ document: undecided, publishedIso: NOW, runs: asking });
    expect({ items: surface.items.map((item) => facts({ item })), unseen: surface.unseen }).toStrictEqual({
      items: [
        {
          identity: "pull-request:org/repo#10",
          lane: "needs-word",
          text:
            "org/repo#10 A change — run `land-org-repo-10-abcdef1` holds a question for you on the Queue. " +
            "checks unreadable",
        },
      ],
      unseen: [],
    });
  });

  it("names an open pull request only an unsuccessful press mentions, since nothing placed it", () => {
    const orphan = landing({
      census: [
        { kind: "read", pullRequests: [{ author: "me", isDraft: false, number: 13 }], repo: "org/repo", viewer: "me" },
      ],
      presses: [{ detail: "refused", number: 13, outcome: "failed", repoSlug: "org/repo", url: "https://x/13" }],
    });
    expect(pullRequestSurface({ document: orphan, publishedIso: NOW, runs: new Map() }).unseen).toStrictEqual([
      "org/repo#13 is open on GitHub and the landing read did not place it",
    ]);
  });

  it("names the read a queue receipt came from by its publication, never as a time GitHub was observed", () => {
    const queued = landing({ rows: [row({ number: 9, queueKind: "queued" })] });
    expect(
      pullRequestSurface({ document: queued, publishedIso: NOW, runs: new Map() }).items.map((item) => facts({ item })),
    ).toStrictEqual([
      {
        identity: "pull-request:org/repo#9",
        lane: "moving",
        text:
          "org/repo#9 A change — GitHub's merge queue held it in the landing read published " +
          "2026-09-26T08:00:00.000Z. green and approved",
      },
    ]);
  });

  it("names every open pull request GitHub lists for the owner that no row or press placed, and every unread list", () => {
    const pr = ({
      number,
      author = "me",
      isDraft = false,
    }: {
      number: number;
      author?: string;
      isDraft?: boolean;
    }) => ({
      author,
      isDraft,
      number,
    });
    const listed = landing({
      census: [
        {
          kind: "read",
          pullRequests: [
            pr({ number: 1 }),
            pr({ number: 2 }),
            pr({ author: "someone-else", number: 3 }),
            pr({ isDraft: true, number: 4 }),
            pr({ number: 5 }),
          ],
          repo: "org/repo",
          viewer: "Me",
        },
        { kind: "unread", repo: "org/other", why: "the connection moved while it was paged" },
      ],
      presses: [{ detail: "queued", number: 5, outcome: "pressed", repoSlug: "org/repo", url: "https://x/5" }],
      rows: [row({ number: 1 })],
      selection: { author: "@me", includeDrafts: false, repos: ["org/repo", "org/other", "org/missing"] },
    });
    const surface = pullRequestSurface({ document: listed, publishedIso: NOW, runs: new Map() });
    expect({ bounds: surface.bounds, unseen: surface.unseen }).toStrictEqual({
      bounds: ["the landing read left drafts out, so 1 open draft(s) of yours that GitHub listed are not counted here"],
      unseen: [
        "org/repo#2 is open on GitHub and the landing read did not place it",
        "GitHub's open list for org/other could not be read: the connection moved while it was paged",
        "GitHub's open list for org/missing is not in the landing read, so a pull request it dropped is unseen",
      ],
    });
  });

  it("counts every author's pull request when the read selected no author", () => {
    const everyAuthor = landing({
      census: [
        {
          kind: "read",
          pullRequests: [{ author: undefined, isDraft: true, number: 6 }],
          repo: "org/repo",
          viewer: "me",
        },
      ],
      selection: { author: undefined, includeDrafts: true, repos: ["org/repo"] },
    });
    const surface = pullRequestSurface({ document: everyAuthor, publishedIso: NOW, runs: new Map() });
    expect({ bounds: surface.bounds, unseen: surface.unseen }).toStrictEqual({
      bounds: [],
      unseen: ["org/repo#6 is open on GitHub and the landing read did not place it"],
    });
  });

  it("reads `@ME` as the viewer, in any case, the way the landing verb accepts it", () => {
    const shouted = landing({
      census: [
        {
          kind: "read",
          pullRequests: [{ author: "alice", isDraft: false, number: 7 }],
          repo: "org/repo",
          viewer: "Alice",
        },
      ],
      selection: { author: "@ME", includeDrafts: true, repos: ["org/repo"] },
    });
    expect(pullRequestSurface({ document: shouted, publishedIso: NOW, runs: new Map() }).unseen).toStrictEqual([
      "org/repo#7 is open on GitHub and the landing read did not place it",
    ]);
  });

  it("reads every open list a repository carries, so a second entry can neither hide nor end a pull request", () => {
    const doubled = landing({
      census: [
        { kind: "read", pullRequests: [{ author: "me", isDraft: false, number: 1 }], repo: "org/repo", viewer: "me" },
        { kind: "read", pullRequests: [{ author: "me", isDraft: false, number: 2 }], repo: "org/repo", viewer: "me" },
        { kind: "unread", repo: "org/repo", why: "the count moved between pages" },
      ],
      rows: [row({ number: 1 })],
      selection: { author: "@me", includeDrafts: true, repos: ["org/repo", "org/repo"] },
    });
    const surface = pullRequestSurface({ document: doubled, publishedIso: NOW, runs: new Map() });
    expect({
      bounds: surface.bounds,
      items: surface.items.map((item) => item.identity),
      unseen: surface.unseen,
    }).toStrictEqual({
      bounds: [],
      items: ["pull-request:org/repo#1"],
      unseen: [
        "org/repo#2 is open on GitHub and the landing read did not place it",
        "GitHub's open list for org/repo could not be read: the count moved between pages",
      ],
    });
  });

  it("reads a repository named in two casings as one, so neither list can end or hide the other's pull request", () => {
    const cased = landing({
      census: [
        { kind: "read", pullRequests: [], repo: "acme/widgets", viewer: "alice" },
        {
          kind: "read",
          pullRequests: [
            { author: "alice", isDraft: false, number: 7 },
            { author: "alice", isDraft: false, number: 8 },
          ],
          repo: "ACME/WIDGETS",
          viewer: "alice",
        },
      ],
      rows: [row({ number: 7, repoSlug: "acme/widgets", url: "https://github.com/acme/widgets/pull/7" })],
      selection: { author: "@me", includeDrafts: true, repos: ["acme/widgets", "ACME/WIDGETS"] },
    });
    const surface = pullRequestSurface({ document: cased, publishedIso: NOW, runs: new Map() });
    expect({
      bounds: surface.bounds,
      items: surface.items.map((item) => item.identity),
      unseen: surface.unseen,
    }).toStrictEqual({
      bounds: [],
      items: ["pull-request:acme/widgets#7"],
      unseen: ["acme/widgets#8 is open on GitHub and the landing read did not place it"],
    });
  });

  it("leaves out a row or press GitHub's open list no longer carries, naming it as closed or merged", () => {
    const asking = { kind: "phase" as const, phase: "waiting-on-owner" as const };
    const ended = landing({
      census: [
        { kind: "read", pullRequests: [{ author: "me", isDraft: false, number: 3 }], repo: "org/repo", viewer: "me" },
        { kind: "unread", repo: "org/other", why: "rate limited" },
      ],
      presses: [{ detail: "queued", number: 1, outcome: "pressed", repoSlug: "org/repo", url: "https://x/1" }],
      rows: [
        row({ number: 1 }),
        row({ number: 2 }),
        row({ number: 3 }),
        row({ number: 4, repoSlug: "org/other", url: "https://github.com/org/other/pull/4" }),
      ],
      selection: { author: "@me", includeDrafts: true, repos: ["org/repo", "org/other"] },
    });
    const journals = new Map<string, RunReceipt>([["land-org-repo-2-abcdef1", asking]]);
    const surface = pullRequestSurface({ document: ended, publishedIso: NOW, runs: journals });
    expect({ bounds: surface.bounds, items: surface.items.map((item) => item.identity) }).toStrictEqual({
      bounds: [
        "org/repo#1 was not on GitHub's open list in the same read, so it closed or merged and is not counted",
        "org/repo#2 was not on GitHub's open list in the same read, so it closed or merged and is not counted",
      ],
      items: ["pull-request:org/repo#3", "pull-request:org/other#4"],
    });
  });

  it("shows an address that will not parse as text, never a link the briefing schema refuses", () => {
    const odd = landing({ rows: [row({ number: 9, url: "not a url" })] });
    const [item] = pullRequestSurface({ document: odd, publishedIso: NOW, runs: new Map() }).items;
    expect(item!.line.slice(0, 2)).toStrictEqual([
      { kind: "text", text: "org/repo#9 A change " },
      { kind: "code", text: "not a url" },
    ]);
  });
});

describe("receiptSlugs", () => {
  it("reads the registration at the head the read saw, then a different board row declaring the branch", () => {
    expect(receiptSlugs({ row: row({ boardRowSlug: "a-named-handover", number: 7 }) })).toStrictEqual([
      "land-org-repo-7-abcdef1",
      "a-named-handover",
    ]);
  });

  it("names a board row that IS the registration once", () => {
    expect(receiptSlugs({ row: row({ boardRowSlug: "land-org-repo-7-abcdef1", number: 7 }) })).toStrictEqual([
      "land-org-repo-7-abcdef1",
    ]);
  });
});

describe("classifyNothingStale", () => {
  it("reads a clean morning as no gap, the standing bounds as caveats, and the census's unproven count", () => {
    const projection = classifyNothingStale({ inputs: inputs() });
    expect([...projection.couldNotSee]).toStrictEqual([]);
    expect([...projection.caveats.keys()]).toStrictEqual(["Linear", "followed threads"]);
    expect(projection.caveats.get("Linear")).toStrictEqual([...CYCLE_STANDING_BOUNDS]);
    expect(projection.unproven).toBe(7);
  });

  it("names every hole in section order, a cycle hole in both Linear surfaces and a partial owed read with its bounds", () => {
    const partial = owed({ status: "incomplete" });
    const projection = classifyNothingStale({
      inputs: inputs({
        boardCensus: { kind: "could-not-see", reason: "no census" },
        followedThreads: available({ document: partial }),
        linearCycle: available<CycleBriefingDocument>({
          document: { couldNotSee: [...CYCLE_STANDING_BOUNDS, "the cycle read timed out"], proposals: [] },
        }),
        pullRequests: { kind: "could-not-see", reason: "no landing read" },
      }),
    });
    expect([...projection.couldNotSee]).toStrictEqual([
      ["pull-requests", ["no landing read"]],
      ["linear-tickets", ["the cycle read timed out"]],
      ["linear-projects", ["the cycle read timed out"]],
      ["followed-threads", ["the read was incomplete", ...partial.coverage.residue]],
      ["board-unproven", ["no census"]],
    ]);
    expect([...projection.caveats.keys()]).toStrictEqual(["Linear"]);
    expect(projection.unproven).toBe(undefined);
  });
});
