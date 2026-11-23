/**
 * `docProblems`: every problem one doc's front-matter reading found, gathered in one order — the flat keys', the
 * nested blocks', then a declared template's and workspace's.
 */
import { describe, expect, it } from "vitest";

import { LAUNCH_TEMPLATES } from "../../../cmux/launchTemplate.js";
import { duplicateKeyProblem } from "../../../handover/docFlat.js";
import { docProblems } from "../../../handover/docProblems.js";
import { WORKSPACES } from "../../../handover/workspace.js";

const declaring =
  ({ fields }: { fields: Readonly<Record<string, string>> }) =>
  ({ key }: { key: string }): string | undefined =>
    fields[key];

describe("docProblems", () => {
  it("finds nothing in a doc that declares nothing wrong", () => {
    const problems = docProblems({
      flat: { duplicated: [], problems: [] },
      named: declaring({ fields: {} }),
      nested: [],
    });

    expect(problems).toEqual([]);
  });

  it("orders the flat keys' problems, the nested blocks', then a misspelt template's and workspace's", () => {
    const problems = docProblems({
      flat: { duplicated: [], problems: ["status must be one of the set"] },
      named: declaring({ fields: { template: "codx", workspace: "elsewhere" } }),
      nested: ["doneWhen: a probe names no kind"],
    });

    expect(problems).toEqual([
      "status must be one of the set",
      "doneWhen: a probe names no kind",
      `template must be one of ${LAUNCH_TEMPLATES.join("|")}, got "codx"`,
      `workspace must be one of ${WORKSPACES.join("|")}, got "elsewhere"`,
    ]);
  });

  it("drops a twice-written key's problem when owner-words reading already owns it", () => {
    const owned = duplicateKeyProblem({ key: "hisWords" });
    const problems = docProblems({
      flat: { duplicated: ["hisWords"], problems: [owned, "lean must be one line"] },
      named: declaring({ fields: {} }),
      nested: [],
    });

    expect(problems).toEqual(["lean must be one line"]);
  });
});
