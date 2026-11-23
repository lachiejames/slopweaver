/**
 * The Codex pass projection — the columns a reader filters on, and the whole record kept beside them.
 *
 * The fixture is a real `record.json` from the live orchestration directory, reduced only by removing
 * fields no case reads. Its outcome is `fatal` with no `artifact.md`, which is the COMMON shape: a pass
 * that dies on the transport writes a record and no artifact, and a projection that required one would
 * refuse the majority of the set.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { projectCodexPass } from "../../../../store/fleet/codexPass.js";

const NUL = String.fromCodePoint(0);
const FFFD = String.fromCodePoint(0xfffd);
const PATH = "/tmp/orchestration/55149b98";
const ID = "55149b98-aa96-48c1-b1ef-d299b56e2c12";

const RECORD = JSON.stringify({
  artifactId: ID,
  createdAtIso: "2026-09-12T07:11:26.970Z",
  observedElapsedMs: 19401,
  outcome: { error: { kind: "llm", message: "the Codex transport failed" }, kind: "fatal" },
  repoRoot: "/Users/x/dev/slopweaver",
  requestedModel: "gpt-6-astra",
  schemaVersion: 1,
  scope: {
    baseSha: "d3c2fc4c43eceec412dbfa0b52188bf3643d7e6a",
    diffSha256: "0502928d1b11c442216a3e6ce91fe5e9fa80d20db0083e957896e4add471fb0f",
    headSha: "16355525d65cd3b9c169ad0e1f52c22882a192bf",
    mode: "review",
    pass: "r1",
    property: { id: "r1-01", statement: "Every atlas and every corpus source this build has is scheduled." },
  },
  tree: { branch: "scheduled-resyncs", headSha: "16355525d65cd3b9c169ad0e1f52c22882a192bf" },
});

describe("projectCodexPass", () => {
  it("reads the filterable columns off a real record", () => {
    const { row } = unwrap(projectCodexPass({ artifactText: undefined, id: ID, path: PATH, recordText: RECORD }));

    expect(row.id).toBe(ID);
    expect(row.pass).toBe("r1");
    expect(row.mode).toBe("review");
    expect(row.outcome).toBe("fatal");
    expect(row.model).toBe("gpt-6-astra");
    expect(row.branch).toBe("scheduled-resyncs");
    expect(row.headSha).toBe("16355525d65cd3b9c169ad0e1f52c22882a192bf");
    expect(row.baseSha).toBe("d3c2fc4c43eceec412dbfa0b52188bf3643d7e6a");
    expect(row.propertyId).toBe("r1-01");
    expect(row.property).toBe("Every atlas and every corpus source this build has is scheduled.");
    expect(row.elapsedMs).toBe(19401);
    expect(row.createdAt.toISOString()).toBe("2026-09-12T07:11:26.970Z");
  });

  it("keeps the whole record, so a field this projection ignores is still recoverable", () => {
    const { row } = unwrap(projectCodexPass({ artifactText: undefined, id: ID, path: PATH, recordText: RECORD }));

    expect(row.record["schemaVersion"]).toBe(1);
    expect(row.record["artifactId"]).toBe(ID);
  });

  it("stores a NULL artifact for a pass that died before writing one", () => {
    const projected = unwrap(projectCodexPass({ artifactText: undefined, id: ID, path: PATH, recordText: RECORD }));

    expect(projected.row.artifact).toBe(null);
    expect(projected.nulsReplaced).toBe(0);
  });

  it("stores the artifact text when the pass wrote one", () => {
    const projected = unwrap(
      projectCodexPass({ artifactText: "# r1-01\n\nCLEAN.", id: ID, path: PATH, recordText: RECORD }),
    );

    expect(projected.row.artifact).toBe("# r1-01\n\nCLEAN.");
    expect(projected.nulsReplaced).toBe(0);
  });

  it("stores each NUL in an artifact as U+FFFD and counts it, since a text column cannot hold one", () => {
    const projected = unwrap(
      projectCodexPass({ artifactText: `\`[${NUL}s,;:]\`${NUL}`, id: ID, path: PATH, recordText: RECORD }),
    );

    expect(projected.row.artifact).toBe(`\`[${FFFD}s,;:]\`${FFFD}`);
    expect(projected.nulsReplaced).toBe(2);
  });

  it("stores each NUL in a record's strings, nested arrays and keys as U+FFFD, since jsonb cannot hold one", () => {
    const text = JSON.stringify({
      createdAtIso: "2026-09-12T07:11:26.970Z",
      [`k${NUL}`]: 1,
      list: [[`a${NUL}`], 2, null],
      outcome: { answer: { evidence: `[${NUL}s]` }, kind: "answered" },
      scope: { property: { statement: `a${NUL}b` } },
    });

    const projected = unwrap(projectCodexPass({ artifactText: `x${NUL}`, id: ID, path: PATH, recordText: text }));

    expect(projected.nulsReplaced).toBe(5);
    expect(projected.row.property).toBe(`a${FFFD}b`);
    expect(projected.row.record).toEqual({
      createdAtIso: "2026-09-12T07:11:26.970Z",
      [`k${FFFD}`]: 1,
      list: [[`a${FFFD}`], 2, null],
      outcome: { answer: { evidence: `[${FFFD}s]` }, kind: "answered" },
      scope: { property: { statement: `a${FFFD}b` } },
    });
  });

  it("leaves a record whose text merely spells the escape exactly as it was", () => {
    const text = JSON.stringify({
      createdAtIso: "2026-09-12T07:11:26.970Z",
      note: "\\u0000",
      outcome: { kind: "spent" },
    });

    const projected = unwrap(projectCodexPass({ artifactText: undefined, id: ID, path: PATH, recordText: text }));

    expect(projected.row.record["note"]).toBe("\\u0000");
    expect(projected.nulsReplaced).toBe(0);
  });

  it("refuses a record with no outcome kind, naming the nested field", () => {
    const text = JSON.stringify({ createdAtIso: "2026-09-12T07:11:26.970Z" });

    const result = projectCodexPass({ artifactText: undefined, id: ID, path: PATH, recordText: text });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("carries no outcome.kind");
  });

  it("refuses a record with no createdAtIso", () => {
    const text = JSON.stringify({ outcome: { kind: "conclusive" } });

    const result = projectCodexPass({ artifactText: undefined, id: ID, path: PATH, recordText: text });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("carries no createdAtIso");
  });

  it("leaves every scope column NULL on a record that has no scope at all", () => {
    const text = JSON.stringify({ createdAtIso: "2026-09-12T07:11:26.970Z", outcome: { kind: "spent" } });

    const { row } = unwrap(projectCodexPass({ artifactText: undefined, id: ID, path: PATH, recordText: text }));

    expect(row.pass).toBe(null);
    expect(row.mode).toBe(null);
    expect(row.property).toBe(null);
    expect(row.branch).toBe(null);
    expect(row.outcome).toBe("spent");
  });
});
