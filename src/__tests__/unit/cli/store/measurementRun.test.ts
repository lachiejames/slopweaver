/**
 * The three `store measurement-*` readers, driven whole through plain seams: an in-memory store, an in-memory
 * filesystem and two captured output channels. What is under test is what each verb reads, prints and writes
 * — and, for restore, the one rule that it never replaces a file whose bytes differ.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  newestPerPath,
  parseMeasurementListArgs,
  parseMeasurementRestoreArgs,
  restoreAction,
} from "../../../../cli/commands/store/measurementCore.js";
import { runStoreMeasurementRestore } from "../../../../cli/commands/store/measurementRestoreRun.js";
import { type MeasurementVerbDeps, runStoreMeasurementList } from "../../../../cli/commands/store/measurementRun.js";
import { runStoreMeasurementShow } from "../../../../cli/commands/store/measurementShowRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { StoreErrors } from "../../../../store/errors.js";
import type { StoredMeasurementLocation } from "../../../../store/fleet/measurementStore.js";

const HOME = "/home/sw";

/** The hex sha-256 of some bytes. */
function sha({ bytes }: { bytes: Uint8Array }): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** One stored body and where it was found. */
interface Stored {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  readonly placement: "inline" | "storage";
  readonly modified: string;
}

/** A location row as the store returns it. */
function locationOf({ stored }: { stored: Stored }): StoredMeasurementLocation {
  return {
    bodySha256: sha({ bytes: stored.bytes }),
    byteLength: stored.bytes.length,
    fileModifiedAt: new Date(stored.modified),
    measurementClass: stored.relativePath.split("/")[0]!,
    mediaType: stored.placement === "inline" ? "text/markdown" : "image/png",
    placement: stored.placement,
    recordedAt: new Date("2026-09-25T00:00:00.000Z"),
    relativePath: stored.relativePath,
  };
}

/**
 * A world: what the store holds, what is on disk, and everything each verb printed and wrote.
 *
 * `appearsAtWrite` is a file that lands between a restore's plan and its write; `foldCase` makes the disk a
 * case-insensitive volume, where `Gold.md` and `gold.md` are one file.
 */
function world({
  stored,
  disk = new Map(),
  appearsAtWrite = new Map(),
  foldCase = false,
}: {
  stored: readonly Stored[];
  disk?: Map<string, Uint8Array>;
  appearsAtWrite?: Map<string, Uint8Array>;
  foldCase?: boolean;
}) {
  const key = ({ path }: { path: string }): string => (foldCase ? path.toLowerCase() : path);
  const out: string[] = [];
  const bodies: string[] = [];
  const roots: string[] = [];
  const diagnostics: string[] = [];
  const written: { path: string; modifiedAt: string }[] = [];
  const bodyReads: string[] = [];
  const rows = stored
    .map((entry) => locationOf({ stored: entry }))
    .toSorted(
      (a, b) => a.relativePath.localeCompare(b.relativePath) || b.fileModifiedAt.getTime() - a.fileModifiedAt.getTime(),
    );
  const deps: MeasurementVerbDeps = {
    defaultHome: () => HOME,
    existingSha256: ({ path }) => {
      const bytes = disk.get(key({ path }));
      return bytes === undefined ? undefined : sha({ bytes });
    },
    openReader: async () =>
      ok({
        body: async ({ bodySha256 }) => {
          bodyReads.push(bodySha256);
          const found = stored.find((entry) => sha({ bytes: entry.bytes }) === bodySha256);
          return found === undefined
            ? err(StoreErrors.queryFailed({ cause: undefined, what: `find ${bodySha256}` }))
            : ok(found.bytes);
        },
        close: async () => {},
        locations: async ({ filter }) =>
          ok(
            rows.filter(
              (row) =>
                (filter.measurementClass === undefined || row.measurementClass === filter.measurementClass) &&
                (filter.prefix === undefined || row.relativePath.startsWith(filter.prefix)) &&
                (filter.ref === undefined ||
                  (filter.ref.kind === "path"
                    ? row.relativePath === filter.ref.relativePath
                    : row.bodySha256 === filter.ref.bodySha256)),
            ),
          ),
      }),
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    createFile: ({ root, path, bytes, modifiedAt }) => {
      roots.push(root);
      const landed = appearsAtWrite.get(path);
      if (landed !== undefined) {
        disk.set(key({ path }), landed);
        appearsAtWrite.delete(path);
      }
      if (disk.has(key({ path }))) {
        return ok("exists");
      }
      disk.set(key({ path }), bytes);
      written.push({ modifiedAt: modifiedAt.toISOString(), path });
      return ok("created");
    },
    writeBody: (text) => {
      bodies.push(text);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { bodies, bodyReads, deps, diagnostics, disk, out, roots, written };
}

const GOLD: Stored = {
  bytes: Buffer.from("gold witness\n"),
  modified: "2026-09-20T10:00:00.000Z",
  placement: "inline",
  relativePath: "proof/1263/gold.md",
};
const GOLD_OLDER: Stored = { ...GOLD, bytes: Buffer.from("draft\n"), modified: "2026-09-19T10:00:00.000Z" };
const SHOT: Stored = {
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff]),
  modified: "2026-09-21T10:00:00.000Z",
  placement: "storage",
  relativePath: "evidence/sup-3534/shot.png",
};

describe("measurement-list", () => {
  it("prints one line per stored location, filtered by class", async () => {
    const w = world({ stored: [GOLD, SHOT] });

    expect(await runStoreMeasurementList({ deps: w.deps, rest: ["--class", "evidence"] })).toBe(EXIT_OK);
    expect(w.out).toEqual([
      `evidence/sup-3534/shot.png  ${sha({ bytes: SHOT.bytes }).slice(0, 12)}  5 B  storage  2026-09-21T10:00:00.000Z`,
    ]);
  });

  it("exits 3 naming the import when nothing matches", async () => {
    const w = world({ stored: [GOLD] });

    expect(await runStoreMeasurementList({ deps: w.deps, rest: ["--prefix", "bakeoff/"] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(w.diagnostics.join("\n")).toContain("store import-fleet --only measurements");
  });

  it("refuses a class the table has no row for, as usage", async () => {
    const w = world({ stored: [] });

    expect(await runStoreMeasurementList({ deps: w.deps, rest: ["--class", "datadog"] })).toBe(EXIT_USAGE);
    expect(unwrapErr(parseMeasurementListArgs({ rest: ["--class", "datadog"] }))).toEqual([
      "--class datadog is not one of bakeoff, datadog-shots, evidence, proof",
    ]);
  });
});

describe("measurement-show", () => {
  it("prints the newest inline body at a path, and says an older one is stored too", async () => {
    const w = world({ stored: [GOLD, GOLD_OLDER] });

    expect(await runStoreMeasurementShow({ deps: w.deps, rest: ["--ref", `~/.slopweaver/${GOLD.relativePath}`] })).toBe(
      EXIT_OK,
    );
    expect(w.bodies).toEqual(["gold witness\n"]);
    expect(w.out).toEqual([]);
    expect(w.diagnostics.join("\n")).toContain("2 distinct bodies are stored at proof/1263/gold.md");
  });

  it("prints a body with no final newline exactly as stored, adding none", async () => {
    const w = world({ stored: [{ ...GOLD, bytes: Buffer.from("abc") }] });

    expect(await runStoreMeasurementShow({ deps: w.deps, rest: ["--ref", GOLD.relativePath] })).toBe(EXIT_OK);
    expect(w.bodies).toEqual(["abc"]);
  });

  it("refuses an --out file that appears with different bytes between its check and the write", async () => {
    const w = world({ appearsAtWrite: new Map([["/tmp/shot.png", Uint8Array.from([7])]]), stored: [SHOT] });

    expect(
      await runStoreMeasurementShow({ deps: w.deps, rest: ["--ref", SHOT.relativePath, "--out", "/tmp/shot.png"] }),
    ).toBe(EXIT_ERROR);
    expect(w.disk.get("/tmp/shot.png")).toEqual(Uint8Array.from([7]));
    expect(w.diagnostics.join("\n")).toContain("appeared holding different bytes");
  });

  it("refuses a Storage body without --out, before reading it", async () => {
    const w = world({ stored: [SHOT] });

    expect(await runStoreMeasurementShow({ deps: w.deps, rest: ["--ref", SHOT.relativePath] })).toBe(EXIT_ERROR);
    expect(w.diagnostics.join("\n")).toContain("pass --out <file>");
    expect(w.bodyReads).toEqual([]);
  });

  it("writes a Storage body's exact bytes to --out, found by its hash", async () => {
    const w = world({ stored: [SHOT] });

    expect(
      await runStoreMeasurementShow({
        deps: w.deps,
        rest: ["--ref", sha({ bytes: SHOT.bytes }), "--out", "/tmp/shot.png"],
      }),
    ).toBe(EXIT_OK);
    expect(w.disk.get("/tmp/shot.png")).toEqual(SHOT.bytes);
    expect(w.written).toEqual([{ modifiedAt: SHOT.modified, path: "/tmp/shot.png" }]);
  });

  it("never replaces an --out file holding different bytes", async () => {
    const w = world({ disk: new Map([["/tmp/shot.png", Uint8Array.from([1])]]), stored: [SHOT] });

    expect(
      await runStoreMeasurementShow({ deps: w.deps, rest: ["--ref", SHOT.relativePath, "--out", "/tmp/shot.png"] }),
    ).toBe(EXIT_ERROR);
    expect(w.written).toEqual([]);
  });

  it("says the store holds nothing and names the import, never reading disk", async () => {
    const w = world({ stored: [] });

    expect(await runStoreMeasurementShow({ deps: w.deps, rest: ["--ref", GOLD.relativePath] })).toBe(EXIT_ERROR);
    expect(w.diagnostics.join("\n")).toContain("store import-fleet --only measurements");
  });

  it("requires --ref, as usage", async () => {
    expect(await runStoreMeasurementShow({ deps: world({ stored: [] }).deps, rest: [] })).toBe(EXIT_USAGE);
  });
});

describe("measurement-restore", () => {
  it("writes the newest body of every path under --into with its recorded mtime", async () => {
    const w = world({ stored: [GOLD, GOLD_OLDER, SHOT] });

    expect(await runStoreMeasurementRestore({ deps: w.deps, rest: ["--into", "/r"] })).toBe(EXIT_OK);
    expect(w.written).toEqual([
      { modifiedAt: SHOT.modified, path: join("/r", "evidence", "sup-3534", "shot.png") },
      { modifiedAt: GOLD.modified, path: join("/r", "proof", "1263", "gold.md") },
    ]);
    expect(w.disk.get(join("/r", "proof", "1263", "gold.md"))).toEqual(GOLD.bytes);
    expect(w.roots).toEqual(["/r", "/r"]);
    expect(w.out).toEqual([
      "store measurement-restore: wrote 2 file(s) under /r, 0 already identical, 0 left alone because the file there differs",
    ]);
  });

  it("counts a path whose write failed as a failure, never as written", async () => {
    const w = world({ stored: [GOLD] });
    const deps: MeasurementVerbDeps = {
      ...w.deps,
      createFile: () => err(["it resolves outside /r"]),
    };

    expect(await runStoreMeasurementRestore({ deps, rest: ["--into", "/r"] })).toBe(EXIT_ERROR);
    expect(w.out).toEqual([
      "store measurement-restore: wrote 0 file(s) under /r, 0 already identical, 0 left alone because the file there differs",
    ]);
    expect(w.diagnostics).toEqual([
      "store measurement-restore: proof/1263/gold.md: /r/proof/1263/gold.md could not be written: it resolves outside /r",
    ]);
  });

  it("never replaces a file that appears between the plan and the write, exiting 1", async () => {
    const target = join("/r", "proof", "1263", "gold.md");
    const w = world({ appearsAtWrite: new Map([[target, Uint8Array.from([9])]]), stored: [GOLD] });

    expect(await runStoreMeasurementRestore({ deps: w.deps, rest: ["--into", "/r"] })).toBe(EXIT_ERROR);
    expect(w.disk.get(target)).toEqual(Uint8Array.from([9]));
    expect(w.written).toEqual([]);
    expect(w.out).toEqual([
      "store measurement-restore: wrote 0 file(s) under /r, 0 already identical, 1 left alone because the file there differs",
    ]);
  });

  it("writes one of two paths a case-insensitive volume folds together and leaves the other alone", async () => {
    const upper: Stored = { ...GOLD, bytes: Buffer.from("upper\n"), relativePath: "proof/1263/Gold.md" };
    const w = world({ foldCase: true, stored: [upper, GOLD] });

    expect(await runStoreMeasurementRestore({ deps: w.deps, rest: ["--into", "/r"] })).toBe(EXIT_ERROR);
    expect(w.written).toEqual([{ modifiedAt: GOLD.modified, path: join("/r", "proof", "1263", "gold.md") }]);
    expect(w.disk.get(join("/r", "proof", "1263", "gold.md"))).toEqual(GOLD.bytes);
    expect(w.out).toEqual([
      "store measurement-restore: wrote 1 file(s) under /r, 0 already identical, 1 left alone because the file there differs",
    ]);
  });

  it("skips an identical file and leaves a differing one alone, exiting 1", async () => {
    const disk = new Map([
      [join("/r", "proof", "1263", "gold.md"), GOLD.bytes],
      [join("/r", "evidence", "sup-3534", "shot.png"), Uint8Array.from([0])],
    ]);
    const w = world({ disk, stored: [GOLD, SHOT] });

    expect(await runStoreMeasurementRestore({ deps: w.deps, rest: ["--into", "/r"] })).toBe(EXIT_ERROR);
    expect(w.written).toEqual([]);
    expect(disk.get(join("/r", "evidence", "sup-3534", "shot.png"))).toEqual(Uint8Array.from([0]));
    expect(w.out).toEqual([
      "store measurement-restore: wrote 0 file(s) under /r, 1 already identical, 1 left alone because the file there differs",
    ]);
  });

  it("reads no body and writes nothing on --dry-run", async () => {
    const w = world({ stored: [GOLD, SHOT] });

    expect(await runStoreMeasurementRestore({ deps: w.deps, rest: ["--into", "/r", "--dry-run"] })).toBe(EXIT_OK);
    expect(w.bodyReads).toEqual([]);
    expect(w.written).toEqual([]);
    expect(w.out).toEqual([
      "store measurement-restore: would write 2 file(s) under /r, 0 already identical, 0 left alone because the file there differs",
    ]);
  });

  it("requires --into, as usage", async () => {
    expect(await runStoreMeasurementRestore({ deps: world({ stored: [] }).deps, rest: [] })).toBe(EXIT_USAGE);
    expect(unwrap(parseMeasurementRestoreArgs({ rest: ["--dry-run"] })).into).toBe(undefined);
  });
});

describe("the pure pieces", () => {
  it("keeps the first — newest — row of each path", () => {
    const rows = [locationOf({ stored: GOLD }), locationOf({ stored: GOLD_OLDER }), locationOf({ stored: SHOT })];

    expect(newestPerPath({ locations: rows }).map((row) => row.bodySha256)).toEqual([
      sha({ bytes: GOLD.bytes }),
      sha({ bytes: SHOT.bytes }),
    ]);
  });

  it("decides write, identical and differs from the hash already there", () => {
    expect(restoreAction({ bodySha256: "a", existingSha256: undefined })).toBe("write");
    expect(restoreAction({ bodySha256: "a", existingSha256: "a" })).toBe("identical");
    expect(restoreAction({ bodySha256: "a", existingSha256: "b" })).toBe("differs");
  });
});
