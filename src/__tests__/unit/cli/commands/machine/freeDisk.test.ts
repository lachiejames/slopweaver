/**
 * `machine free-disk` driven end to end over plain fake seams that record every call: help and a bad argv touch
 * nothing, a dry run acts on nothing, an apply rechecks each item immediately before its act and stops on the
 * first one that changed or failed, a Trash move reports moved bytes and frees none, an app is resolved against
 * the state home's ruling, and `--json` is one document even when an apply stops partway.
 */
import { describe, expect, it } from "vitest";

import { runMachineFreeDisk } from "../../../../../cli/commands/machine/freeDisk.js";
import type { MachineFreeDiskDeps } from "../../../../../cli/commands/machine/freeDiskApply.js";
import { MACHINE_FREE_DISK_USAGE_LINE } from "../../../../../cli/commands/machine/freeDiskUsage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { VolumeReading } from "../../../../../live/machine/diskFootprint.js";
import { type FreeDiskError, FreeDiskErrors } from "../../../../../live/machine/freeDisk/errors.js";
import type { FreeDiskObservation, PathObservation } from "../../../../../live/machine/freeDisk/types.js";

const CACHES = "/Users/someone/Library/Caches";
const BUNDLE = "Acme Scanner Edition.app";
const RULING = { kept: ["Acme Browser.app"], removable: [BUNDLE] };
const SOURCE = `/Applications/${BUNDLE}`;
const TRASH = "/Users/someone/.Trash";
const RAW = "/Users/someone/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw";
const MAIN = "/Users/someone/dev/repo";
const COPY = `${MAIN}.before-setup`;

/** A present directory resolving to itself, holding `bytes`, all single-link. */
function dir({ path, bytes, ino }: { path: string; bytes: number; ino: number }): PathObservation {
  return {
    identity: { dev: 1, ino },
    kind: "directory",
    path,
    realPath: path,
    state: "present",
    usage: { allocatedBytes: bytes, freeableBytes: bytes, multiLinkFiles: 0, singleLinkFiles: 1 },
  };
}

/** A fake machine: which paths exist, what every seam was asked, and the failures it is told to produce. */
interface FakeMachine {
  readonly present: Map<string, PathObservation>;
  readonly calls: string[];
  readonly out: string[];
  readonly diagnostics: string[];
  failRemoveOf?: string;
  /** Swap a path's inode on its next recheck read, as if it were replaced between plan and act. */
  replaceOnRecheck?: string;
  /** Give every file under a path another hard link on its next recheck read, so none of it is freeable. */
  linkOnRecheck?: string;
  /** What the trim prints when it runs; a recognised line unless a test says otherwise. */
  trimPrints?: string;
  /** The bundle ruling read, or the refusal reading it produces. */
  ruling?: Result<typeof RULING, FreeDiskError>;
  /** Fail every read once an act has happened, as a read after the act that hits EACCES. */
  failReadAfterAct?: boolean;
  /** Stand in a main checkout `profile.json` does not declare. */
  undeclaredCheckout?: boolean;
}

/** The observed state of one path. */
function observed({ machine, path }: { machine: FakeMachine; path: string }): PathObservation {
  const found = machine.present.get(path);
  if (found === undefined) {
    return { path, state: "absent" };
  }
  return found;
}

/** The fake's observation of a target, built from what is present. */
function observation({
  machine,
  kind,
  actedOnly,
}: {
  machine: FakeMachine;
  kind: FreeDiskObservation["kind"];
  actedOnly: boolean;
}): FreeDiskObservation {
  if (kind === "before-setup-copy") {
    if (machine.undeclaredCheckout === true) {
      return { checkout: "undeclared", kind, mainCheckout: MAIN };
    }
    const copy = observed({ machine, path: COPY });
    return { checkout: "declared", copy, gitEntries: 0, insideGitRepository: false, kind, mainCheckout: MAIN };
  }
  if (kind === "docker-data") {
    return {
      kind: "docker-data",
      raw: observed({ machine, path: RAW }),
      trimDryRunOutput: "/var/lib: 0 B (dry run) trimmed\n",
      vm: { totalKib: 65_739_308, usedKib: 1_000_000 },
    };
  }
  if (kind === "app") {
    return {
      bundle: BUNDLE,
      destination: observed({ machine, path: `${TRASH}/${BUNDLE}` }),
      kind: "app",
      runningPids: [],
      source: observed({ machine, path: SOURCE }),
      trash: observed({ machine, path: TRASH }),
    };
  }
  const clearable = [
    ["Poetry", "pypoetry"],
    ["pnpm", "pnpm"],
    ["pip", "pip"],
    ["pipenv", "pipenv"],
  ].map(([label, name]) => ({ label: label!, observed: observed({ machine, path: `${CACHES}/${name!}` }) }));
  if (actedOnly) {
    return { clearable, kept: [], kind: "package-caches", slopweaverChildren: [] };
  }
  return {
    clearable,
    kept: [{ label: "npm", observed: dir({ bytes: 5_000_000_000, ino: 90, path: "/Users/someone/.npm" }) }],
    kind: "package-caches",
    slopweaverChildren: [],
  };
}

/** A volume reading whose free space is `freeKib`. */
function volume({ freeKib }: { freeKib: number }): VolumeReading {
  return { availableKib: freeKib, totalKib: 971_298_980, usedPct: 95 };
}

/** The fake seams over one machine. Free space rises by what each act freed, so the volume line is exact. */
function fakeDeps({ machine }: { machine: FakeMachine }): MachineFreeDiskDeps {
  let freeKib = 41_015_625;
  let acted = false;
  return {
    bundleRuling: () => {
      if (machine.ruling === undefined) {
        return ok(RULING);
      }
      return machine.ruling;
    },
    moveToTrash: ({ source, destination }) => {
      machine.calls.push(`move ${source} -> ${destination}`);
      acted = true;
      const moving = machine.present.get(source)!;
      machine.present.delete(source);
      machine.present.set(destination, { ...moving, path: destination, realPath: destination } as PathObservation);
      return ok(true);
    },
    observe: ({ target, actedOnly }) => {
      machine.calls.push(`observe ${target.kind}${actedOnly ? " (recheck)" : ""}`);
      if (machine.failReadAfterAct === true && acted) {
        return err(FreeDiskErrors.readFailed({ cause: new Error("EACCES"), path: "the read after the act" }));
      }
      if (actedOnly && machine.replaceOnRecheck !== undefined) {
        // The same kind of entry at the same path, on a new inode — a replacement, not a removal.
        const path = machine.replaceOnRecheck;
        const replaced = machine.present.get(path)!;
        machine.present.set(path, { ...replaced, identity: { dev: 1, ino: 999 } } as PathObservation);
      }
      const linked = machine.linkOnRecheck === undefined ? undefined : machine.present.get(machine.linkOnRecheck);
      if (actedOnly && linked?.state === "present") {
        const usage = { ...linked.usage, freeableBytes: 0, multiLinkFiles: 1, singleLinkFiles: 0 };
        machine.present.set(linked.path, { ...linked, usage });
      }
      return ok(observation({ actedOnly, kind: target.kind, machine }));
    },
    removeTree: ({ path }): Result<true, FreeDiskError> => {
      machine.calls.push(`remove ${path}`);
      if (machine.failRemoveOf === path) {
        return err(FreeDiskErrors.applyFailed({ cause: new Error("EACCES"), path }));
      }
      const removed = machine.present.get(path)!;
      machine.present.delete(path);
      acted = true;
      if (removed.state === "present") {
        freeKib += removed.usage.freeableBytes / 1024;
      }
      return ok(true);
    },
    runDocker: ({ argv }) => {
      machine.calls.push(`docker ${argv.join(" ")}`);
      acted = true;
      if (machine.trimPrints === undefined) {
        return ok("/var/lib: 1.1 GiB (1181116006 bytes) trimmed\n");
      }
      return ok(machine.trimPrints);
    },
    volume: () => {
      machine.calls.push("volume");
      return volume({ freeKib });
    },
    writeDiagnostic: (line) => machine.diagnostics.push(line),
    writeOut: (line) => machine.out.push(line),
  };
}

/** A machine with pip (0.5 GB) and pnpm (0.25 GB) present. */
function cacheMachine(): FakeMachine {
  return {
    calls: [],
    diagnostics: [],
    out: [],
    present: new Map([
      [`${CACHES}/pip`, dir({ bytes: 512_000_000, ino: 11, path: `${CACHES}/pip` })],
      [`${CACHES}/pnpm`, dir({ bytes: 256_000_000, ino: 12, path: `${CACHES}/pnpm` })],
    ]),
  };
}

describe("runMachineFreeDisk — refusals before any read", () => {
  it("prints help and reads nothing", () => {
    const machine = cacheMachine();
    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["--help"] })).toBe(EXIT_OK);
    expect(machine.calls).toEqual([]);
    expect(MACHINE_FREE_DISK_USAGE_LINE).toBe(
      "usage: slopweaver machine free-disk <package-caches|docker-data|before-setup-copy|app> [--bundle <name>] [--apply] [--json]",
    );
    expect(machine.out[0]).toContain(MACHINE_FREE_DISK_USAGE_LINE);
  });

  it("refuses no target, a protected target and a bundle without app, reading nothing", () => {
    const machine = cacheMachine();
    const deps = fakeDeps({ machine });

    const codes = [[], ["yarn"], ["package-caches", "--bundle", "Acme Scanner Edition"], ["app"]].map((rest) =>
      runMachineFreeDisk({ deps, rest }),
    );

    expect(codes).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
    expect(machine.calls).toEqual([]);
    expect(machine.diagnostics.filter((line) => line.startsWith("machine free-disk: "))).toEqual([
      "machine free-disk: name exactly one target, got 0",
      "machine free-disk: yarn stays: every worktree install reads Yarn's cache, and the owner ruled it kept",
      "machine free-disk: --bundle belongs to the app target, not package-caches",
      "machine free-disk: the app target needs --bundle <name>",
    ]);
  });
});

describe("runMachineFreeDisk — package-caches", () => {
  it("dry run prints the plan and acts on nothing", () => {
    const machine = cacheMachine();

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["package-caches"] })).toBe(EXIT_OK);

    expect(machine.calls).toEqual(["volume", "observe package-caches"]);
    expect(machine.out[0]).toBe("machine free-disk package-caches — state home volume 42 GB free (df)");
    expect(machine.out).toContain("  2 to act on, expected to free 0.77 GB");
    expect(machine.out.at(-1)).toBe("nothing changed — re-run with --apply");
  });

  it("apply rechecks each cache immediately before removing it, then measures it and the volume", () => {
    const machine = cacheMachine();

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["package-caches", "--apply"] })).toBe(EXIT_OK);

    expect(machine.calls).toEqual([
      "volume",
      "observe package-caches",
      "observe package-caches (recheck)",
      `remove ${CACHES}/pnpm`,
      "observe package-caches (recheck)",
      "observe package-caches (recheck)",
      `remove ${CACHES}/pip`,
      "observe package-caches (recheck)",
      "volume",
    ]);
    expect(machine.out.slice(-3)).toEqual([
      "  removed pnpm: held 0.26 GB, now 0.00 GB, freed 0.26 GB (its single-link files, counted at the recheck)",
      "  removed pip: held 0.51 GB, now 0.00 GB, freed 0.51 GB (its single-link files, counted at the recheck)",
      "  state home volume: 42 GB free before, 42.8 GB after (+0.8 GB; the whole volume, which other writers move too)",
    ]);
  });

  it("refuses an item whose inode changed since the plan, removing nothing", () => {
    const machine = cacheMachine();
    machine.replaceOnRecheck = `${CACHES}/pnpm`;

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["package-caches", "--apply"] })).toBe(EXIT_ERROR);

    expect(machine.calls.filter((call) => call.startsWith("remove"))).toEqual([]);
    expect(machine.diagnostics.at(-1)).toBe(
      `machine free-disk: stopped — ${CACHES}/pnpm changed since the plan read it (its fresh read no longer plans the same act); nothing further was touched`,
    );
  });

  it("stops on the first failed removal and reports the one that already happened", () => {
    const machine = cacheMachine();
    machine.failRemoveOf = `${CACHES}/pip`;

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["package-caches", "--apply"] })).toBe(EXIT_ERROR);

    expect(machine.calls.filter((call) => call.startsWith("remove"))).toEqual([
      `remove ${CACHES}/pnpm`,
      `remove ${CACHES}/pip`,
    ]);
    expect(machine.diagnostics.slice(-2)).toEqual([
      "  removed pnpm: held 0.26 GB, now 0.00 GB, freed 0.26 GB (its single-link files, counted at the recheck)",
      `machine free-disk: stopped — could not act on ${CACHES}/pip: EACCES`,
    ]);
  });

  it("--apply --json that stops partway still writes one document, with the acts done and the stop", () => {
    const machine = cacheMachine();
    machine.failRemoveOf = `${CACHES}/pip`;

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["package-caches", "--apply", "--json"] })).toBe(
      EXIT_ERROR,
    );

    expect(machine.out).toHaveLength(1);
    const document = JSON.parse(machine.out[0]!) as {
      applied: boolean;
      outcomes: readonly { label: string; freedBasis: string }[];
      stopped: { code: string; message: string };
    };
    expect([document.applied, document.outcomes.map((outcome) => [outcome.label, outcome.freedBasis])]).toEqual([
      true,
      [["pnpm", "counted-at-recheck"]],
    ]);
    expect(document.stopped).toEqual({ code: "APPLY_FAILED", message: `could not act on ${CACHES}/pip: EACCES` });
    expect(machine.diagnostics.at(-1)).toBe(`machine free-disk: stopped — could not act on ${CACHES}/pip: EACCES`);
  });

  it("--json writes exactly one document, the plan on stderr", () => {
    const machine = cacheMachine();

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["package-caches", "--json"] })).toBe(EXIT_OK);

    expect(machine.out).toHaveLength(1);
    const document = JSON.parse(machine.out[0]!) as {
      schemaVersion: number;
      applied: boolean;
      plan: { items: unknown[] };
    };
    expect([document.schemaVersion, document.applied, document.plan.items.length]).toEqual([1, false, 5]);
    expect(machine.diagnostics[0]).toBe("machine free-disk package-caches — state home volume 42 GB free (df)");
  });
});

describe("runMachineFreeDisk — the saving is the fresh read's", () => {
  it("counts nothing freed for a cache whose files gained another hard link after the plan", () => {
    const machine: FakeMachine = { ...cacheMachine(), linkOnRecheck: `${CACHES}/pip` };

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["package-caches", "--apply", "--json"] })).toBe(
      EXIT_OK,
    );

    const document = JSON.parse(machine.out[0]!) as {
      outcomes: readonly { label: string; freedBytes: number; allocatedBeforeBytes: number }[];
    };
    expect(
      document.outcomes.map((outcome) => [outcome.label, outcome.freedBytes, outcome.allocatedBeforeBytes]),
    ).toEqual([
      ["pnpm", 256_000_000, 256_000_000],
      ["pip", 0, 512_000_000],
    ]);
  });
});

/** A machine holding only Docker's data file, 18 GB, single-link. */
function dockerMachine(): FakeMachine {
  return {
    calls: [],
    diagnostics: [],
    out: [],
    present: new Map([
      [RAW, { ...dir({ bytes: 18_000_000_000, ino: 40, path: RAW }), kind: "regular file" } as PathObservation],
    ]),
  };
}

describe("runMachineFreeDisk — docker-data", () => {
  it("reports a trim that ran but printed an unrecognised line, then stops", () => {
    const machine: FakeMachine = { ...dockerMachine(), trimPrints: "something else\n" };

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["docker-data", "--apply", "--json"] })).toBe(
      EXIT_ERROR,
    );

    const document = JSON.parse(machine.out[0]!) as {
      outcomes: readonly { operation: string; freedBasis: string; detail: string }[];
      stopped: { code: string };
    };
    expect(document.outcomes.map((outcome) => [outcome.operation, outcome.freedBasis, outcome.detail])).toEqual([
      ["docker-trim", "measured-after", "something else"],
    ]);
    expect(document.stopped.code).toBe("DOCKER_COMMAND_FAILED");
    expect(machine.diagnostics.at(-1)).toContain("the trim ran but printed an unrecognised line");
  });

  it("refuses a data file replaced on a new inode between the plan and the trim, running no trim", () => {
    const machine: FakeMachine = { ...dockerMachine(), replaceOnRecheck: RAW };

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["docker-data", "--apply"] })).toBe(EXIT_ERROR);

    expect(machine.calls.filter((call) => call.startsWith("docker"))).toEqual([]);
    expect(machine.diagnostics.at(-1)).toBe(
      `machine free-disk: stopped — ${RAW} changed since the plan read it (its fresh read no longer plans the same act); nothing further was touched`,
    );
  });
});

describe("runMachineFreeDisk — app", () => {
  it("refuses an app the ruling keeps, and a malformed ruling, before reading the machine", () => {
    const machine = cacheMachine();
    const kept = runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["app", "--bundle", "Acme Browser"] });
    machine.ruling = err(
      FreeDiskErrors.bundleRulingInvalid({ path: "/home/machine/free-disk-bundles.json", why: "it is not JSON" }),
    );
    const malformed = runMachineFreeDisk({
      deps: fakeDeps({ machine }),
      rest: ["app", "--bundle", "Acme Scanner Edition"],
    });

    expect([kept, malformed]).toEqual([EXIT_USAGE, EXIT_USAGE]);
    expect(machine.calls).toEqual([]);
    expect(machine.diagnostics.filter((line) => line.startsWith("machine free-disk: "))).toEqual([
      "machine free-disk: Acme Browser.app stays: the owner ruled it kept",
      "machine free-disk: /home/machine/free-disk-bundles.json is not a bundle ruling (it is not JSON); nothing was read as approved",
    ]);
  });

  it("moves the bundle to the Trash and reports it moved, not freed", () => {
    const machine: FakeMachine = {
      calls: [],
      diagnostics: [],
      out: [],
      present: new Map([
        [SOURCE, dir({ bytes: 700_000_000, ino: 77, path: SOURCE })],
        [TRASH, dir({ bytes: 0, ino: 2, path: TRASH })],
      ]),
    };

    expect(
      runMachineFreeDisk({
        deps: fakeDeps({ machine }),
        rest: ["app", "--bundle", "Acme Scanner Edition", "--apply"],
      }),
    ).toBe(EXIT_OK);

    expect(machine.calls.filter((call) => call.startsWith("move"))).toEqual([`move ${SOURCE} -> ${TRASH}/${BUNDLE}`]);
    expect(machine.out.at(-2)).toBe(
      `  moved to the Trash ${BUNDLE}: held 0.70 GB, now 0.00 GB, freed 0.00 GB, moved 0.70 GB (lands once the Trash is emptied)`,
    );
  });
});

/** The outcome fields a stopped run must still carry, from its one JSON document. */
function stoppedOutcomes({ machine }: { machine: FakeMachine }): readonly (string | number | null)[][] {
  const document = JSON.parse(machine.out[0]!) as {
    outcomes: readonly {
      operation: string;
      allocatedAfterBytes: number | null;
      freedBytes: number | null;
      freedBasis: string;
    }[];
    stopped: { code: string };
  };
  return [
    [document.stopped.code],
    ...document.outcomes.map((outcome) => [
      outcome.operation,
      outcome.allocatedAfterBytes,
      outcome.freedBytes,
      outcome.freedBasis,
    ]),
  ];
}

describe("runMachineFreeDisk — an act whose read after it failed is still reported", () => {
  it("a removal: the cache it removed is reported with its after-figure unread, and nothing further is removed", () => {
    const machine: FakeMachine = { ...cacheMachine(), failReadAfterAct: true };

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["package-caches", "--apply", "--json"] })).toBe(
      EXIT_ERROR,
    );

    expect(machine.calls.filter((call) => call.startsWith("remove"))).toEqual([`remove ${CACHES}/pnpm`]);
    expect(stoppedOutcomes({ machine })).toEqual([
      ["READ_FAILED"],
      ["remove-tree", null, 256_000_000, "counted-at-recheck"],
    ]);
  });

  it("a removal in text: the outcome line says unread, never 0", () => {
    const machine: FakeMachine = { ...cacheMachine(), failReadAfterAct: true };

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["package-caches", "--apply"] })).toBe(EXIT_ERROR);

    expect(machine.diagnostics.at(-2)).toBe(
      "  removed pnpm: held 0.26 GB, now unread, freed 0.26 GB (its single-link files, counted at the recheck)",
    );
  });

  it("a trim: the trim that ran is reported with nothing measured", () => {
    const machine: FakeMachine = { ...dockerMachine(), failReadAfterAct: true };

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["docker-data", "--apply", "--json"] })).toBe(
      EXIT_ERROR,
    );

    expect(stoppedOutcomes({ machine })).toEqual([["READ_FAILED"], ["docker-trim", null, null, "after-read-failed"]]);
  });

  it("a Trash move: the bundle that moved is reported moved, its after-figure unread", () => {
    const machine: FakeMachine = {
      calls: [],
      diagnostics: [],
      failReadAfterAct: true,
      out: [],
      present: new Map([
        [SOURCE, dir({ bytes: 700_000_000, ino: 77, path: SOURCE })],
        [TRASH, dir({ bytes: 0, ino: 2, path: TRASH })],
      ]),
    };

    expect(
      runMachineFreeDisk({
        deps: fakeDeps({ machine }),
        rest: ["app", "--bundle", "Acme Scanner Edition", "--apply", "--json"],
      }),
    ).toBe(EXIT_ERROR);

    expect(stoppedOutcomes({ machine })).toEqual([
      ["READ_FAILED"],
      ["move-to-trash", null, 0, "none-until-trash-emptied"],
    ]);
  });
});

describe("runMachineFreeDisk — before-setup-copy", () => {
  /** A machine holding the declared checkout's pre-setup copy, 0.4 GB. */
  function copyMachine(): FakeMachine {
    return {
      calls: [],
      diagnostics: [],
      out: [],
      present: new Map([[COPY, dir({ bytes: 400_000_000, ino: 60, path: COPY })]]),
    };
  }

  it("rechecks the copy, removes it, and reports what its single-link files freed", () => {
    const machine = copyMachine();

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["before-setup-copy", "--apply"] })).toBe(EXIT_OK);

    expect(machine.calls).toEqual([
      "volume",
      "observe before-setup-copy",
      "observe before-setup-copy (recheck)",
      `remove ${COPY}`,
      "observe before-setup-copy (recheck)",
      "volume",
    ]);
    expect(machine.out.at(-2)).toBe(
      "  removed pre-setup copy: held 0.40 GB, now 0.00 GB, freed 0.40 GB (its single-link files, counted at the recheck)",
    );
  });

  it("refuses a checkout profile.json does not declare, removing nothing", () => {
    const machine: FakeMachine = { ...copyMachine(), undeclaredCheckout: true };

    expect(runMachineFreeDisk({ deps: fakeDeps({ machine }), rest: ["before-setup-copy", "--apply"] })).toBe(
      EXIT_ERROR,
    );

    expect(machine.calls.filter((call) => call.startsWith("remove"))).toEqual([]);
    expect(machine.diagnostics.at(-1)).toBe(
      `machine free-disk: ${MAIN} is not a main checkout profile.json declares, so no copy beside it is the one ruled deletable`,
    );
  });
});
