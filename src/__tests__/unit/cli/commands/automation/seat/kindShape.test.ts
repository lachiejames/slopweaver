/**
 * Which kinds `slopweaver automation seat` takes: a kind whose run shape is `spawn` is a seating decision, and a
 * `verb-run` row stays in the calling process.
 */
import { describe, expect, it } from "vitest";

import { runShapeForKind } from "../../../../../../live/automation/definitionShape.js";
import { BUMP_FIX_KIND, RESYNC_KIND } from "../../../../../../live/automation/kinds.js";

describe("the resync kind's shape", () => {
  it("answers spawn, which is what makes it a seating decision", () => {
    expect(runShapeForKind({ kind: RESYNC_KIND })).toBe("spawn");
  });

  it("answers spawn for bump-fix too, the second kind whose work is a visible session's", () => {
    expect(runShapeForKind({ kind: BUMP_FIX_KIND })).toBe("spawn");
  });

  it("leaves verb-run running in the calling process", () => {
    expect(runShapeForKind({ kind: "verb-run" })).toBe("run-here");
  });
});
