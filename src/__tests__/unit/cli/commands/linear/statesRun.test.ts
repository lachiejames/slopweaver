/**
 * `linear states` is the one READ verb with a side effect on disk, so what this file actually pins is WHEN
 * the catalog moves: after a successful read, never on a failure, and never under `--no-record`. Widening
 * what the issue write door accepts is the whole reason the verb exists, so widening it wrongly is the
 * defect worth a test.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type LinearStatesDeps,
  recordLinearStates,
  runLinearStates,
} from "../../../../../cli/commands/linear/statesRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../../live/linear/errors.js";
import type { LinearStatesDocument } from "../../../../../live/linear/states.js";
import { stateCatalogTeams } from "../../../../../outbound/linear/stateCatalog.js";

const DOCUMENT: LinearStatesDocument = {
  members: [{ active: true, displayName: "ada", email: undefined, id: "u-1", name: "Ada" }],
  readAtIso: "2026-08-26T12:00:00.000Z",
  source: "linear",
  states: [{ id: "s-todo", name: "Todo", position: 1, type: "unstarted" }],
  team: { id: "team-1", key: "ENG", name: "Engineering" },
  workspace: "acme",
};

function harness({ fail }: { fail?: boolean } = {}): {
  deps: LinearStatesDeps;
  recorded: LinearStatesDocument[];
  out: string[];
  diagnostics: string[];
} {
  const recorded: LinearStatesDocument[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      read: () =>
        Promise.resolve(fail === true ? err(LinearLiveErrors.readFailed({ message: "no token" })) : ok(DOCUMENT)),
      record: ({ document }) => recorded.push(document),
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
    recorded,
  };
}

describe("runLinearStates", () => {
  it("records what it read, so the issue write door will accept those state ids", async () => {
    const { deps, recorded, out } = harness();

    expect(await runLinearStates({ deps, rest: ["--team", "ENG"] })).toBe(EXIT_OK);
    expect(recorded).toEqual([DOCUMENT]);
    expect(out.join("\n")).toContain("s-todo");
  });

  it("takes the team as a bare positional too", async () => {
    const { deps, recorded } = harness();

    expect(await runLinearStates({ deps, rest: ["ENG"] })).toBe(EXIT_OK);
    expect(recorded.length).toBe(1);
  });

  it("records NOTHING under --no-record, so an operator can look without moving the gate", async () => {
    const { deps, recorded, out } = harness();

    expect(await runLinearStates({ deps, rest: ["--team", "ENG", "--no-record"] })).toBe(EXIT_OK);
    expect(recorded).toEqual([]);
    expect(out.join("\n")).toContain("s-todo");
  });

  it("records NOTHING when the read failed — a refused read must never widen the gate", async () => {
    const { deps, recorded, diagnostics } = harness({ fail: true });

    expect(await runLinearStates({ deps, rest: ["--team", "ENG"] })).toBe(EXIT_ERROR);
    expect(recorded).toEqual([]);
    expect(diagnostics).toEqual(["no token"]);
  });

  it("emits the JSON document under --json", async () => {
    const { deps, out } = harness();

    expect(await runLinearStates({ deps, rest: ["--team", "ENG", "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!)).toEqual(DOCUMENT);
  });

  it("refuses with usage when no team is named, and reads nothing", async () => {
    const { deps, recorded, diagnostics } = harness();

    expect(await runLinearStates({ deps, rest: [] })).toBe(EXIT_USAGE);
    expect(recorded).toEqual([]);
    expect(diagnostics[0]!).toContain("--team <team-key> is required");
  });

  it("refuses a --limit outside its advertised range", async () => {
    const { deps, diagnostics } = harness();

    expect(await runLinearStates({ deps, rest: ["--team", "ENG", "--limit", "0"] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]!).toContain("--limit must be an integer from 1 to 250");
  });
});

describe("recordLinearStates", () => {
  // The stamp is the workspace LINEAR reported for the token, never the organisation record's name.
  it("stamps the catalog with the workspace the read itself reported", () => {
    const home = mkdtempSync(join(tmpdir(), "states-record-"));
    try {
      recordLinearStates({ document: { ...DOCUMENT, workspace: "initech" }, home });
      expect(stateCatalogTeams({ home })).toStrictEqual([{ teamKey: "ENG", workspace: "initech" }]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
