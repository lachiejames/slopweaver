/**
 * `observeFreeDiskTarget` over a throwaway user home: a package-caches read finds the clearable caches that are
 * there and reports the missing ones absent, reads npm's, Yarn's and every Slopweaver cache child beside them, and
 * a recheck's read (`actedOnly`) reads the clearable four alone, walking each so a file that gained a hard link
 * counts as freeing nothing.
 */
import { linkSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { observeFreeDiskTarget, runDocker } from "../../../../../live/machine/freeDisk/read.js";
import { dockerTrimArgv } from "../../../../../live/machine/freeDisk/registry.js";
import type { FreeDiskObservation, LabelledPath } from "../../../../../live/machine/freeDisk/types.js";

let userHome: string;

beforeEach(() => {
  userHome = mkdtempSync(join(tmpdir(), "free-disk-home-"));
  const caches = join(userHome, "Library", "Caches");
  for (const dir of ["pip", "pnpm", join("slopweaver", "exec-store"), join("slopweaver", "console")]) {
    mkdirSync(join(caches, dir), { recursive: true });
    writeFileSync(join(caches, dir, "f.bin"), Buffer.alloc(4096, 1));
  }
  mkdirSync(join(userHome, ".npm"));
});

afterEach(() => {
  rmSync(userHome, { force: true, recursive: true });
});

/** Each labelled path's label and state, in order. */
function states({ paths }: { paths: readonly LabelledPath[] }): readonly string[] {
  return paths.map((entry) => `${entry.label}:${entry.observed.state}`);
}

/** Read package-caches under the fixture home. */
function readCaches({ actedOnly }: { actedOnly: boolean }): FreeDiskObservation {
  return unwrap(
    observeFreeDiskTarget({
      actedOnly,
      cwd: userHome,
      declaredMainCheckouts: [],
      target: { kind: "package-caches" },
      userHome,
    }),
  );
}

describe("runDocker", () => {
  it("refuses, before docker starts, any argv that is not one of the registry's fixed commands", () => {
    const trim = dockerTrimArgv({ dryRun: false });
    const refused = [["system", "prune", "--all", "--force"], [...trim, "-a"], trim.slice(0, -1)].map(
      (argv) => unwrapErr(runDocker({ argv })).code,
    );

    expect(refused).toEqual(["DOCKER_ARGV_REFUSED", "DOCKER_ARGV_REFUSED", "DOCKER_ARGV_REFUSED"]);
  });
});

describe("observeFreeDiskTarget — package-caches", () => {
  it("reads the four clearable caches, the two kept ones and every Slopweaver cache child", () => {
    const observed = readCaches({ actedOnly: false });

    expect(observed.kind).toBe("package-caches");
    const caches = observed as Extract<FreeDiskObservation, { kind: "package-caches" }>;
    expect(states({ paths: caches.clearable })).toEqual([
      "Poetry:absent",
      "pnpm:present",
      "pip:present",
      "pipenv:absent",
    ]);
    expect(states({ paths: caches.kept })).toEqual(["npm:present", "Yarn:absent"]);
    expect(states({ paths: caches.slopweaverChildren })).toEqual(["console:present", "exec-store:present"]);
  });

  it("a recheck's read touches the clearable four alone", () => {
    const caches = readCaches({ actedOnly: true }) as Extract<FreeDiskObservation, { kind: "package-caches" }>;

    expect([caches.clearable.length, caches.kept.length, caches.slopweaverChildren.length]).toEqual([4, 0, 0]);
  });

  it("a recheck walks each clearable cache, so a file that gained a hard link frees nothing", () => {
    const file = join(userHome, "Library", "Caches", "pip", "f.bin");
    const fileBytes = statSync(file).blocks * 512;
    const pipUsage = (): unknown =>
      (readCaches({ actedOnly: true }) as Extract<FreeDiskObservation, { kind: "package-caches" }>).clearable.find(
        (entry) => entry.label === "pip",
      )!.observed;

    const before = pipUsage();
    linkSync(file, join(userHome, "elsewhere.bin"));

    expect([before, pipUsage()]).toMatchObject([
      { usage: { allocatedBytes: fileBytes, freeableBytes: fileBytes, multiLinkFiles: 0, singleLinkFiles: 1 } },
      { usage: { allocatedBytes: fileBytes, freeableBytes: 0, multiLinkFiles: 1, singleLinkFiles: 0 } },
    ]);
  });
});
