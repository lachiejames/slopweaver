/**
 * `supervisor owner-turn-record` and `owner-turn-show`, driven through their injected seams over a temp home.
 *
 * `record` runs the REAL `recordOwnerTurnFile` with an empty environment and a fresh home, which selects no
 * store — so the store-free outcomes (no-store, outside-family, a refused NUL) are exercised end to end with
 * no connection. `show` gets a plain fake reader, which is a seam rather than a mock: the property under test
 * is that it prints what the STORE returned and never the file on disk.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  bodyAsOutLine,
  ownerTurnNothingStoredLine,
  ownerTurnVersions,
} from "../../../../../cli/commands/supervisor/ownerTurnCore.js";
import {
  type OwnerTurnVerbDeps,
  runSupervisorOwnerTurnRecord,
  runSupervisorOwnerTurnShow,
} from "../../../../../cli/commands/supervisor/ownerTurnRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { OwnerTurnRef } from "../../../../../store/fleet/ownerTurnAnchor.js";
import {
  readOwnerTurnsFromStore,
  recordOwnerTurnFile,
  type StoredOwnerTurn,
} from "../../../../../store/fleet/ownerTurnStore.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "owner-turn-verb-"));
  homes.push(home);
  return home;
}

/** Write one file under the home, making its directory, and return its absolute path. */
function put({ home, path, text }: { home: string; path: string; text: string }): string {
  const full = join(home, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
  return full;
}

/** Deps that record for real against no store, read from a fixed row set, and capture every line. */
function harness({ rows = [] }: { rows?: readonly StoredOwnerTurn[] } = {}): {
  deps: OwnerTurnVerbDeps;
  out: string[];
  diagnostics: string[];
  refs: OwnerTurnRef[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const refs: OwnerTurnRef[] = [];
  return {
    deps: {
      defaultHome: () => {
        throw new Error("every case passes --home");
      },
      read: ({ ref }) => {
        refs.push(ref);
        return Promise.resolve(ok({ kind: "read" as const, rows }));
      },
      record: ({ path, home }) => recordOwnerTurnFile({ env: {}, home, path }),
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
    refs,
  };
}

/** One stored copy. */
function stored({
  relativePath,
  body,
  sha,
  at,
}: {
  relativePath: string;
  body: string;
  sha: string;
  at: string;
}): StoredOwnerTurn {
  return {
    body,
    bodySha256: sha,
    byteLength: Buffer.byteLength(body),
    family: "scratch-turn",
    fileModifiedAt: new Date(at),
    relativePath,
    turn: "257-1",
  };
}

describe("recordOwnerTurnFile with no store selected", () => {
  it("answers no-store for an owner-turn file, opening no connection", async () => {
    const home = freshHome();
    const path = put({ home, path: "supervisor-scratch/handoff-9257/owner-turn-257-1.txt", text: "their words\n" });

    const outcome = await recordOwnerTurnFile({ env: {}, home, path });

    expect(unwrap(outcome)).toEqual({ kind: "no-store" });
  });

  it("answers outside-family for a file under neither root", async () => {
    const home = freshHome();
    const path = put({ home, path: "handovers/owner-turn-257-1.txt", text: "x" });

    const outcome = await recordOwnerTurnFile({ env: {}, home, path });

    expect(unwrap(outcome)).toEqual({ kind: "outside-family" });
  });

  it("refuses a NUL before it ever reaches the store", async () => {
    const home = freshHome();
    const path = put({ home, path: "handovers/archive/owner-turn-1-1.txt", text: "a\u0000b" });

    const outcome = await recordOwnerTurnFile({ env: {}, home, path });

    expect(unwrapErr(outcome).code).toBe("UNSTORABLE_TURN_FILE");
  });

  it("names a file that is not there as absent", async () => {
    const home = freshHome();

    const outcome = await recordOwnerTurnFile({
      env: {},
      home,
      path: join(home, "handovers/archive/owner-turn-9.txt"),
    });

    expect(unwrapErr(outcome).code).toBe("SOURCE_ABSENT");
  });
});

describe("readOwnerTurnsFromStore with no store selected", () => {
  it("answers no-store rather than anything off disk", async () => {
    const home = freshHome();
    put({ home, path: "handovers/archive/owner-turn-257-1.txt", text: "on disk only" });

    const read = await readOwnerTurnsFromStore({ env: {}, home, ref: { kind: "turn", turn: "257-1" } });

    expect(unwrap(read)).toEqual({ kind: "no-store" });
  });
});

describe("runSupervisorOwnerTurnRecord", () => {
  it("refuses a missing --file as usage", async () => {
    const { deps, diagnostics } = harness();

    const code = await runSupervisorOwnerTurnRecord({ deps, rest: ["--home", freshHome()] });

    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe(
      "supervisor owner-turn-record: --file <path> is required: the owner-turn file a seat just wrote",
    );
  });

  it("exits non-zero when the home selects no store, naming the import command", async () => {
    const home = freshHome();
    const path = put({ home, path: "supervisor-scratch/handoff-9257/owner-turn-257-1.txt", text: "their words\n" });
    const { deps, diagnostics, out } = harness();

    const code = await runSupervisorOwnerTurnRecord({ deps, rest: ["--file", path, "--home", home] });

    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual([
      `supervisor owner-turn-record: ${home} selects no store, so ${path} is on disk only — run ` +
        "`slopweaver store import-fleet --only owner-turns` once a store is selected",
    ]);
  });

  it("exits non-zero for a file outside both roots", async () => {
    const home = freshHome();
    const path = put({ home, path: "handovers/owner-turn-257-1.txt", text: "x" });
    const { deps, diagnostics } = harness();

    const code = await runSupervisorOwnerTurnRecord({ deps, rest: ["--file", path, "--home", home] });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("is not an owner-turn-*.txt under handovers/archive/");
  });

  it("exits non-zero on a NUL, naming the code and the reconcile command", async () => {
    const home = freshHome();
    const path = put({ home, path: "handovers/archive/owner-turn-1-1.txt", text: "a\u0000b" });
    const { deps, diagnostics } = harness();

    const code = await runSupervisorOwnerTurnRecord({ deps, rest: ["--file", path, "--home", home] });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toBe(`supervisor owner-turn-record: ${path} was NOT recorded (UNSTORABLE_TURN_FILE)`);
    expect(diagnostics[2]).toBe(
      "  reconcile with `slopweaver store import-fleet --only owner-turns` once the cause is fixed",
    );
  });
});

describe("runSupervisorOwnerTurnShow", () => {
  const newest = stored({
    at: "2026-09-20T00:00:00.000Z",
    body: "second version\n",
    relativePath: "supervisor-scratch/handoff-9258/owner-turn-257-1.txt",
    sha: "b".repeat(64),
  });
  const older = stored({
    at: "2026-09-19T00:00:00.000Z",
    body: "first version",
    relativePath: "supervisor-scratch/handoff-9257/owner-turn-257-1.txt",
    sha: "a".repeat(64),
  });

  it("refuses a missing --ref as usage", async () => {
    const { deps, diagnostics } = harness();

    const code = await runSupervisorOwnerTurnShow({ deps, rest: ["--home", freshHome()] });

    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("supervisor owner-turn-show: --ref <anchor|turn> is required");
  });

  it("prints the newest body from the store, byte-exact through the out channel's own newline", async () => {
    const { deps, diagnostics, out, refs } = harness({ rows: [newest, older] });

    const code = await runSupervisorOwnerTurnShow({ deps, rest: ["--ref", "257-1", "--home", freshHome()] });

    expect(code).toBe(EXIT_OK);
    expect(refs).toEqual([{ kind: "turn", turn: "257-1" }]);
    expect(out).toEqual(["second version"]);
    expect(diagnostics).toEqual([
      "supervisor owner-turn-show: 2 distinct bodies are stored for 257-1; this is the newest-written — --all prints every one",
    ]);
  });

  it("prints every body under --all, each headed by where it was found", async () => {
    const { deps, out } = harness({ rows: [newest, older] });

    await runSupervisorOwnerTurnShow({ deps, rest: ["--ref", "257-1", "--all", "--home", freshHome()] });

    expect(out).toEqual([
      `=== sha256 ${"b".repeat(64)} · 15 bytes · supervisor-scratch/handoff-9258/owner-turn-257-1.txt @ 2026-09-20T00:00:00.000Z`,
      "second version",
      `=== sha256 ${"a".repeat(64)} · 13 bytes · supervisor-scratch/handoff-9257/owner-turn-257-1.txt @ 2026-09-19T00:00:00.000Z`,
      "first version",
    ]);
  });

  it("carries every body byte-exact under --json", async () => {
    const { deps, out } = harness({ rows: [newest] });

    await runSupervisorOwnerTurnShow({ deps, rest: ["--ref", "257-1", "--json", "--home", freshHome()] });

    const parsed = JSON.parse(out[0]!) as { versions: { body: string }[] };
    expect(parsed.versions.map((version) => version.body)).toEqual(["second version\n"]);
  });

  it("says the store holds nothing, and never falls back to the file on disk", async () => {
    const home = freshHome();
    put({ home, path: "supervisor-scratch/handoff-9257/owner-turn-257-1.txt", text: "on disk only" });
    const { deps, diagnostics, out } = harness({ rows: [] });

    const code = await runSupervisorOwnerTurnShow({ deps, rest: ["--ref", "257-1", "--home", home] });

    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual([ownerTurnNothingStoredLine({ ref: "257-1" })]);
  });

  it("refuses an anchor that cites no owner-turn file, before reading the store", async () => {
    const { deps, diagnostics, refs } = harness();

    const code = await runSupervisorOwnerTurnShow({
      deps,
      rest: ["--ref", "transcript:abc#def", "--home", freshHome()],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(refs).toEqual([]);
    expect(diagnostics[0]).toContain("names a transcript or other record, not a file");
  });
});

describe("ownerTurnVersions", () => {
  it("groups copies of one body together, keeping the newest-first order", () => {
    const at = "2026-09-20T00:00:00.000Z";
    const rows = [
      stored({ at, body: "x", relativePath: "p/2", sha: "b" }),
      stored({ at, body: "y", relativePath: "p/1", sha: "a" }),
      stored({ at, body: "x", relativePath: "p/3", sha: "b" }),
    ];

    const versions = ownerTurnVersions({ rows });

    expect(versions.map((version) => version.bodySha256)).toEqual(["b", "a"]);
    expect(versions[0]!.locations.map((location) => location.relativePath)).toEqual(["p/2", "p/3"]);
  });
});

describe("bodyAsOutLine", () => {
  it("drops exactly one final newline, which the out channel puts back", () => {
    expect(bodyAsOutLine({ body: "a\n\n" })).toBe("a\n");
    expect(bodyAsOutLine({ body: "a" })).toBe("a");
  });
});
