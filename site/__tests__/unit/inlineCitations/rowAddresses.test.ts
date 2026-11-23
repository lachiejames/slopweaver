/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { type CardReferences, inlineSegments, NO_CARD_REFERENCES } from "../../../lib/inlineCitations";
import { ACME_ADMIN, pr, SECU } from "./fixtures";

/*
 * A number or key no address names, resolved through what the row knows instead: a drawer for acme-admin 16406 whose
 * ask carried no address at all still shows every plain-text PR number and Linear ticket id as a link.
 */
describe("inlineSegments with the row's references", () => {
  it("keeps repo N as words when its pull request and an issue of that number are both carried", () => {
    const references = { ...NO_CARD_REFERENCES, attested: new Map([["acme/repo", 100]]), home: "acme/repo" };
    const pull = "https://github.com/acme/repo/pull/42";
    const issue = "https://github.com/acme/repo/issues/42";
    expect(inlineSegments({ known: [pull, issue], references, text: "repo 42" })).toEqual([
      { kind: "text", text: "repo 42" },
    ]);
    expect(inlineSegments({ known: [pull], references, text: "repo 42" })).toEqual([
      { kind: "cite", label: "repo 42", url: pull },
    ]);
  });

  it("reads PR before a repository and its bare number as that pull request, never a carried issue", () => {
    const references = {
      ...NO_CARD_REFERENCES,
      attested: new Map([["acme/acme-admin", 100]]),
      home: "acme/acme-admin",
    };
    const known = ["https://github.com/acme/acme-admin/issues/42"];
    expect(inlineSegments({ known, references, text: "PR acme-admin 42, not PR review 12" })).toEqual([
      { kind: "cite", label: "PR acme-admin 42", url: "https://github.com/acme/acme-admin/pull/42" },
      { kind: "text", text: ", not PR review 12" },
    ]);
  });

  it("keeps a key fused into a hyphenated name as words, even with its address carried", () => {
    const known = ["https://linear.app/acme/issue/POST-16676", "https://linear.app/acme/issue/QQQQ-134"];
    const text = "post-16676-draft, QQQQ-134-notes and PR-15959-seed";
    expect(inlineSegments({ known, references: ACME_ADMIN, text })).toEqual([{ kind: "text", text }]);
  });

  it("reads a lower-case pr-N as the Linear key its carried address claims, never a pull request", () => {
    const linear = "https://linear.app/acme/issue/pr-15959";
    const references = { ...ACME_ADMIN, linearTeamKeys: ["PR"], linearWorkspace: "acme" };
    expect(inlineSegments({ known: [linear], references, text: "pr-15959 and Pr-15959" })).toEqual([
      { kind: "cite", label: "pr-15959", url: linear },
      { kind: "text", text: " and " },
      { kind: "cite", label: "Pr-15959", url: linear },
    ]);
    expect(inlineSegments({ references: ACME_ADMIN, text: "pr-15959" })).toEqual([
      { kind: "cite", label: "pr-15959", url: pr({ n: 15959 }) },
    ]);
  });

  it("keeps another register's #N as words unless an address carries it: an issue #N, a ticket #N", () => {
    const text = "GitHub issue #42 is closed, ticket #12 and finding #31 too";
    expect(inlineSegments({ references: ACME_ADMIN, text })).toEqual([{ kind: "text", text }]);
  });

  it("links both ends of a range the PR word names, and no other range", () => {
    expect(inlineSegments({ references: ACME_ADMIN, text: "Review PRs 16400–16406, then PR 16410 - 16412" })).toEqual([
      { kind: "text", text: "Review " },
      { kind: "cite", label: "PRs 16400", url: pr({ n: 16400 }) },
      { kind: "text", text: "–" },
      { kind: "cite", label: "16406", url: pr({ n: 16406 }) },
      { kind: "text", text: ", then " },
      { kind: "cite", label: "PR 16410", url: pr({ n: 16410 }) },
      { kind: "text", text: " - " },
      { kind: "cite", label: "16412", url: pr({ n: 16412 }) },
    ]);
  });

  it("claims a key from a Linear address written in lower case", () => {
    const issue = "https://linear.app/example/issue/exa-2";
    expect(inlineSegments({ known: [issue], text: `${issue} and EXA-2` })).toEqual([
      { kind: "cite", label: "EXA-2", url: issue },
      { kind: "text", text: " and " },
      { kind: "cite", label: "EXA-2", url: issue },
    ]);
  });

  it("links `issue owner/repo#N` to that issue with no address carried", () => {
    expect(inlineSegments({ references: ACME_ADMIN, text: "see issue acme/acme-admin#42" })).toEqual([
      { kind: "text", text: "see " },
      {
        kind: "cite",
        label: "issue acme/acme-admin#42",
        url: "https://github.com/acme/acme-admin/issues/42",
      },
    ]);
    // The plural in any case, `ISSUES` as surely as `issues`.
    expect(inlineSegments({ references: ACME_ADMIN, text: "ISSUES acme/repo#1" })).toEqual([
      { kind: "cite", label: "ISSUES acme/repo#1", url: "https://github.com/acme/repo/issues/1" },
    ]);
  });

  it("reads a label's PR-41 as the Linear ticket when the install has a team PR", () => {
    const text = `<${pr({ n: 41 })}|PR-41>`;
    const team = { ...ACME_ADMIN, linearTeamKeys: ["PR"], linearWorkspace: "acme" };
    expect(inlineSegments({ references: team, text })).toEqual([
      { kind: "cite", label: "PR-41", url: "https://linear.app/acme/issue/PR-41" },
      { kind: "text", text: " " },
      { kind: "cite", label: "#41", url: pr({ n: 41 }) },
    ]);
    expect(inlineSegments({ references: ACME_ADMIN, text })).toEqual([
      { kind: "cite", label: "PR-41", url: pr({ n: 41 }) },
    ]);
  });

  it("reads two spellings of one address differing only by case as one", () => {
    const upper = "https://github.com/Acme/acme-admin/pull/16406";
    const linear = "https://linear.app/acme/issue/QQQQ-134";
    const known = [pr({ n: 16406 }), upper, linear, "https://linear.app/acme/issue/QQQQ-134"];
    expect(inlineSegments({ known, text: "#16406 and QQQQ-134" })).toEqual([
      { kind: "cite", label: "#16406", url: pr({ n: 16406 }) },
      { kind: "text", text: " and " },
      { kind: "cite", label: "QQQQ-134", url: linear },
    ]);
  });

  it("links a lower-case key only through a carried address", () => {
    const issue = "https://linear.app/example/issue/exa-2";
    expect(inlineSegments({ known: [issue], text: "exa-2 over utf-8" })).toEqual([
      { kind: "cite", label: "exa-2", url: issue },
      { kind: "text", text: " over utf-8" },
    ]);
  });

  it("links PR N to home's pull request beside a carried issue N, and org/repo#N to that issue in any case", () => {
    const issue = "https://github.com/acme/acme-admin/issues/42";
    const known = [issue, "https://github.com/Acme/acme-admin/issues/42"];
    expect(inlineSegments({ known, references: ACME_ADMIN, text: "PR 42, acme/acme-admin#42" })).toEqual([
      { kind: "cite", label: "PR 42", url: pr({ n: 42 }) },
      { kind: "text", text: ", " },
      { kind: "cite", label: "acme/acme-admin#42", url: issue },
    ]);
  });

  it("links a number beside a month word that is not a day — 16406 may land, see may 17564", () => {
    expect(inlineSegments({ references: ACME_ADMIN, text: "Decide 16406 may land" })).toEqual([
      { kind: "text", text: "Decide " },
      { kind: "cite", label: "16406", url: pr({ n: 16406 }) },
      { kind: "text", text: " may land" },
    ]);
  });

  it("chips any other address whole under its place, whatever numbers or keys sit inside it", () => {
    const text = "see https://example.com/report?id=16406 and https://www.notion.so/QQQQ-134-notes-abc then #16406";
    expect(inlineSegments({ references: ACME_ADMIN, text })).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "example.com", url: "https://example.com/report?id=16406" },
      { kind: "text", text: " and " },
      { kind: "cite", label: "a Notion page", url: "https://www.notion.so/QQQQ-134-notes-abc" },
      { kind: "text", text: " then " },
      { kind: "cite", label: "#16406", url: pr({ n: 16406 }) },
    ]);
  });

  it("draws another site's link whose label names a PR or ticket as those words, then the site's own chip", () => {
    const text = "<https://example.com/notes|PR 16406 notes> and [QQQQ-134 doc](https://docs.example.com/x)";
    expect(inlineSegments({ references: ACME_ADMIN, text })).toEqual([
      { kind: "cite", label: "PR 16406", url: "https://github.com/acme/acme-admin/pull/16406" },
      { kind: "text", text: " notes " },
      { kind: "cite", label: "example.com", url: "https://example.com/notes" },
      { kind: "text", text: " and " },
      { kind: "cite", label: "QQQQ-134", url: "https://linear.app/acme/issue/QQQQ-134" },
      { kind: "text", text: " doc " },
      { kind: "cite", label: "docs.example.com", url: "https://docs.example.com/x" },
    ]);
  });

  it("chips a bare Vanta, Datadog, JumpCloud and Slack address by the place it names, a sentence's full stop left out", () => {
    const vanta = "https://app.vanta.com/c/acme/controls/change-management";
    const monitor = "https://app.ap1.datadoghq.com/monitors/4412";
    const jumpcloud = "https://console.jumpcloud.com/#/users/5f1a";
    const slack = "https://acme.slack.com/archives/C0123ABC/p1788319097879449";
    const text = `${vanta}, ${monitor}; ${jumpcloud} and ${slack}.`;
    expect(inlineSegments({ references: ACME_ADMIN, text })).toEqual([
      { kind: "cite", label: "control change-management", url: vanta },
      { kind: "text", text: ", " },
      { kind: "cite", label: "monitor 4412", url: monitor },
      { kind: "text", text: "; " },
      { kind: "cite", label: "users 5f1a", url: jumpcloud },
      { kind: "text", text: " and " },
      { kind: "cite", label: "a message", url: slack },
      { kind: "text", text: "." },
    ]);
  });

  it("keeps a board row's slug as words, never a link, since a board row has no page to open", () => {
    const references: CardReferences = { ...ACME_ADMIN, boardSlugs: new Set(["iso-compliance-violations-bigtask"]) };
    const text = "blocked on iso-compliance-violations-bigtask, not on some-other-row-name or a-b";
    expect(inlineSegments({ references, text })).toEqual([{ kind: "text", text }]);
    expect(inlineSegments({ references: ACME_ADMIN, text: "iso-compliance-violations-bigtask" })).toEqual([
      { kind: "text", text: "iso-compliance-violations-bigtask" },
    ]);
    // A longer word of any script it only begins is not the row.
    expect(inlineSegments({ references, text: "iso-compliance-violations-bigtaské" })).toEqual([
      { kind: "text", text: "iso-compliance-violations-bigtaské" },
    ]);
  });

  it("links another site's Slack link under its own words when they name no PR or ticket", () => {
    const thread = "https://acme.slack.com/archives/C0SYN000001/p1790054263189439";
    const control = "https://app.vanta.com/c/acme/controls?controlId=0syn0005";
    const text = `reply in <${thread}|the owner's change-management thread>; III-204 is <${control}|Use of privileged utility programs>`;
    expect(inlineSegments({ references: ACME_ADMIN, text })).toEqual([
      { kind: "text", text: "reply in " },
      { kind: "cite", label: "the owner's change-management thread", url: thread },
      { kind: "text", text: "; III-204 is " },
      { kind: "cite", label: "Use of privileged utility programs", url: control },
    ]);
  });

  it("chips another site's bare Slack link under the place it points at, since it has no words to draw", () => {
    const url = "https://acme.slack.com/archives/C0SYN000001/p1790054263189439";
    expect(inlineSegments({ references: ACME_ADMIN, text: `see <${url}>` })).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "a message", url },
    ]);
  });

  it("links a label that names its own PR or ticket, or none", () => {
    expect(
      inlineSegments({ text: `<${pr({ n: 716 })}|716> and [QQQQ-134 fix](https://linear.app/acme/issue/QQQQ-134)` }),
    ).toEqual([
      { kind: "cite", label: "716", url: pr({ n: 716 }) },
      { kind: "text", text: " and " },
      { kind: "cite", label: "QQQQ-134 fix", url: "https://linear.app/acme/issue/QQQQ-134" },
    ]);
  });

  it("links no bare number when the row has no repository, or no row attests its scale", () => {
    const text = "Decide 16406";
    expect(inlineSegments({ references: { ...ACME_ADMIN, home: undefined }, text })).toEqual([{ kind: "text", text }]);
    expect(inlineSegments({ references: { ...ACME_ADMIN, attested: new Map() }, text })).toEqual([
      { kind: "text", text },
    ]);
  });

  it("links a key only on a team the install knows, and only with a workspace to address it", () => {
    const text = "QQQQ-134 at UTC-5 per ISO-8601";
    expect(inlineSegments({ references: ACME_ADMIN, text })).toEqual([
      { kind: "cite", label: "QQQQ-134", url: SECU },
      { kind: "text", text: " at UTC-5 per ISO-8601" },
    ]);
    expect(inlineSegments({ references: { ...ACME_ADMIN, linearWorkspace: undefined }, text })).toEqual([
      { kind: "text", text },
    ]);
  });

  it("still prefers an address the row carries over the home repository", () => {
    const other = "https://github.com/acme/other/pull/16406";
    expect(inlineSegments({ known: [other], references: ACME_ADMIN, text: "#16406" })).toEqual([
      { kind: "cite", label: "#16406", url: other },
    ]);
  });
});
