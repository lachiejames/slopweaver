/**
 * `profile harvest` end to end over a real tree, up to but not past the point it would write.
 *
 * The disposition manifest's whole value is that it REFUSES when the tree has moved — an entry judged weeks
 * ago is a claim about a file, and a file that changed since is content nobody read. So the cases here build
 * an actual directory, hash it, and then vary one byte: the dry run over a matching tree exits zero and the
 * same manifest over a changed one is refused. A fixture whose hashes were typed rather than computed would
 * prove neither half.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runProfileHarvest } from "../../../../../cli/commands/profile/harvestRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** `argv` as the CLI hands it over. */
function argvFor({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "profile", "harvest", ...tail];
}

let dir = "";

/** The archived unit the manifest describes. */
let root = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slopweaver-profile-harvest-"));
  root = join(dir, "unit");
  mkdirSync(join(root, "archive"), { recursive: true });
  writeFileSync(join(root, "archive", "note.md"), "one kept file\n", "utf8");
  writeFileSync(join(root, "archive", "old.md"), "one dropped file\n", "utf8");
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** The sha256 of one file under the fixture root, read off disk exactly as the verb reads it. */
function hashOf({ path }: { path: string }): string {
  return createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex");
}

/** Write a manifest covering the fixture, and return its path. */
function writeManifest({ entries }: { entries: readonly Record<string, unknown>[] }): string {
  const path = join(dir, `manifest-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify({ covers: ["archive"], entries, root, schemaVersion: 1 }), "utf8");
  return path;
}

/** Both fixture files, judged truthfully against what is on disk. */
function matchingEntries(): readonly Record<string, unknown>[] {
  return [
    {
      disposition: "harvest",
      path: "archive/note.md",
      reason: "still describes how the thing works",
      sha256: hashOf({ path: "archive/note.md" }),
    },
    {
      disposition: "drop",
      path: "archive/old.md",
      reason: "superseded and contradicts current doctrine",
      sha256: hashOf({ path: "archive/old.md" }),
    },
  ];
}

describe("profile harvest", () => {
  it("prints its usage on --help", async () => {
    expect(await runProfileHarvest(argvFor({ tail: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses an invocation with no --manifest", async () => {
    expect(await runProfileHarvest(argvFor({ tail: [] }))).toBe(EXIT_USAGE);
  });

  it("refuses a manifest file that is not there, naming the path", async () => {
    expect(await runProfileHarvest(argvFor({ tail: ["--manifest", join(dir, "absent.json")] }))).toBe(EXIT_USAGE);
  });

  it("refuses a manifest at another schema version rather than reinterpreting it", async () => {
    const path = join(dir, "v9.json");
    writeFileSync(path, JSON.stringify({ covers: ["archive"], entries: [], root, schemaVersion: 9 }), "utf8");
    expect(await runProfileHarvest(argvFor({ tail: ["--manifest", path] }))).toBe(EXIT_USAGE);
  });

  it("plans without writing when every entry matches the tree", async () => {
    const path = writeManifest({ entries: matchingEntries() });
    expect(await runProfileHarvest(argvFor({ tail: ["--manifest", path] }))).toBe(EXIT_OK);
  });

  it("refuses when a judged file has changed since it was judged", async () => {
    const path = writeManifest({ entries: matchingEntries() });
    writeFileSync(join(root, "archive", "note.md"), "edited after the judgement\n", "utf8");
    expect(await runProfileHarvest(argvFor({ tail: ["--manifest", path] }))).toBe(EXIT_USAGE);
  });

  it("refuses when a covered file is judged by no entry at all", async () => {
    const path = writeManifest({ entries: [matchingEntries()[0]!] });
    expect(await runProfileHarvest(argvFor({ tail: ["--manifest", path] }))).toBe(EXIT_USAGE);
  });
});
