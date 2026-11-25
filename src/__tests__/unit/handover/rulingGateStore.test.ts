/**
 * The projection: what a rebuild reads out of real journals, and what the fail-open read path does with a
 * file it cannot use.
 *
 * Filesystem only for a genuine round trip through a `mkdtempSync` directory, per
 * `.claude/rules/testing.md` — no mocks, and nothing writes to the ambient home.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseRulingGateIndex,
  RULING_GATE_INDEX_SCHEMA_VERSION,
  renderRulingGateIndex,
} from "../../../handover/rulingGateIndex.js";
import {
  readStandingGates,
  rebuildStandingGates,
  type StandingGateWalk,
  walkStandingGates,
  writeStandingGates,
} from "../../../handover/rulingGateStore.js";
import { unwrap } from "../../../lib/result.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway home holding a `runs/` directory. */
function sandbox(): { home: string; runsDir: string; indexPath: string } {
  const home = mkdtempSync(join(tmpdir(), "sw-gate-"));
  fixtures.push(home);
  const runsDir = join(home, "runs");
  mkdirSync(runsDir, { recursive: true });
  return { home, indexPath: join(home, "ruling-gates.json"), runsDir };
}

/** One journal line, as `applyRowEvent` would have written it. */
function line({ event }: { event: Readonly<Record<string, unknown>> }): string {
  return `${JSON.stringify(event)}\n`;
}

const PLACED = "2026-09-21T03:01:34.000Z";

const PLACING = {
  anchor: "transcript:a0000036#a0000064",
  atIso: PLACED,
  decidedIso: PLACED,
  gate: { subjects: ["iso-policy-acceptance-daily"], verbs: [{ noun: "recipe", verb: "run-due" }] },
  kind: "ruling",
  ruling: "post only what someone has asked for",
};

describe("rebuildStandingGates", () => {
  it("finds a gate in a journal", () => {
    const { runsDir } = sandbox();
    writeFileSync(join(runsDir, "a-row.jsonl"), line({ event: PLACING }), "utf8");

    const gates = rebuildStandingGates({ runsDir });

    expect(gates.length).toBe(1);
    expect(gates[0]!.slug).toBe("a-row");
    expect(gates[0]!.subjects).toEqual(["iso-policy-acceptance-daily"]);
  });

  it("finds a gate in a journal whose ruling line was serialised with whitespace", () => {
    const { runsDir } = sandbox();
    const spaced = JSON.stringify(PLACING).replace('"kind":"ruling"', '"kind": "ruling"');
    writeFileSync(join(runsDir, "spaced.jsonl"), `${spaced}\n`, "utf8");

    const gates = rebuildStandingGates({ runsDir });

    expect(spaced).toContain('"kind": "ruling"');
    expect(gates.map((gate) => gate.slug)).toEqual(["spaced"]);
  });

  it("skips a journal that carries no ruling at all", () => {
    const { runsDir } = sandbox();
    writeFileSync(
      join(runsDir, "quiet.jsonl"),
      line({ event: { atIso: PLACED, branch: "b", docHash: "h", kind: "started" } }),
      "utf8",
    );

    expect(rebuildStandingGates({ runsDir })).toEqual([]);
  });

  it("answers empty for a runs directory that is not there, rather than throwing", () => {
    expect(rebuildStandingGates({ runsDir: join(tmpdir(), "sw-gate-absent-directory") })).toEqual([]);
  });

  it("lets one unreadable journal leave every other row's gates standing", () => {
    const { runsDir } = sandbox();
    writeFileSync(join(runsDir, "a-row.jsonl"), line({ event: PLACING }), "utf8");
    writeFileSync(join(runsDir, "broken.jsonl"), '{"kind":"ruling" this is not json\n', "utf8");

    expect(rebuildStandingGates({ runsDir }).length).toBe(1);
  });
});

describe("walkStandingGates", () => {
  it("names a journal that would not open as a gap, beside the gates that did read", () => {
    const { runsDir } = sandbox();
    writeFileSync(join(runsDir, "a-row.jsonl"), line({ event: PLACING }), "utf8");
    mkdirSync(join(runsDir, "held.jsonl"));

    const walk = walkStandingGates({ runsDir });

    expect(walk.kind).toBe("read");
    const read = walk as Extract<StandingGateWalk, { kind: "read" }>;
    expect(read.gates.map((gate) => gate.slug)).toEqual(["a-row"]);
    expect(read.gaps.length).toBe(1);
    expect(read.gaps[0]).toContain("held.jsonl: ");
  });

  it("names a ruling journal with a line that would not decode as a gap", () => {
    const { runsDir } = sandbox();
    writeFileSync(join(runsDir, "broken.jsonl"), `${line({ event: PLACING })}{"kind":"ruling" not json\n`, "utf8");

    expect(walkStandingGates({ runsDir })).toEqual({
      gaps: ["broken.jsonl: line 2 would not decode"],
      gates: rebuildStandingGates({ runsDir }),
      kind: "read",
    });
  });

  it("reads a home with no runs directory as no gates", () => {
    expect(walkStandingGates({ runsDir: join(tmpdir(), "sw-gate-absent-directory") })).toEqual({
      gaps: [],
      gates: [],
      kind: "read",
    });
  });

  it("calls a runs path that is there but will not list unreadable, never empty", () => {
    const { home } = sandbox();
    const runsDir = join(home, "ruling-gates.json");
    writeFileSync(runsDir, "a file, not a directory", "utf8");

    const walk = walkStandingGates({ runsDir });

    expect(walk.kind).toBe("unreadable");
    expect((walk as Extract<StandingGateWalk, { kind: "unreadable" }>).why).toContain(
      "the run journals would not list",
    );
  });
});

describe("the projection round trip", () => {
  it("writes gates a reader gets back unchanged", () => {
    const { runsDir, indexPath } = sandbox();
    writeFileSync(join(runsDir, "a-row.jsonl"), line({ event: PLACING }), "utf8");
    const gates = rebuildStandingGates({ runsDir });

    expect(unwrap(writeStandingGates({ builtAtIso: PLACED, gates, indexPath }))).toBe(indexPath);
    expect(readStandingGates({ indexPath })).toEqual(gates);
  });

  it("keeps an optional lapse instant through the round trip", () => {
    const withExpiry = {
      ...PLACING,
      gate: { ...PLACING.gate, untilIso: "2026-09-21T14:00:00.000Z" },
    };
    const { runsDir, indexPath } = sandbox();
    writeFileSync(join(runsDir, "a-row.jsonl"), line({ event: withExpiry }), "utf8");
    const gates = rebuildStandingGates({ runsDir });
    unwrap(writeStandingGates({ builtAtIso: PLACED, gates, indexPath }));

    expect(readStandingGates({ indexPath })[0]!.untilIso).toBe("2026-09-21T14:00:00.000Z");
  });
});

describe("readStandingGates fails OPEN", () => {
  it("answers empty for a file that is not there", () => {
    expect(readStandingGates({ indexPath: join(tmpdir(), "sw-gate-no-such-index.json") })).toEqual([]);
  });

  it("answers empty for a file that is not JSON", () => {
    const { indexPath } = sandbox();
    writeFileSync(indexPath, "{ truncated", "utf8");

    expect(readStandingGates({ indexPath })).toEqual([]);
  });

  it("answers empty for a file whose shape is wrong, rather than a partial set", () => {
    const { indexPath } = sandbox();
    writeFileSync(indexPath, '{"schemaVersion":1,"builtAtIso":"x","gates":[{"id":""}]}', "utf8");

    expect(readStandingGates({ indexPath })).toEqual([]);
  });
});

describe("parseRulingGateIndex", () => {
  it("names the file it could not read, so a reader knows what to rebuild", () => {
    const parsed = parseRulingGateIndex({ path: "/tmp/ruling-gates.json", text: "nope" });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("GATE_INDEX_UNREADABLE");
    expect(parsed._unsafeUnwrapErr().message).toContain("/tmp/ruling-gates.json");
  });

  it("refuses a gate whose instant is not canonical, since nothing could ever release it", () => {
    const text = renderRulingGateIndex({
      builtAtIso: PLACED,
      gates: [
        {
          anchor: "a",
          id: "row#2026-09-21T03:01:34Z",
          placedIso: "2026-09-21T03:01:34Z",
          slug: "row",
          subjects: [],
          verbs: [{ noun: "slack", verb: "post" }],
          words: "w",
        },
      ],
    });

    const parsed = parseRulingGateIndex({ path: "/tmp/i.json", text });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("GATE_INDEX_UNREADABLE");
    expect(parsed._unsafeUnwrapErr().message).toContain("canonical");
  });
});

describe("the projection's schema version", () => {
  it("stamps what the writer writes, so a future bump has something to compare against", () => {
    const text = renderRulingGateIndex({ builtAtIso: PLACED, gates: [] });

    expect(unwrap(parseRulingGateIndex({ path: "/tmp/i.json", text })).schemaVersion).toBe(
      RULING_GATE_INDEX_SCHEMA_VERSION,
    );
  });

  it("refuses a version this build has never written, rather than reading it as gates", () => {
    const text = JSON.stringify({ builtAtIso: PLACED, gates: [], schemaVersion: 99 });
    const parsed = parseRulingGateIndex({ path: "/tmp/i.json", text });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("GATE_INDEX_UNREADABLE");
  });
});
