/**
 * `slopweaver protect` over plain fakes: an in-memory registry file, a fixed clock and directory, a lock that records
 * its release — so every verb's exit code, output and write is asserted with no filesystem.
 */
import { describe, expect, it } from "vitest";
import {
  absoluteProtectedPath,
  type ProtectDeps,
  runProtectWithDeps,
} from "../../../../../cli/commands/protect/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { parseProtectedPaths } from "../../../../../protectedPaths/registry.js";

const HOME = "/Users/example/.slopweaver";
const FILE = `${HOME}/protected-paths.json`;
const NOW = "2026-03-03T00:00:00.000Z";
const KEPT = "/Users/example/protected-state";

/** What a fake run leaves behind. */
interface Harness {
  readonly deps: ProtectDeps;
  readonly files: Map<string, string>;
  readonly out: string[];
  readonly errors: string[];
  readonly releases: string[];
}

/** Fakes over an in-memory file map, with the given environment and optional lock failure. */
function harness({
  env = {},
  lockFails = false,
  initial,
}: {
  env?: Record<string, string>;
  lockFails?: boolean;
  initial?: string;
}): Harness {
  const files = new Map<string, string>();
  if (initial !== undefined) {
    files.set(FILE, initial);
  }
  const out: string[] = [];
  const errors: string[] = [];
  const releases: string[] = [];
  const deps: ProtectDeps = {
    cwd: () => "/Users/example/work",
    env,
    home: () => HOME,
    lock: ({ home }) => {
      if (lockFails) {
        return `the operation lock in ${home} is held`;
      }
      return () => {
        releases.push(home);
      };
    },
    logger: {
      error: ({ msg }) => {
        errors.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    nowIso: () => NOW,
    readText: ({ path }) => files.get(path),
    removeFile: ({ path }) => {
      files.delete(path);
    },
    userHome: "/Users/example",
    writeText: ({ path, text }) => {
      files.set(path, text);
    },
  };
  return { deps, errors, files, out, releases };
}

/** Run one `protect` invocation. */
function run({ words, h }: { words: readonly string[]; h: Harness }): number {
  return runProtectWithDeps({ argv: ["node", "slopweaver", "protect", ...words], deps: h.deps });
}

/** The registry the fake file holds now. */
function written({ h }: { h: Harness }): readonly { path: string; mode: string }[] {
  return unwrap(parseProtectedPaths({ file: FILE, text: h.files.get(FILE)! })).paths.map(({ path, mode }) => ({
    mode,
    path,
  }));
}

describe("protect add", () => {
  it("writes a new entry under the lock and releases it", () => {
    const h = harness({});
    expect(run({ h, words: ["add", KEPT, "--mode", "no-access", "--why", "the old store"] })).toBe(EXIT_OK);
    expect(written({ h })).toEqual([{ mode: "no-access", path: KEPT }]);
    expect(h.out).toEqual([`protect: added ${KEPT}`]);
    expect(h.releases).toEqual([HOME]);
  });

  it("expands ~ and resolves a relative path before storing it", () => {
    const h = harness({});
    expect(run({ h, words: ["add", "~/protected-state", "--mode", "read-only", "--why", "x"] })).toBe(EXIT_OK);
    expect(run({ h, words: ["add", "notes", "--mode", "read-only", "--why", "x"] })).toBe(EXIT_OK);
    expect(written({ h }).map(({ path }) => path)).toEqual([KEPT, "/Users/example/work/notes"]);
  });

  it("refuses a missing or unknown mode as usage", () => {
    const h = harness({});
    expect(run({ h, words: ["add", KEPT, "--mode", "hidden", "--why", "x"] })).toBe(EXIT_USAGE);
    expect(h.errors[0]).toContain("--mode must be one of read-only, no-access");
    expect(h.files.has(FILE)).toBe(false);
  });

  it("refuses an add with no reason, since every refusal prints it", () => {
    const h = harness({});
    expect(run({ h, words: ["add", KEPT, "--mode", "read-only"] })).toBe(EXIT_USAGE);
    expect(h.errors[0]).toContain("--why is required");
  });

  it("never overwrites a registry it cannot parse", () => {
    const h = harness({ initial: "{ not json" });
    expect(run({ h, words: ["add", KEPT, "--mode", "read-only", "--why", "x"] })).toBe(EXIT_ERROR);
    expect(h.files.get(FILE)).toBe("{ not json");
    expect(h.releases).toEqual([HOME]);
  });

  it("reports a held lock and touches nothing", () => {
    const h = harness({ lockFails: true });
    expect(run({ h, words: ["add", KEPT, "--mode", "read-only", "--why", "x"] })).toBe(EXIT_ERROR);
    expect(h.errors).toEqual([`protect: the operation lock in ${HOME} is held`]);
    expect(h.files.has(FILE)).toBe(false);
  });
});

describe("protect remove", () => {
  it("refuses with the protect-remove hatch closed, naming it, and leaves the entry", () => {
    const h = harness({});
    run({ h, words: ["add", KEPT, "--mode", "read-only", "--why", "x"] });
    expect(run({ h, words: ["remove", KEPT] })).toBe(EXIT_ERROR);
    expect(h.errors[0]).toContain("SLOPWEAVER_ALLOW_PROTECT_REMOVE=1");
    expect(written({ h })).toEqual([{ mode: "read-only", path: KEPT }]);
  });

  it("removes one entry with the hatch open, keeping the rest", () => {
    const h = harness({ env: { SLOPWEAVER_ALLOW_PROTECT_REMOVE: "1" } });
    run({ h, words: ["add", KEPT, "--mode", "read-only", "--why", "x"] });
    run({ h, words: ["add", "/Users/example/other", "--mode", "read-only", "--why", "x"] });
    expect(run({ h, words: ["remove", KEPT] })).toBe(EXIT_OK);
    expect(written({ h })).toEqual([{ mode: "read-only", path: "/Users/example/other" }]);
  });

  // The read-side hook row starts no Node process while no registry file exists, so the last removal deletes it.
  it("deletes the registry file when its last entry is removed", () => {
    const h = harness({ env: { SLOPWEAVER_ALLOW_PROTECT_REMOVE: "1" } });
    run({ h, words: ["add", KEPT, "--mode", "read-only", "--why", "x"] });
    expect(h.files.has(FILE)).toBe(true);
    expect(run({ h, words: ["remove", KEPT] })).toBe(EXIT_OK);
    expect(h.files.has(FILE)).toBe(false);
  });
});

describe("protect list and check", () => {
  it("says nothing is protected over an absent registry", () => {
    const h = harness({});
    expect(run({ h, words: ["list"] })).toBe(EXIT_OK);
    expect(h.out).toEqual([`protect: nothing is protected (${FILE} is absent or empty)`]);
  });

  it("checks a read and a write of a read-only path", () => {
    const h = harness({});
    run({ h, words: ["add", KEPT, "--mode", "read-only", "--why", "the old store"] });
    expect(run({ h, words: ["check", `${KEPT}/a.json`] })).toBe(EXIT_OK);
    expect(run({ h, words: ["check", `${KEPT}/a.json`, "--write"] })).toBe(EXIT_OK);
    expect(h.out.slice(1)).toEqual([
      `protect: a read of ${KEPT}/a.json is allowed`,
      `protect: a write of ${KEPT}/a.json is REFUSED — inside ${KEPT} (read-only): the old store`,
    ]);
  });

  it("refuses an unknown verb and an unknown flag as usage", () => {
    const h = harness({});
    expect(run({ h, words: ["hide", KEPT] })).toBe(EXIT_USAGE);
    expect(run({ h, words: ["list", "--loud"] })).toBe(EXIT_USAGE);
    expect(h.errors[1]).toBe("unknown flag --loud");
  });
});

describe("absoluteProtectedPath", () => {
  it("expands a bare ~ to the user's home", () => {
    expect(absoluteProtectedPath({ cwd: "/x", raw: "~", userHome: "/Users/example" })).toBe("/Users/example");
  });

  it("normalises an absolute path and drops its trailing separator, ignoring the caller's directory", () => {
    expect(absoluteProtectedPath({ cwd: "/x", raw: "/a/b/../c/", userHome: "/u" })).toBe("/a/c");
  });

  it("drops a trailing separator after ~ too", () => {
    expect(absoluteProtectedPath({ cwd: "/x", raw: "~/kept/", userHome: "/u" })).toBe("/u/kept");
  });
});
