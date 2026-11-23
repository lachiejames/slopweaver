/**
 * The kind labels a conventional-commit title derives, and the ones a pull request is missing.
 */
import { describe, expect, it } from "vitest";

import { kindLabelsForTitle, missingKindLabels } from "../../../../outbound/github/kindLabels.js";

describe("kindLabelsForTitle", () => {
  it("maps each type to its one label", () => {
    const titles = [
      "fix: x",
      "feat: x",
      "refactor: x",
      "perf: x",
      "test: x",
      "docs: x",
      "build: x",
      "chore: x",
      "ci: x",
      "dx: x",
      "style: x",
      "revert: x",
    ];
    expect(titles.map((title) => kindLabelsForTitle({ title }))).toStrictEqual([
      ["bug fix"],
      ["feature"],
      ["refactor"],
      ["refactor"],
      ["tests"],
      ["docs"],
      ["maintenance"],
      ["maintenance"],
      ["maintenance"],
      ["maintenance"],
      ["maintenance"],
      ["maintenance"],
    ]);
  });

  it("reads a scope and a breaking bang without changing the type's label", () => {
    expect(kindLabelsForTitle({ title: "fix(export)!: keep the last row" })).toStrictEqual(["bug fix"]);
  });

  it("makes a maintenance change under a deps scope a dependency change", () => {
    expect(kindLabelsForTitle({ title: "chore(deps): update typescript" })).toStrictEqual(["dependencies"]);
    expect(kindLabelsForTitle({ title: "build(dependencies): bump node" })).toStrictEqual(["dependencies"]);
  });

  it("keeps a non-maintenance type's label under a deps scope", () => {
    expect(kindLabelsForTitle({ title: "fix(deps): pin a broken release" })).toStrictEqual(["bug fix"]);
  });

  it("adds security beside the type's label, reading every scope in a list", () => {
    expect(kindLabelsForTitle({ title: "fix(security): close the open port" })).toStrictEqual(["bug fix", "security"]);
    expect(kindLabelsForTitle({ title: "chore(deps, Security): bump a vulnerable package" })).toStrictEqual([
      "dependencies",
      "security",
    ]);
  });

  it("derives nothing for a title with no recognised type", () => {
    expect(kindLabelsForTitle({ title: "Update the readme" })).toStrictEqual([]);
    expect(kindLabelsForTitle({ title: "wip: something" })).toStrictEqual([]);
    expect(kindLabelsForTitle({ title: "" })).toStrictEqual([]);
  });
});

describe("missingKindLabels", () => {
  it("names each derived label the pull request lacks, in derivation order", () => {
    expect(missingKindLabels({ labels: ["bug fix"], title: "fix(security): close the open port" })).toStrictEqual([
      "security",
    ]);
  });

  it("is empty once every derived label is carried, whatever else is", () => {
    expect(missingKindLabels({ labels: ["feature", "needs-review"], title: "feat: x" })).toStrictEqual([]);
  });
});
