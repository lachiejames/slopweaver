import { describe, expect, it } from "vitest";

import { type CardReferences, inlineSegments, NO_CARD_REFERENCES } from "../../../lib/inlineCitations";
import { ACME_ADMIN, pr } from "./fixtures";

/*
 * A number or key no address names, resolved through what the row knows instead: a drawer for acme-admin 16406 whose
 * ask carried no address at all still shows every plain-text PR number and Linear ticket id as a link.
 */
describe("inlineSegments with the row's references", () => {
  it("reads Slack's `<URL|label>` as one chip, another site's under its own label", () => {
    const linear = "https://linear.app/acme/issue/SUP-9297";
    const text = `see <${pr({ n: 16304 })}|#16304>, <${linear}|SUP-9297>, <${pr({ n: 16305 })}> and <https://example.com|docs>`;
    expect(inlineSegments({ text })).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "#16304", url: pr({ n: 16304 }) },
      { kind: "text", text: ", " },
      { kind: "cite", label: "SUP-9297", url: linear },
      { kind: "text", text: ", " },
      { kind: "cite", label: "#16305", url: pr({ n: 16305 }) },
      { kind: "text", text: " and " },
      { kind: "cite", label: "docs", url: "https://example.com" },
    ]);
  });

  it("links a number after the one other attested repository it names, when it fits that repository", () => {
    const slopweaverAsk: CardReferences = { ...ACME_ADMIN, home: "lachiejames/slopweaver", named: [] };
    expect(
      inlineSegments({ references: slopweaverAsk, text: "acme-admin 17594, acme-admin PR 17594; acme-admin 176480" }),
    ).toEqual([
      { kind: "cite", label: "acme-admin 17594", url: pr({ n: 17594 }) },
      { kind: "text", text: ", " },
      { kind: "cite", label: "acme-admin PR 17594", url: pr({ n: 17594 }) },
      { kind: "text", text: "; acme-admin 176480" },
    ]);
    expect(inlineSegments({ references: ACME_ADMIN, text: "slopweaver 17564" })).toEqual([
      { kind: "text", text: "slopweaver 17564" },
    ]);
  });

  it("links a number the home cannot hold and the row never names to the ONE other attested repository it fits", () => {
    const slopweaverAsk: CardReferences = { ...ACME_ADMIN, home: "lachiejames/slopweaver", named: [] };
    expect(
      inlineSegments({ references: slopweaverAsk, text: "citation chips said with 16406 open, and #17594" }),
    ).toEqual([
      { kind: "text", text: "citation chips said with " },
      { kind: "cite", label: "16406", url: pr({ n: 16406 }) },
      { kind: "text", text: " open, and " },
      { kind: "cite", label: "#17594", url: pr({ n: 17594 }) },
    ]);
    expect(inlineSegments({ references: slopweaverAsk, text: "1309 stays home's, 30 fits nothing" })).toEqual([
      { kind: "cite", label: "1309", url: "https://github.com/lachiejames/slopweaver/pull/1309" },
      { kind: "text", text: " stays home's, 30 fits nothing" },
    ]);
  });

  it("never falls back to a repository no board row checks out — a live acme/widgets#N", () => {
    // MEASURED on a live board: one row quoted an acme/widgets pull request URL as an example, attesting a
    // placeholder at two digits, and another row drew a two-digit number as its own row number.
    const memoryRow: CardReferences = {
      ...ACME_ADMIN,
      attested: new Map([...ACME_ADMIN.attested, ["acme/widgets", 42]]),
      home: "lachiejames/slopweaver",
      named: [],
    };
    const text = "placement.md also carries a stale 18 lines / 3,297 bytes figure, since 18, and 16406 open";
    expect(inlineSegments({ references: memoryRow, text })).toEqual([
      { kind: "text", text: "placement.md also carries a stale 18 lines / 3,297 bytes figure, since 18, and " },
      { kind: "cite", label: "16406", url: pr({ n: 16406 }) },
      { kind: "text", text: " open" },
    ]);
    expect(
      inlineSegments({ references: { ...memoryRow, checkouts: new Set(["acme/widgets"]) }, text: "since 18" }),
    ).toEqual([
      { kind: "text", text: "since " },
      { kind: "cite", label: "18", url: "https://github.com/acme/widgets/pull/18" },
    ]);
  });

  it("folds `URL (#N)` into one chip, the reverse of `#N (URL)`", () => {
    const text = `${pr({ n: 17941 })} (#17941) and ${pr({ n: 17940 })}(#17940), then ${pr({ n: 17940 })} (#17941)`;
    expect(inlineSegments({ references: ACME_ADMIN, text })).toEqual([
      { kind: "cite", label: "#17941", url: pr({ n: 17941 }) },
      { kind: "text", text: " and " },
      { kind: "cite", label: "#17940", url: pr({ n: 17940 }) },
      { kind: "text", text: ", then " },
      { kind: "cite", label: "#17940", url: pr({ n: 17940 }) },
      { kind: "text", text: " (" },
      { kind: "cite", label: "#17941", url: pr({ n: 17941 }) },
      { kind: "text", text: ")" },
    ]);
  });

  it("leaves a `#N` range as words, though `PRs N–M` links both ends", () => {
    expect(
      inlineSegments({
        references: ACME_ADMIN,
        text: "#16400–16406, #16400\u201216406, #16400 - 16406 and #16400-#16406",
      }),
    ).toEqual([
      { kind: "text", text: "#16400–16406, #16400\u201216406, #16400 - 16406 and " },
      { kind: "cite", label: "#16400", url: pr({ n: 16400 }) },
      { kind: "text", text: "-" },
      { kind: "cite", label: "#16406", url: pr({ n: 16406 }) },
    ]);
  });

  it("never links a time written with AM or PM", () => {
    const references: CardReferences = {
      ...ACME_ADMIN,
      attested: new Map([["acme/widgets", 99]]),
      home: "acme/widgets",
    };
    expect(inlineSegments({ references, text: "Deploy at 11 AM, 12 p.m. or 10pm; 42 stays" })).toEqual([
      { kind: "text", text: "Deploy at 11 AM, 12 p.m. or 10pm; " },
      { kind: "cite", label: "42", url: "https://github.com/acme/widgets/pull/42" },
      { kind: "text", text: " stays" },
    ]);
  });

  it("ends any other address at a closing bracket, so a reference after it still links", () => {
    const references: CardReferences = {
      ...ACME_ADMIN,
      attested: new Map([["acme/widgets", 99]]),
      home: "acme/widgets",
    };
    expect(inlineSegments({ references, text: "see (https://example.com/docs?id=7)#42" })).toEqual([
      { kind: "text", text: "see (" },
      { kind: "cite", label: "example.com", url: "https://example.com/docs?id=7" },
      { kind: "text", text: ")" },
      { kind: "cite", label: "#42", url: "https://github.com/acme/widgets/pull/42" },
    ]);
  });

  it("reads `pr N` and `Pull Request N` as `PR N`", () => {
    expect(inlineSegments({ references: ACME_ADMIN, text: "pr 478 and Pull Request 479" })).toEqual([
      { kind: "cite", label: "pr 478", url: pr({ n: 478 }) },
      { kind: "text", text: " and " },
      { kind: "cite", label: "Pull Request 479", url: pr({ n: 479 }) },
    ]);
  });

  it("links `acme-admin#N` and every member of a slashed `#A/#B/#C` list, never a path's `/#5`", () => {
    expect(inlineSegments({ references: ACME_ADMIN, text: "acme-admin#16497, #607/#605/#601, docs/#5" })).toEqual([
      { kind: "cite", label: "acme-admin#16497", url: pr({ n: 16497 }) },
      { kind: "text", text: ", " },
      { kind: "cite", label: "#607", url: pr({ n: 607 }) },
      { kind: "text", text: "/" },
      { kind: "cite", label: "#605", url: pr({ n: 605 }) },
      { kind: "text", text: "/" },
      { kind: "cite", label: "#601", url: pr({ n: 601 }) },
      { kind: "text", text: ", docs/#5" },
    ]);
  });

  it("links a #N its issue address claims to that issue, never a /pull/ home would invent", () => {
    const issue = "https://github.com/acme/acme-admin/issues/42";
    expect(inlineSegments({ references: ACME_ADMIN, text: `see #42 (filed as ${issue})` })).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "#42", url: issue },
      { kind: "text", text: " (filed as " },
      { kind: "cite", label: "acme/acme-admin #42", url: issue },
      { kind: "text", text: ")" },
    ]);
  });

  it("links `owner/repo#N`, `repo #N` and `repo N` to the issue a carried address claims", () => {
    const issue = "https://github.com/acme/acme-admin/issues/42";
    const text = "acme/acme-admin#42, acme-admin #42 and acme-admin 42";
    expect(inlineSegments({ known: [issue], references: ACME_ADMIN, text })).toEqual([
      { kind: "cite", label: "acme/acme-admin#42", url: issue },
      { kind: "text", text: ", " },
      { kind: "cite", label: "acme-admin #42", url: issue },
      { kind: "text", text: " and " },
      { kind: "cite", label: "acme-admin 42", url: issue },
    ]);
  });

  it("links a repository-qualified number the text calls a PR to the pull request, never a carried issue", () => {
    const issue = "https://github.com/acme/acme-admin/issues/42";
    const text = "PR acme/acme-admin#42, PR acme-admin #42, acme-admin PR 42 and acme-admin #42";
    expect(inlineSegments({ known: [issue], references: ACME_ADMIN, text })).toEqual([
      { kind: "cite", label: "PR acme/acme-admin#42", url: pr({ n: 42 }) },
      { kind: "text", text: ", " },
      { kind: "cite", label: "PR acme-admin #42", url: pr({ n: 42 }) },
      { kind: "text", text: ", " },
      { kind: "cite", label: "acme-admin PR 42", url: pr({ n: 42 }) },
      { kind: "text", text: " and " },
      { kind: "cite", label: "acme-admin #42", url: issue },
    ]);
  });

  it("reads a lower-case key in a link's label, so a label naming another ticket is words beside its chip", () => {
    const exa3 = "https://linear.app/example/issue/exa-3";
    expect(inlineSegments({ text: `[exa-2](${exa3}) and <${exa3}|qqqq-9>`, references: ACME_ADMIN })).toEqual([
      { kind: "text", text: "exa-2 " },
      { kind: "cite", label: "EXA-3", url: exa3 },
      { kind: "text", text: " and " },
      // A known team's key in lower case links through the workspace, as `QQQQ-9` does.
      { kind: "cite", label: "qqqq-9", url: "https://linear.app/acme/issue/QQQQ-9" },
      { kind: "text", text: " " },
      { kind: "cite", label: "EXA-3", url: exa3 },
    ]);
    expect(inlineSegments({ text: `[exa-3, utf-8](${exa3})` })).toEqual([
      { kind: "cite", label: "exa-3, utf-8", url: exa3 },
    ]);
  });

  it("keeps an address's trailing hyphen or ampersand, which a sentence never ends on", () => {
    const pull = "https://github.com/acme/repo/pull/42?view=review-";
    const joined = "https://github.com/acme/repo/pull/43#a=1&";
    const issue = "https://linear.app/acme/issue/QQQQ-134/fix-the-bug-";
    expect(inlineSegments({ text: `${pull} ${joined} ${issue}` })).toEqual([
      { kind: "cite", label: "#42", url: pull },
      { kind: "text", text: " " },
      { kind: "cite", label: "#43", url: joined },
      { kind: "text", text: " " },
      { kind: "cite", label: "QQQQ-134", url: issue },
    ]);
  });

  it("ends an address before a sentence's punctuation and Markdown's bold, never on it", () => {
    const pull = "https://github.com/acme/repo/pull/42?x=1";
    expect(inlineSegments({ text: `**${pull}** and ${pull}! Then ${pull}*` })).toEqual([
      { kind: "text", text: "**" },
      { kind: "cite", label: "#42", url: pull },
      { kind: "text", text: "** and " },
      { kind: "cite", label: "#42", url: pull },
      { kind: "text", text: "! Then " },
      { kind: "cite", label: "#42", url: pull },
      { kind: "text", text: "*" },
    ]);
  });

  it("keeps an address's query on its chip, so a number inside it names nothing", () => {
    const pull = "https://github.com/acme/repo/pull/42?notification_referrer_id=16406;from=a@b.c,d!e";
    const linear = "https://linear.app/example/issue/EXA-3?utm=17000#comment-c1";
    const references = { ...NO_CARD_REFERENCES, attested: new Map([["acme/repo", 20000]]), home: "acme/repo" };
    expect(inlineSegments({ references, text: `${pull}. And ${linear}, done` })).toEqual([
      { kind: "cite", label: "#42", url: pull },
      { kind: "text", text: ". And " },
      { kind: "cite", label: "EXA-3", url: linear },
      { kind: "text", text: ", done" },
    ]);
  });

  it("keeps a Linear comment's fragment on its chip, bare and inside Slack markup", () => {
    const comment = "https://linear.app/acme/issue/ENG-42#comment-c1";
    expect(inlineSegments({ text: `see ${comment} and <${comment}|that comment>` })).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "ENG-42", url: comment },
      { kind: "text", text: " and " },
      { kind: "cite", label: "that comment", url: comment },
    ]);
  });

  it("reads a Markdown link as one chip under its label", () => {
    const linear = "https://linear.app/acme/issue/QQQQ-134";
    const text = `[PR #16406](${pr({ n: 16406 })}) and [the ticket](${linear}), [docs](https://example.com)`;
    expect(inlineSegments({ text })).toEqual([
      { kind: "cite", label: "PR #16406", url: pr({ n: 16406 }) },
      { kind: "text", text: " and " },
      { kind: "cite", label: "the ticket", url: linear },
      { kind: "text", text: ", " },
      { kind: "cite", label: "docs", url: "https://example.com" },
    ]);
  });

  it("draws a Slack or Markdown link whose label names another PR or ticket as its label, then its own chip", () => {
    const text = [
      `<${pr({ n: 716 })}|PR #715>`,
      `[PR #16406](${pr({ n: 16407 })})`,
      "<https://linear.app/acme/issue/QQQQ-135|QQQQ-134>",
      `[#716 and #717](${pr({ n: 716 })})`,
      `[QQQQ-134](${pr({ n: 716 })})`,
      `[acme-admin 715](${pr({ n: 716 })})`,
    ].join(" ");
    const secu135 = "https://linear.app/acme/issue/QQQQ-135";
    expect(inlineSegments({ text })).toEqual([
      { kind: "text", text: "PR #715 " },
      { kind: "cite", label: "#716", url: pr({ n: 716 }) },
      { kind: "text", text: " PR #16406 " },
      { kind: "cite", label: "#16407", url: pr({ n: 16407 }) },
      { kind: "text", text: " QQQQ-134 " },
      { kind: "cite", label: "QQQQ-135", url: secu135 },
      { kind: "text", text: " " },
      { kind: "cite", label: "#716", url: pr({ n: 716 }) },
      { kind: "text", text: " and #717 " },
      { kind: "cite", label: "#716", url: pr({ n: 716 }) },
      { kind: "text", text: " QQQQ-134 " },
      { kind: "cite", label: "#716", url: pr({ n: 716 }) },
      { kind: "text", text: " acme-admin 715 " },
      { kind: "cite", label: "#716", url: pr({ n: 716 }) },
    ]);
  });

  it("links the fleet's compact PR#N and PR-N, and acme-admin PR#N", () => {
    expect(inlineSegments({ references: ACME_ADMIN, text: "PR#16672, PR-15959 and acme-admin PR#16676" })).toEqual([
      { kind: "cite", label: "PR#16672", url: pr({ n: 16672 }) },
      { kind: "text", text: ", " },
      { kind: "cite", label: "PR-15959", url: pr({ n: 15959 }) },
      { kind: "text", text: " and " },
      { kind: "cite", label: "acme-admin PR#16676", url: pr({ n: 16676 }) },
    ]);
  });

  it("reads PR-N as a Linear key when the install has a team PR", () => {
    const references = { ...ACME_ADMIN, linearTeamKeys: ["PR"], linearWorkspace: "acme" };
    expect(inlineSegments({ references, text: "PR-15959" })).toEqual([
      { kind: "cite", label: "PR-15959", url: "https://linear.app/acme/issue/PR-15959" },
    ]);
  });
});
