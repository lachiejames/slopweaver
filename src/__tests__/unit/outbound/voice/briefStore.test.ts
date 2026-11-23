import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { loadVoiceRuleBrief, readWasWhole, sameStamp } from "../../../../outbound/voice/briefStore.js";
import { PROFILE_SCHEMA_VERSION } from "../../../../profile.js";

/** Every temp home this file minted, removed in `afterEach` so one test's fixtures never outlive it. */
const homes: string[] = [];

/** Mint a throwaway Slopweaver home. */
function mintHome(): string {
  const home = mkdtempSync(join(tmpdir(), "brief-store-"));
  homes.push(home);
  return home;
}

/** Write a `profile.json` carrying the given `slackMe.voice` block into `home`. */
function writeProfile({ home, voice }: { home: string; voice: Record<string, unknown> }): void {
  writeFileSync(
    join(home, "profile.json"),
    JSON.stringify({
      displayName: "Fixture",
      gitNamespace: "",
      id: "fixture",
      schemaVersion: PROFILE_SCHEMA_VERSION,
      slackMe: { voice },
      sources: [],
    }),
    "utf8",
  );
}

/** A well-formed response-shape memory, with neutral fixture prose. */
const SHAPE_MEMORY = [
  "---",
  "name: fixture-response-shape",
  "description: how a fixture reply should read",
  "metadata:",
  "  type: feedback",
  "---",
  "",
  "Lead with the outcome.",
  "",
].join("\n");

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("loadVoiceRuleBrief", () => {
  it("treats a home with no profile at all as a configured-nothing success", () => {
    const result = loadVoiceRuleBrief({ home: mintHome() });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({ paragraphSpacing: false, rules: [], shape: null });
  });

  it("reads the exact rules and spacing flag when no shape file is configured", () => {
    const home = mintHome();
    writeProfile({ home, voice: { exact: [{ kind: "word", value: "delve" }], paragraphSpacing: true } });

    const result = loadVoiceRuleBrief({ home });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      paragraphSpacing: true,
      rules: [{ kind: "word", value: "delve" }],
      shape: null,
    });
  });

  it("reads the configured shape memory's body alongside the rules", () => {
    const home = mintHome();
    const shapeFile = join(home, "response-shape.md");
    writeFileSync(shapeFile, SHAPE_MEMORY, "utf8");
    writeProfile({ home, voice: { exact: [], paragraphSpacing: false, shapeMemoryFile: shapeFile } });

    const result = loadVoiceRuleBrief({ home });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).shape).toBe("Lead with the outcome.");
  });

  it("picks up an edited shape memory on the next read rather than a cached body", () => {
    const home = mintHome();
    const shapeFile = join(home, "response-shape.md");
    writeFileSync(shapeFile, SHAPE_MEMORY, "utf8");
    writeProfile({ home, voice: { exact: [], paragraphSpacing: false, shapeMemoryFile: shapeFile } });
    const before = loadVoiceRuleBrief({ home });
    writeFileSync(shapeFile, SHAPE_MEMORY.replace("Lead with the outcome.", "Cut the how."), "utf8");

    const after = loadVoiceRuleBrief({ home });

    expect(unwrap(before).shape).toBe("Lead with the outcome.");
    expect(unwrap(after).shape).toBe("Cut the how.");
  });

  it("FAILS on a profile that is there but unreadable, which `existsSync` reports as absent", () => {
    // A counterexample: a profile inside a directory with no execute permission
    // answers `existsSync === false`, so a pre-check read a fully configured install as an empty one.
    const parent = mintHome();
    const home = join(parent, "h");
    mkdirSync(home);
    writeProfile({ home, voice: { exact: [{ kind: "word", value: "delve" }], paragraphSpacing: true } });
    chmodSync(home, 0o000);

    const result = loadVoiceRuleBrief({ home });
    chmodSync(home, 0o700);

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("profile.json");
  });

  it("FAILS on a profile.json that is a dangling link, rather than reading the broken install as configured-nothing", () => {
    const home = mintHome();
    symlinkSync(join(home, "gone.json"), join(home, "profile.json"));

    expect(unwrapErr(loadVoiceRuleBrief({ home }))[0]).toContain(
      `the profile at ${join(home, "profile.json")} is there but cannot be trusted`,
    );
  });

  it("FAILS on a profile that exists but is not valid JSON, rather than reporting nothing configured", () => {
    const home = mintHome();
    writeFileSync(join(home, "profile.json"), "{not json", "utf8");

    const result = loadVoiceRuleBrief({ home });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("invalid JSON");
  });

  it("FAILS on a profile whose schema version is wrong", () => {
    const home = mintHome();
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({ displayName: "F", gitNamespace: "", id: "f", schemaVersion: 99, sources: [] }),
      "utf8",
    );

    const result = loadVoiceRuleBrief({ home });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).length).toBeGreaterThan(0);
  });

  it("FAILS when the configured shape file is not there", () => {
    const home = mintHome();
    writeProfile({ home, voice: { exact: [], shapeMemoryFile: join(home, "missing.md") } });

    const result = loadVoiceRuleBrief({ home });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("missing.md");
  });

  // A FIFO would block the read forever; a directory is the special file a test can make, and takes the same check.
  it("FAILS on a shape path that is not a regular file, before reading it", () => {
    const home = mintHome();
    const shapeDir = join(home, "shape-dir");
    mkdirSync(shapeDir);
    writeProfile({ home, voice: { exact: [], shapeMemoryFile: shapeDir } });

    expect(unwrapErr(loadVoiceRuleBrief({ home }))[0]).toContain("is not a regular file");
  });

  it("FAILS when the configured shape file is not a valid memory", () => {
    const home = mintHome();
    const shapeFile = join(home, "response-shape.md");
    writeFileSync(shapeFile, "Just prose, no frontmatter.\n", "utf8");
    writeProfile({ home, voice: { exact: [], shapeMemoryFile: shapeFile } });

    const result = loadVoiceRuleBrief({ home });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual([`${shapeFile}: frontmatter is missing or never closed`]);
  });

  it("FAILS on a shape file that is not valid UTF-8, rather than printing the operator's prose with U+FFFD in it", () => {
    // A second counterexample: readFileSync(path, "utf8") repairs an invalid byte
    // into U+FFFD, so a broken configured source printed as guidance the operator never wrote.
    const home = mintHome();
    const shapeFile = join(home, "response-shape.md");
    writeFileSync(shapeFile, Buffer.concat([Buffer.from(SHAPE_MEMORY, "utf8"), Buffer.from([0x96])]));
    writeProfile({ home, voice: { exact: [], shapeMemoryFile: shapeFile } });

    const result = loadVoiceRuleBrief({ home });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("response-shape.md");
  });

  it("REFUSES a relative shape path at the profile boundary rather than resolving it against the cwd", () => {
    const home = mintHome();
    writeProfile({ home, voice: { exact: [], shapeMemoryFile: "response-shape.md" } });

    const result = loadVoiceRuleBrief({ home });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("absolute");
  });
});

describe("sameStamp", () => {
  const still = { ctimeMs: 3, mtimeMs: 1, size: 2 };

  it("takes a file absent both times, or one that kept its size, mtime and ctime", () => {
    expect(sameStamp({ after: null, before: null })).toBe(true);
    expect(sameStamp({ after: { ...still }, before: still })).toBe(true);
  });

  it("refuses a file that appeared, vanished, or moved size, mtime or ctime", () => {
    expect(sameStamp({ after: still, before: null })).toBe(false);
    expect(sameStamp({ after: null, before: still })).toBe(false);
    expect(sameStamp({ after: { ...still, size: 3 }, before: still })).toBe(false);
    expect(sameStamp({ after: { ...still, mtimeMs: 2 }, before: still })).toBe(false);
    expect(sameStamp({ after: { ...still, ctimeMs: 4 }, before: still })).toBe(false);
  });
});

describe("readWasWhole", () => {
  const still = { ctimeMs: 1_000, mtimeMs: 1_000, size: 12 };

  it("takes a read of every byte with nothing moved", () => {
    expect(readWasWhole({ after: still, before: still, length: 12 })).toBe(true);
  });

  it("refuses a read shorter than the file, a size that moved, an mtime that moved and a ctime that moved", () => {
    expect(readWasWhole({ after: still, before: still, length: 6 })).toBe(false);
    expect(readWasWhole({ after: { ...still, size: 6 }, before: still, length: 12 })).toBe(false);
    expect(readWasWhole({ after: { ...still, mtimeMs: 1_001 }, before: still, length: 12 })).toBe(false);
    expect(readWasWhole({ after: { ...still, ctimeMs: 1_001 }, before: still, length: 12 })).toBe(false);
  });
});
