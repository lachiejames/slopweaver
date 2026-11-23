import { describe, expect, it } from "vitest";
import {
  bareRefIssuesOfDetail,
  bareRefIssuesOfRuns,
  linkifyDetail,
  linkifyDripArtifact,
  linkifyRuns,
} from "../../../../outbound/artifact/bareRefRuns.js";
import type {
  DetailBlock,
  DripArtifact,
  InlineRun,
  PlainArtifact,
  TextSpan,
} from "../../../../outbound/artifact/types.js";
import type { BareRefContext } from "../../../../outbound/linkify/bareRefs.js";

const ONE_REPO: BareRefContext = { repos: [{ owner: "acme", repo: "widget" }] };
const NO_CONTEXT: BareRefContext = { repos: [] };

describe("linkifyRuns", () => {
  it("is byte-identical when no run carries a bare reference", () => {
    const runs: readonly InlineRun[] = [{ text: "nothing here", type: "text" }];
    expect(linkifyRuns({ context: ONE_REPO, runs })).toEqual(runs);
  });

  it("splices a resolvable bare reference into a link run, keeping the surrounding text", () => {
    const runs: readonly InlineRun[] = [{ text: "fixed in #42 today", type: "text" }];
    const out = linkifyRuns({ context: ONE_REPO, runs });
    expect(out).toEqual([
      { text: "fixed in ", type: "text" },
      { label: "#42", type: "link", url: "https://github.com/acme/widget/issues/42" },
      { text: " today", type: "text" },
    ]);
  });

  it("leaves an unresolvable bare reference as literal text", () => {
    const runs: readonly InlineRun[] = [{ text: "closed: 100, 200", type: "text" }];
    expect(linkifyRuns({ context: NO_CONTEXT, runs })).toEqual(runs);
  });

  it("never touches a code run", () => {
    const runs: readonly InlineRun[] = [{ code: true, text: "#42", type: "text" }];
    expect(linkifyRuns({ context: ONE_REPO, runs })).toEqual(runs);
  });

  it("never touches a link run's label", () => {
    const runs: readonly InlineRun[] = [{ label: "#42", type: "link", url: "https://example.com" }];
    expect(linkifyRuns({ context: ONE_REPO, runs })).toEqual(runs);
  });

  it("preserves bold/italic styling on the untouched surrounding text", () => {
    const runs: readonly InlineRun[] = [{ bold: true, text: "see #42 now", type: "text" } satisfies TextSpan];
    const out = linkifyRuns({ context: ONE_REPO, runs });
    expect(out[0]).toEqual({ bold: true, text: "see ", type: "text" });
  });
});

describe("bareRefIssuesOfRuns", () => {
  it("reports nothing once every reference resolves", () => {
    const runs: readonly InlineRun[] = linkifyRuns({ context: ONE_REPO, runs: [{ text: "see #42", type: "text" }] });
    expect(bareRefIssuesOfRuns({ context: ONE_REPO, path: ["tldr"], runs }).length).toBe(0);
  });

  it("reports every reference still bare after linkifying", () => {
    const runs: readonly InlineRun[] = [{ text: "closed: 100, 200", type: "text" }];
    const issues = bareRefIssuesOfRuns({ context: NO_CONTEXT, path: ["detail", 0], runs });
    expect(issues.length).toBe(2);
    expect(issues[0]!.path).toEqual(["detail", 0]);
  });
});

describe("a Linear ticket in code formatting", () => {
  const LINEAR: BareRefContext = { linearTeamKeys: ["GGGG"], linearWorkspaceSlug: "acme", repos: [] };
  const NO_WORKSPACE: BareRefContext = { linearTeamKeys: ["GGGG"], repos: [] };

  it("replaces a code run that is exactly one known ticket with the link to it", () => {
    const runs: readonly InlineRun[] = [
      { text: "same thing as ", type: "text" },
      { code: true, text: "GGGG-1742", type: "text" },
    ];
    expect(linkifyRuns({ context: LINEAR, runs })).toEqual([
      { text: "same thing as ", type: "text" },
      { label: "GGGG-1742", type: "link", url: "https://linear.app/acme/issue/GGGG-1742" },
    ]);
  });

  it("leaves nothing to refuse once the ticket has become its link", () => {
    const runs = linkifyRuns({ context: LINEAR, runs: [{ code: true, text: "GGGG-1742", type: "text" }] });
    expect(bareRefIssuesOfRuns({ context: LINEAR, path: ["messages", 0], runs })).toEqual([]);
  });

  it("refuses a known ticket among other code, leaving the code run as authored", () => {
    const runs: readonly InlineRun[] = [{ code: true, text: "deploy --ticket GGGG-1742", type: "text" }];
    const linked = linkifyRuns({ context: LINEAR, runs });
    expect(linked).toEqual(runs);
    const issues = bareRefIssuesOfRuns({ context: LINEAR, path: ["messages", 0], runs: linked });
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain('"GGGG-1742" is a Linear ticket inside code formatting');
  });

  it("refuses a code-formatted ticket it cannot build a URL for, rather than letting it through as code", () => {
    const runs: readonly InlineRun[] = [{ code: true, text: "GGGG-1742", type: "text" }];
    const issues = bareRefIssuesOfRuns({
      context: NO_WORKSPACE,
      path: ["lines", 0],
      runs: linkifyRuns({ context: NO_WORKSPACE, runs }),
    });
    expect(issues.map((issue) => issue.path)).toEqual([["lines", 0]]);
    expect(issues[0]!.message).toContain("code formatting");
  });

  it("leaves a code span whose prefix is not a known team key as code", () => {
    const runs: readonly InlineRun[] = [
      { code: true, text: "UTC-5", type: "text" },
      { code: true, text: "ISO-8601", type: "text" },
    ];
    const linked = linkifyRuns({ context: LINEAR, runs });
    expect(linked).toEqual(runs);
    expect(bareRefIssuesOfRuns({ context: LINEAR, path: ["messages", 0], runs: linked })).toEqual([]);
  });

  it("links the ticket in a drip message, the shape the GGGG-1742 draft carried", () => {
    const artifact: DripArtifact = {
      kind: "drip",
      messages: [
        {
          runs: [
            { text: "same as ", type: "text" },
            { code: true, text: "GGGG-1742", type: "text" },
          ],
        },
      ],
    };
    const out = linkifyDripArtifact({ artifact, context: LINEAR });
    expect(out.issues).toEqual([]);
    expect(out.artifact).toEqual({
      kind: "drip",
      messages: [
        {
          runs: [
            { text: "same as ", type: "text" },
            { label: "GGGG-1742", type: "link", url: "https://linear.app/acme/issue/GGGG-1742" },
          ],
        },
      ],
    });
  });
});

describe("linkifyDetail / bareRefIssuesOfDetail", () => {
  it("linkifies inside a paragraph, leaving a resolved reference behind", () => {
    const detail: readonly DetailBlock[] = [{ runs: [{ text: "fixed in #42", type: "text" }], type: "paragraph" }];
    const linkified = linkifyDetail({ context: ONE_REPO, detail });
    const first = linkified[0]!;
    expect(first.type === "paragraph" ? first.runs : []).toEqual([
      { text: "fixed in ", type: "text" },
      { label: "#42", type: "link", url: "https://github.com/acme/widget/issues/42" },
    ]);
    expect(bareRefIssuesOfDetail({ context: ONE_REPO, detail: linkified, path: ["detail"] }).length).toBe(0);
  });

  it("reports surviving residue addressed to its own block index", () => {
    const detail: readonly DetailBlock[] = [
      { runs: [{ text: "no reference here", type: "text" }], type: "paragraph" },
      { runs: [{ text: "still open: 15895", type: "text" }], type: "paragraph" },
    ];
    const linkified = linkifyDetail({ context: NO_CONTEXT, detail });
    const issues = bareRefIssuesOfDetail({ context: NO_CONTEXT, detail: linkified, path: ["detail"] });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["detail", 1]);
  });

  it("linkifies inside a bullets block", () => {
    const detail: readonly DetailBlock[] = [{ items: [[{ text: "see #42", type: "text" }]], type: "bullets" }];
    const linkified = linkifyDetail({ context: ONE_REPO, detail });
    const block = linkified[0]!;
    expect(block.type === "bullets" ? block.items[0] : []).toEqual([
      { text: "see ", type: "text" },
      { label: "#42", type: "link", url: "https://github.com/acme/widget/issues/42" },
    ]);
  });
});

describe("linkifyDripArtifact", () => {
  it("linkifies a drip message's runs", () => {
    const artifact: DripArtifact = { kind: "drip", messages: [{ runs: [{ text: "fixed in #42", type: "text" }] }] };
    const result = linkifyDripArtifact({ artifact, context: ONE_REPO });
    expect(result.artifact).toEqual({
      kind: "drip",
      messages: [
        {
          runs: [
            { text: "fixed in ", type: "text" },
            { label: "#42", type: "link", url: "https://github.com/acme/widget/issues/42" },
          ],
        },
      ],
    });
    expect(result.issues.length).toBe(0);
  });

  it("linkifies a plain body using Slack's own <url|label> mrkdwn syntax", () => {
    const artifact: PlainArtifact = { kind: "plain", text: "@the-bot #42 is ticked now" };
    const result = linkifyDripArtifact({ artifact, context: ONE_REPO });
    expect(result.artifact).toEqual({
      kind: "plain",
      text: "@the-bot <https://github.com/acme/widget/issues/42|#42> is ticked now",
    });
    expect(result.issues.length).toBe(0);
  });

  it("reports every reference still bare, for either kind", () => {
    const drip: DripArtifact = { kind: "drip", messages: [{ runs: [{ text: "closed: 100, 200", type: "text" }] }] };
    expect(linkifyDripArtifact({ artifact: drip, context: NO_CONTEXT }).issues.length).toBe(2);
    const plain: PlainArtifact = { kind: "plain", text: "closed: 100, 200" };
    expect(linkifyDripArtifact({ artifact: plain, context: NO_CONTEXT }).issues.length).toBe(2);
  });
});
