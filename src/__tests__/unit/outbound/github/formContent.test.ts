/**
 * The one walk over a C3 body. Both the voice gate and bare-reference linking read their cells from here, so the
 * order, the fold marking and the paths are the contract, and the map must address exactly the content cells the walk
 * names — every one but the badge hovers, which are plain sentences and are never rewritten.
 */
import { describe, expect, it } from "vitest";

import { type ContentPath, contentFieldsOf, mapContentFields } from "../../../../outbound/github/formContent.js";
import type { Content } from "../../../../outbound/github/types.js";
import { FEATURE_BODY, FIX_BODY, formOf, TESTS_BODY, TESTS_ONLY_BODY, t } from "./fixtures.js";

/** A path as one comparable string. */
function joined({ path }: { path: ContentPath }): string {
  return path.join(".");
}

/** Whether a walked path is a badge hover rather than a content cell. */
function isHover({ path }: { path: string }): boolean {
  return path.startsWith("risk.") || path.startsWith("problemSeen.");
}

describe("contentFieldsOf — the walk", () => {
  it("names every cell of the feature body in reading order, the fold alone below it", () => {
    expect(
      contentFieldsOf({ body: FEATURE_BODY }).map((field) => [joined({ path: field.path }), field.fold]),
    ).toStrictEqual([
      ["risk.items.0.worst", "above"],
      ["risk.items.0.check", "above"],
      ["problemSeen.why", "above"],
      ["explainer", "above"],
      ["problemProof.reason", "above"],
      ["solutionProof.proves", "above"],
      ["checks.0", "above"],
      ["checks.1", "above"],
      ["notChecked.0.check", "above"],
      ["notChecked.0.why", "above"],
      ["rerun.0.content", "below"],
      ["rerun.1.items.0", "below"],
      ["rerun.1.items.1", "below"],
    ]);
  });

  it("reads every risk item's worst case and check, and a seen problem's what", () => {
    const paths = contentFieldsOf({ body: FIX_BODY }).map((field) => joined({ path: field.path }));
    expect(paths.filter((path) => isHover({ path }))).toStrictEqual([
      "risk.items.0.worst",
      "risk.items.0.check",
      "risk.items.1.worst",
      "risk.items.1.check",
      "problemSeen.what",
    ]);
  });

  it("hands each cell its own runs, a hover's sentence as one text run", () => {
    const fields = contentFieldsOf({ body: FIX_BODY });
    const at = ({ path }: { path: string }): Content =>
      fields.find((field) => joined({ path: field.path }) === path)!.content;
    expect([at({ path: "risk.items.1.check" }), at({ path: "solutionProof.proves" })]).toStrictEqual([
      t({ text: "no staging copy of the widget store exists" }),
      t({ text: "On this branch, start refuses and names the setting." }),
    ]);
  });

  it("skips a command in the fold, which is not authored prose", () => {
    const body = { ...TESTS_BODY };
    expect(contentFieldsOf({ body }).filter((field) => field.fold === "below")).toStrictEqual([]);
  });
});

describe("mapContentFields — the rewrite over the same cells", () => {
  it("is the identity under an identity map, on every fixture", () => {
    const forms = [TESTS_BODY, FIX_BODY, FEATURE_BODY, TESTS_ONLY_BODY].map((body) => formOf({ body }));
    expect(forms.map((form) => mapContentFields({ body: form, map: ({ content }) => content }))).toStrictEqual(forms);
  });

  it("hands the map exactly the content paths the walk names, and no hover", () => {
    const seen: string[] = [];
    mapContentFields({
      body: FEATURE_BODY,
      map: ({ content, path }) => {
        seen.push(joined({ path }));
        return content;
      },
    });
    const walked = contentFieldsOf({ body: FEATURE_BODY })
      .map((field) => joined({ path: field.path }))
      .filter((path) => !isHover({ path }));
    expect(seen.toSorted()).toStrictEqual(walked.toSorted());
  });

  it("rewrites every content cell while carrying every image, hover and non-content field unchanged", () => {
    const marked: Content = t({ text: "rewritten" });
    const out = mapContentFields({ body: FEATURE_BODY, map: () => marked });
    expect([out.explainer, out.problemProof, out.solutionProof, out.rerun, out.risk, out.problemSeen]).toStrictEqual([
      marked,
      { kind: "reason", reason: marked },
      { ...FEATURE_BODY.solutionProof, proves: marked },
      [
        { content: marked, kind: "note" },
        { items: [marked, marked], kind: "tests" },
      ],
      FEATURE_BODY.risk,
      FEATURE_BODY.problemSeen,
    ]);
  });

  it("carries a command in the fold unchanged", () => {
    const out = mapContentFields({ body: TESTS_BODY, map: () => t({ text: "rewritten" }) });
    expect(out.rerun).toStrictEqual(TESTS_BODY.rerun);
  });

  it("hands each cell its own path, so a rewrite lands on the check or reason it was asked about", () => {
    const out = mapContentFields({ body: TESTS_BODY, map: ({ path }) => t({ text: joined({ path }) }) });
    expect([out.checks, out.notChecked]).toStrictEqual([
      [t({ text: "checks.0" })],
      [
        { check: t({ text: "notChecked.0.check" }), why: t({ text: "notChecked.0.why" }) },
        { check: t({ text: "notChecked.1.check" }), why: t({ text: "notChecked.1.why" }) },
      ],
    ]);
  });

  it("rewrites two reason slots as reasons, carrying the visual-proof state and the routing of a whole form", () => {
    const form = formOf({ body: TESTS_ONLY_BODY });
    const marked: Content = t({ text: "rewritten" });
    const out = mapContentFields({ body: form, map: () => marked });
    expect([out.problemProof, out.solutionProof, out.visualProof, out.title, out.target, out.draft]).toStrictEqual([
      { kind: "reason", reason: marked },
      { kind: "reason", reason: marked },
      "nothing-on-screen",
      form.title,
      form.target,
      true,
    ]);
  });
});

describe("contentFieldsOf — a body with no fold and nothing unchecked", () => {
  it("ends the walk at the checks, every cell above the fold", () => {
    expect(
      contentFieldsOf({ body: FIX_BODY }).map((field) => [joined({ path: field.path }), field.fold]),
    ).toStrictEqual([
      ["risk.items.0.worst", "above"],
      ["risk.items.0.check", "above"],
      ["risk.items.1.worst", "above"],
      ["risk.items.1.check", "above"],
      ["problemSeen.what", "above"],
      ["explainer", "above"],
      ["problemProof.proves", "above"],
      ["solutionProof.proves", "above"],
      ["checks.0", "above"],
    ]);
  });

  it("reads a not-seen problem's reason as one plain text run", () => {
    const field = contentFieldsOf({ body: FEATURE_BODY }).find(
      (candidate) => joined({ path: candidate.path }) === "problemSeen.why",
    )!;
    expect(field.content).toStrictEqual(t({ text: "Not seen on a real sign-in yet" }));
  });
});
