/*
 * What an act card on the queue links to: the pull request or anything else linkable, so the owner can check
 * the implementation and proof. Every fixture is the shape `autonomy list --json` and `handover list --json` print.
 */

import { describe, expect, it } from "vitest";

import { indexBoardRows, rowsCarrying } from "../../lib/boardRowIndex";
import { type ActLinkLanding, type LinkedAct, type LinkedPullRequest } from "../../lib/queueCardAct";
import {
  ACT_BOARD_SUBJECT,
  ACT_LANDING_SUBJECT,
  type ActLinkBoard,
  type ActLinks,
  actLinks,
  liveActNotices,
} from "../../lib/queueCardActLinks";

const SLUG = "talk-tab-cannot-establish-the-webrtc-connection-prove-a-real-call-end-to-end";

/** A finding act as the finding gate records it: before the pull request exists, so subject and run are the slug. */
const FINDING: LinkedAct = {
  run: SLUG,
  said: "I opened a pull request for a problem the fleet found itself, rather than one you asked about.",
  subject: SLUG,
  why: "an unruled fleet finding, observed from the owner's screenshot of http://localhost:3000/talk",
  witness: "open a pull request on main: finding gate: proceeding on this session's judgement under rule 10",
};

const PR_1142 = "https://github.com/lachiejames/slopweaver/pull/1142";

/** A read board holding these rows. */
function readBoard({ rows }: { rows: readonly { slug: string; prUrls: readonly string[] }[] }): ActLinkBoard {
  const index = indexBoardRows({ rows });
  return { phase: "ready", rowsNamed: ({ slugs }) => rowsCarrying({ index, slugs }) };
}

/** `actLinks` over a read pull-request reading joining nothing and a queue holding no card, unless told otherwise. */
function linksOf({
  act,
  board,
  landing = { phase: "ready" },
  pulls = [],
  queueKeys = new Set(),
}: {
  act: LinkedAct;
  board: ActLinkBoard;
  landing?: ActLinkLanding;
  pulls?: readonly LinkedPullRequest[];
  queueKeys?: ReadonlySet<string>;
}): ActLinks {
  return actLinks({ act, board, landing, pulls, queueKeys });
}

describe("actLinks", () => {
  it("links a finding act to the pull request its board row names, then to the row's card on the queue", () => {
    const board = readBoard({
      rows: [
        { prUrls: [PR_1142], slug: SLUG },
        { prUrls: ["https://x.test/a"], slug: "b" },
      ],
    });
    expect(linksOf({ act: FINDING, board, queueKeys: new Set([`ask:${SLUG}`, "ask:b"]) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [
        { label: "lachiejames/slopweaver#1142", url: PR_1142 },
        { label: "its card on the queue", url: `/queue?open=ask%3A${SLUG}` },
      ],
    });
  });

  it("links no address under a page the console no longer has, whether the subject or the prose names it", () => {
    const act = {
      ...FINDING,
      said: "see https://localhost:3000/board?row=a and https://github.com/lachiejames/slopweaver/pull/1142",
      subject: "https://localhost:3000/machine",
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "lachiejames/slopweaver#1142", url: PR_1142 }],
    });
  });

  it("links a board row matched only by run", () => {
    const act = { ...FINDING, subject: "plan-one" };
    const board = readBoard({ rows: [{ prUrls: [], slug: SLUG }] });
    expect(linksOf({ act, board, queueKeys: new Set([`ask:${SLUG}`]) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "its card on the queue", url: `/queue?open=ask%3A${SLUG}` }],
    });
  });

  it("draws no chip for a board row the queue holds no card for, and never the workstreams page", () => {
    const board = readBoard({ rows: [{ prUrls: [], slug: SLUG }] });
    expect(linksOf({ act: FINDING, board })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "none",
    });
  });

  it("names each board row's card when subject and run match two different ones", () => {
    const act = { ...FINDING, subject: "other-row" };
    const board = readBoard({
      rows: [
        { prUrls: [], slug: "other-row" },
        { prUrls: [], slug: SLUG },
      ],
    });
    expect(linksOf({ act, board, queueKeys: new Set(["ask:other-row", `ask:${SLUG}`]) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [
        { label: "the card for other-row", url: "/queue?open=ask%3Aother-row" },
        { label: `the card for ${SLUG}`, url: `/queue?open=ask%3A${SLUG}` },
      ],
    });
  });

  it("links a pull-request subject once, however many places name it", () => {
    const pr = "https://github.com/lachiejames/slopweaver/pull/1143";
    const act: LinkedAct = {
      run: "cmux-send-truncates",
      said: `I queued the fix, ${pr}.`,
      subject: pr,
      why: "13/13 checks passed",
      witness: "slopweaver github enqueue --pr 1143 -> queued at position 1",
    };
    const board = readBoard({ rows: [{ prUrls: [pr], slug: "cmux-send-truncates" }] });
    expect(linksOf({ act, board })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "lachiejames/slopweaver#1143", url: pr }],
    });
  });

  it("links a proof address in the prose whole — query kept, closing punctuation and brackets dropped", () => {
    const vanta = "https://app.vanta.com/c/acme/documents/pen-test?tab=results";
    const act: LinkedAct = {
      run: undefined,
      said: "filed the pentest pdf into Vanta",
      subject: vanta,
      why: "asked in (https://acme.slack.com/archives/C0123/p1789861718766449).",
      witness: "see **https://github.com/lachiejames/slopweaver/pull/9/files#diff-1**",
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [
        { label: "app.vanta.com/c/acme/documents/pen-test?tab=results", url: vanta },
        { label: "Slack C0123", url: "https://acme.slack.com/archives/C0123/p1789861718766449" },
        { label: "lachiejames/slopweaver#9", url: "https://github.com/lachiejames/slopweaver/pull/9/files#diff-1" },
      ],
    });
  });

  it("never links an https inside another token", () => {
    const act = { ...FINDING, witness: "xhttps://evil.test/a is not an address" };
    expect(linksOf({ act, board: readBoard({ rows: [] }) }).kind).toBe("none");
  });

  it("links a local page the witness names", () => {
    const page = "file:///Users/someone/.slopweaver/pages/the-proof/index.html";
    const act = { ...FINDING, witness: `published ${page}` };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "the the-proof page", url: page }],
    });
  });

  it("carries no sentence when a read board has no row for it, and links no plain-http address", () => {
    expect(linksOf({ act: FINDING, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "none",
    });
  });

  it("waits on the board read rather than saying no row exists", () => {
    expect(linksOf({ act: FINDING, board: { phase: "loading" } })).toEqual({
      boardNotice: { read: { phase: "loading" }, subject: ACT_BOARD_SUBJECT },
      landingNotice: undefined,
      kind: "none",
    });
  });

  it("keeps the ledger's own links and marks the board read failed, when it did", () => {
    const act = { ...FINDING, subject: PR_1142 };
    expect(linksOf({ act, board: { phase: "not-measured", why: "handover list timed out" } })).toEqual({
      boardNotice: { read: { phase: "not-measured", why: "handover list timed out" }, subject: ACT_BOARD_SUBJECT },
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "lachiejames/slopweaver#1142", url: PR_1142 }],
    });
  });
});

describe("actLinks never links an address the record did not name", () => {
  it("links a subject ending in an underscore once, whole", () => {
    const act: LinkedAct = {
      run: undefined,
      said: undefined,
      subject: "https://example.test/proof_",
      why: "",
      witness: undefined,
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "example.test/proof_", url: "https://example.test/proof_" }],
    });
  });

  it("keeps a trailing underscore on an address in the prose", () => {
    const act: LinkedAct = {
      run: undefined,
      said: "see https://example.test/proof_ for it",
      subject: "x",
      why: "",
      witness: undefined,
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "example.test/proof_", url: "https://example.test/proof_" }],
    });
  });

  it("keeps the punctuation of an address a backtick closes", () => {
    const act: LinkedAct = {
      run: undefined,
      said: undefined,
      subject: "proof",
      why: "",
      witness: "Proof: `https://example.test/proof?token=abc!`",
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "example.test/proof?token=abc!", url: "https://example.test/proof?token=abc!" }],
    });
  });

  it("keeps a local page address whole when a backtick closes it", () => {
    const page = "file:///Users/someone/.slopweaver/pages/the-proof/index.html?tab=results#finding";
    const act: LinkedAct = {
      run: undefined,
      said: undefined,
      subject: "proof",
      why: "",
      witness: `Proof: \`${page}\``,
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "the the-proof page", url: page }],
    });
  });

  it("never links the page inside a longer filename", () => {
    const file = "file:///Users/someone/.slopweaver/pages/the-proof/index.html.bak";
    const act: LinkedAct = {
      run: undefined,
      said: undefined,
      subject: "proof",
      why: "",
      witness: `Proof: \`${file}\``,
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "none",
    });
  });

  it("never links a file whose page path is only its query or fragment", () => {
    const act: LinkedAct = {
      run: undefined,
      said: undefined,
      subject: "proof",
      why: "file:///etc/hosts?/pages/proof/index.html",
      witness: "file:///etc/passwd#/pages/proof/index.html",
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "none",
    });
  });

  it("never links a page whose slug is a directory step out of pages", () => {
    const act: LinkedAct = {
      run: undefined,
      said: "file:///tmp/pages/./index.html",
      subject: "proof",
      why: "file:///tmp/pages/../index.html",
      witness: undefined,
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "none",
    });
  });

  it("never links the page inside a delimited name that carries more after it", () => {
    const file = "file:///Users/someone/.slopweaver/pages/the-proof/index.html!";
    const act: LinkedAct = {
      run: undefined,
      said: undefined,
      subject: "proof",
      why: "",
      witness: `Proof: \`${file}\``,
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) }).kind).toBe("none");
  });

  it("links a bare page address ending a sentence, without the full stop", () => {
    const page = "file:///Users/someone/.slopweaver/pages/the-proof/index.html";
    const act: LinkedAct = { run: undefined, said: undefined, subject: "proof", why: "", witness: `see ${page}.` };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "the the-proof page", url: page }],
    });
  });

  it("never links an https address nested inside another address", () => {
    const act: LinkedAct = {
      run: undefined,
      said: undefined,
      subject: "proof",
      why: "",
      witness: "See http://example.test/https://evil.test/proof",
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) }).kind).toBe("none");
  });

  it("never reads an asterisk inside an address as Markdown opening a new one", () => {
    const act: LinkedAct = {
      run: undefined,
      said: undefined,
      subject: "proof",
      why: "",
      witness: "See http://example.test/*https://evil.test/proof",
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) }).kind).toBe("none");
  });

  it("never runs a page address across a Markdown link's closing bracket", () => {
    const act: LinkedAct = {
      run: undefined,
      said: undefined,
      subject: "proof",
      why: "",
      witness: "[file:///tmp/report](https://example.test/pages/proof/index.html)",
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "example.test/pages/proof/index.html", url: "https://example.test/pages/proof/index.html" }],
    });
  });

  it("ends an address at a closing brace", () => {
    const act: LinkedAct = {
      run: undefined,
      said: undefined,
      subject: "proof",
      why: "",
      witness: "Proof: {https://example.test/proof#finding}tail",
    };
    expect(linksOf({ act, board: readBoard({ rows: [] }) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "example.test/proof#finding", url: "https://example.test/proof#finding" }],
    });
  });

  it("links only an https address out of a board row's prUrls", () => {
    const act: LinkedAct = { run: undefined, said: undefined, subject: "named-row", why: "", witness: undefined };
    const board = readBoard({
      rows: [
        { prUrls: ["/workstreams?row=unrelated-row"], slug: "named-row" },
        { prUrls: [], slug: "unrelated-row" },
      ],
    });
    expect(linksOf({ act, board, queueKeys: new Set(["ask:named-row"]) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "linked",
      links: [{ label: "its card on the queue", url: "/queue?open=ask%3Anamed-row" }],
    });
  });

  it("draws no chip for a board row whose key no URL carries unchanged, and does not throw", () => {
    const act: LinkedAct = { run: undefined, said: undefined, subject: "\ud800", why: "", witness: undefined };
    const board = readBoard({ rows: [{ prUrls: [], slug: "\ud800" }] });
    expect(linksOf({ act, board, queueKeys: new Set(["ask:\ud800"]) })).toEqual({
      boardNotice: undefined,
      landingNotice: undefined,
      kind: "none",
    });
  });
});

/** An open pull request as `github landing --json` carries it, with `over` laid on top. */
function pull(over: Partial<LinkedPullRequest> = {}): LinkedPullRequest {
  return {
    boardRowSlug: undefined,
    headRefName: "codex-seats-spawn-the-chatgpt-app-s-computer",
    number: 1353,
    repoSlug: "lachiejames/slopweaver",
    title: "No Codex Slopweaver starts can launch the ChatGPT app's browser",
    url: "https://github.com/lachiejames/slopweaver/pull/1353",
    ...over,
  };
}

describe("actLinks over the owner's open pull requests", () => {
  it("puts each joined pull request first, and links one named twice once", () => {
    const act = { ...FINDING, witness: `opened ${pull().url}` };
    const board = readBoard({ rows: [{ prUrls: [pull().url, PR_1142], slug: SLUG }] });
    expect(linksOf({ act, board, pulls: [pull()], queueKeys: new Set([`ask:${SLUG}`]) })).toEqual({
      boardNotice: undefined,
      kind: "linked",
      landingNotice: undefined,
      links: [
        { label: "lachiejames/slopweaver#1353", url: pull().url },
        { label: "lachiejames/slopweaver#1142", url: PR_1142 },
        { label: "its card on the queue", url: `/queue?open=ask%3A${SLUG}` },
      ],
    });
  });

  it("waits on the pull-request reading rather than saying none is open", () => {
    expect(linksOf({ act: FINDING, board: readBoard({ rows: [] }), landing: { phase: "loading" } })).toEqual({
      boardNotice: undefined,
      kind: "none",
      landingNotice: { read: { phase: "loading" }, subject: ACT_LANDING_SUBJECT },
    });
  });

  it("carries why the pull-request reading could not be read, for its staleness mark", () => {
    const landing: ActLinkLanding = { phase: "not-measured", why: "github landing timed out" };
    expect(linksOf({ act: FINDING, board: readBoard({ rows: [] }), landing }).landingNotice).toEqual({
      read: { phase: "not-measured", why: "github landing timed out" },
      subject: ACT_LANDING_SUBJECT,
    });
  });
});

// A card left open after its row went is the snapshot taken while both reads were loading.
describe("liveActNotices", () => {
  it("re-reads both notices off the registers as they stand now, a failed read saying so", () => {
    const snapshot = actLinks({
      act: FINDING,
      board: { phase: "loading" },
      landing: { phase: "loading" },
      pulls: [],
      queueKeys: new Set(),
    });
    expect(snapshot.boardNotice).toEqual({ read: { phase: "loading" }, subject: ACT_BOARD_SUBJECT });
    const now = liveActNotices({
      board: { phase: "not-measured", why: "handover list exited 1" },
      landing: { phase: "ready" },
      links: snapshot,
    });
    expect(now.boardNotice).toEqual({
      read: { phase: "not-measured", why: "handover list exited 1" },
      subject: ACT_BOARD_SUBJECT,
    });
    expect(now.landingNotice).toBe(undefined);
    expect(now.kind).toBe(snapshot.kind);
  });
});
