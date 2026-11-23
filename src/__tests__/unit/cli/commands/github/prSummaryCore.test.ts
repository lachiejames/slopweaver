/**
 * `github pr summary`'s projection: one pull-request node down to the fields a queue card draws, over C3 bodies
 * written by the real renderer — so the parser under test is the one every Slopweaver description round-trips —
 * over a retired reading-order body the frozen legacy renderer wrote, and over a retired table-shaped body, read
 * where the CI gate reads it.
 */
import { describe, expect, it } from "vitest";

import {
  flattenContent,
  flattenTableCell,
  githubPrSummaryOf,
  parseGithubPrSummaryArgs,
  renderGithubPrSummaryText,
} from "../../../../../cli/commands/github/prSummaryCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { renderPrBody as renderLegacyBody } from "../../../../../outbound/github/legacy/render.js";
import type { Content, PrForm as LegacyForm } from "../../../../../outbound/github/legacy/types.js";
import { renderPrBody } from "../../../../../outbound/github/render.js";
import { FEATURE_BODY, FIX_BODY, formOf } from "../../../outbound/github/fixtures.js";

function t({ text }: { text: string }): Content {
  return [{ kind: "text", text }];
}

/** A C3 body: a medium, checked top risk over a low unchecked one. */
const C3_BODY = unwrap(renderPrBody({ form: formOf({ body: FIX_BODY }) }));

/** A retired reading-order form, with every field a card reads set to something distinct. */
const FORM: LegacyForm = {
  change: t({ text: "Read the description back." }),
  claims: [],
  draft: false,
  origin: [{ kind: "link", text: "the thread", url: "https://x.test/thread/1" }],
  problem: [
    { kind: "text", text: "The card showed " },
    { kind: "code", text: "NOT_AN_ASK" },
    { kind: "text", text: " instead of the problem." },
  ],
  problemSeen: { kind: "unevidenced" },
  risk: {
    blastRadius: [
      { kind: "text", text: "The queue page; test on " },
      { kind: "link", text: "the act card", url: "https://x.test/queue" },
      { kind: "text", text: "." },
    ],
    items: [
      {
        check: { check: t({ text: "the summary test" }), kind: "checked" },
        impact: "low",
        likelihood: "low",
        priority: 4,
        reach: t({ text: "one card" }),
        worst: t({ text: "A card draws the wrong cell" }),
      },
    ],
    line: t({ text: "Low: one console card." }),
  },
  target: { base: "main", head: "finding-branch", owner: "octo-self", repo: "slopweaver" },
  title: "A finding card carries its pull request",
  whereToLook: [[{ kind: "code", text: "src/cli/commands/github/prSummaryCore.ts" }]],
  writtenOn: "2026-09-26",
};

/** The rendered reading-order description, as the frozen legacy renderer wrote one. */
const BODY = unwrap(renderLegacyBody({ form: FORM }));

/** A description in the retired table shape, as the old renderer wrote one. */
const TABLE_BODY = [
  "<table>",
  "<tr><td><strong>Risk</strong></td><td><strong>Low:</strong> one console card.</td></tr>",
  '<tr><td><strong>Blast radius</strong></td><td>The queue page; test on <a href="https://x.test/queue">the act card</a>.</td></tr>',
  "<tr><td><strong>Problem</strong></td><td>The card showed <code>NOT_AN_ASK</code> instead of the problem &amp; more.</td></tr>",
  "<tr><td><strong>Solution</strong></td><td>Read the description back.</td></tr>",
  "</table>",
  "",
].join("\n");

/** The pull-request node `github read` selects, carrying `body`. */
function node({ body, over }: { body: string | null; over: Record<string, unknown> }): Record<string, unknown> {
  return {
    __typename: "PullRequest",
    baseRefName: "main",
    body,
    headRefName: "finding-branch",
    isCrossRepository: false,
    isDraft: false,
    merged: true,
    mergedAt: "2026-09-26T12:00:00Z",
    number: 1353,
    state: "MERGED",
    title: "A finding card carries its pull request",
    url: "https://github.com/octo-self/slopweaver/pull/1353",
    ...over,
  };
}

const READ_AT = "2026-09-27T01:00:00.000Z";

function summarise({ body, over = {} }: { body: string | null; over?: Record<string, unknown> }) {
  return githubPrSummaryOf({ data: node({ body, over }), readAtIso: READ_AT });
}

describe("githubPrSummaryOf", () => {
  it("reads a C3 description's explainer as Problem and its top risk as Risk and Blast radius", () => {
    expect(unwrap(summarise({ body: C3_BODY })).form).toEqual({
      blastRadius: "Worst case a sign-in that used to work is refused.",
      kind: "parsed",
      problem: "The local store was left open to the network. This makes start refuse in that case.",
      risk: "Medium risk. It only refuses an expiry that is not a sensible number of seconds.",
    });
  });

  it("keeps a C3 explainer link's address", () => {
    const body = unwrap(renderPrBody({ form: formOf({ body: FEATURE_BODY }) }));
    expect(unwrap(summarise({ body })).form).toEqual({
      blastRadius: "Worst case a sign-in that used to work is refused.",
      kind: "parsed",
      problem:
        "The provider expires sign-ins after 7 days (https://example.com/oauth#expiry) for an app in testing mode. " +
        "This saves the expiry and warns 48 hours before.",
      risk: "Medium risk. It only refuses an expiry that is not a sensible number of seconds.",
    });
  });

  it("reads a retired reading-order description's Problem, Risk and Blast radius, keeping each link's address", () => {
    const summary = unwrap(summarise({ body: BODY }));
    expect(summary).toEqual({
      form: {
        blastRadius: "The queue page; test on the act card (https://x.test/queue).",
        kind: "parsed",
        problem: "The card showed `NOT_AN_ASK` instead of the problem.",
        risk: "Low: one console card.",
      },
      crossRepository: false,
      headRefName: "finding-branch",
      mergedAt: "2026-09-26T12:00:00Z",
      number: 1353,
      readAtIso: READ_AT,
      state: "merged",
      title: "A finding card carries its pull request",
      url: "https://github.com/octo-self/slopweaver/pull/1353",
    });
  });

  it("says when the head branch lives in a fork", () => {
    expect(unwrap(summarise({ body: BODY, over: { isCrossRepository: true } })).crossRepository).toBe(true);
  });

  it("says open, draft and closed apart from merged", () => {
    const body = BODY;
    const open = unwrap(summarise({ body, over: { merged: false, mergedAt: null, state: "OPEN" } }));
    const draft = unwrap(summarise({ body, over: { isDraft: true, merged: false, mergedAt: null, state: "OPEN" } }));
    const closed = unwrap(summarise({ body, over: { merged: false, mergedAt: null, state: "CLOSED" } }));
    expect([open.state, draft.state, closed.state]).toEqual(["open", "draft", "closed"]);
    expect(open.mergedAt).toBe(null);
  });

  it("reads a retired table-shaped description's three rows where the CI gate reads them", () => {
    const summary = unwrap(summarise({ body: TABLE_BODY }));
    expect(summary.form).toStrictEqual({
      blastRadius: "The queue page; test on the act card (https://x.test/queue).",
      kind: "parsed",
      problem: "The card showed `NOT_AN_ASK` instead of the problem & more.",
      risk: "Low: one console card.",
    });
  });

  it("declines a table-shaped description whose lead rows are not Risk and Blast radius", () => {
    const body = TABLE_BODY.replace("<strong>Risk</strong>", "<strong>Rollout</strong>").replace(
      "<strong>Blast radius</strong>",
      "<strong>Reach</strong>",
    );
    const summary = unwrap(summarise({ body }));
    expect(summary.form).toEqual({ kind: "declined", reason: "its description has no Risk, Blast radius to draw" });
  });

  it("declines an absent description with the parser's own reason", () => {
    const summary = unwrap(summarise({ body: null }));
    expect(summary.form).toEqual({
      kind: "declined",
      reason:
        "its description is not one this card can read: the pull request has no description, so there is no form to recover from it",
    });
  });

  it("declines a hand-written description in neither shape", () => {
    const summary = unwrap(summarise({ body: "Fixes the card.\n\nNothing else." }));
    expect(summary.form.kind).toBe("declined");
  });

  it("refuses a node that is not a pull request", () => {
    const summary = githubPrSummaryOf({ data: { __typename: "Issue", number: 1, title: "x" }, readAtIso: READ_AT });
    expect(unwrapErr(summary)).toEqual([
      "the address is not a pull request, or GitHub answered without the fields a summary needs",
    ]);
  });
});

describe("flattenContent", () => {
  it("keeps a bare link once and collapses whitespace", () => {
    const text = flattenContent({
      content: [
        { kind: "text", text: "  see\n" },
        { kind: "link", text: "https://x.test/a", url: "https://x.test/a" },
        { kind: "strong", text: " now " },
      ],
    });
    expect(text).toBe("see https://x.test/a now");
  });
});

describe("flattenTableCell", () => {
  it("keeps a markdown link's address, drops bold and keeps a bare link once", () => {
    const text = flattenTableCell({
      cell: "**Low** — see [the run](https://x.test/r) and [https://x.test/a](https://x.test/a)",
    });
    expect(text).toBe("Low — see the run (https://x.test/r) and https://x.test/a");
  });

  it("strips from a < to the next >, so a tag holding another < leaves no tag behind", () => {
    expect(flattenTableCell({ cell: "<script <>>alert(1)" })).toBe(">alert(1)");
    expect(flattenTableCell({ cell: "a <scr<b>ipt>alert</scr<b>ipt> b" })).toBe("a ipt>alert ipt> b");
    expect(flattenTableCell({ cell: "p99 < 200ms <br> ok" })).toBe("p99 ok");
  });
});

describe("parseGithubPrSummaryArgs", () => {
  it("takes one address, --json and --home", () => {
    const args = unwrap(
      parseGithubPrSummaryArgs({ rest: ["https://github.com/o/r/pull/1", "--json", "--home", "/h"] }),
    );
    expect(args).toEqual({ home: "/h", json: true, url: "https://github.com/o/r/pull/1" });
  });

  it("refuses no address", () => {
    expect(unwrapErr(parseGithubPrSummaryArgs({ rest: ["--json"] }))).toEqual([
      "exactly one pull-request address is required; got 0",
    ]);
  });
});

describe("renderGithubPrSummaryText", () => {
  it("prints the decline in place of the cells", () => {
    const summary = unwrap(summarise({ body: null, over: { merged: false, mergedAt: null, state: "OPEN" } }));
    expect(renderGithubPrSummaryText({ summary })).toEqual([
      "#1353 A finding card carries its pull request",
      "open · https://github.com/octo-self/slopweaver/pull/1353",
      "declined: its description is not one this card can read: the pull request has no description, so there is no form to recover from it",
    ]);
  });
});
