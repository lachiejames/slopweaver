/**
 * `handover currency`'s standing read over real files: every memory corpus under a projects directory becomes an
 * entry, the owner-profile read arrives through its seam, and a read that fails is a gap rather than an empty source.
 */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readCurrencyStanding } from "../../../../../cli/commands/handover/currencyStandingRead.js";
import type { OwnerProfileRead } from "../../../../../handover/currencyStandingEntries.js";

const NOW = "2026-10-02T12:00:00.000Z";
const CHANGED = "2026-10-02T10:00:00.000Z";
const LINKED = "2026-10-02T11:00:00.000Z";
const minted: string[] = [];

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "standing-"));
  minted.push(dir);
  return dir;
};

/** A projects directory holding one corpus, `acme`, with one leaf whose file last changed at {@link CHANGED}. */
function projectsWithOneMemory(): string {
  const projectsDir = scratch();
  const memory = join(projectsDir, "acme", "memory");
  mkdirSync(memory, { recursive: true });
  writeFileSync(join(memory, "MEMORY.md"), "- [jq](jq.md) — no jq\n");
  const leaf = join(memory, "jq.md");
  writeFileSync(leaf, "---\nname: jq\ndescription: no jq, verbs only\n---\n\nbody\n");
  utimesSync(leaf, new Date(CHANGED), new Date(CHANGED));
  return projectsDir;
}

const absent = (): Promise<OwnerProfileRead> => Promise.resolve({ kind: "absent" });

describe("readCurrencyStanding", () => {
  it("reads every corpus under the projects directory, the index never an entry, a backdated mtime never hiding an edit", async () => {
    const writtenMs = Date.now();
    const projectsDir = projectsWithOneMemory();
    // A regular file in the root holds no project, so it is neither an entry nor a gap.
    writeFileSync(join(projectsDir, ".DS_Store"), "");
    const standing = await readCurrencyStanding({
      deps: { projectsDir, readProfile: absent },
      home: scratch(),
      journals: new Map(),
      nowIso: NOW,
    });

    expect(standing.entries.map(({ pointer, source }) => ({ pointer, source }))).toEqual([
      { pointer: "memory:acme/jq.md", source: "memory" },
      { pointer: "memory:acme/", source: "memory" },
    ]);
    // The fixture set its mtime back to CHANGED with `utimes`, which cannot set a ctime: the leaf dates from its write.
    expect(Date.parse(standing.entries[0]!.atIso)).toBeGreaterThanOrEqual(writtenMs - 1000);
    expect(standing.gaps).toEqual([]);
    expect(standing.sources).toEqual({
      memory: "1 memories read across 1 project",
      profile: "no owner profile recorded",
      rulings: "0 rulings read; 0 gates in force across 0 run journals",
    });
  });

  it("names a projects path that cannot be listed, and a profile that would not read, as gaps for every card", async () => {
    const notADirectory = join(scratch(), "file");
    writeFileSync(notADirectory, "");

    const standing = await readCurrencyStanding({
      deps: {
        projectsDir: notADirectory,
        readProfile: () => Promise.resolve({ kind: "unavailable", why: "ECONNREFUSED" }),
      },
      home: scratch(),
      journals: new Map(),
      nowIso: NOW,
    });

    expect(standing.entries).toEqual([]);
    expect(standing.gaps.length).toBe(2);
    expect(standing.gaps[0]!.why).toContain("your memories could not be listed");
    expect(standing.gaps[1]!.why).toBe("your owner profile could not be read: ECONNREFUSED");
  });

  it("follows a linked leaf and names a link that will not follow as a gap", async () => {
    const projectsDir = projectsWithOneMemory();
    const memory = join(projectsDir, "acme", "memory");
    const target = join(scratch(), "shared.md");
    writeFileSync(target, "---\nname: shared\ndescription: a linked rule\n---\n\nbody\n");
    utimesSync(target, new Date(LINKED), new Date(LINKED));
    symlinkSync(target, join(memory, "shared.md"));
    symlinkSync(join(scratch(), "gone.md"), join(memory, "gone.md"));
    mkdirSync(join(memory, "folder.md"));
    symlinkSync("/dev/null", join(memory, "device.md"));

    const standing = await readCurrencyStanding({
      deps: { projectsDir, readProfile: absent },
      home: scratch(),
      journals: new Map(),
      nowIso: NOW,
    });

    expect(standing.entries.map(({ pointer }) => pointer)).toEqual([
      "memory:acme/jq.md",
      "memory:acme/shared.md",
      "memory:acme/",
    ]);
    expect(standing.gaps.map((gap) => gap.why)).toEqual([
      "one of your memory folders would not read: device.md links to something that is not a file, so the memory it names cannot be read",
      "one of your memory folders would not read: folder.md is not a file, so the memory it names cannot be read",
      `one of your memory folders would not read: gone.md is a link that would not read: ENOENT: no such file or directory, stat '${join(memory, "gone.md")}'`,
    ]);
  });

  it("reads a linked project, and names every link that will not resolve as a gap, never as absence", async () => {
    const projectsDir = scratch();
    symlinkSync(join(projectsWithOneMemory(), "acme"), join(projectsDir, "linked"));
    mkdirSync(join(projectsDir, "dangling-memory"));
    symlinkSync(join(scratch(), "gone"), join(projectsDir, "dangling-memory", "memory"));
    symlinkSync(join(scratch(), "gone"), join(projectsDir, "dangling-project"));
    const danglingRoot = join(scratch(), "projects");
    symlinkSync(join(scratch(), "gone"), danglingRoot);
    // `~/.claude` itself dangling: the projects root is not there because a link above it points nowhere.
    const danglingAncestor = join(scratch(), "claude");
    symlinkSync(join(scratch(), "gone"), danglingAncestor);
    const home = scratch();
    symlinkSync(join(scratch(), "gone"), join(home, "runs"));

    const linked = await readCurrencyStanding({
      deps: { projectsDir, readProfile: absent },
      home,
      journals: new Map(),
      nowIso: NOW,
    });
    const root = await readCurrencyStanding({
      deps: { projectsDir: danglingRoot, readProfile: absent },
      home: scratch(),
      journals: new Map(),
      nowIso: NOW,
    });
    const ancestor = await readCurrencyStanding({
      deps: { projectsDir: join(danglingAncestor, "projects"), readProfile: absent },
      home: scratch(),
      journals: new Map(),
      nowIso: NOW,
    });

    expect(linked.entries.map(({ pointer }) => pointer)).toEqual(["memory:linked/jq.md", "memory:linked/"]);
    expect(linked.gaps.map((gap) => gap.why.split(":")[0])).toEqual([
      "one of your memory folders would not read",
      "one of your memory folders would not read",
      "your run journals could not be listed, so a ruling gate may be missed",
    ]);
    expect(root.gaps.map((gap) => gap.why.split(":")[0])).toEqual(["your memories could not be listed"]);
    expect(ancestor.gaps.map((gap) => gap.why.split(":")[0])).toEqual(["your memories could not be listed"]);
  });

  it("dates a leaf linked, a project linked or the projects root linked after its target was written from the link, never the older target", async () => {
    const source = projectsWithOneMemory();
    const target = join(scratch(), "old.md");
    writeFileSync(target, "---\nname: old\ndescription: an old rule\n---\n\nbody\n");
    // A synchronous 5ms pause, so the links below change strictly after every target did.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    const leafLink = join(source, "acme", "memory", "live.md");
    symlinkSync(target, leafLink);
    const projectsDir = scratch();
    const projectLink = join(projectsDir, "moved");
    symlinkSync(join(source, "acme"), projectLink);
    const rootLink = join(scratch(), "projects");
    symlinkSync(source, rootLink);

    const read = ({ dir }: { dir: string }): ReturnType<typeof readCurrencyStanding> =>
      readCurrencyStanding({
        deps: { projectsDir: dir, readProfile: absent },
        home: scratch(),
        journals: new Map(),
        nowIso: NOW,
      });
    const standing = await read({ dir: projectsDir });
    const rooted = await read({ dir: rootLink });

    const atOf = ({ pointer, from = standing }: { pointer: string; from?: typeof standing }): number =>
      Date.parse(from.entries.find((entry) => entry.pointer === pointer)!.atIso);
    expect(atOf({ pointer: "memory:moved/jq.md" })).toBe(Math.floor(lstatSync(projectLink).ctimeMs) + 1);
    expect(atOf({ pointer: "memory:moved/live.md" })).toBeGreaterThan(statSync(target).ctimeMs);
    expect(atOf({ from: rooted, pointer: "memory:acme/jq.md" })).toBe(Math.floor(lstatSync(rootLink).ctimeMs) + 1);
    expect(standing.gaps).toEqual([]);
  });

  it("dates the memory folder past a floor taken before one of its memories was deleted", async () => {
    const projectsDir = projectsWithOneMemory();
    const memory = join(projectsDir, "acme", "memory");
    // Backdate the folder, so only the deletion below can move its time past the floor.
    utimesSync(memory, new Date(CHANGED), new Date(CHANGED));
    const floorMs = Math.max(statSync(memory).ctimeMs, Date.now());
    // A synchronous 5ms pause, so the deletion lands strictly after the floor.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    rmSync(join(memory, "jq.md"));

    const standing = await readCurrencyStanding({
      deps: { projectsDir, readProfile: absent },
      home: scratch(),
      journals: new Map(),
      nowIso: NOW,
    });

    expect(standing.entries.map(({ pointer }) => pointer)).toEqual(["memory:acme/"]);
    expect(Date.parse(standing.entries[0]!.atIso)).toBeGreaterThan(floorMs);
    expect(standing.gaps).toEqual([]);
  });

  it("names a memory folder whose index is not a file as a gap, never as an empty corpus", async () => {
    const projectsDir = scratch();
    mkdirSync(join(projectsDir, "acme", "memory", "MEMORY.md"), { recursive: true });
    mkdirSync(join(projectsDir, "flat"));
    writeFileSync(join(projectsDir, "flat", "memory"), "");

    const standing = await readCurrencyStanding({
      deps: { projectsDir, readProfile: absent },
      home: scratch(),
      journals: new Map(),
      nowIso: NOW,
    });

    expect(standing.gaps.map((gap) => gap.why)).toEqual([
      `one of your memory folders would not read: ${join(projectsDir, "acme", "memory", "MEMORY.md")} is not a file, so the corpus it indexes cannot be read`,
      `one of your memory folders would not read: ENOTDIR: not a directory, stat '${join(projectsDir, "flat", "memory", "MEMORY.md")}'`,
    ]);
  });

  it("names a socket standing where a project belongs as a gap, skipping only a regular file in the projects root", async () => {
    const projectsDir = scratch();
    writeFileSync(join(projectsDir, ".DS_Store"), "");
    const socket = join(projectsDir, "acme");
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(socket, resolve));

    const standing = await readCurrencyStanding({
      deps: { projectsDir, readProfile: absent },
      home: scratch(),
      journals: new Map(),
      nowIso: NOW,
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(standing.gaps.map((gap) => gap.why)).toEqual([
      `one of your memory folders would not read: ENOTDIR: not a directory, stat '${join(socket, "memory", "MEMORY.md")}'`,
    ]);
  });

  it("names a memory folder that cannot be searched as a gap, never as a project with no memories", async () => {
    const projectsDir = projectsWithOneMemory();
    const project = join(projectsDir, "acme");
    chmodSync(project, 0o000);
    try {
      const standing = await readCurrencyStanding({
        deps: { projectsDir, readProfile: absent },
        home: scratch(),
        journals: new Map(),
        nowIso: NOW,
      });

      expect(standing.entries).toEqual([]);
      expect(standing.gaps.map((gap) => gap.why)).toEqual([
        `one of your memory folders would not read: EACCES: permission denied, stat '${join(project, "memory", "MEMORY.md")}'`,
      ]);
    } finally {
      chmodSync(project, 0o755);
    }
  });
});
