/**
 * The order between the staleness guard and the console wait, over a REAL throwaway git checkout with the real
 * manifest read and judgement (`productionWaitSeams`) — only the clock and the pause are fakes, and the pause is
 * where a test plays the rebuild a pull starts.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { CONSOLE_REBUILD_WAIT_MS, type RebuildWaitSeams } from "../../../builtCli/consoleRebuildWait.js";
import { guardInvocation, productionWaitSeams, WAITING_LINE } from "../../../builtCli/invocationGuard.js";
import { scanSourceStamps } from "../../../builtCli/sourceScan.js";
import { BUILD_MANIFEST_FILE } from "../../../builtCli/staleness.js";
import { gitInTemp } from "../../tempGitRepo.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/** A throwaway checkout with one tracked source file and a manifest written from it, as `dev build` writes one. */
function builtCheckout(): { root: string; builtRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "invocation-guard-"));
  dirs.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  gitInTemp({ args: ["init", "-q"], cwd: root });
  gitInTemp({ args: ["add", "-A"], cwd: root });
  const builtRoot = join(root, "dist-cli");
  mkdirSync(builtRoot, { recursive: true });
  stamp({ builtRoot, root });
  return { builtRoot, root };
}

/** Write the manifest from the source as it stands — what a finished rebuild leaves. */
function stamp({ builtRoot, root }: { builtRoot: string; root: string }): void {
  writeFileSync(
    join(builtRoot, BUILD_MANIFEST_FILE),
    JSON.stringify({ builtAtIso: new Date(0).toISOString(), root, stamps: scanSourceStamps({ root }) }),
  );
}

/**
 * The real read and judgement over a fake clock. `onPause` runs at each pause, given its index — where a test
 * deletes the manifest or re-stamps it, as the emit would. Counts every pause so a test can tell a wait from none,
 * and logs every announced line and pause in order, so a test can pin that the announcement comes first.
 */
function seamsFor({
  builtRoot,
  onAnnounce = () => undefined,
  onPause,
}: {
  builtRoot: string;
  onAnnounce?: () => void;
  onPause: (index: number) => void;
}): {
  announce: (line: string) => void;
  events: readonly string[];
  seams: RebuildWaitSeams;
  pauses: () => number;
} {
  let now = 0;
  let count = 0;
  const events: string[] = [];
  return {
    announce: (line) => {
      events.push(line);
      onAnnounce();
    },
    events,
    pauses: () => count,
    seams: {
      ...productionWaitSeams({ builtRoot }),
      nowMs: () => now,
      pause: ({ ms }) => {
        events.push(`pause ${String(count)}`);
        onPause(count);
        count += 1;
        now += ms;
        return Promise.resolve();
      },
    },
  };
}

/** Move the source the way a pull does. */
function pull({ root }: { root: string }): void {
  writeFileSync(join(root, "src/a.ts"), "export const a = 11;\n");
}

describe("guardInvocation", () => {
  it("runs a fresh build without waiting or announcing a wait, console child or not", async () => {
    const { builtRoot } = builtCheckout();
    const { announce, events, seams, pauses } = seamsFor({ builtRoot, onPause: () => undefined });

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_CONSOLE_CHILD: "1" },
      waitSeams: seams,
    });

    expect(guarded).toEqual({ disposition: "run", lines: [] });
    expect(pauses()).toBe(0);
    expect(events).toEqual([]);
  });

  it("refuses an ordinary stale invocation AT ONCE, with the four-line refusal and no announced wait", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const { announce, events, seams, pauses } = seamsFor({ builtRoot, onPause: () => undefined });

    const guarded = await guardInvocation({ announce, builtRoot, env: {}, waitSeams: seams });

    expect(guarded.disposition).toBe("refuse");
    expect(guarded.lines.length).toBe(4);
    expect(guarded.lines[0]).toContain("src/a.ts is 21 bytes, 20 at build time");
    expect(pauses()).toBe(0);
    expect(events).toEqual([]);
  });

  it("announces the wait BEFORE its first pause, so a rebuild landing on the announcement is seen", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const { announce, events, seams } = seamsFor({
      builtRoot,
      onAnnounce: () => {
        stamp({ builtRoot, root });
      },
      onPause: () => undefined,
    });

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_CONSOLE_CHILD: "1" },
      waitSeams: seams,
    });

    expect(guarded).toEqual({
      disposition: "restart",
      lines: [
        "slopweaver: [stale-build] a rebuild landed 250ms into this console read — restarting on the fresh build.",
      ],
    });
    expect(events).toEqual([WAITING_LINE, "pause 0"]);
    expect(WAITING_LINE).toBe(
      "slopweaver: [stale-build] this build is stale; this console read waits up to 30s for a rebuild to land.",
    );
  });

  it("restarts a console child once the rebuild it waited for lands — through the emit's missing manifest", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const { announce, events, seams } = seamsFor({
      builtRoot,
      onPause: (index) => {
        if (index === 0) {
          rmSync(join(builtRoot, BUILD_MANIFEST_FILE));
        }
        if (index === 2) {
          stamp({ builtRoot, root });
        }
      },
    });

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_CONSOLE_CHILD: "1" },
      waitSeams: seams,
    });

    expect(guarded).toEqual({
      disposition: "restart",
      lines: [
        "slopweaver: [stale-build] a rebuild landed 750ms into this console read — restarting on the fresh build.",
      ],
    });
    expect(events).toEqual([WAITING_LINE, "pause 0", "pause 1", "pause 2"]);
  });

  it("refuses a console child at the bound when no rebuild lands, naming the wait above the refusal", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const { announce, seams, pauses } = seamsFor({ builtRoot, onPause: () => undefined });

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_CONSOLE_CHILD: "1" },
      waitSeams: seams,
    });

    expect(guarded.disposition).toBe("refuse");
    expect(guarded.lines[0]).toBe(
      "slopweaver: [stale-build] this console read waited 30s for a rebuild, and no fresh build landed.",
    );
    expect(guarded.lines[3]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_STALE_BUILD=1 slopweaver <any verb>.",
    );
    expect(pauses()).toBe(CONSOLE_REBUILD_WAIT_MS / 250);
  });

  it("never takes a manifest naming another directory as fresh, even one that scans empty against empty stamps", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const elsewhere = mkdtempSync(join(tmpdir(), "invocation-guard-elsewhere-"));
    dirs.push(elsewhere);
    const { announce, seams, pauses } = seamsFor({
      builtRoot,
      onPause: (index) => {
        if (index === 0) {
          writeFileSync(
            join(builtRoot, BUILD_MANIFEST_FILE),
            JSON.stringify({ builtAtIso: new Date(0).toISOString(), root: elsewhere, stamps: [] }),
          );
        }
      },
    });

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_CONSOLE_CHILD: "1" },
      waitSeams: seams,
    });

    expect(guarded.disposition).toBe("refuse");
    expect(guarded.lines[0]).toBe(
      "slopweaver: [stale-build] this console read waited 30s for a rebuild, and no fresh build landed.",
    );
    expect(pauses()).toBe(CONSOLE_REBUILD_WAIT_MS / 250);
  });

  it("never takes a manifest repeating a path as fresh, even when its last stamp matches", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const { announce, seams, pauses } = seamsFor({
      builtRoot,
      onPause: (index) => {
        if (index === 0) {
          const current = scanSourceStamps({ root });
          const old = { ...current[0]!, size: current[0]!.size - 1 };
          writeFileSync(
            join(builtRoot, BUILD_MANIFEST_FILE),
            JSON.stringify({ builtAtIso: new Date(0).toISOString(), root, stamps: [old, ...current] }),
          );
        }
      },
    });

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_CONSOLE_CHILD: "1" },
      waitSeams: seams,
    });

    expect(guarded.disposition).toBe("refuse");
    expect(pauses()).toBe(CONSOLE_REBUILD_WAIT_MS / 250);
  });

  it("never blocks on a manifest replaced by a FIFO, so the wait still ends at its bound", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const manifestPath = join(builtRoot, BUILD_MANIFEST_FILE);
    const { announce, seams, pauses } = seamsFor({
      builtRoot,
      onPause: (index) => {
        if (index === 0) {
          rmSync(manifestPath);
          execFileSync("mkfifo", [manifestPath]);
        }
      },
    });

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_CONSOLE_CHILD: "1" },
      waitSeams: seams,
    });

    expect(guarded.disposition).toBe("refuse");
    expect(pauses()).toBe(CONSOLE_REBUILD_WAIT_MS / 250);
  });

  it("lets an open hatch run a console child at once — the marker can neither close nor delay it", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const { announce, seams, pauses } = seamsFor({ builtRoot, onPause: () => undefined });

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_ALLOW_STALE_BUILD: "1", SLOPWEAVER_CONSOLE_CHILD: "1" },
      waitSeams: seams,
    });

    expect(guarded.disposition).toBe("run");
    expect(guarded.lines[0]).toContain("[stale-build] override in force");
    expect(pauses()).toBe(0);
  });

  it("never waits out an unreadable manifest, which proves no rebuild in flight", async () => {
    const { builtRoot } = builtCheckout();
    writeFileSync(join(builtRoot, BUILD_MANIFEST_FILE), "{}");
    const { announce, seams, pauses } = seamsFor({ builtRoot, onPause: () => undefined });

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_CONSOLE_CHILD: "1" },
      waitSeams: seams,
    });

    expect(guarded.disposition).toBe("refuse");
    expect(guarded.lines[0]).toContain("is not a build manifest");
    expect(pauses()).toBe(0);
  });

  it("never waits out a build whose checkout is gone", async () => {
    const { builtRoot, root } = builtCheckout();
    writeFileSync(
      join(builtRoot, BUILD_MANIFEST_FILE),
      JSON.stringify({ builtAtIso: new Date(0).toISOString(), root: `${root}-gone`, stamps: [] }),
    );
    const { announce, seams, pauses } = seamsFor({ builtRoot, onPause: () => undefined });

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_CONSOLE_CHILD: "1" },
      waitSeams: seams,
    });

    expect(guarded.disposition).toBe("refuse");
    expect(guarded.lines[0]).toContain("is gone, so nothing can say whether it is current");
    expect(pauses()).toBe(0);
  });
});
