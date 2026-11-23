/**
 * `store authored-list`, `authored-show` and `authored-restore`: their flags, their lines, and the three
 * verbs driven end to end over an in-memory store and an in-memory home — plain fakes passed as seams.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  authoredListLine,
  authoredListRows,
  authoredRestoreLines,
  parseAuthoredListArgs,
  parseAuthoredRestoreArgs,
  parseAuthoredShowArgs,
} from "../../../../cli/commands/store/authoredCore.js";
import { type AuthoredVerbDeps, productionAuthoredVerbDeps } from "../../../../cli/commands/store/authoredDeps.js";
import { memoryRestoreLines } from "../../../../cli/commands/store/authoredMemoryRestore.js";
import {
  runStoreAuthoredList,
  runStoreAuthoredRestore,
  runStoreAuthoredShow,
} from "../../../../cli/commands/store/authoredRun.js";
import { AUTHORED_SHOW_USAGE } from "../../../../cli/commands/store/authoredUsage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { StoredAuthoredVersion } from "../../../../store/fleet/authoredFile.js";
import {
  createAuthoredFile,
  createFileUnderRoot,
  fileSha256,
  writeShownBody,
} from "../../../../store/fleet/authoredWrite.js";
import { claudeProjectsForHome } from "../../../../store/fleet/claudeMemorySync.js";

const HOME = "/h/.slopweaver";
const PROJECTS = "/h/.claude/projects";
const EARLY = new Date("2026-09-01T00:00:00.000Z");
const LATE = new Date("2026-09-02T00:00:00.000Z");

/** The sha-256 of some bytes, as the store keys them. */
function shaOf({ bytes }: { bytes: Buffer }): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A stored version of some text at a path. */
function stored({ relativePath, text, at }: { relativePath: string; text: string; at: Date }): {
  version: StoredAuthoredVersion;
  bytes: Buffer;
} {
  const bytes = Buffer.from(text, "utf8");
  return {
    bytes,
    version: { bodySha256: shaOf({ bytes }), byteLength: bytes.length, fileModifiedAt: at, relativePath },
  };
}

/** An in-memory store and home, plus every line the verb printed. */
function harness({
  rows,
  disk = new Map(),
  store = "open",
  absent = new Set(),
}: {
  rows: readonly { version: StoredAuthoredVersion; bytes: Buffer }[];
  disk?: Map<string, Buffer>;
  store?: "open" | "no-store";
  absent?: ReadonlySet<string>;
}): { deps: AuthoredVerbDeps; out: string[]; diag: string[]; disk: Map<string, Buffer>; closed: string[] } {
  const out: string[] = [];
  const diag: string[] = [];
  const closed: string[] = [];
  const bodies = new Map(rows.map((row) => [row.version.bodySha256, row.bytes]));
  const deps: AuthoredVerbDeps = {
    claudeProjectsFor: ({ home }) => {
      if (home !== HOME) {
        return undefined;
      }
      return PROJECTS;
    },
    createUnderRoot: ({ path, bytes }) => {
      if (disk.has(path)) {
        return ok("exists" as const);
      }
      disk.set(path, Buffer.from(bytes));
      return ok("created" as const);
    },
    defaultHome: () => HOME,
    fileSha256: ({ path }) => {
      const bytes = disk.get(path);
      if (bytes === undefined) {
        return undefined;
      }
      return shaOf({ bytes });
    },
    openStore: () => {
      if (store === "no-store") {
        return Promise.resolve(ok({ kind: "no-store" as const }));
      }
      return Promise.resolve(
        ok({
          kind: "open" as const,
          session: {
            absent: () => Promise.resolve(ok(absent)),
            body: ({ bodySha256 }) => Promise.resolve(ok(bodies.get(bodySha256))),
            close: () => {
              closed.push("closed");
              return Promise.resolve();
            },
            versions: ({ directory, relativePath }) =>
              Promise.resolve(
                ok(
                  rows
                    .map((row) => row.version)
                    .filter((version) => directory === undefined || version.relativePath.startsWith(`${directory}/`))
                    .filter((version) => relativePath === undefined || version.relativePath === relativePath),
                ),
              ),
          },
        }),
      );
    },
    writeDiagnostic: (line) => {
      diag.push(line);
    },
    createFile: ({ path, bytes }) => {
      if (disk.has(path)) {
        throw new Error(`EEXIST: ${path}`);
      }
      disk.set(path, bytes);
    },
    writeFile: ({ path, bytes }) => {
      disk.set(path, bytes);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { closed, deps, diag, disk, out };
}

describe("the authored verbs' parsers", () => {
  it("reads each verb's flags", () => {
    expect(unwrap(parseAuthoredListArgs({ rest: ["--directory", "briefs", "--json"] }))).toEqual({
      directory: "briefs",
      home: undefined,
      json: true,
    });
    expect(unwrap(parseAuthoredShowArgs({ rest: ["--ref", "briefs/a.md", "--out", "/o"] }))).toEqual({
      home: undefined,
      out: "/o",
      ref: "briefs/a.md",
    });
    expect(unwrap(parseAuthoredRestoreArgs({ rest: ["--dry-run", "--home", "/x"] }))).toEqual({
      directory: undefined,
      dryRun: true,
      home: "/x",
      json: false,
    });
  });

  it("refuses a flag the verb does not take", () => {
    expect(unwrapErr(parseAuthoredListArgs({ rest: ["--all"] })).join("\n")).toContain("--all");
  });
});

describe("authoredListRows and authoredListLine", () => {
  it("counts every stored version per path, and prints one tab-separated line each", () => {
    const first = stored({ at: EARLY, relativePath: "briefs/a.md", text: "one" }).version;
    const second = stored({ at: LATE, relativePath: "briefs/a.md", text: "two!" }).version;

    const rows = authoredListRows({ all: [first, second], newest: [second] });

    expect(rows).toEqual([
      { byteLength: 4, fileModifiedAtIso: LATE.toISOString(), relativePath: "briefs/a.md", versions: 2 },
    ]);
    expect(authoredListLine({ row: rows[0]! })).toBe(`briefs/a.md\t4\t${LATE.toISOString()}\t2`);
  });
});

describe("authoredRestoreLines", () => {
  it("summarises the plan, then names each failure and each differing path up to the cap", () => {
    const a = stored({ at: EARLY, relativePath: "briefs/a.md", text: "a" }).version;
    const b = stored({ at: EARLY, relativePath: "briefs/b.md", text: "b" }).version;
    const c = stored({ at: EARLY, relativePath: "briefs/c.md", text: "c" }).version;

    const lines = authoredRestoreLines({
      absent: 3,
      differsCap: 1,
      dryRun: false,
      failed: [{ relativePath: "briefs/a.md", why: "disk full" }],
      plan: { differs: [b, c], identical: [], write: [a] },
    });

    expect(lines).toEqual([
      "store authored-restore: wrote 0, 0 already identical, 2 present with other bytes (left alone), 3 deleted since stored (left out), 1 failed",
      "  FAILED briefs/a.md: disk full",
      "  differs briefs/b.md — the home copy was kept; `store authored-show` prints the stored one",
      "  … and 1 more present with other bytes",
    ]);
  });
});

describe("runStoreAuthoredList", () => {
  it("lists the newest version at each path from the store", async () => {
    const early = stored({ at: EARLY, relativePath: "briefs/a.md", text: "one" });
    const late = stored({ at: LATE, relativePath: "briefs/a.md", text: "two" });
    const { deps, out, closed } = harness({ rows: [early, late] });

    const code = await runStoreAuthoredList({ deps, rest: [] });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([`briefs/a.md\t3\t${LATE.toISOString()}\t2`]);
    expect(closed).toEqual(["closed"]);
  });

  it("says a home with no store has nothing to read, rather than reading the disk", async () => {
    const { deps, diag } = harness({ rows: [], store: "no-store" });

    const code = await runStoreAuthoredList({ deps, rest: [] });

    expect(code).toBe(EXIT_ERROR);
    expect(diag).toEqual([
      `store authored-list: ${HOME} selects no store, so there is nothing to read — this verb never reads the disk copy`,
    ]);
  });
});

describe("runStoreAuthoredShow", () => {
  it("prints the newest stored text, from the store even when the home has no copy", async () => {
    const early = stored({ at: EARLY, relativePath: "briefs/a.md", text: "old\n" });
    const late = stored({ at: LATE, relativePath: "briefs/a.md", text: "new\n" });
    const { deps, out } = harness({ rows: [early, late] });

    const code = await runStoreAuthoredShow({ deps, rest: ["--ref", `${HOME}/briefs/a.md`] });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual(["new"]);
  });

  it("refuses a missing --ref as usage", async () => {
    const { deps, diag } = harness({ rows: [] });

    expect(await runStoreAuthoredShow({ deps, rest: [] })).toBe(EXIT_USAGE);
    expect(diag.at(-1)).toBe(AUTHORED_SHOW_USAGE);
  });

  it("says the store holds nothing at a path it never received, naming the import", async () => {
    const { deps, diag } = harness({ rows: [] });

    const code = await runStoreAuthoredShow({ deps, rest: ["--ref", "briefs/none.md"] });

    expect(code).toBe(EXIT_ERROR);
    expect(diag).toEqual([
      "store authored-show: the store holds nothing at briefs/none.md — run `slopweaver store import-fleet --only authored` while the file exists",
    ]);
  });

  it("refuses to print a binary body, and writes its exact bytes with --out", async () => {
    const bytes = Buffer.from([0, 1, 2, 255]);
    const row = {
      bytes,
      version: { bodySha256: shaOf({ bytes }), byteLength: 4, fileModifiedAt: EARLY, relativePath: "shots/a.png" },
    };
    const printed = harness({ rows: [row] });
    const written = harness({ rows: [row] });

    expect(await runStoreAuthoredShow({ deps: printed.deps, rest: ["--ref", "shots/a.png"] })).toBe(EXIT_ERROR);
    expect(
      await runStoreAuthoredShow({ deps: written.deps, rest: ["--ref", "shots/a.png", "--out", "/o/a.png"] }),
    ).toBe(EXIT_OK);
    expect(written.disk.get("/o/a.png")).toEqual(bytes);
  });
});

describe("runStoreAuthoredRestore", () => {
  it("writes an absent file, leaves an identical one, and never overwrites one with other bytes", async () => {
    const absent = stored({ at: LATE, relativePath: "briefs/absent.md", text: "back" });
    const same = stored({ at: LATE, relativePath: "briefs/same.md", text: "same" });
    const changed = stored({ at: LATE, relativePath: "briefs/changed.md", text: "stored" });
    const disk = new Map([
      [join(HOME, "briefs", "same.md"), Buffer.from("same")],
      [join(HOME, "briefs", "changed.md"), Buffer.from("edited since")],
    ]);
    const run = harness({ disk, rows: [absent, same, changed] });

    const code = await runStoreAuthoredRestore({ deps: run.deps, rest: [] });

    expect(code).toBe(EXIT_OK);
    expect(run.disk.get(join(HOME, "briefs", "absent.md"))!.toString("utf8")).toBe("back");
    expect(run.disk.get(join(HOME, "briefs", "changed.md"))!.toString("utf8")).toBe("edited since");
    expect(run.diag[0]).toBe(
      "store authored-restore: wrote 1, 1 already identical, 1 present with other bytes (left alone), 0 deleted since stored (left out), 0 failed",
    );
  });

  it("writes nothing on a dry run", async () => {
    const absent = stored({ at: LATE, relativePath: "briefs/absent.md", text: "back" });
    const run = harness({ rows: [absent] });

    const code = await runStoreAuthoredRestore({ deps: run.deps, rest: ["--dry-run"] });

    expect(code).toBe(EXIT_OK);
    expect(run.disk.size).toBe(0);
    expect(run.diag[0]).toBe(
      "store authored-restore: would write 1, 0 already identical, 0 present with other bytes (left alone), 0 deleted since stored (left out), 0 failed",
    );
  });

  it("never writes back a path the last import found deleted", async () => {
    const kept = stored({ at: LATE, relativePath: "briefs/kept.md", text: "kept" });
    const deleted = stored({ at: LATE, relativePath: "live/recipe/definitions/resync-atlas-x.json", text: "{}" });
    const run = harness({ absent: new Set([deleted.version.relativePath]), rows: [kept, deleted] });

    const code = await runStoreAuthoredRestore({ deps: run.deps, rest: [] });

    expect(code).toBe(EXIT_OK);
    expect([...run.disk.keys()]).toEqual([join(HOME, "briefs", "kept.md")]);
    expect(run.diag[0]).toBe(
      "store authored-restore: wrote 1, 0 already identical, 0 present with other bytes (left alone), 1 deleted since stored (left out), 0 failed",
    );
  });

  it("never writes a stored path this build does not classify authored", async () => {
    const foreign = stored({ at: LATE, relativePath: "secrets/token", text: "x" });
    const run = harness({ rows: [foreign] });

    await runStoreAuthoredRestore({ deps: run.deps, rest: [] });

    expect(run.disk.size).toBe(0);
  });
});

describe("runStoreAuthoredRestore, Claude auto-memory", () => {
  const project = "-h-dev-repo";
  const mirrored = stored({ at: LATE, relativePath: `claude-memory/${project}/MEMORY.md`, text: "- [a](a.md)\n" });
  const leaf = stored({ at: LATE, relativePath: `claude-memory/${project}/a.md`, text: "a fact\n" });
  const corpus = join(PROJECTS, project, "memory");

  it("writes the mirror back into the corpus, never over a file already there", async () => {
    const disk = new Map([[join(corpus, "a.md"), Buffer.from("written since")]]);
    const run = harness({ disk, rows: [mirrored, leaf] });

    const code = await runStoreAuthoredRestore({ deps: run.deps, rest: [] });

    expect(code).toBe(EXIT_OK);
    expect(run.disk.get(join(HOME, "claude-memory", project, "MEMORY.md"))!.toString("utf8")).toBe("- [a](a.md)\n");
    expect(run.disk.get(join(corpus, "MEMORY.md"))!.toString("utf8")).toBe("- [a](a.md)\n");
    expect(run.disk.get(join(corpus, "a.md"))!.toString("utf8")).toBe("written since");
    expect(run.diag.slice(1)).toEqual([
      `store authored-restore: Claude auto-memory into ${PROJECTS}: wrote 1, 0 already identical, 1 present with other bytes (left alone), 0 failed`,
      `  DIFFERS claude-memory/${project}/a.md: a memory of that name with other bytes is already in ~/.claude and ` +
        `was kept — merge the old one from the home's claude-memory/${project}/a.md, which the next nightly import keeps in its attic`,
    ]);
  });

  it("names a fresh index already in the corpus, which leaves the restored memories unlisted", async () => {
    const disk = new Map([[join(corpus, "MEMORY.md"), Buffer.from("fresh\n")]]);
    const run = harness({ disk, rows: [mirrored, leaf] });

    const code = await runStoreAuthoredRestore({ deps: run.deps, rest: [] });

    expect(code).toBe(EXIT_OK);
    expect(run.disk.get(join(corpus, "MEMORY.md"))!.toString("utf8")).toBe("fresh\n");
    expect(run.disk.get(join(corpus, "a.md"))!.toString("utf8")).toBe("a fact\n");
    expect(run.diag.slice(1)).toEqual([
      `store authored-restore: Claude auto-memory into ${PROJECTS}: wrote 1, 0 already identical, 1 present with other bytes (left alone), 0 failed`,
      `  INDEX claude-memory/${project}/MEMORY.md: a different MEMORY.md is already in ~/.claude, so the restored ` +
        `memories are not listed in it — merge the old one from the home's claude-memory/${project}/MEMORY.md` +
        `, which the next nightly import keeps in its attic`,
    ]);
  });

  it("writes nothing into the corpus on a dry run", async () => {
    const run = harness({ rows: [mirrored] });

    const code = await runStoreAuthoredRestore({ deps: run.deps, rest: ["--dry-run"] });

    expect(code).toBe(EXIT_OK);
    expect(run.disk.size).toBe(0);
    expect(run.diag[1]).toBe(
      `store authored-restore: Claude auto-memory into ${PROJECTS}: would write 1, 0 already identical, 0 present with other bytes (left alone), 0 failed`,
    );
  });

  it("never writes into Claude Code's projects for a --home that is not the default", async () => {
    const run = harness({ rows: [mirrored] });

    const code = await runStoreAuthoredRestore({ deps: run.deps, rest: ["--home", "/tmp/rehearse"] });

    expect(code).toBe(EXIT_OK);
    expect([...run.disk.keys()]).toEqual([join("/tmp/rehearse", "claude-memory", project, "MEMORY.md")]);
    expect(run.diag[1]).toBe(
      "store authored-restore: Claude auto-memory not written back — this home is not ~/.slopweaver, so ~/.claude is not its own",
    );
  });
});

describe("memoryRestoreLines", () => {
  it("says why nothing was written back for a home that does not own ~/.claude", () => {
    expect(memoryRestoreLines({ dryRun: false, memory: undefined })).toEqual([
      "store authored-restore: Claude auto-memory not written back — this home is not ~/.slopweaver, so ~/.claude is not its own",
    ]);
  });

  it("counts only the writes that succeeded, and names each failure", () => {
    const one = stored({ at: LATE, relativePath: "claude-memory/p/a.md", text: "a\n" }).version;
    const lines = memoryRestoreLines({
      dryRun: false,
      memory: {
        failed: [{ relativePath: "claude-memory/p/a.md", why: "the store would not return its body" }],
        plan: { differs: [], identical: [], write: [one] },
        projectsDir: PROJECTS,
      },
    });

    expect(lines).toEqual([
      `store authored-restore: Claude auto-memory into ${PROJECTS}: wrote 0, 0 already identical, 0 present with other bytes (left alone), 1 failed`,
      "  FAILED claude-memory/p/a.md: the store would not return its body",
    ]);
  });
});

describe("productionAuthoredVerbDeps", () => {
  it("writes through the one sanctioned filesystem module, and nothing of its own", () => {
    const deps = productionAuthoredVerbDeps();

    expect(deps.createFile).toBe(createAuthoredFile);
    expect(deps.createUnderRoot).toBe(createFileUnderRoot);
    expect(deps.claudeProjectsFor).toBe(claudeProjectsForHome);
    expect(deps.writeFile).toBe(writeShownBody);
    expect(deps.fileSha256).toBe(fileSha256);
  });
});
