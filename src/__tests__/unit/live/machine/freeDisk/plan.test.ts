/**
 * `machine free-disk`'s registry and pure planner: the closed target list, a bundle resolved against a ruling,
 * the exact Docker argv, and every refusal a read of the machine can trigger — a link, a wrong kind, a path
 * resolving elsewhere, a git repository, an undeclared checkout, a running app, a Trash collision and a
 * cross-volume Trash.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { parseTrimmedBytes, parseVmDataMount, planFreeDisk } from "../../../../../live/machine/freeDisk/plan.js";
import {
  dockerTrimArgv,
  freeDiskPaths,
  resolveBundle,
  resolveTargetName,
} from "../../../../../live/machine/freeDisk/registry.js";
import type {
  AppObservation,
  BeforeSetupCopyObservation,
  DockerDataObservation,
  PackageCachesObservation,
  PathObservation,
  TreeUsage,
} from "../../../../../live/machine/freeDisk/types.js";

const HOME = "/Users/someone";
const CACHES = `${HOME}/Library/Caches`;

/** A usage with `allocated` bytes, `freeable` of them single-link. */
function usage({ allocated, freeable }: { allocated: number; freeable: number }): TreeUsage {
  return { allocatedBytes: allocated, freeableBytes: freeable, multiLinkFiles: 0, singleLinkFiles: 1 };
}

/** A present directory resolving to itself. */
function dir({
  path,
  allocated = 1000,
  freeable = 1000,
  dev = 1,
  ino = 10,
}: {
  path: string;
  allocated?: number;
  freeable?: number;
  dev?: number;
  ino?: number;
}): PathObservation {
  return {
    identity: { dev, ino },
    kind: "directory",
    path,
    realPath: path,
    state: "present",
    usage: usage({ allocated, freeable }),
  };
}

/** An absent path. */
function absent({ path }: { path: string }): PathObservation {
  return { path, state: "absent" };
}

/** A package-caches observation: pip present, the rest absent, npm kept, two Slopweaver children. */
function cachesObservation({
  pip = dir({ path: `${CACHES}/pip` }),
}: { pip?: PathObservation } = {}): PackageCachesObservation {
  return {
    clearable: [
      { label: "Poetry", observed: absent({ path: `${CACHES}/pypoetry` }) },
      { label: "pnpm", observed: absent({ path: `${CACHES}/pnpm` }) },
      { label: "pip", observed: pip },
      { label: "pipenv", observed: absent({ path: `${CACHES}/pipenv` }) },
    ],
    kept: [
      { label: "npm", observed: dir({ allocated: 5000, path: `${HOME}/.npm` }) },
      { label: "Yarn", observed: absent({ path: `${CACHES}/Yarn` }) },
    ],
    kind: "package-caches",
    slopweaverChildren: [
      {
        label: "exec-store",
        observed: dir({ allocated: 963_700, freeable: 0, path: `${CACHES}/slopweaver/exec-store` }),
      },
      { label: "mystery", observed: dir({ allocated: 7, path: `${CACHES}/slopweaver/mystery` }) },
    ],
  };
}

describe("resolveTargetName", () => {
  it("resolves each of the four targets", () => {
    expect(
      ["package-caches", "docker-data", "before-setup-copy", "app"].map((named) =>
        unwrap(resolveTargetName({ named })),
      ),
    ).toEqual(["package-caches", "docker-data", "before-setup-copy", "app"]);
  });

  it("refuses npm, yarn and Slopweaver's cache by name, with the reason they stay", () => {
    const refused = ["npm", "yarn", "slopweaver-cache"].map((named) => unwrapErr(resolveTargetName({ named })).code);
    expect(refused).toEqual(["PROTECTED_TARGET", "PROTECTED_TARGET", "PROTECTED_TARGET"]);
    expect(unwrapErr(resolveTargetName({ named: "npm" })).message).toBe(
      "npm stays: every worktree install reads npm's cache, and the owner ruled it kept",
    );
  });

  it("refuses an unknown name, and a prototype key reads as unknown rather than protected", () => {
    expect(unwrapErr(resolveTargetName({ named: "downloads" })).message).toBe(
      '"downloads" is not a free-disk target; the targets: package-caches, docker-data, before-setup-copy, app',
    );
    expect(unwrapErr(resolveTargetName({ named: "toString" })).code).toBe("UNSUPPORTED_TARGET");
  });
});

describe("resolveBundle", () => {
  const ruling = { kept: ["Acme Browser.app"], removable: ["Acme Scanner Edition.app"] };

  it("resolves a ruled-removable app with or without `.app`, in any case, to its exact name", () => {
    expect(unwrap(resolveBundle({ named: "Acme Scanner Edition", ruling }))).toBe("Acme Scanner Edition.app");
    expect(unwrap(resolveBundle({ named: "acme scanner edition.app", ruling }))).toBe("Acme Scanner Edition.app");
  });

  it("keeps a ruled-kept app, refuses an unruled one, and refuses any path or control character", () => {
    expect(unwrapErr(resolveBundle({ named: "Acme Browser", ruling })).code).toBe("BUNDLE_PROTECTED");
    expect(unwrapErr(resolveBundle({ named: "Acme Chat", ruling })).message).toBe(
      "Acme Chat.app is not an application the owner ruled removable; the ruled ones: Acme Scanner Edition.app",
    );
    const invalid = ["/Applications/Acme Scanner Edition.app", "../Acme", "..", ".app", "", "Acme\nScanner"].map(
      (named) => unwrapErr(resolveBundle({ named, ruling })).code,
    );
    expect(invalid).toEqual([
      "BUNDLE_NAME_INVALID",
      "BUNDLE_NAME_INVALID",
      "BUNDLE_NAME_INVALID",
      "BUNDLE_NAME_INVALID",
      "BUNDLE_NAME_INVALID",
      "BUNDLE_NAME_INVALID",
    ]);
  });

  it("refuses every app as not approved when no ruling names it", () => {
    expect(
      unwrapErr(resolveBundle({ named: "Acme Scanner Edition", ruling: { kept: [], removable: [] } })).message,
    ).toBe("Acme Scanner Edition.app is not an application the owner ruled removable; the ruled ones: none");
  });
});

describe("dockerTrimArgv", () => {
  it("differs between dry run and apply only by -n, against /var/lib alone, never pulling", () => {
    const prefix = [
      "run",
      "--rm",
      "--pull",
      "never",
      "--privileged",
      "--pid=host",
      "postgres:17",
      "nsenter",
      "-t",
      "1",
      "-m",
      "--",
    ];
    expect(dockerTrimArgv({ dryRun: true })).toEqual([...prefix, "fstrim", "-n", "-v", "/var/lib"]);
    expect(dockerTrimArgv({ dryRun: false })).toEqual([...prefix, "fstrim", "-v", "/var/lib"]);
  });
});

describe("freeDiskPaths", () => {
  it("derives every path under the user home", () => {
    expect(freeDiskPaths({ userHome: HOME })).toEqual({
      dockerRaw: `${HOME}/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`,
      libraryCaches: CACHES,
      npmCache: `${HOME}/.npm`,
      slopweaverCacheRoot: `${CACHES}/slopweaver`,
      trash: `${HOME}/.Trash`,
      yarnCache: `${CACHES}/Yarn`,
    });
  });
});

describe("planFreeDisk — package-caches", () => {
  it("removes the present clearable cache and keeps npm and every Slopweaver child with its reason", () => {
    const plan = unwrap(planFreeDisk({ observation: cachesObservation() }));

    expect(plan.items.map((item) => [item.label, item.disposition, item.expectedFreedBytes])).toEqual([
      ["Poetry", "absent", 0],
      ["pnpm", "absent", 0],
      ["pip", "remove", 1000],
      ["pipenv", "absent", 0],
      ["npm", "keep", 0],
      ["Yarn", "absent", 0],
      ["exec-store", "keep", 0],
      ["mystery", "keep", 0],
    ]);
    expect(plan.items[2]!.action).toEqual({
      identity: { dev: 1, ino: 10 },
      kind: "remove-tree",
      path: `${CACHES}/pip`,
    });
    expect(plan.items[4]!.reason).toBe("every worktree install reads npm's cache, and the owner ruled it kept");
    expect(plan.items[6]!.reason).toBe(
      "every file is hardlinked into a checkout's node_modules, so removing it frees nothing",
    );
    expect(plan.items[7]!.reason).toBe(
      "not a child the owner ruled rebuildable, so it is kept and named rather than skipped",
    );
    expect(plan.items.filter((item) => item.disposition === "keep").every((item) => item.action === undefined)).toBe(
      true,
    );
  });

  it("counts only single-link bytes as freed", () => {
    const plan = unwrap(
      planFreeDisk({
        observation: cachesObservation({ pip: dir({ allocated: 900, freeable: 300, path: `${CACHES}/pip` }) }),
      }),
    );
    expect([plan.items[2]!.allocatedBytes, plan.items[2]!.expectedFreedBytes]).toEqual([900, 300]);
  });

  it("refuses a cache that is a link, a file, or resolves elsewhere", () => {
    const pip = `${CACHES}/pip`;
    const link: PathObservation = { ...dir({ path: pip }), kind: "symlink", realPath: "/elsewhere" } as PathObservation;
    const file: PathObservation = { ...dir({ path: pip }), kind: "regular file" } as PathObservation;
    const moved: PathObservation = { ...dir({ path: pip }), realPath: "/Volumes/other/pip" } as PathObservation;

    expect(unwrapErr(planFreeDisk({ observation: cachesObservation({ pip: link }) })).code).toBe("SYMLINK_REFUSED");
    expect(unwrapErr(planFreeDisk({ observation: cachesObservation({ pip: file }) })).code).toBe("WRONG_KIND");
    expect(unwrapErr(planFreeDisk({ observation: cachesObservation({ pip: moved }) })).message).toBe(
      `${pip} resolves to /Volumes/other/pip, not to itself`,
    );
  });
});

describe("planFreeDisk — docker-data", () => {
  const raw = `${HOME}/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`;
  const observation = ({
    dryRunOutput = "/var/lib: 0 B (dry run) trimmed\n",
  }: { dryRunOutput?: string } = {}): DockerDataObservation => ({
    kind: "docker-data",
    raw: { ...dir({ allocated: 18_000_000_000, path: raw }), kind: "regular file" } as PathObservation,
    trimDryRunOutput: dryRunOutput,
    vm: { totalKib: 65_739_308, usedKib: 16_426_964 },
  });

  it("plans one trim with an upper bound of the file's allocation less the VM's used bytes", () => {
    const plan = unwrap(planFreeDisk({ observation: observation() }));
    expect(plan.items).toEqual([
      {
        action: {
          argv: dockerTrimArgv({ dryRun: false }),
          file: raw,
          identity: { dev: 1, ino: 10 },
          kind: "docker-trim",
        },
        allocatedBytes: 18_000_000_000,
        disposition: "trim",
        expectedFreedBytes: 18_000_000_000 - 16_426_964 * 1024,
        label: "Docker.raw",
        path: raw,
        reason: `the VM's /var/lib uses ${String(16_426_964 * 1024)} bytes of it; TRIM hands the rest back, deleting nothing`,
      },
    ]);
  });

  it("refuses a dry run that did not print fstrim's dry-run line", () => {
    expect(
      unwrapErr(planFreeDisk({ observation: observation({ dryRunOutput: "fstrim: /var/lib: not mounted" }) })).code,
    ).toBe("DOCKER_COMMAND_FAILED");
  });

  it("refuses a data file with another hard link, so no saving is counted on blocks it shares", () => {
    const linked = {
      ...observation(),
      raw: {
        ...dir({ allocated: 18_000_000_000, path: raw }),
        kind: "regular file",
        usage: { allocatedBytes: 18_000_000_000, freeableBytes: 0, multiLinkFiles: 1, singleLinkFiles: 0 },
      } as PathObservation,
    };
    expect(unwrapErr(planFreeDisk({ observation: linked })).message).toBe(
      `${raw} has another hard link, so what trimming it frees cannot be counted as its own; nothing was planned`,
    );
  });
});

describe("parseTrimmedBytes and parseVmDataMount", () => {
  it("reads the trimmed bytes and refuses a dry-run or foreign line", () => {
    expect(parseTrimmedBytes({ text: "/var/lib: 1.7 GiB (1825361920 bytes) trimmed on /dev/vda1\n" })).toBe(
      1_825_361_920,
    );
    expect(parseTrimmedBytes({ text: "/var/lib: 0 B (dry run) trimmed" })).toBe(undefined);
    expect(parseTrimmedBytes({ text: "/: 5 GiB (5368709120 bytes) trimmed" })).toBe(undefined);
  });

  it("reads the /var/lib row's total and used KiB, and nothing else", () => {
    const text =
      "Filesystem     1K-blocks     Used Available Use% Mounted on\n/dev/vda1       65739308 16426964  45940572  27% /var/lib\n";
    expect(parseVmDataMount({ text })).toEqual({ totalKib: 65_739_308, usedKib: 16_426_964 });
    expect(parseVmDataMount({ text: "Filesystem 1K-blocks Used\n/dev/vda1 1 1 1 1% /\n" })).toBe(undefined);
  });
});

describe("planFreeDisk — before-setup-copy", () => {
  const main = "/Users/someone/dev/repo";
  const copy = `${main}.before-setup`;
  const declared: Extract<BeforeSetupCopyObservation, { checkout: "declared" }> = {
    checkout: "declared",
    copy: dir({ allocated: 4000, path: copy }),
    gitEntries: 0,
    insideGitRepository: false,
    kind: "before-setup-copy",
    mainCheckout: main,
  };
  const observation = (over: Partial<typeof declared> = {}): BeforeSetupCopyObservation => ({ ...declared, ...over });

  it("removes exactly the main checkout's .before-setup sibling", () => {
    const plan = unwrap(planFreeDisk({ observation: observation() }));
    expect(plan.items.map((item) => [item.path, item.disposition, item.expectedFreedBytes])).toEqual([
      [copy, "remove", 1000],
    ]);
  });

  it("refuses a copy holding any .git entry, or sitting inside a repository", () => {
    expect(unwrapErr(planFreeDisk({ observation: observation({ gitEntries: 1 }) })).message).toBe(
      `${copy} is, holds or sits inside a git repository, so it is not the pre-setup copy the owner ruled deletable`,
    );
    expect(unwrapErr(planFreeDisk({ observation: observation({ insideGitRepository: true }) })).code).toBe(
      "GIT_REPOSITORY_REFUSED",
    );
  });

  it("refuses an unproven main checkout, and one profile.json does not declare", () => {
    expect(unwrapErr(planFreeDisk({ observation: { checkout: "unproven", kind: "before-setup-copy" } })).code).toBe(
      "MAIN_CHECKOUT_UNPROVEN",
    );
    expect(
      unwrapErr(
        planFreeDisk({ observation: { checkout: "undeclared", kind: "before-setup-copy", mainCheckout: main } }),
      ).message,
    ).toBe(`${main} is not a main checkout profile.json declares, so no copy beside it is the one ruled deletable`);
  });

  it("refuses a copy path that is not the derived sibling", () => {
    expect(
      unwrapErr(planFreeDisk({ observation: observation({ copy: dir({ path: "/Users/someone/dev/other" }) }) })).code,
    ).toBe("PATH_OUTSIDE_EXPECTED_ROOT");
  });

  it("plans nothing when the copy is already gone", () => {
    const plan = unwrap(planFreeDisk({ observation: observation({ copy: absent({ path: copy }) }) }));
    expect(plan.items.map((item) => item.disposition)).toEqual(["absent"]);
  });
});

describe("planFreeDisk — app", () => {
  const bundle = "Acme Scanner Edition.app";
  const source = `/Applications/${bundle}`;
  const trash = `${HOME}/.Trash`;
  const observation = (over: Partial<AppObservation> = {}): AppObservation => ({
    bundle,
    destination: absent({ path: `${trash}/${bundle}` }),
    kind: "app",
    runningPids: [],
    source: dir({ allocated: 700_000_000, dev: 5, ino: 77, path: source }),
    trash: dir({ dev: 5, ino: 2, path: trash }),
    ...over,
  });

  it("moves the bundle into the Trash, freeing nothing until it is emptied", () => {
    const plan = unwrap(planFreeDisk({ observation: observation() }));
    expect(plan.target).toEqual({ bundle, kind: "app" });
    expect(
      plan.items.map((item) => [item.disposition, item.allocatedBytes, item.expectedFreedBytes, item.action]),
    ).toEqual([
      [
        "trash",
        700_000_000,
        0,
        { destination: `${trash}/${bundle}`, identity: { dev: 5, ino: 77 }, kind: "move-to-trash", source },
      ],
    ]);
  });

  it("refuses a running app, a Trash collision and a Trash on another volume", () => {
    expect(unwrapErr(planFreeDisk({ observation: observation({ runningPids: [4242] }) })).message).toBe(
      `${bundle} is running (pid 4242) — quit it, then run this again`,
    );
    expect(
      unwrapErr(planFreeDisk({ observation: observation({ destination: dir({ path: `${trash}/${bundle}` }) }) })).code,
    ).toBe("TRASH_COLLISION");
    expect(unwrapErr(planFreeDisk({ observation: observation({ trash: dir({ dev: 9, path: trash }) }) })).code).toBe(
      "TRASH_VOLUME_MISMATCH",
    );
  });

  it("refuses a bundle that is a link", () => {
    const link = { ...dir({ path: source }), kind: "symlink", realPath: "/Volumes/x/Acme.app" } as PathObservation;
    expect(unwrapErr(planFreeDisk({ observation: observation({ source: link }) })).code).toBe("SYMLINK_REFUSED");
  });
});
