/**
 * The stale-seat guard's pure core, over the incident's own paths.
 *
 * The two rows that matter are carried together on purpose: a criterion that fires on EVERYTHING passes the
 * "recipe fires" case and fails the "slack stays silent" one, which is the whole reason a distance
 * threshold was rejected in favour of an overlap.
 */
import { describe, expect, it } from "vitest";

import { staleEvidenceDetail, supersededEvidence } from "../../../cli/commands/handover/staleEvidenceGate.js";
import {
  OVERLAP_PATHS_SHOWN,
  resolveImportPathspec,
  staleSeatAssessment,
  staleSeatCadence,
  staleSeatLines,
  verbModuleTrees,
} from "../../../cli/staleSeat.js";
import { codeEvidencePaths } from "../../../handover/evidenceRefs.js";

/** The evidence the incident's seat registered its row from, verbatim. */
const INCIDENT_EVIDENCE = ["bin/slopweaver", "src/live/automation/definitionStore.ts", "state:ledgers/autonomy.jsonl"];

/** One path the upstream had already changed while that seat was reading its own older copy. */
const INCIDENT_CHANGED = ["src/live/automation/definitionStore.ts"];

describe("resolveImportPathspec", () => {
  it("resolves a command file's own domain import to its directory", () => {
    expect(
      resolveImportPathspec({
        fromDir: "src/cli/commands/automation",
        specifier: "../../../live/automation/definitionStore.js",
      }),
    ).toBe("src/live/automation");
  });

  it("keeps the filename for a module directly under src, which would otherwise widen to the whole repo", () => {
    expect(resolveImportPathspec({ fromDir: "src/cli/commands/automation", specifier: "../../../config.js" })).toBe(
      "src/config.ts",
    );
  });

  it("keeps the filename for a CLI-root import, whose directory contains every sibling verb", () => {
    expect(resolveImportPathspec({ fromDir: "src/cli/commands/autonomy", specifier: "../../defineCommand.js" })).toBe(
      "src/cli/defineCommand.ts",
    );
  });

  it("keeps the filename for a sibling-verb barrel, never widening to src/cli/commands", () => {
    expect(resolveImportPathspec({ fromDir: "src/cli/commands/autonomy", specifier: "../shared.js" })).toBe(
      "src/cli/commands/shared.ts",
    );
  });

  it("keeps the filename for a SIDEWAYS import into another verb group, a counterexample", () => {
    // `cmux todo list` named `src/cli/commands/supervisor/scratchCore.ts` as a path it reads, on the
    // strength of `cmux/takeover.ts`'s one `../supervisor/ownerTurnsRun.js` import. Measured on the real
    // CLI. The ancestor test does not reach this: `src/cli/commands/supervisor` contains
    // neither the verb nor its directory.
    expect(
      resolveImportPathspec({ fromDir: "src/cli/commands/cmux", specifier: "../supervisor/ownerTurnsRun.js" }),
    ).toBe("src/cli/commands/supervisor/ownerTurnsRun.ts");
  });

  it("keeps the filename for src/lib, which 104 of 105 command directories import", () => {
    expect(resolveImportPathspec({ fromDir: "src/cli/commands/autonomy", specifier: "../../../lib/result.js" })).toBe(
      "src/lib/result.ts",
    );
  });

  it("still widens a genuine module directory, which is the whole point of widening at all", () => {
    expect(resolveImportPathspec({ fromDir: "src/cli/commands/cmux", specifier: "../../../cmux/eventStream.js" })).toBe(
      "src/cmux",
    );
  });

  it("rejects a bare package specifier", () => {
    expect(resolveImportPathspec({ fromDir: "src/cli/commands/automation", specifier: "node:fs" })).toBe(undefined);
  });

  it("rejects a relative import that climbs out of src entirely", () => {
    expect(
      resolveImportPathspec({ fromDir: "src/cli/commands/automation", specifier: "../../../../scripts/x.js" }),
    ).toBe(undefined);
  });
});

describe("verbModuleTrees", () => {
  it("always leads with the verb's own command directory", () => {
    expect(verbModuleTrees({ noun: "autonomy", specifiers: [] })).toEqual(["src/cli/commands/autonomy"]);
  });

  it("finds src/live/automation for the automation noun, which a src/<noun> guess never would", () => {
    const trees = verbModuleTrees({
      noun: "automation",
      specifiers: ["../../../live/automation/definitionStore.js", "../../../live/automation/dueReport.js"],
    });
    expect(trees).toEqual(["src/cli/commands/automation", "src/live/automation"]);
  });

  it("never names a tree containing a sibling verb, the false positive measured on the real CLI", () => {
    const trees = verbModuleTrees({
      noun: "autonomy",
      specifiers: ["../../../autonomy/query.js", "../../defineCommand.js", "../../exitCodes.js", "./core.js"],
    });
    expect(trees).toEqual([
      "src/cli/commands/autonomy",
      "src/autonomy",
      "src/cli/defineCommand.ts",
      "src/cli/exitCodes.ts",
    ]);
  });
});

describe("staleSeatAssessment and staleSeatCadence", () => {
  it("fires on the verb whose own code the upstream changed", () => {
    const trees = verbModuleTrees({ noun: "automation", specifiers: ["../../../live/automation/definitionStore.js"] });
    const assessment = staleSeatAssessment({ behind: 258, changedPaths: INCIDENT_CHANGED, trees });
    expect(assessment.overlapping).toEqual(["src/live/automation/definitionStore.ts"]);
    expect(staleSeatCadence({ assessment })).toBe("every-invocation");
  });

  it("stays quiet-but-honest on a verb the SAME upstream change does not touch", () => {
    const trees = verbModuleTrees({ noun: "slack", specifiers: ["../../../outbound/slack/post.js"] });
    const assessment = staleSeatAssessment({ behind: 258, changedPaths: INCIDENT_CHANGED, trees });
    expect(assessment.overlapping).toEqual([]);
    expect(assessment.behind).toBe(258);
    expect(staleSeatCadence({ assessment })).toBe("once-per-session");
  });

  it("is silent only when the seat is actually current", () => {
    const assessment = staleSeatAssessment({ behind: 0, changedPaths: [], trees: ["src/cli/commands/autonomy"] });
    expect(staleSeatCadence({ assessment })).toBe("silent");
  });

  it("counts a changed file inside a named directory as an overlap", () => {
    const assessment = staleSeatAssessment({
      behind: 3,
      changedPaths: ["src/autonomy/query.ts"],
      trees: ["src/autonomy"],
    });
    expect(assessment.overlapping).toEqual(["src/autonomy/query.ts"]);
  });

  it("never matches a sibling directory sharing a prefix", () => {
    const assessment = staleSeatAssessment({
      behind: 3,
      changedPaths: ["src/autonomyOther/query.ts"],
      trees: ["src/autonomy"],
    });
    expect(assessment.overlapping).toEqual([]);
  });
});

describe("staleSeatLines", () => {
  it("names the superseded path and the commit count when the verb's own code moved", () => {
    const trees = verbModuleTrees({ noun: "automation", specifiers: ["../../../live/automation/definitionStore.js"] });
    const lines = staleSeatLines({
      assessment: staleSeatAssessment({ behind: 258, changedPaths: INCIDENT_CHANGED, trees }),
      fetchedAtMs: 1_000_000,
      noun: "automation",
      nowMs: 1_600_000,
      upstreamRef: "origin/main",
      verb: "due",
    });
    expect(lines[0]).toBe("slopweaver automation due: this seat is 258 commit(s) behind origin/main");
    expect(lines[1]).toBe("  and it changed 1 path(s) inside the tree(s) this verb reads:");
    expect(lines.join("\n")).toContain("src/live/automation/definitionStore.ts");
    expect(lines.join("\n")).toContain("superseded");
    expect(lines.at(-1)).toBe("  last fetch: 10 min ago");
  });

  it("says LOWER BOUND in those words when there is drift but no overlap", () => {
    const trees = verbModuleTrees({ noun: "slack", specifiers: ["../../../outbound/slack/post.js"] });
    const lines = staleSeatLines({
      assessment: staleSeatAssessment({ behind: 30, changedPaths: INCIDENT_CHANGED, trees }),
      fetchedAtMs: undefined,
      noun: "slack",
      nowMs: 1_600_000,
      upstreamRef: "origin/main",
      verb: "post",
    });
    expect(lines[0]).toBe("slopweaver slack post: this seat is 30 commit(s) behind origin/main");
    expect(lines.join("\n")).toContain("LOWER BOUND");
    expect(lines.join("\n")).toContain("transitively");
    expect(lines.at(-1)).toBe("  last fetch: unknown — the true distance can only be larger");
  });

  it("prints nothing at all for a current seat", () => {
    expect(
      staleSeatLines({
        assessment: staleSeatAssessment({ behind: 0, changedPaths: [], trees: ["src/cli/commands/autonomy"] }),
        fetchedAtMs: 1_000_000,
        noun: "autonomy",
        nowMs: 1_600_000,
        upstreamRef: "origin/main",
        verb: "list",
      }),
    ).toEqual([]);
  });

  it("caps the listed paths and says how many it held back", () => {
    const changed = ["a", "b", "c", "d", "e", "f", "g"].map((name) => `src/autonomy/${name}.ts`);
    const lines = staleSeatLines({
      assessment: staleSeatAssessment({ behind: 40, changedPaths: changed, trees: ["src/autonomy"] }),
      fetchedAtMs: 1_000_000,
      noun: "autonomy",
      nowMs: 1_000_000,
      upstreamRef: "origin/main",
      verb: "list",
    });
    expect(lines.filter((line) => line.startsWith("    src/autonomy/"))).toHaveLength(OVERLAP_PATHS_SHOWN);
    expect(lines.join("\n")).toContain("…and 2 more");
  });
});

describe("codeEvidencePaths", () => {
  it("keeps the two code paths of the incident's row and drops its state: item", () => {
    expect(codeEvidencePaths({ evidence: INCIDENT_EVIDENCE })).toEqual([
      "bin/slopweaver",
      "src/live/automation/definitionStore.ts",
    ]);
  });

  it("drops a github ref, a permalink and a flag", () => {
    // The ref is the r2 review's finding: it cleared every other test — a slash, no whitespace, no scheme —
    // and this case ASSERTED that it survived while its own name said it did not. Both docs claimed such a
    // ref was outside the criterion, and only git's indifference to an unmatched pathspec made that true.
    expect(
      codeEvidencePaths({ evidence: ["owner/repo#16360", "https://example.com/a/b", "--finding", "notapath"] }),
    ).toEqual([]);
  });

  it("keeps a real path that sits beside a dropped ref, so the drop is not a blanket refusal", () => {
    expect(codeEvidencePaths({ evidence: ["owner/repo#16360", "src/cli/staleSeat.ts"] })).toEqual([
      "src/cli/staleSeat.ts",
    ]);
  });
});

describe("supersededEvidence", () => {
  it("refuses the incident's row, naming only the code path the upstream moved", () => {
    expect(supersededEvidence({ changedPaths: INCIDENT_CHANGED, evidence: INCIDENT_EVIDENCE })).toEqual([
      "src/live/automation/definitionStore.ts",
    ]);
  });

  it("never names the state: item, which is carried in the input so the absence is falsifiable", () => {
    const superseded = supersededEvidence({
      changedPaths: ["src/live/automation/definitionStore.ts", "state:ledgers/autonomy.jsonl"],
      evidence: INCIDENT_EVIDENCE,
    });
    expect(superseded).toEqual(["src/live/automation/definitionStore.ts"]);
  });

  it("passes a finding whose subject the upstream has not touched", () => {
    expect(supersededEvidence({ changedPaths: ["src/autonomy/query.ts"], evidence: INCIDENT_EVIDENCE })).toEqual([]);
  });
});

describe("staleEvidenceDetail", () => {
  it("states the distance, the ref and what moved", () => {
    expect(
      staleEvidenceDetail({
        behind: 258,
        superseded: ["src/live/automation/definitionStore.ts"],
        upstreamRef: "origin/main",
      }),
    ).toBe(
      "this seat is 258 commit(s) behind origin/main, which changed src/live/automation/definitionStore.ts — " +
        "confirm the defect against origin/main before registering it",
    );
  });
});
