/**
 * `breakageClasses` — every measured class of loop breakage has a declared writer, and every module it names
 * is really there.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BREAKAGE_CLASSES, breakageClassLines } from "../../../../live/turn/breakageClasses.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

describe("BREAKAGE_CLASSES", () => {
  it("is not empty — every check below is true of an empty registry", () => {
    expect(BREAKAGE_CLASSES.length).toBeGreaterThan(0);
  });

  it("declares exactly the measured classes, each with its disposition", () => {
    expect(BREAKAGE_CLASSES.map((entry) => [entry.id, entry.writer.kind])).toEqual([
      ["turn-review-round", "code"],
      ["reviewer-death", "code"],
      ["reviewer-late-verdict", "code"],
      ["turn-dispatch", "elsewhere"],
      ["listener-death", "elsewhere"],
      ["hook-kill", "elsewhere"],
      ["scheduler-tick", "retired"],
      ["session-respawn", "retired"],
      ["turn-answer", "judgement"],
      ["witness", "judgement"],
      ["residue", "judgement"],
    ]);
  });

  it("names a module that exists for every class a code writer owns", () => {
    const owned = BREAKAGE_CLASSES.flatMap((entry) =>
      entry.writer.kind === "code" || entry.writer.kind === "elsewhere" ? [entry.writer.module] : [],
    );
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.filter((module) => !existsSync(join(REPO_ROOT, module)))).toEqual([]);
  });

  it("ends in exactly one residue class, so a new kind of breakage still has an owner", () => {
    expect(BREAKAGE_CLASSES.filter((entry) => entry.id === "residue")).toHaveLength(1);
    expect(BREAKAGE_CLASSES.at(-1)!.id).toBe("residue");
  });

  it("has unique ids", () => {
    expect(new Set(BREAKAGE_CLASSES.map((entry) => entry.id)).size).toBe(BREAKAGE_CLASSES.length);
  });
});

describe("breakageClassLines", () => {
  it("renders each disposition as the instruction a session acts on", () => {
    expect(
      breakageClassLines({
        classes: [
          { id: "a", selector: "`a`", writer: { kind: "code", module: "src/a.ts" } },
          { id: "b", selector: "`b`", writer: { kind: "elsewhere", module: "src/b.ts", record: "ask-lifecycle" } },
          { id: "c", selector: "`c`", writer: { kind: "retired", why: "c is gone" } },
          { id: "d", selector: "`d`", writer: { kind: "judgement" } },
        ],
      }),
    ).toEqual([
      "a — `a`",
      "  code writes it (src/a.ts) — do not record it by hand",
      "b — `b`",
      "  journalled in the ask-lifecycle record (src/b.ts) — do not record it here",
      "c — `c`",
      "  retired: c is gone",
      "d — `d`",
      "  yours to record, with `turn breakage --cause`",
    ]);
  });

  it("tells a session a hook kill is counted out of the transcripts, never by hand", () => {
    const hookKill = BREAKAGE_CLASSES.find((entry) => entry.id === "hook-kill")!;
    expect(breakageClassLines({ classes: [hookKill] })[1]).toBe(
      "  journalled in the session-transcripts record (src/transcripts/hookDuration.ts) — do not record it here",
    );
  });

  it("renders nothing for no classes", () => {
    expect(breakageClassLines({ classes: [] })).toEqual([]);
  });
});
