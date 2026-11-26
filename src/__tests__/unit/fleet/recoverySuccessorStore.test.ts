/**
 * Writing the doc a Recovery press seats a supervisor from, into a throwaway home: the number counts docs and run
 * journals both, and a doc already there is never overwritten.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SUCCESSOR_SLUG_PREFIX } from "../../../fleet/recoverySuccessor.js";
import { writeRecoverySuccessor } from "../../../fleet/recoverySuccessorStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-successor-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("writeRecoverySuccessor", () => {
  it("takes the number after the highest doc or journal, leaving every existing doc as it was", () => {
    const { handovers, runs } = stateHomePaths({ home });
    mkdirSync(handovers, { recursive: true });
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(handovers, "fresh-supervisor-handoff-9040.md"), "the predecessor's own doc");
    writeFileSync(join(runs, "fresh-supervisor-handoff-9041.jsonl"), "");
    const written = unwrap(
      writeRecoverySuccessor({
        home,
        predecessor: { label: "app:old-chair", slug: "fresh-supervisor-handoff-9040" },
        repo: "/repo",
        writtenAtIso: "2026-11-25T10:01:00.000Z",
      }),
    );
    expect(written).toEqual({
      path: join(handovers, "fresh-supervisor-handoff-9042.md"),
      slug: "fresh-supervisor-handoff-9042",
    });
    expect(readFileSync(written.path, "utf8")).toContain("slug: fresh-supervisor-handoff-9042\n");
    expect(readFileSync(join(handovers, "fresh-supervisor-handoff-9040.md"), "utf8")).toBe("the predecessor's own doc");
  });

  it("says where it could not write when the home has no handover directory", () => {
    const written = writeRecoverySuccessor({
      home,
      predecessor: undefined,
      repo: "/repo",
      writtenAtIso: "2026-11-25T10:01:00.000Z",
    });
    expect(unwrapErr(written)).toMatchObject({
      code: "IO_FAILED",
      path: join(stateHomePaths({ home }).handovers, `${SUCCESSOR_SLUG_PREFIX}1.md`),
    });
  });
});
