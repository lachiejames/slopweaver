import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { auditRunCommand, runAudit, runAuditWithDeps } from "../../../../../cli/commands/audit/run.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { admittingSlotGuard, refusingSlotGuard } from "../../../../loadSlotFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "audit-run-"));
  fixtureDirs.push(dir);
  return dir;
}

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "audit", ...tail];
}

describe("runAudit", () => {
  it("exits OK on --help", () => {
    expect(runAuditWithDeps({ argv: argv({ tail: ["--help"] }), guard: admittingSlotGuard })).toBe(EXIT_OK);
  });

  it("audits an empty home WITHOUT writing anything into it — it is a read-only verb", () => {
    const home = freshHome();
    runAuditWithDeps({ argv: argv({ tail: ["--home", home] }), guard: admittingSlotGuard });
    expect(readdirSync(home)).toEqual([]);
  });

  it("emits JSON over an empty home without writing to it", () => {
    const home = freshHome();
    runAuditWithDeps({ argv: argv({ tail: ["--json", "--home", home] }), guard: admittingSlotGuard });
    expect(readdirSync(home)).toEqual([]);
  });
});

describe("runAudit — the machine's load slot", () => {
  it("REFUSES with the error exit and reads nothing when the machine's load slots are full", () => {
    const home = freshHome();
    expect(runAuditWithDeps({ argv: argv({ tail: ["--home", home] }), guard: refusingSlotGuard({ pid: 4242 }) })).toBe(
      EXIT_ERROR,
    );
    expect(readdirSync(home)).toEqual([]);
  });
});

describe("the manifest-selected handler", () => {
  it("is the run function itself, carrying no metadata of its own", () => {
    expect(auditRunCommand).toBe(runAudit);
    expect(Object.hasOwn(auditRunCommand, "meta")).toBe(false);
  });
});
