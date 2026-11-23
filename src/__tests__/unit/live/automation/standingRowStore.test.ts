import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../live/automation/definition.js";
import { failureFindingSlug, failureHoldReason } from "../../../../live/automation/failureHold.js";
import { RESYNC_KIND } from "../../../../live/automation/kinds.js";
import type { StandingRow } from "../../../../live/automation/standingRow.js";
import { standingRowLines, writeStandingRows } from "../../../../live/automation/standingRowStore.js";
import { VERB_RUN_KIND } from "../../../../live/automation/verbRun.js";

const ROW: StandingRow = {
  definition: {
    cadence: "0 4 * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: { argv: ["worktree", "prune", "--apply"] },
    recipeId: "worktree-prune",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why: "nothing else removes a worktree",
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "standing-rows-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("writeStandingRows", () => {
  it("writes an absent row and reports the path it wrote", () => {
    const definitionsDir = join(dir, "definitions");
    const report = unwrap(
      writeStandingRows({
        absentIds: ["worktree-prune"],
        definitionsDir,
        dryRun: false,
        rows: [ROW],
        supersededIds: [],
      }),
    );
    expect(report.outcomes).toEqual([
      { kind: "created", path: join(definitionsDir, "worktree-prune.json"), recipeId: "worktree-prune" },
    ]);
  });

  it("writes the declared definition byte for byte, so the store holds what the build declared", () => {
    const definitionsDir = join(dir, "definitions");
    unwrap(
      writeStandingRows({
        absentIds: ["worktree-prune"],
        definitionsDir,
        dryRun: false,
        rows: [ROW],
        supersededIds: [],
      }),
    );
    const written: unknown = JSON.parse(readFileSync(join(definitionsDir, "worktree-prune.json"), "utf8"));
    expect(written).toEqual(ROW.definition);
  });

  it("writes NOTHING on a dry run while still reporting what it would have written", () => {
    const definitionsDir = join(dir, "definitions");
    const report = unwrap(
      writeStandingRows({
        absentIds: ["worktree-prune"],
        definitionsDir,
        dryRun: true,
        rows: [ROW],
        supersededIds: [],
      }),
    );
    expect(report.outcomes).toEqual([
      { kind: "created", path: join(definitionsDir, "worktree-prune.json"), recipeId: "worktree-prune" },
    ]);
    expect(report.dryRun).toBe(true);
    expect(() => readFileSync(join(definitionsDir, "worktree-prune.json"), "utf8")).toThrow();
  });

  it("leaves a row the read already found present exactly where it is", () => {
    const definitionsDir = join(dir, "definitions");
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(join(definitionsDir, "worktree-prune.json"), "SOMEBODY ELSE'S BYTES", "utf8");
    const report = unwrap(
      writeStandingRows({ absentIds: [], definitionsDir, dryRun: false, rows: [ROW], supersededIds: [] }),
    );
    expect(report.outcomes).toEqual([{ kind: "present", recipeId: "worktree-prune" }]);
    expect(readFileSync(join(definitionsDir, "worktree-prune.json"), "utf8")).toBe("SOMEBODY ELSE'S BYTES");
  });

  it("REFUSES to write over a path that is occupied even when the read called the id absent", () => {
    const definitionsDir = join(dir, "definitions");
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(join(definitionsDir, "worktree-prune.json"), "HALF-WRITTEN", "utf8");
    const report = unwrap(
      writeStandingRows({
        absentIds: ["worktree-prune"],
        definitionsDir,
        dryRun: false,
        rows: [ROW],
        supersededIds: [],
      }),
    );
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(["refused"]);
    expect(readFileSync(join(definitionsDir, "worktree-prune.json"), "utf8")).toBe("HALF-WRITTEN");
  });

  it("says WHY it refused, naming the path and that something stands there", () => {
    const definitionsDir = join(dir, "definitions");
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(join(definitionsDir, "worktree-prune.json"), "HALF-WRITTEN", "utf8");
    const report = unwrap(
      writeStandingRows({
        absentIds: ["worktree-prune"],
        definitionsDir,
        dryRun: false,
        rows: [ROW],
        supersededIds: [],
      }),
    );
    const refused = report.outcomes.find((outcome) => outcome.kind === "refused")!;
    expect(refused.reason).toContain("a file already stands there");
    expect(refused.reason).toContain(join(definitionsDir, "worktree-prune.json"));
  });

  it("reports an empty pass for an empty declaration", () => {
    const report = unwrap(
      writeStandingRows({
        absentIds: [],
        definitionsDir: join(dir, "definitions"),
        dryRun: false,
        rows: [],
        supersededIds: [],
      }),
    );
    expect(report.outcomes).toEqual([]);
  });
});

describe("standingRowLines", () => {
  it("prints a written row and a tally naming how many were written", () => {
    const lines = standingRowLines({
      report: {
        dryRun: false,
        outcomes: [{ kind: "created", path: "/store/worktree-prune.json", recipeId: "worktree-prune" }],
      },
    });
    expect(lines).toEqual([
      "wrote worktree-prune · /store/worktree-prune.json",
      "automation register-standing · 1 written · 0 refused · 1 row(s) declared",
    ]);
  });

  it("says WOULD write on a dry run, so a report can never be read as an act", () => {
    const lines = standingRowLines({
      report: {
        dryRun: true,
        outcomes: [{ kind: "created", path: "/store/worktree-prune.json", recipeId: "worktree-prune" }],
      },
    });
    expect(lines).toEqual([
      "would write worktree-prune · /store/worktree-prune.json",
      "automation register-standing · 1 to write · 0 refused · 1 row(s) declared",
    ]);
  });

  it("counts a refusal in the tally rather than only in its own line", () => {
    const lines = standingRowLines({
      report: {
        dryRun: false,
        outcomes: [
          { kind: "present", recipeId: "alerts-digest" },
          { kind: "refused", reason: "something stands there", recipeId: "worktree-prune" },
        ],
      },
    });
    expect(lines).toEqual([
      "-- alerts-digest · already in the store",
      "!! worktree-prune · something stands there",
      "automation register-standing · 0 written · 1 refused · 2 row(s) declared",
    ]);
  });
});

describe("writeStandingRows over an earlier build's row", () => {
  /** The file an install holds from the daily declaration, byte for byte as `register-standing` wrote it. */
  const DAILY_BYTES =
    '{"cadence":"0 4 * * *","destination":{"kind":"local-atlas"},"effect":"read-write","enabled":true,' +
    '"kind":"verb-run","onMissed":"skip","params":{"argv":["worktree","prune","--apply"]},' +
    '"recipeId":"worktree-prune","schemaVersion":1}\n';
  const HOURLY: StandingRow = {
    ...ROW,
    definition: { ...ROW.definition, cadence: "0 * * * *" },
    supersedes: [ROW.definition],
  };
  const storedAt = ({ definitionsDir }: { definitionsDir: string }): string =>
    readFileSync(join(definitionsDir, "worktree-prune.json"), "utf8");

  const seeded = ({ bytes }: { bytes: string }): string => {
    const definitionsDir = join(dir, "definitions");
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(join(definitionsDir, "worktree-prune.json"), bytes, "utf8");
    return definitionsDir;
  };

  it("brings the daily row forward to the hourly declaration", () => {
    const definitionsDir = seeded({ bytes: DAILY_BYTES });
    const report = unwrap(
      writeStandingRows({
        absentIds: [],
        definitionsDir,
        dryRun: false,
        rows: [HOURLY],
        supersededIds: ["worktree-prune"],
      }),
    );
    expect(report.outcomes).toEqual([
      { kind: "brought-forward", path: join(definitionsDir, "worktree-prune.json"), recipeId: "worktree-prune" },
    ]);
    const written: unknown = JSON.parse(storedAt({ definitionsDir }));
    expect(written).toEqual(HOURLY.definition);
  });

  it("REFUSES when the file was edited after the read called it superseded, and leaves the edit", () => {
    const paused = DAILY_BYTES.replace('"enabled":true', '"enabled":false');
    const definitionsDir = seeded({ bytes: paused });
    const report = unwrap(
      writeStandingRows({
        absentIds: [],
        definitionsDir,
        dryRun: false,
        rows: [HOURLY],
        supersededIds: ["worktree-prune"],
      }),
    );
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(["refused"]);
    expect(storedAt({ definitionsDir })).toBe(paused);
  });

  it("REFUSES over bytes that do not parse, rather than reading them as the earlier shape", () => {
    const definitionsDir = seeded({ bytes: "HALF-WRITTEN" });
    const report = unwrap(
      writeStandingRows({
        absentIds: [],
        definitionsDir,
        dryRun: false,
        rows: [HOURLY],
        supersededIds: ["worktree-prune"],
      }),
    );
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(["refused"]);
    expect(storedAt({ definitionsDir })).toBe("HALF-WRITTEN");
  });

  it("brings a row the store held on a FAILURE forward, carrying the hold so it stands until its finding settles", () => {
    const slotIso = "2026-11-03T04:00:00.000Z";
    const finding = failureFindingSlug({ attempt: 1, recipeId: "worktree-prune", slotIso });
    const hold = {
      askedIso: "2026-11-03T06:58:20.401Z",
      clearedBy: null,
      finding,
      reason: failureHoldReason({ attempt: 1, finding, recipeId: "worktree-prune", slotIso, what: "exit 1" }),
    };
    const definitionsDir = seeded({
      bytes: DAILY_BYTES.replace('"kind":"verb-run"', `"hold":${JSON.stringify(hold)},"kind":"verb-run"`),
    });
    const report = unwrap(
      writeStandingRows({
        absentIds: [],
        definitionsDir,
        dryRun: false,
        rows: [HOURLY],
        supersededIds: ["worktree-prune"],
      }),
    );
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(["brought-forward"]);
    const written: unknown = JSON.parse(storedAt({ definitionsDir }));
    expect(written).toEqual({ ...HOURLY.definition, hold });
  });

  it("REFUSES over a row the owner held — an owner hold carries no finding, and is the owner's word", () => {
    const ownerHold = '"hold":{"askedIso":"2026-11-03T06:58:20.401Z","clearedBy":null,"reason":"wait for me"},';
    const held = DAILY_BYTES.replace('"kind":"verb-run"', `${ownerHold}"kind":"verb-run"`);
    const definitionsDir = seeded({ bytes: held });
    const report = unwrap(
      writeStandingRows({
        absentIds: [],
        definitionsDir,
        dryRun: false,
        rows: [HOURLY],
        supersededIds: ["worktree-prune"],
      }),
    );
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(["refused"]);
    expect(storedAt({ definitionsDir })).toBe(held);
  });

  it("writes nothing on a dry run while reporting the row it would bring forward", () => {
    const definitionsDir = seeded({ bytes: DAILY_BYTES });
    const report = unwrap(
      writeStandingRows({
        absentIds: [],
        definitionsDir,
        dryRun: true,
        rows: [HOURLY],
        supersededIds: ["worktree-prune"],
      }),
    );
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(["brought-forward"]);
    expect(storedAt({ definitionsDir })).toBe(DAILY_BYTES);
  });

  it("prints the row brought forward and counts it as written", () => {
    const lines = standingRowLines({
      report: {
        dryRun: false,
        outcomes: [{ kind: "brought-forward", path: "/store/worktree-prune.json", recipeId: "worktree-prune" }],
      },
    });
    expect(lines).toEqual([
      "wrote worktree-prune · /store/worktree-prune.json · over an earlier build's untouched row",
      "automation register-standing · 1 written · 0 refused · 1 row(s) declared",
    ]);
  });
});

describe("writeStandingRows over a row this build's own reader refuses", () => {
  const UNKNOWN: StandingRow = { ...ROW, definition: { ...ROW.definition, kind: "no-such-kind" } };
  const UNKNOWN_REASON =
    "this build's own reader refuses the declared row, so it is not written — recipe 'worktree-prune' names " +
    "kind 'no-such-kind', which this build does not register — a newer build may, so run `slopweaver automation " +
    "due` from a checkout current with origin/main before treating the row as broken";

  it("REFUSES to create a row naming a kind this build does not register, and writes no file", () => {
    const definitionsDir = join(dir, "definitions");
    const report = unwrap(
      writeStandingRows({
        absentIds: ["worktree-prune"],
        definitionsDir,
        dryRun: false,
        rows: [UNKNOWN],
        supersededIds: [],
      }),
    );
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(["refused"]);
    expect(existsSync(join(definitionsDir, "worktree-prune.json"))).toBe(false);
  });

  it("refuses on a dry run too, naming the reader's own failure, and writes no file", () => {
    const definitionsDir = join(dir, "definitions");
    const report = unwrap(
      writeStandingRows({
        absentIds: ["worktree-prune"],
        definitionsDir,
        dryRun: true,
        rows: [UNKNOWN],
        supersededIds: [],
      }),
    );
    expect(report.outcomes).toEqual([{ kind: "refused", reason: UNKNOWN_REASON, recipeId: "worktree-prune" }]);
    expect(existsSync(join(definitionsDir, "worktree-prune.json"))).toBe(false);
  });

  it("judges the bytes it would write, so a definition that serialises differently is refused", () => {
    const definitionsDir = join(dir, "definitions");
    const disguised = {
      ...ROW.definition,
      toJSON: (): unknown => ({ ...ROW.definition, kind: "no-such-kind" }),
    };
    const report = unwrap(
      writeStandingRows({
        absentIds: ["worktree-prune"],
        definitionsDir,
        dryRun: false,
        rows: [{ ...ROW, definition: disguised }],
        supersededIds: [],
      }),
    );
    expect(report.outcomes).toEqual([{ kind: "refused", reason: UNKNOWN_REASON, recipeId: "worktree-prune" }]);
    expect(existsSync(join(definitionsDir, "worktree-prune.json"))).toBe(false);
  });

  it("REFUSES to bring an earlier build's row forward to a declaration this build cannot read", () => {
    const definitionsDir = join(dir, "definitions");
    mkdirSync(definitionsDir, { recursive: true });
    const earlier = `${JSON.stringify(ROW.definition)}\n`;
    writeFileSync(join(definitionsDir, "worktree-prune.json"), earlier, "utf8");
    const report = unwrap(
      writeStandingRows({
        absentIds: [],
        definitionsDir,
        dryRun: false,
        rows: [{ ...UNKNOWN, supersedes: [ROW.definition] }],
        supersededIds: ["worktree-prune"],
      }),
    );
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(["refused"]);
    expect(readFileSync(join(definitionsDir, "worktree-prune.json"), "utf8")).toBe(earlier);
  });

  it("REFUSES a row declaring more effect than its kind is capable of", () => {
    const overreach: StandingRow = { ...ROW, definition: { ...ROW.definition, kind: RESYNC_KIND } };
    const report = unwrap(
      writeStandingRows({
        absentIds: ["worktree-prune"],
        definitionsDir: join(dir, "definitions"),
        dryRun: true,
        rows: [overreach],
        supersededIds: [],
      }),
    );
    expect(report.outcomes).toEqual([
      {
        kind: "refused",
        reason:
          "this build's own reader refuses the declared row, so it is not written — recipe 'worktree-prune' " +
          "declares effect 'read-write' but kind 'resync' is only capable of 'read' — declare the same or less, " +
          "never more",
        recipeId: "worktree-prune",
      },
    ]);
  });
});
