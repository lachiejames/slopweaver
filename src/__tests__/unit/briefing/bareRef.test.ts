/**
 * The bare-reference scan: context built from the page's own links, and residue found — or not — in the
 * react-now block and everything outside it.
 */
import { describe, expect, it } from "vitest";

import {
  bareRefContextOfPage,
  checkBareRefs,
  plainTextRefsOf,
  resolvedGithubRefsOf,
} from "../../../briefing/bareRef.js";
import { renderNote } from "../../../outbound/briefing/render.js";
import { type BriefingNote, ME_FACING_ID } from "../../../outbound/briefing/types.js";

const GITHUB_LINK = '<a href="https://github.com/octo-self/slopweaver/pull/100">#100</a>';
const OTHER_REPO_LINK = '<a href="https://github.com/acme/other-repo/pull/9">#9</a>';
const LINEAR_LINK = '<a href="https://linear.app/acme/issue/SUP-100">SUP-100</a>';

/** Wrap a react-now snippet and an "outside" snippet the way the real page shapes them. */
function page({ reactNow, outside = "" }: { reactNow: string; outside?: string }): string {
  return `<style>:root{--ground:#131619;}</style>${outside}<h2>react now</h2>${reactNow}<h2>done</h2>`;
}

describe("bareRefContextOfPage", () => {
  it("collects every distinct repo a github link on the page names", () => {
    const context = bareRefContextOfPage({ html: `${GITHUB_LINK} and ${OTHER_REPO_LINK}` });

    expect(context.repos).toEqual([
      { owner: "octo-self", repo: "slopweaver" },
      { owner: "acme", repo: "other-repo" },
    ]);
  });

  it("collects the linear workspace slug and every team-key prefix a linear link names", () => {
    const context = bareRefContextOfPage({ html: LINEAR_LINK });

    expect(context.linearWorkspaceSlug).toBe("acme");
    expect(context.linearTeamKeys).toEqual(["SUP"]);
  });

  it("takes the workspace slug from the FIRST linear link when two name different workspaces", () => {
    const second = '<a href="https://linear.app/elsewhere/issue/OPS-7">OPS-7</a>';
    const context = bareRefContextOfPage({ html: `${LINEAR_LINK} then ${second}` });

    expect(context.linearWorkspaceSlug).toBe("acme");
    expect(context.linearTeamKeys).toEqual(["SUP", "OPS"]);
  });

  it("finds nothing on a page with no link at all", () => {
    const context = bareRefContextOfPage({ html: "<p>no links here</p>" });

    expect(context.repos).toEqual([]);
    expect(context.linearWorkspaceSlug).toBeUndefined();
  });
});

describe("checkBareRefs", () => {
  it("finds nothing on a page carrying no bare reference at all", () => {
    const result = checkBareRefs({ html: page({ reactNow: "<p>Nothing to link here.</p>" }) });

    expect(result.defects).toEqual([]);
  });

  it("resolves a bare issue reference against the sole repo the page's own links name, in the react-now region", () => {
    const result = checkBareRefs({
      html: page({ outside: GITHUB_LINK, reactNow: "<p>Also see #100 in this card.</p>" }),
    });

    expect(result.defects).toEqual([]);
  });

  it("refuses a bare issue reference when no repo on the page resolves it", () => {
    const result = checkBareRefs({ html: page({ reactNow: "<p>See #100 for context.</p>" }) });

    expect(result.defects).toEqual([
      {
        reason:
          '"#100" is a bare reference (renders as #100) with no single repo to resolve it against — write it ' +
          'as "owner/repo#<number>", or put one full github.com/<owner>/<repo> link in the same text, which names ' +
          "the repo every bare reference beside it means.",
        region: "react-now",
        where: 'section "react now"',
      },
    ]);
  });

  it("refuses a bare issue reference when the page links two different repos — a real ambiguity", () => {
    const result = checkBareRefs({
      html: page({ outside: `${GITHUB_LINK}${OTHER_REPO_LINK}`, reactNow: "<p>See #100 for context.</p>" }),
    });

    expect(result.defects).toEqual([
      {
        reason:
          '"#100" is a bare reference (renders as #100) with no single repo to resolve it against — write it ' +
          'as "owner/repo#<number>", or put one full github.com/<owner>/<repo> link in the same text, which names ' +
          "the repo every bare reference beside it means.",
        region: "react-now",
        where: 'section "react now"',
      },
    ]);
  });

  it("always resolves the explicit owner/repo-qualified spelling, with no context needed", () => {
    const result = checkBareRefs({ html: page({ reactNow: "<p>See octo-self/slopweaver#100.</p>" }) });

    expect(result.defects).toEqual([]);
  });

  it("never re-flags a reference that is already a real link", () => {
    const result = checkBareRefs({ html: page({ reactNow: `<p>Merged as ${GITHUB_LINK}.</p>` }) });

    expect(result.defects).toEqual([]);
  });

  it("never flags a reference sitting inside a code span", () => {
    const result = checkBareRefs({ html: page({ reactNow: "<p>Write it as <code>#100</code> in prose.</p>" }) });

    expect(result.defects).toEqual([]);
  });

  it("strips the page's own <style> block before scanning, so a hex colour is never mistaken for a reference", () => {
    const result = checkBareRefs({ html: page({ reactNow: "<p>Nothing to link.</p>" }) });

    expect(result.defects).toEqual([]);
  });

  it("scans outside the react-now block too, and names that region and the fold it sits in", () => {
    const result = checkBareRefs({
      html: page({ outside: "<details><summary>history</summary><div><p>See #100.</p></div></details>", reactNow: "" }),
    });

    expect(result.defects).toEqual([
      {
        reason:
          '"#100" is a bare reference (renders as #100) with no single repo to resolve it against — write it ' +
          'as "owner/repo#<number>", or put one full github.com/<owner>/<repo> link in the same text, which names ' +
          "the repo every bare reference beside it means.",
        region: "page",
        where: 'the page header › fold "history"',
      },
    ]);
  });
});

describe("checkBareRefs — naming the place a chair edits", () => {
  /** A react-now card carrying `body` below its question, in the renderer's shape. */
  function card({ question, body }: { question: string; body: string }): string {
    return `<div class="need"><div class="q">${question}</div><p>${body}</p></div>`;
  }

  it("names the card by number and question, counting both groupings in page order", () => {
    const html = page({
      reactNow:
        `<h3 id="team-facing">team-facing</h3>${card({ body: "clean", question: "Send the draft?" })}` +
        `<h3 id="${ME_FACING_ID}">yours</h3>${card({ body: "See #100.", question: "Close the ticket?" })}`,
    });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual(['card 2 ("Close the ticket?")']);
  });

  it("numbers a card after one wrapped in an anchor as the card checks do, rather than one early", () => {
    const html = page({
      reactNow:
        `<a href="#first">${card({ body: "clean", question: "A?" })}</a>` + card({ body: "See #100.", question: "B?" }),
    });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual(['card 2 ("B?")']);
  });

  it("scans nothing of a card the page comments out or wraps in a code span, and still counts it", () => {
    const html = page({
      reactNow:
        `<!-- ${card({ body: "See #100.", question: "Old?" })} -->` +
        `<code>${card({ body: "See #200.", question: "Code?" })}</code>` +
        card({ body: "See #300.", question: "Live?" }),
    });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual(['card 3 ("Live?")']);
  });

  it("never lets the page's own text fence a stretch of it as a card", () => {
    const html = page({
      reactNow: `<p>1 See #100. 1</p>${card({ body: "clean", question: "A?" })}`,
    });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual(['section "react now"']);
  });

  it("drops a card left open before the me-facing grouping, as the card checks do", () => {
    const html = page({
      reactNow:
        '<div class="need"><div class="q">A?</div><p>never closed</p>' +
        `<h3 id="${ME_FACING_ID}">yours</h3>${card({ body: "See #100.", question: "B?" })}</div>`,
    });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual(['card 1 ("B?")']);
  });

  it("reads no fold boundary, and no reference, inside an HTML comment", () => {
    const html =
      "<h2>react now</h2><h2>history</h2>" +
      "<details><summary>A</summary><!-- </details> #200 --><p>See #100.</p></details>";

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual(['section "history" › fold "A"']);
  });

  it("names the section heading, then each fold it sits inside, outermost first", () => {
    const html =
      `<h2>react now</h2><h2 id="autonomy">done for you, without asking</h2>` +
      "<details><summary>merged 3 pull requests</summary><div>" +
      "<details><summary>the second</summary><div><p>Landed #100.</p></div></details>" +
      "<p>After the inner fold closes.</p></div></details>";

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual([
      'section "done for you, without asking" › fold "merged 3 pull requests" › fold "the second"',
    ]);
  });

  it("returns to the outer fold once an inner one closes", () => {
    const html =
      '<h2>react now</h2><h2 id="recent">done since you last looked</h2>' +
      "<details><summary>this pass</summary><div>" +
      "<details><summary>inner</summary><div><p>clean</p></div></details>" +
      "<p>Landed #100.</p></div></details>";

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual([
      'section "done since you last looked" › fold "this pass"',
    ]);
  });

  it("reports a reference in a card nested inside a card once, under the outer card", () => {
    const html = page({
      reactNow: `<div class="need"><div class="q">Outer?</div>${card({ body: "See #100.", question: "Inner?" })}</div>`,
    });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual(['card 1 ("Outer?")']);
  });

  it("numbers cards by position, even when a nested card's markup appears again later", () => {
    const repeated = card({ body: "See #100.", question: "Repeated?" });
    const html = page({
      reactNow:
        `<div class="need"><div class="q">Outer?</div>${repeated}</div>` +
        `${card({ body: "See #200.", question: "Middle?" })}${repeated}`,
    });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual([
      'card 1 ("Outer?")',
      'card 3 ("Middle?")',
      'card 4 ("Repeated?")',
    ]);
  });

  it("still strips an anchor that straddles a fold's summary, so its label is never read as a reference", () => {
    const html =
      "<h2>react now</h2><h2>history</h2><details>" +
      '<a href="https://github.com/o/r/pull/1"><summary>see #100</summary></a></details>';

    expect(checkBareRefs({ html }).defects).toEqual([]);
  });

  it("names a grouping heading inside the react-now block for text outside every card", () => {
    const html = page({ reactNow: '<h3 id="open">every open page, best first</h3><p>See #100.</p>' });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual([
      'section "react now" › "every open page, best first"',
    ]);
  });
});

describe("a URL rendered as inert text", () => {
  const URL = "https://claude.ai/code/artifact/0dc1a3db";

  it("is refused when it sits in a card fold as plain characters", () => {
    const result = checkBareRefs({
      html: page({
        reactNow: `<div class="need"><details><summary>s</summary><div><p>see ${URL} .</p></div></details></div>`,
      }),
    });

    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.region).toBe("react-now");
    expect(result.defects[0]!.reason).toContain("sits in the text as plain characters rather than a link");
  });

  it("is refused when it sits outside the react-now block", () => {
    const result = checkBareRefs({ html: page({ outside: `<p>${URL}</p>`, reactNow: "" }) });

    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.region).toBe("page");
  });

  it("finds nothing once the same URL is a real anchor", () => {
    const result = checkBareRefs({
      html: page({ reactNow: `<p><a href="${URL}">the probeless board rows</a></p>` }),
    });

    expect(result.defects).toEqual([]);
  });

  it("reports one defect per distinct URL rather than one per occurrence", () => {
    const result = checkBareRefs({ html: page({ reactNow: `<p>${URL} and again ${URL} and ${URL}b</p>` }) });

    expect(result.defects.length).toBe(2);
  });

  it("reads a URL inside a code span as a literal, never as a dead link", () => {
    const result = checkBareRefs({ html: page({ reactNow: `<p><code>${URL}</code></p>` }) });

    expect(result.defects).toEqual([]);
  });
});

describe("bareRefContextOfPage — the page's own numbering evidence", () => {
  it("attests every object number a github link on the page names", () => {
    const context = bareRefContextOfPage({ html: `${GITHUB_LINK} and ${OTHER_REPO_LINK}` });

    expect(context.attested).toEqual([
      { number: 100, owner: "octo-self", repo: "slopweaver" },
      { number: 9, owner: "acme", repo: "other-repo" },
    ]);
  });

  it("attests nothing from a link that names no object number", () => {
    const html = '<a href="https://github.com/octo-self/slopweaver/commit/15d422aa">the commit</a>';

    expect(bareRefContextOfPage({ html }).attested).toEqual([]);
  });
});

describe("checkBareRefs — a number that cannot be one of the page's repo", () => {
  it("refuses a five-digit bare reference on a page whose only repo link is three-digit", () => {
    const html = page({ reactNow: `${GITHUB_LINK} and the ruling covered #16339` });
    const { defects } = checkBareRefs({ html });

    expect(defects.length).toBe(1);
    expect(defects[0]!.region).toBe("react-now");
    expect(defects[0]!.reason).toContain("largest number known to exist in octo-self/slopweaver here is 100");
  });

  it("still resolves a bare reference of the repo's own magnitude on the same page", () => {
    const html = page({ reactNow: `${GITHUB_LINK} and the ruling covered #99` });

    expect(checkBareRefs({ html }).defects).toEqual([]);
  });
});

describe("checkBareRefs — a link in a heading leaves no scan mark in the place a defect names", () => {
  it("names the heading with its link taken out, exactly as before the marks existed", () => {
    const html = '<h2><a href="https://github.com/acme/widget/pull/1">Widget #1</a> landings</h2><p>#22</p>';

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual(['section "landings"']);
  });

  it("leaves no half of a mark behind where the heading's label is capped mid-mark", () => {
    const html = `<h2>${"a".repeat(56)}<a href="https://github.com/acme/widget/pull/1">#1</a> trailing</h2><p>#999</p>`;

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual([`section "${"a".repeat(56)}..."`]);
  });

  it("reads a page's own scan character as the separator it is, never as a space waking the alert exemption", () => {
    const separated = ({ between }: { between: string }): string =>
      '<p><a href="https://github.com/acme/widget/pull/120">#120</a></p>' +
      '<h2>other</h2><p><a href="https://github.com/acme/gadget/pull/19343">#19343</a></p>' +
      `<h2>landings</h2><p>alert${between}#9999</p>`;

    expect(checkBareRefs({ html: separated({ between: "" }) }).defects.map((defect) => defect.where)).toEqual([
      'section "landings"',
    ]);
    expect(checkBareRefs({ html: separated({ between: " " }) }).defects).toEqual([]);
  });

  it("reads the one space either side of a link as the page does, so a PR-list lead-in at its limit still counts", () => {
    const link = '<a href="https://github.com/acme/widget/pull/120">#120</a>';
    const html = `<h2>landings</h2><p>merged 1234567890123456789012 ${link} : 19343</p>`;

    expect(checkBareRefs({ html }).defects.map((defect) => defect.where)).toEqual(['section "landings"']);
  });

  it("reads an auto-linked URL as its entry's own link, never falling back to another entry's", () => {
    const own = renderNote({
      note: { headline: [{ kind: "text", text: "https://github.com/acme/widget/pull/120 then #19344" }] },
    });
    const other = renderNote({
      note: { headline: [{ kind: "link", text: "#19343", url: "https://github.com/acme/gadget/pull/19343" }] },
    });

    // Against its own widget link, that reference is far past the link's own number, so the check refuses it rather than credit gadget.
    expect(checkBareRefs({ html: `<h2>landings</h2>${own}${other}` }).defects.map((defect) => defect.where)).toEqual([
      'section "landings"',
    ]);
  });

  it("counts a link whose host is spelled in capitals toward the page's own repositories", () => {
    const html = '<p><a href="https://GitHub.com/acme/widget/pull/120">#120</a></p>';

    expect(bareRefContextOfPage({ html }).repos).toEqual([{ owner: "acme", repo: "widget" }]);
  });

  it("reads a link to a repository's root as its entry's own link", () => {
    const own = renderNote({
      note: {
        headline: [
          { kind: "link", text: "widget repo", url: "https://github.com/acme/widget" },
          { kind: "text", text: " then #121" },
        ],
      },
    });
    const other = renderNote({
      note: { headline: [{ kind: "link", text: "#19343", url: "https://github.com/acme/gadget/pull/19343" }] },
    });

    const html = `<h2>landings</h2>${own}${other}`;

    expect(bareRefContextOfPage({ html: own }).repos).toEqual([{ owner: "acme", repo: "widget" }]);
    expect(resolvedGithubRefsOf({ fallback: bareRefContextOfPage({ html }), html })).toEqual([
      { raw: "#121", repo: { owner: "acme", repo: "widget" }, writerSpan: undefined },
    ]);
  });
});

describe("checkBareRefs — a bare reference resolves inside its own entry", () => {
  const WIDGET = "https://github.com/acme/widget/pull/120";
  const GADGET = "https://github.com/acme/gadget/pull/19343";

  /** The "done since you last looked" section the renderer emits, holding these notes in order. */
  function recent({ notes }: { notes: readonly BriefingNote[] }): string {
    const body = notes.map((note) => renderNote({ note })).join("\n");
    return page({
      outside: `<h2 id="recent">done since you last looked</h2><details data-section="recent"><summary>landings</summary><div>${body}</div></details>`,
      reactNow: "",
    });
  }

  /** The refusal a bare reference earns when nothing names one repository for it. */
  function ambiguous({ raw }: { raw: string }): string {
    return (
      `"${raw}" is a bare reference (renders as ${raw}) with no single repo to resolve it against — write it ` +
      'as "owner/repo#<number>", or put one full github.com/<owner>/<repo> link in the same text, which names ' +
      "the repo every bare reference beside it means."
    );
  }

  it("resolves a bare #N against its own note's link while another note links a second repository", () => {
    const html = recent({
      notes: [
        {
          headline: [
            { kind: "link", text: "#120 the map", url: WIDGET },
            { kind: "text", text: " then #121 landed." },
          ],
        },
        {
          headline: [
            { kind: "text", text: "The review of " },
            { kind: "link", text: "#19343 the reminder", url: GADGET },
          ],
        },
      ],
    });

    expect(checkBareRefs({ html }).defects).toEqual([]);
  });

  it("takes the repository of the NEAREST link when one note links two", () => {
    const html = recent({
      notes: [
        {
          headline: [
            { kind: "link", text: "#19343 the reminder", url: GADGET },
            { kind: "text", text: " was reviewed, and much later in the same note the map work moved on: " },
            { kind: "link", text: "#120 the map", url: WIDGET },
            { kind: "text", text: " then #121." },
          ],
        },
      ],
    });

    expect(checkBareRefs({ html }).defects).toEqual([]);
  });

  it("keeps the magnitude check once the nearest link narrows the repository", () => {
    const html = recent({
      notes: [
        {
          headline: [
            { kind: "link", text: "#120 the map", url: WIDGET },
            { kind: "text", text: " and #19344." },
          ],
        },
      ],
    });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.reason)).toEqual([
      '"#19344" would resolve to acme/widget#19344, but the largest number known to exist in acme/widget here is ' +
        '120 — a 5-digit number cannot be one of its own. Write it as "owner/repo#19344" so it points at the ' +
        "repository it is from.",
    ]);
  });

  it("refuses a bare #N sitting exactly between links to two different repositories", () => {
    const html = recent({
      notes: [
        {
          headline: [
            { kind: "link", text: "#120 the map", url: WIDGET },
            { kind: "text", text: " #121 " },
            { kind: "link", text: "#19343 the reminder", url: GADGET },
          ],
        },
      ],
    });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.reason)).toEqual([ambiguous({ raw: "#121" })]);
  });

  it("still refuses a note with no link of its own on a page linking two repositories", () => {
    const html = recent({
      notes: [
        { headline: [{ kind: "text", text: "Step 9b rebased #2687 onto main." }] },
        {
          headline: [
            { kind: "text", text: "The review of " },
            { kind: "link", text: "#19343 the reminder", url: GADGET },
          ],
        },
        { headline: [{ kind: "link", text: "#120 the map", url: WIDGET }] },
      ],
    });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.reason)).toEqual([ambiguous({ raw: "#2687" })]);
  });

  it("falls back to the page's sole repository for a note with no link of its own", () => {
    const html = recent({
      notes: [
        { headline: [{ kind: "text", text: "Step 9b rebased #121 onto main." }] },
        { headline: [{ kind: "link", text: "#120 the map", url: WIDGET }] },
      ],
    });

    expect(checkBareRefs({ html }).defects).toEqual([]);
  });

  it("reads a note's fold as part of the same entry as its headline", () => {
    const html = recent({
      notes: [
        {
          detail: {
            blocks: [{ items: [[{ kind: "text", text: "merged: 121, 122" }]], kind: "list", ordered: false }],
            summary: "readings",
          },
          headline: [{ kind: "link", text: "#120 the map", url: WIDGET }],
        },
        { headline: [{ kind: "link", text: "#19343 the reminder", url: GADGET }] },
      ],
    });

    expect(checkBareRefs({ html }).defects).toEqual([]);
  });

  it("gives plainTextRefsOf the same per-entry resolution", () => {
    const html = recent({
      notes: [
        {
          headline: [
            { kind: "link", text: "#120 the map", url: WIDGET },
            { kind: "text", text: " then #121." },
          ],
        },
        { headline: [{ kind: "text", text: "Rebased #2687." }] },
        { headline: [{ kind: "link", text: "#19343 the reminder", url: GADGET }] },
      ],
    });

    expect(plainTextRefsOf({ html }).map((ref) => [ref.raw, ref.refusal])).toEqual([
      ["#121", undefined],
      ["#2687", ambiguous({ raw: "#2687" })],
    ]);
  });
});
