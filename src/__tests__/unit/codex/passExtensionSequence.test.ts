/*
 * One extension per run and lane: a first carries no `after`, every later one names the latest before it, and a
 * second row for a diff already approved is refused. A damaged register line that cannot be shown to be another
 * run's refuses the grant, since it may be this run's earlier extension.
 */
import { describe, expect, it } from "vitest";

import type { CodexPassExtension } from "../../../codex/passExtension.js";
import { damagedHistoryProblem, extensionSequenceProblem } from "../../../codex/passExtensionSequence.js";

const FIRST: CodexPassExtension = {
  after: undefined,
  atIso: "2026-11-27T01:00:00.000Z",
  branch: "feature",
  diffSha256: "a".repeat(64),
  gitCommonDir: "/repos/acme/.git",
  grantedBy: { host: "claude-code", id: "4c829e9d-d903-49b4-b446-6bb88b198511" },
  id: "first",
  lane: "general",
  reason: "the fix moved the parser",
  repoRoot: "/repos/acme",
  run: "acme-parser",
  schemaVersion: 1,
};

const SECOND: CodexPassExtension = { ...FIRST, after: "first", diffSha256: "b".repeat(64), id: "second" };
const NEW_DIFF = "c".repeat(64);

describe("extensionSequenceProblem", () => {
  it("allows a run's first extension with no after", () => {
    expect(extensionSequenceProblem({ after: undefined, diff: NEW_DIFF, prior: [] })).toBeUndefined();
  });

  it("refuses an after on a run's first extension", () => {
    expect(extensionSequenceProblem({ after: "first", diff: NEW_DIFF, prior: [] })).toBe(
      "--after first names an extension, but this run holds none in this lane yet — drop --after",
    );
  });

  it("refuses a second extension that does not name the first", () => {
    expect(extensionSequenceProblem({ after: undefined, diff: NEW_DIFF, prior: [FIRST] })).toBe(
      "this run already holds extension first in this lane (the fix moved the parser); each further one is a " +
        "deliberate call — pass --after first with a reason saying why the last was not enough",
    );
  });

  it("allows a second that names the latest, and refuses one naming an earlier row", () => {
    expect(extensionSequenceProblem({ after: "second", diff: NEW_DIFF, prior: [FIRST, SECOND] })).toBeUndefined();
    expect(extensionSequenceProblem({ after: "first", diff: NEW_DIFF, prior: [FIRST, SECOND] })).toBe(
      "--after first is not this run's latest extension in this lane, which is second",
    );
  });

  it("refuses a row for a diff the run already holds one for, whatever after names", () => {
    expect(extensionSequenceProblem({ after: "second", diff: FIRST.diffSha256, prior: [FIRST, SECOND] })).toBe(
      "extension first already approves this diff for this run, so a review of it is admitted as it stands",
    );
  });
});

describe("damagedHistoryProblem", () => {
  it("finds nothing when no line is damaged", () => {
    expect(damagedHistoryProblem({ run: "acme-parser", unreadable: [] })).toBeUndefined();
  });

  it("sets aside a damaged line that still names another run", () => {
    expect(
      damagedHistoryProblem({
        run: "acme-parser",
        unreadable: [{ detail: "line 4: lane x is not a review lane", run: "acme-other" }],
      }),
    ).toBeUndefined();
  });

  it("refuses over a line naming no run, and over one naming this run, listing both", () => {
    expect(
      damagedHistoryProblem({
        run: "acme-parser",
        unreadable: [
          { detail: "line 1: not JSON", run: undefined },
          { detail: "line 2: lane x is not a review lane", run: "acme-other" },
          { detail: "line 3: lane x is not a review lane", run: "acme-parser" },
        ],
      }),
    ).toBe(
      "2 register line(s) will not decode and cannot be shown to be another run's (line 1: not JSON; line 3: lane " +
        "x is not a review lane), so they may be this run's earlier extension and whether this one is a first " +
        "cannot be told — repair or remove those lines by hand, then grant again",
    );
  });
});
