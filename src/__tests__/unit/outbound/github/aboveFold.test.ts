/** Which regions of a C3 pull-request form the above-the-fold and below-the-fold rules are allowed to read. */
import { describe, expect, it } from "vitest";

import { prAboveFoldCells, prBelowFoldCells } from "../../../../outbound/github/aboveFold.js";
import type { PrForm } from "../../../../outbound/github/types.js";
import { FEATURE_BODY, FIX_BODY, formOf, TESTS_BODY, TESTS_ONLY_BODY, t } from "./fixtures.js";

/** The fix form with some fields replaced. */
function formWith({ over }: { over: Partial<PrForm> }): PrForm {
  return { ...formOf({ body: FIX_BODY }), ...over };
}

describe("prAboveFoldCells", () => {
  it("names every cell a reviewer meets before expanding anything, hovers first, by its dotted path", () => {
    expect(prAboveFoldCells({ form: formOf({ body: TESTS_BODY }) }).map((cell) => cell.path)).toStrictEqual([
      "risk.items[0].worst",
      "risk.items[0].check",
      "problemSeen.what",
      "explainer",
      "problemProof.proves",
      "solutionProof.proves",
      "checks[0]",
      "notChecked[0].check",
      "notChecked[0].why",
      "notChecked[1].check",
      "notChecked[1].why",
    ]);
  });

  it("reads every risk item's hover, a not-seen reason, and a reason slot by its own path", () => {
    expect(prAboveFoldCells({ form: formOf({ body: FEATURE_BODY }) }).map((cell) => cell.path)).toStrictEqual([
      "risk.items[0].worst",
      "risk.items[0].check",
      "problemSeen.why",
      "explainer",
      "problemProof.reason",
      "solutionProof.proves",
      "checks[0]",
      "checks[1]",
      "notChecked[0].check",
      "notChecked[0].why",
    ]);
  });

  it("reads an unchecked risk's reason as its check cell", () => {
    const cells = prAboveFoldCells({ form: formOf({ body: FIX_BODY }) });
    expect(cells.find((cell) => cell.path === "risk.items[1].check")!.text).toBe(
      "no staging copy of the widget store exists",
    );
  });

  it("names both reason slots on a form with nothing on screen", () => {
    const paths = prAboveFoldCells({ form: formOf({ body: TESTS_ONLY_BODY }) }).map((cell) => cell.path);
    expect(paths.filter((path) => path.endsWith(".reason"))).toStrictEqual([
      "problemProof.reason",
      "solutionProof.reason",
    ]);
  });

  it("keeps emphasis, which is the author writing, and replaces a code run with a space", () => {
    const form = formWith({
      over: {
        explainer: [
          { kind: "strong", text: "Refuses" },
          { kind: "text", text: " a call to" },
          { kind: "code", text: "doThing()" },
          { kind: "em", text: "now" },
        ],
      },
    });
    expect(prAboveFoldCells({ form }).find((cell) => cell.path === "explainer")!.text).toBe("Refuses a call to now");
  });

  it("replaces a link run with a space rather than dropping it, so two sentences never weld", () => {
    const form = formWith({
      over: {
        explainer: [
          { kind: "text", text: "Broken." },
          { kind: "link", text: "the thread", url: "https://example.com/t" },
          { kind: "text", text: "Fixed." },
        ],
      },
    });
    expect(prAboveFoldCells({ form }).find((cell) => cell.path === "explainer")!.text).toBe("Broken. Fixed.");
  });

  it("reads each screenshot's proves line as its slot's cell, and never the image", () => {
    const cells = prAboveFoldCells({ form: formOf({ body: FIX_BODY }) });
    expect(cells.filter((cell) => cell.path.endsWith("Proof.proves"))).toStrictEqual([
      { path: "problemProof.proves", text: "On main, start goes through with the store open to the network." },
      { path: "solutionProof.proves", text: "On this branch, start refuses and names the setting." },
    ]);
  });

  it("reads a risk item's worst case and check as the plain sentences its hover carries", () => {
    const cells = prAboveFoldCells({ form: formOf({ body: FIX_BODY }) });
    expect(cells.filter((cell) => cell.path.startsWith("risk.items[0]"))).toStrictEqual([
      { path: "risk.items[0].worst", text: "a sign-in that used to work is refused" },
      { path: "risk.items[0].check", text: "It only refuses an expiry that is not a sensible number of seconds" },
    ]);
  });

  it("never reads the re-run fold, which is the one collapsed region", () => {
    const paths = prAboveFoldCells({ form: formOf({ body: FEATURE_BODY }) }).map((cell) => cell.path);
    expect(paths.filter((path) => path.startsWith("rerun"))).toStrictEqual([]);
  });
});

describe("prBelowFoldCells", () => {
  it("reads each note and each test-list line of the fold, in order", () => {
    expect(prBelowFoldCells({ form: formOf({ body: FEATURE_BODY }) })).toStrictEqual([
      { path: "rerun[0].content", text: "Where the warning shows up, and the tests." },
      { path: "rerun[1].items[0]", text: "expiry.test.ts" },
      { path: "rerun[1].items[1]", text: "warning.test.ts" },
    ]);
  });

  it("yields nothing when the description has no fold at all", () => {
    expect(prBelowFoldCells({ form: formOf({ body: FIX_BODY }) })).toStrictEqual([]);
  });

  it("skips a command inside the fold, which is somebody else's terminal output", () => {
    const form = formWith({
      over: {
        rerun: [
          { kind: "command", lang: "sh", text: "yarn vitest run; echo done" },
          { content: t({ text: "the note" }), kind: "note" },
        ],
      },
    });
    expect(prBelowFoldCells({ form })).toStrictEqual([{ path: "rerun[1].content", text: "the note" }]);
  });
});
