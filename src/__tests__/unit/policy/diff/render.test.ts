import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { buildDocDiffModel, type DocDiffModel } from "../../../../policy/diff/model.js";
import { parseDocDiffRecord } from "../../../../policy/diff/record.js";
import { renderOwnerPage } from "../../../../policy/diff/render.js";
import { renderTeamPage, renderTeamPost } from "../../../../policy/diff/team.js";
import { CONTEXT, CONTROL_URL, recordText, SLOT_URL, SOURCES } from "./fixture.js";

/** The fixture built into a model, with any record field replaced. */
function build({ overrides = {} }: { overrides?: Record<string, unknown> } = {}): ReturnType<typeof buildDocDiffModel> {
  return buildDocDiffModel({
    context: CONTEXT,
    images: new Map(),
    phrases: [],
    record: unwrap(parseDocDiffRecord({ text: recordText({ overrides }) })),
    slotUrls: new Map([["network-diagram", SLOT_URL]]),
    sources: SOURCES,
  });
}

const model: DocDiffModel = unwrap(build());

describe("buildDocDiffModel", () => {
  it("counts each kind of row and links the record's own prose", () => {
    expect(model.documents[0]!.counts).toEqual({ formatting: 1, material: 2, same: 2 });
    expect(model.documents[0]!.controls).toEqual([{ id: "NET-38", url: CONTROL_URL }]);
    expect(model.record.lede).toBe(`Two changes to [NET-38](${CONTROL_URL})'s evidence.`);
  });

  it("refuses a document link a page must not carry, rather than publishing it escaped", () => {
    const sides = SOURCES.get("network")!;
    const issues = unwrapErr(
      buildDocDiffModel({
        context: CONTEXT,
        images: new Map(),
        phrases: [],
        record: unwrap(parseDocDiffRecord({ text: recordText() })),
        slotUrls: new Map([["network-diagram", SLOT_URL]]),
        sources: new Map([
          [
            "network",
            { ...sides, after: sides.after.replace("still live.", "still live: [runbook](javascript:alert`1`).") },
          ],
        ]),
      }),
    );
    expect(issues.map((issue) => issue.code)).toEqual(["UNSAFE_LINK"]);
  });

  it("refuses an image key this run never read, which would publish a broken diagram", () => {
    const sides = SOURCES.get("network")!;
    const issues = unwrapErr(
      buildDocDiffModel({
        context: CONTEXT,
        images: new Map([["diff-image:aaaa", "data:image/png;base64,AA"]]),
        phrases: [],
        record: unwrap(parseDocDiffRecord({ text: recordText() })),
        slotUrls: new Map([["network-diagram", SLOT_URL]]),
        sources: new Map([["network", { ...sides, after: `${sides.after}\n\n![Map](diff-image:bbbb)\n` }]]),
      }),
    );
    expect(issues.map((issue) => [issue.code, issue.message])).toEqual([
      [
        "UNSAFE_LINK",
        "the address diff-image:bbbb is refused: it names no public web host or mailbox, or an image this run did not read, so on the published page it would lead nowhere",
      ],
      [
        "UNCOVERED_ROW",
        'network: a material change says nothing about why — add a change whose match is a substring of this after line: "Map"',
      ],
    ]);
  });

  it("refuses an address in the record's own prose that would lead nowhere", () => {
    const issues = unwrapErr(build({ overrides: { lede: "See [runbook](./runbook.md) and [top](#top)." } }));
    const why =
      "is refused: it names no public web host or mailbox, or an image this run did not read, so on the published page it would lead nowhere";
    expect(issues.map((issue) => [issue.code, issue.message])).toEqual([
      ["UNSAFE_LINK", `the address ./runbook.md ${why}`],
      ["UNSAFE_LINK", `the address #top ${why}`],
    ]);
  });

  it("refuses a link the checks cannot read as one, and a bare address, in the team's text", () => {
    const team = { ask: "see [this](https://localhost/x ) or wiki.corp", opener: "pushed", title: "t" };
    const issues = unwrapErr(build({ overrides: { team } }));
    expect(issues.map((issue) => [issue.code, issue.message.split(" is refused")[0]])).toEqual([
      ["UNSAFE_LINK", "the address https://localhost/x"],
      ["UNSAFE_LINK", "the address wiki.corp"],
    ]);
  });

  it("refuses an identifier in the record's prose that nothing resolves, once", () => {
    const issues = unwrapErr(build({ overrides: { lede: "See #12 and #12." } }));
    expect(issues.map((issue) => issue.code)).toEqual(["UNLINKED_IDENTIFIER"]);
  });
});

describe("renderOwnerPage", () => {
  const page = renderOwnerPage({ model });

  it("draws a mark as colour with its note on hover, never a text badge", () => {
    expect(page).toContain('class="cell after added has-note tone-red" tabindex="0"');
    expect(page).toContain("<b>Not in the ask</b>Read it before you approve.");
    expect(page).not.toContain("not in the ask</span>");
  });

  it("hovers what each line says and what the owner is asked about it, never what it said before", () => {
    const notes = Array.from(
      page.matchAll(/<span class="note" role="note">(.*?<\/span>)<\/span><\/(?:div|span)>/g),
      (match) => match[1],
    );
    expect(notes).toEqual([
      '<span class="k">Read it before you approve.</span>',
      `<span class="k"><a href="${CONTROL_URL}">NET-38</a> needs the month.</span>`,
      '<span class="k">The exception is live.</span><span class="k tone-red"><b>Not in the ask</b>Read it before you approve.</span>',
      '<span class="k">Field labels are bold so the eye finds each one.</span>',
    ]);
  });

  it("folds what the before side said under each change's reason, once per change", () => {
    expect(Array.from(page.matchAll(/<details class="was">(.*?)<\/details>/g), (match) => match[1])).toEqual([
      "<summary>What changed since your draft</summary>A date nobody could source.",
      "<summary>What changed since your draft</summary>Not mentioned.",
    ]);
  });

  it("says the colours stay on this page and the right column is what Vanta holds", () => {
    expect(page).toContain(
      "The right column is the document as Vanta will hold it, screenshots included. The colours and hover notes are only on this page.",
    );
    expect(page).toContain("The colours are only on this page; the document in Vanta stays plain.");
  });

  it("shows a tab per document with its material count, between the overview and the team tab", () => {
    expect(Array.from(page.matchAll(/<label for="dd-tab-\d">([^<]+)/g), (match) => match[1])).toEqual([
      "Overview",
      "Network diagram ",
      "For the team",
    ]);
    expect(page).toContain('Network diagram <span class="n">2</span>');
  });

  it("folds the bold-only label under formatting with its convention", () => {
    expect(page).toContain("Labels in bold · 1");
  });

  it("warns that the team post waits for the upload when nothing is in Vanta", () => {
    expect(page).toContain("Nothing is in Vanta yet");
  });
});

describe("renderTeamPage", () => {
  it("shows the post and each document with its reason on hover", () => {
    const page = renderTeamPage({ model });
    expect(page).toContain(`<a href="${SLOT_URL}">Network diagram</a>`);
    expect(page).toContain('class="cell explained has-note"');
    expect(page).not.toContain("Before</b>");
  });
});

describe("renderTeamPost", () => {
  it("is the opener with each document linked, three dot points and the ask, a blank line between", () => {
    expect(renderTeamPost({ model })).toBe(
      [
        `we just pushed these changes to Vanta after I reviewed them: <${SLOT_URL}|Network diagram>`,
        "",
        "key changes:",
        "• the refresh date is sourced",
        "• the bypass is named",
        "• labels are bold",
        "",
        "tell me if you disagree",
      ].join("\n"),
    );
  });

  it("escapes Slack's own link and mention syntax in the record's text, and keeps the links it checked", () => {
    const post = renderTeamPost({
      model: unwrap(
        build({
          overrides: {
            team: {
              ask: "<https://app.vanta.com/x|this> <!channel> & see [NET-38 & co](https://app.vanta.com/a|b)",
              opener: "pushed",
              title: "t",
            },
          },
        }),
      ),
    });
    expect(post.split("\n\n").at(-1)).toBe(
      "&lt;https://app.vanta.com/x|this&gt; &lt;!channel&gt; &amp; see <https://app.vanta.com/a%7Cb|NET-38 &amp; co>",
    );
  });
});
