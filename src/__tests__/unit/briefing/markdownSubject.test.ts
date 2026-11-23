/**
 * The never-a-markdown-document subject rule: the criterion, its words, and the walk over both groupings.
 *
 * The fixture is the owner's own measured url rather than an invented one, so a test
 * passing means the finding card the owner actually read would now be refused.
 */
import { describe, expect, it } from "vitest";

import {
  FINDING_PAGE_CONTRACT,
  isMarkdownSubjectUrl,
  markdownSubjectIssues,
  markdownSubjectRefusal,
} from "../../../briefing/markdownSubject.js";
import type { BriefingCard } from "../../../outbound/briefing/types.js";

/** The exact url on the Slack-ingest-stall card of one chair's `pre-p1-open-pages.json`. */
const HIS_URL =
  "file:///Users/ada.owner/.slopweaver/handovers/slack-ingest-stalls-on-poll-known-threads-corpus-a-day-behind.md";

/** A page the same finding should have been published as. */
const A_PAGE = "file:///Users/ada.owner/.slopweaver/pages/slack-ingest-stall/index.html";

/** One text run, the way every projected field is spelled. */
function run({ text }: { text: string }): readonly [{ kind: "text"; text: string }] {
  return [{ kind: "text", text }];
}

/** A well-shaped ready card whose subject is whatever the test hands it. */
function card({ url }: { url: string | undefined }): BriefingCard {
  return {
    ifSilent: run({ text: "The corpus stays a day behind." }),
    lean: run({ text: "A, the walk is the fault." }),
    options: [{ letter: "A", text: "Tell the supervisor A and a seat fixes the walk." }],
    premise: { kind: "composed", readIso: "2026-09-15T22:23:35Z" },
    question: "Do you rule the Slack ingest stall finding?",
    readiness: { state: "ready" },
    subject: url === undefined ? { text: "no page for this one yet" } : { text: "the finding", url },
    what: run({ text: "A two-day Slack refresh hangs with no error. The newest record is from 14 Sep." }),
    whyYou: run({ text: "Your own hand opens a finding-origin pull request." }),
  };
}

describe("isMarkdownSubjectUrl", () => {
  it("refuses the very handover doc they were sent to", () => {
    expect(isMarkdownSubjectUrl({ url: HIS_URL })).toBe(true);
  });

  it("refuses a markdown document under any scheme and any directory, not only a handover doc", () => {
    const urls = [
      "https://github.com/lachiejames/slopweaver/blob/main/docs/security.md",
      "file:///Users/someone/notes/README.md",
      "https://raw.githubusercontent.invalid/x/y/main/finding.MD",
    ];

    expect(urls.map((url) => isMarkdownSubjectUrl({ url }))).toEqual([true, true, true]);
  });

  it("sees through a query or a fragment, which name a place inside the same raw file", () => {
    expect(isMarkdownSubjectUrl({ url: `${HIS_URL}#what-was-observed` })).toBe(true);
    expect(isMarkdownSubjectUrl({ url: `${HIS_URL}?plain=1` })).toBe(true);
  });

  it("passes a published page, a pull request and a Slack permalink", () => {
    const urls = [
      A_PAGE,
      "https://github.com/lachiejames/slopweaver/pull/756",
      "https://acme.slack.com/archives/C0SYN000002/p1788735639410069",
    ];

    expect(urls.map((url) => isMarkdownSubjectUrl({ url }))).toEqual([false, false, false]);
  });

  it("does not claim a url whose `.md` sits in the query rather than the path", () => {
    expect(isMarkdownSubjectUrl({ url: "https://example.invalid/view?file=finding.md" })).toBe(false);
  });

  it("leaves a url that does not parse to the absolute-url rule rather than refusing it twice", () => {
    expect(isMarkdownSubjectUrl({ url: "/handovers/finding.md" })).toBe(false);
    expect(isMarkdownSubjectUrl({ url: "" })).toBe(false);
  });
});

describe("markdownSubjectRefusal", () => {
  it("names the page verb and the four things a finding page carries", () => {
    const words = markdownSubjectRefusal();

    expect(words).toContain("slopweaver page publish <slug> --page <fragment>.html");
    expect(words).toContain(FINDING_PAGE_CONTRACT);
    expect(FINDING_PAGE_CONTRACT).toBe(
      "what was measured, why it matters, the candidate causes, and the options with their cost",
    );
  });
});

describe("markdownSubjectIssues", () => {
  it("refuses the card the owner read, at its own me-facing path", () => {
    expect(markdownSubjectIssues({ meFacing: [card({ url: HIS_URL })], teamFacing: [] })).toEqual([
      {
        message: `this card's \`subject.url\` ${markdownSubjectRefusal()}`,
        path: ["reactNow", "meFacing", 0, "subject", "url"],
      },
    ]);
  });

  it("reads both groupings, team-facing first, and names every offender rather than the first", () => {
    const issues = markdownSubjectIssues({
      meFacing: [card({ url: A_PAGE }), card({ url: HIS_URL })],
      teamFacing: [card({ url: "https://example.invalid/docs/plan.md" })],
    });

    expect(issues.map((issue) => issue.path)).toEqual([
      ["reactNow", "teamFacing", 0, "subject", "url"],
      ["reactNow", "meFacing", 1, "subject", "url"],
    ]);
  });

  it("passes a page-less subject and a page subject alike", () => {
    expect(
      markdownSubjectIssues({ meFacing: [card({ url: undefined })], teamFacing: [card({ url: A_PAGE })] }),
    ).toEqual([]);
  });
});
