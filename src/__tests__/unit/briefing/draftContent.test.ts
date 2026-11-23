import { describe, expect, it } from "vitest";

import { checkFoldResidue } from "../../../briefing/draftContent.js";

/** One react-now card's markup, with a `<details>` fold carrying whatever `foldBody` supplies. */
function cardWithFold({ foldBody }: { foldBody: string }): string {
  return (
    "<h2>react now</h2>" +
    '<div class="need"><div class="q">1. Ship it?</div>' +
    `<dl class="f"><dt>what</dt><dd>Two sentences here. <details><summary>more</summary>${foldBody}</details></dd></dl>` +
    "</div><h2>done</h2>"
  );
}

describe("checkFoldResidue", () => {
  it("passes a fold with ordinary prose and no residue", () => {
    const html = cardWithFold({ foldBody: "<p>Plain evidence, no path and no bare link.</p>" });

    expect(checkFoldResidue({ html }).defects).toEqual([]);
  });

  it("refuses a home-relative path standing in for a draft", () => {
    const html = cardWithFold({ foldBody: "<p>See ~/scratch/announce.txt for the draft.</p>" });

    expect(checkFoldResidue({ html }).defects).toEqual([
      {
        card: 1,
        kind: "filesystem-path",
        reason:
          'its fold names a filesystem path ("~/scratch/announce.txt") rather than the draft itself. Write a ' +
          '`{ "kind": "draft" }` block instead, rendered inline the way the surface will show it.',
      },
    ]);
  });

  it("refuses an absolute path under a common root", () => {
    const html = cardWithFold({ foldBody: "<p>The draft sits at /private/tmp/scratch/draft.txt.</p>" });

    expect(checkFoldResidue({ html }).defects.map((defect) => defect.kind)).toEqual(["filesystem-path"]);
  });

  it("never flags a URL whose visible text merely contains a path-shaped segment", () => {
    const html = cardWithFold({ foldBody: "<p>See https://example.com/tmp/foo for the doc.</p>" });

    expect(checkFoldResidue({ html }).defects).toEqual([]);
  });

  it("refuses a link whose visible text is only a bare PR number", () => {
    const html = cardWithFold({ foldBody: '<p>See <a href="https://github.com/o/r/pull/123">#123</a>.</p>' });

    expect(checkFoldResidue({ html }).defects).toEqual([
      {
        card: 1,
        kind: "bare-key-link",
        reason:
          'a link in its fold carries only "#123" as the label, its key and nothing else. Put the title ' +
          "beside the key so the reader never opens the link to know what it is.",
      },
    ]);
  });

  it("refuses a link whose visible text is only a bare Linear key", () => {
    const html = cardWithFold({ foldBody: '<p>See <a href="https://linear.app/x/issue/SUP-42">SUP-42</a>.</p>' });

    expect(checkFoldResidue({ html }).defects.map((defect) => defect.kind)).toEqual(["bare-key-link"]);
  });

  it("passes a link whose visible text carries the title beside the key", () => {
    const html = cardWithFold({
      foldBody: '<p>See <a href="https://github.com/o/r/pull/123">#123 fix the flaky upload test</a>.</p>',
    });

    expect(checkFoldResidue({ html }).defects).toEqual([]);
  });

  it("never scans outside a react-now card's own fold", () => {
    const html =
      '<h2>react now</h2><div class="need"><div class="q">1. Ship it?</div></div>' +
      '<h2>done</h2><div class="need"><div class="q">See ~/scratch/x.txt</div></div>';

    expect(checkFoldResidue({ html }).defects).toEqual([]);
  });

  it("passes a page with no react-now heading at all", () => {
    expect(checkFoldResidue({ html: "<p>~/nowhere/near/a/card</p>" }).defects).toEqual([]);
  });
});
