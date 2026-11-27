import { describe, expect, it } from "vitest";

import {
  DEV_BUILD_LOCK_TIMEOUT_SECONDS,
  DEV_BUILD_RSS_CEILING_MIB,
  DEV_BUILD_SPAWN_TIMEOUT_MS,
  DEV_BUILD_TIMEOUT_SECONDS,
  devBuildOwnerVerdict,
  ownedEsbuildArgv,
  ownerEmitted,
  ownerFailureLine,
} from "../../../../../cli/commands/dev/buildOwner.js";

const LOCK = "TSC_OWNER_LOCK mode=acquired waitedSeconds=0 holderPid=4242";
const START = "TSC_OWNER_START pid=4300 pgid=4300 startHex=abc";

/** A RESULT record, its fields overridable. */
const result = ({
  outcome,
  commandExit = "none",
  peak = "1024",
}: {
  outcome: string;
  commandExit?: string;
  peak?: string;
}): string =>
  `TSC_OWNER_RESULT outcome=${outcome} commandExit=${commandExit} peakRssKiB=${peak} pid=4300 pgid=4300 startHex=abc`;

const stderrOf = (...lines: string[]): string => `${lines.join("\n")}\n`;

const verdictOf = ({ status, stderr }: { status: number | null; stderr: string }) =>
  devBuildOwnerVerdict({ spawnError: undefined, status, stderr });

describe("the dev build bounds", () => {
  it("sets the hard ceiling above the largest measured legitimate build and well under the 28 GB event", () => {
    expect(DEV_BUILD_RSS_CEILING_MIB).toBe(16_384);
    expect(DEV_BUILD_RSS_CEILING_MIB * 1024 * 1024).toBeGreaterThan(14_902_345_728);
    expect(DEV_BUILD_RSS_CEILING_MIB * 1024 * 1024).toBeLessThan(28_000_000_000);
  });

  it("fits the lease wait, the emit, the grace and the owner's settle inside the spawn's own bound, and that under provisioning's 300 s", () => {
    expect((DEV_BUILD_LOCK_TIMEOUT_SECONDS + DEV_BUILD_TIMEOUT_SECONDS + 5 + 5) * 1000).toBeLessThan(
      DEV_BUILD_SPAWN_TIMEOUT_MS,
    );
    expect(DEV_BUILD_SPAWN_TIMEOUT_MS).toBeLessThan(300_000);
  });
});

describe("ownedEsbuildArgv", () => {
  it("runs the checkout's own esbuild after `--`, under every bound the owner takes", () => {
    expect(ownedEsbuildArgv({ esbuildArgs: ["src/a.ts", "--outdir=/repo/dist-cli"], root: "/repo" })).toEqual([
      "/repo/scripts/tsc-owner.sh",
      "--timeout-seconds",
      "120",
      "--grace-seconds",
      "5",
      "--rss-ceiling-mib",
      "16384",
      "--lock-timeout-seconds",
      "120",
      "--go-memory-limit-mib",
      "4096",
      "--",
      "/repo/node_modules/.bin/esbuild",
      "src/a.ts",
      "--outdir=/repo/dist-cli",
    ]);
  });
});

describe("devBuildOwnerVerdict", () => {
  it("reads a clean emit with no wait as built", () => {
    const stderr = stderrOf(LOCK, START, result({ commandExit: "0", outcome: "exited" }));
    expect(verdictOf({ status: 0, stderr })).toEqual({ kind: "built", lockMode: "acquired" });
  });

  it("reads an inherited lease as built, naming the mode", () => {
    const lock = "TSC_OWNER_LOCK mode=inherited waitedSeconds=0 holderPid=1";
    const stderr = stderrOf(lock, START, result({ commandExit: "0", outcome: "exited" }));
    expect(verdictOf({ status: 0, stderr })).toEqual({ kind: "built", lockMode: "inherited" });
  });

  it("reads a clean emit after a wait for the lease as waited-out", () => {
    const stderr = stderrOf(
      "tsc-owner: waiting for the machine's TypeScript compile lease at /x, held by pid 9",
      "TSC_OWNER_LOCK mode=acquired waitedSeconds=14 holderPid=4242",
      START,
      result({ commandExit: "0", outcome: "exited" }),
    );
    expect(verdictOf({ status: 0, stderr })).toEqual({ kind: "waited-out", lockMode: "acquired", waitedSeconds: 14 });
  });

  it("reads a lease never obtained as refused", () => {
    const stderr = stderrOf(
      "tsc-owner: the lease was still held after 120s, so nothing ran",
      result({ outcome: "lock-timed-out" }),
    );
    expect(verdictOf({ status: 75, stderr })).toEqual({ kind: "refused" });
  });

  it("reads the RSS ceiling as killed, carrying the sampled peak", () => {
    const stderr = stderrOf(LOCK, START, result({ outcome: "rss-ceiling", peak: "16800000" }));
    expect(verdictOf({ status: 126, stderr })).toEqual({ kind: "killed", peakRssKiB: 16_800_000 });
  });

  it("reads the emit's own timeout as timed-out", () => {
    const stderr = stderrOf(LOCK, START, result({ outcome: "timed-out" }));
    expect(verdictOf({ status: 124, stderr })).toEqual({ kind: "timed-out" });
  });

  it("reads a signal to the owner as cancelled, naming which", () => {
    const stderr = stderrOf(LOCK, START, result({ outcome: "cancelled-term" }));
    expect(verdictOf({ status: 143, stderr })).toEqual({ kind: "cancelled", outcome: "cancelled-term" });
  });

  it("reads an owner error with the owner's LAST prose line, past its waiting line", () => {
    const stderr = stderrOf(
      "tsc-owner: waiting for the machine's TypeScript compile lease at /x, held by pid 9",
      "tsc-owner: ps could not be read",
      result({ outcome: "owner-error" }),
    );
    expect(verdictOf({ status: 125, stderr })).toEqual({
      detail: "tsc-owner: ps could not be read",
      kind: "owner-error",
    });
  });

  it("reads a non-zero esbuild exit as esbuild-failed with esbuild's first line", () => {
    const stderr = stderrOf(
      LOCK,
      START,
      '✘ [ERROR] Expected ";" but found "}"',
      "  src/a.ts:3:1:",
      result({ commandExit: "1", outcome: "exited" }),
    );
    expect(verdictOf({ status: 1, stderr })).toEqual({
      commandExit: 1,
      detail: '✘ [ERROR] Expected ";" but found "}"',
      kind: "esbuild-failed",
    });
  });

  it("puts a spawn error ahead of every record, so a spawn killed at its own bound is never a success", () => {
    const stderr = stderrOf(LOCK, START, result({ commandExit: "0", outcome: "exited" }));
    expect(devBuildOwnerVerdict({ spawnError: new Error("spawnSync bash ETIMEDOUT"), status: 0, stderr })).toEqual({
      detail: "spawnSync bash ETIMEDOUT",
      kind: "spawn-failed",
    });
  });

  it.each([
    { name: "no result record", status: 0, stderr: stderrOf(LOCK, START) },
    {
      name: "two result records",
      status: 0,
      stderr: stderrOf(
        LOCK,
        START,
        result({ commandExit: "0", outcome: "exited" }),
        result({ commandExit: "0", outcome: "exited" }),
      ),
    },
    {
      name: "an exit that disagrees with the outcome",
      status: 0,
      stderr: stderrOf(result({ outcome: "rss-ceiling" })),
    },
    {
      name: "a command exit that disagrees with the owner's",
      status: 0,
      stderr: stderrOf(LOCK, START, result({ commandExit: "1", outcome: "exited" })),
    },
    {
      name: "a clean exit with no lease record",
      status: 0,
      stderr: stderrOf(START, result({ commandExit: "0", outcome: "exited" })),
    },
    {
      name: "a clean exit with no start record",
      status: 0,
      stderr: stderrOf(LOCK, result({ commandExit: "0", outcome: "exited" })),
    },
    {
      name: "a lease mode the owner never writes",
      status: 0,
      stderr: stderrOf(
        "TSC_OWNER_LOCK mode=nonsense waitedSeconds=0 holderPid=4242",
        START,
        result({ commandExit: "0", outcome: "exited" }),
      ),
    },
    {
      name: "a lease record naming no holder",
      status: 0,
      stderr: stderrOf(
        "TSC_OWNER_LOCK mode=acquired waitedSeconds=0 holderPid=",
        START,
        result({ commandExit: "0", outcome: "exited" }),
      ),
    },
    {
      name: "a start record with no process group",
      status: 0,
      stderr: stderrOf(LOCK, "TSC_OWNER_START pid=4300 startHex=abc", result({ commandExit: "0", outcome: "exited" })),
    },
    {
      name: "a result record naming another job than the start record",
      status: 0,
      stderr: stderrOf(
        LOCK,
        START,
        "TSC_OWNER_RESULT outcome=exited commandExit=0 peakRssKiB=1024 pid=9999 pgid=9999 startHex=def",
      ),
    },
    {
      name: "a result record whose start time alone disagrees",
      status: 0,
      stderr: stderrOf(
        LOCK,
        START,
        "TSC_OWNER_RESULT outcome=exited commandExit=0 peakRssKiB=1024 pid=4300 pgid=4300 startHex=def",
      ),
    },
    {
      name: "a result record that writes its outcome twice",
      status: 0,
      stderr: stderrOf(
        LOCK,
        START,
        "TSC_OWNER_RESULT outcome=rss-ceiling outcome=exited commandExit=0 peakRssKiB=1024 pid=4300 pgid=4300 startHex=abc",
      ),
    },
    {
      name: "a lease record carrying a field with no key",
      status: 0,
      stderr: stderrOf(
        "TSC_OWNER_LOCK mode=acquired waitedSeconds=0 holderPid=4242 stray",
        START,
        result({ commandExit: "0", outcome: "exited" }),
      ),
    },
    {
      name: "two start records",
      status: 0,
      stderr: stderrOf(LOCK, START, START, result({ commandExit: "0", outcome: "exited" })),
    },
    { name: "an unknown outcome", status: 0, stderr: stderrOf(result({ outcome: "vanished" })) },
    {
      name: "a ceiling kill with no readable peak",
      status: 126,
      stderr: stderrOf(result({ outcome: "rss-ceiling", peak: "none" })),
    },
    { name: "an owner ended by a signal", status: null, stderr: "" },
  ])("fails closed on $name, never reading it as a success", ({ status, stderr }) => {
    expect(verdictOf({ status, stderr }).kind).toBe("invalid-owner-report");
  });
});

describe("ownerEmitted", () => {
  it("admits built and waited-out, and nothing else", () => {
    expect(ownerEmitted({ verdict: { kind: "built", lockMode: "acquired" } })).toBe(true);
    expect(ownerEmitted({ verdict: { kind: "waited-out", lockMode: "acquired", waitedSeconds: 3 } })).toBe(true);
    expect(ownerEmitted({ verdict: { kind: "refused" } })).toBe(false);
    expect(ownerEmitted({ verdict: { kind: "killed", peakRssKiB: 1 } })).toBe(false);
    expect(ownerEmitted({ verdict: { detail: "x", kind: "invalid-owner-report" } })).toBe(false);
  });
});

describe("ownerFailureLine", () => {
  const tail = "dist-cli is left unstamped and this checkout runs from source until a `slopweaver dev build` succeeds";

  it("prints nothing for a run that emitted", () => {
    expect(ownerFailureLine({ verdict: { kind: "built", lockMode: "acquired" } })).toBeUndefined();
    expect(
      ownerFailureLine({ verdict: { kind: "waited-out", lockMode: "acquired", waitedSeconds: 3 } }),
    ).toBeUndefined();
  });

  it("names a refusal on the lease, in one line", () => {
    expect(ownerFailureLine({ verdict: { kind: "refused" } })).toBe(
      `dev build: refused — the machine's compile lease stayed held past 120s, so esbuild never ran; ${tail}`,
    );
  });

  it("names a kill on the ceiling with the sampled peak, in one line", () => {
    expect(ownerFailureLine({ verdict: { kind: "killed", peakRssKiB: 17_203_200 } })).toBe(
      `dev build: killed — esbuild's process group passed the 16384 MiB resident-memory ceiling (peak 16800 MiB sampled); ${tail}`,
    );
  });

  it("names an esbuild failure by its exit and first line", () => {
    expect(ownerFailureLine({ verdict: { commandExit: 1, detail: "✘ [ERROR] bad", kind: "esbuild-failed" } })).toBe(
      `dev build: esbuild exited 1 — ✘ [ERROR] bad; ${tail}`,
    );
  });

  it("says a silent owner error refused without saying why rather than printing an empty cause", () => {
    expect(ownerFailureLine({ verdict: { detail: "", kind: "owner-error" } })).toBe(
      `dev build: owner error — the owner refused without saying why; ${tail}`,
    );
  });

  it("keeps every failure to one line", () => {
    const failures = [
      { kind: "refused" },
      { kind: "killed", peakRssKiB: 1 },
      { kind: "timed-out" },
      { kind: "cancelled", outcome: "cancelled-int" },
      { detail: "tsc-owner: x", kind: "owner-error" },
      { commandExit: 2, detail: "y", kind: "esbuild-failed" },
      { detail: "z", kind: "spawn-failed" },
      { detail: "w", kind: "invalid-owner-report" },
    ] as const;
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.map((verdict) => ownerFailureLine({ verdict })!.includes("\n"))).toEqual(failures.map(() => false));
  });
});
