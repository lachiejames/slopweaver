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
import { err, ok, type Result } from "#lib/result.js";
import { CONSOLE_REBUILD_WAIT_MS, type RebuildWaitSeams } from "../../../builtCli/consoleRebuildWait.js";
import {
  guardInvocation as guardInvocationWith,
  type InvocationGuard,
  productionWaitSeams,
  sourceFallbackLine,
  WAITING_LINE,
} from "../../../builtCli/invocationGuard.js";
import { BUILT_TREE_VERBS } from "../../../builtCli/sourceFallbackPolicy.js";
import { type SourceLaunch, type SourceLaunchError, SourceLaunchErrors } from "../../../builtCli/sourceRestart.js";
import { scanSourceStamps } from "../../../builtCli/sourceScan.js";
import { BUILD_MANIFEST_FILE } from "../../../builtCli/staleness.js";
import { JUDGEMENT_NOTE } from "../../../hatch/render.js";
import { gitInTemp } from "../../tempGitRepo.js";

const dirs: string[] = [];

/** An ordinary verb's argv — one no stale build is barred from handing to source. */
const VERB_ARGV = ["node", "dist-cli/cli/index.js", "catalog"] as const;

/** A checkout whose source can always run, recording every root it was asked about. */
function launchable(): {
  asked: string[];
  sourceLaunch: (options: { root: string }) => Result<SourceLaunch, SourceLaunchError>;
} {
  const asked: string[] = [];
  return {
    asked,
    sourceLaunch: ({ root }) => {
      asked.push(root);
      return ok({ root });
    },
  };
}

/** The guard's own options. */
type GuardOptions = Parameters<typeof guardInvocationWith>[0];

/** The guard from a built tree, with an ordinary verb and a checkout that can run its source, unless a case says otherwise. */
function guardInvocation(
  options: Omit<GuardOptions, "argv" | "fromSource" | "sourceLaunch"> &
    Partial<Pick<GuardOptions, "argv" | "fromSource" | "sourceLaunch">>,
): Promise<InvocationGuard> {
  return guardInvocationWith({
    argv: VERB_ARGV,
    fromSource: false,
    sourceLaunch: launchable().sourceLaunch,
    ...options,
  });
}

/** The exact four-line refusal the guard draws over one detail, every line spelled out. */
function refusalOver({ detail }: { detail: string }): readonly string[] {
  return [
    `slopweaver <any verb> blocked because the built CLI in this checkout no longer describes the source beside it, so a verdict it gives is about code nobody is editing (${detail}).`,
    "Legitimate exceptions may include reproducing a defect that only the older build shows, deliberately and knowing the source has moved; the source tree is mid-rebase and the built CLI is the only working copy of the verb being run.",
    "To override use the designated escape hatch SLOPWEAVER_ALLOW_STALE_BUILD=1 slopweaver <any verb>.",
    JUDGEMENT_NOTE,
  ];
}

/** The exact four-line refusal the test checkout's one-byte edit draws. */
const STALE_REFUSAL = refusalOver({
  detail: "src/a.ts is 21 bytes, 20 at build time — rebuild with `slopweaver dev build`",
});

/** The detail an unreadable manifest under `builtRoot` draws. */
function unreadableDetail({ builtRoot }: { builtRoot: string }): string {
  return `${join(builtRoot, BUILD_MANIFEST_FILE)} is not a build manifest, so what this tree was built from is unknown`;
}

/** The detail a manifest naming the vanished checkout `root` draws. */
function vanishedDetail({ root }: { root: string }): string {
  return `the checkout it was built from (${root}) is gone, so nothing can say whether it is current`;
}

/** The exact two lines an open hatch prints over the test checkout's one-byte edit. */
function hatchLines({ builtRoot, root }: { builtRoot: string; root: string }): readonly string[] {
  return [
    "slopweaver: [stale-build] override in force — src/a.ts is 21 bytes, 20 at build time.",
    `slopweaver:   this answer comes from ${builtRoot}, built at 1970-01-01T00:00:00.000Z, NOT from ${root}/src.`,
  ];
}

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

  it("restarts an ordinary stale invocation on ITS checkout's source, with one exact line and no wait", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const { announce, events, seams, pauses } = seamsFor({ builtRoot, onPause: () => undefined });
    const { asked, sourceLaunch } = launchable();

    const guarded = await guardInvocation({ announce, builtRoot, env: {}, sourceLaunch, waitSeams: seams });

    expect(guarded).toEqual({
      disposition: "source",
      lines: [
        `slopweaver: [stale-build] ${root}: the build is behind (src/a.ts is 21 bytes, 20 at build time); running this checkout's source; \`slopweaver dev build\` restores the fast path.`,
      ],
      source: { root },
    });
    expect(asked).toEqual([root]);
    expect(pauses()).toBe(0);
    expect(events).toEqual([]);
  });

  it("never restarts or waits in a run that is already source, over a stale manifest planted beside `src/`", async () => {
    const { root } = builtCheckout();
    const besideSrc = join(root, "src");
    stamp({ builtRoot: besideSrc, root });
    pull({ root });
    // A console child's first pause re-stamps the planted manifest fresh, so a source run that waited WOULD restart.
    const { announce, events, seams, pauses } = seamsFor({
      builtRoot: besideSrc,
      onPause: () => {
        stamp({ builtRoot: besideSrc, root });
      },
    });
    const { asked, sourceLaunch } = launchable();

    const guarded = [
      await guardInvocation({
        announce,
        builtRoot: besideSrc,
        env: {},
        fromSource: true,
        sourceLaunch,
        waitSeams: seams,
      }),
      await guardInvocation({
        announce,
        builtRoot: besideSrc,
        env: { SLOPWEAVER_CONSOLE_CHILD: "1" },
        fromSource: true,
        sourceLaunch,
        waitSeams: seams,
      }),
    ];

    expect(guarded).toEqual([
      { disposition: "refuse", lines: STALE_REFUSAL },
      { disposition: "refuse", lines: STALE_REFUSAL },
    ]);
    expect(asked).toEqual([]);
    expect(pauses()).toBe(0);
    expect(events).toEqual([]);
  });

  it("words the source line as one line naming the checkout, the reason and the remedy", () => {
    expect(sourceFallbackLine({ root: "/w/seat", why: "src/x.ts has changed since the build" })).toBe(
      "slopweaver: [stale-build] /w/seat: the build is behind (src/x.ts has changed since the build); running this checkout's source; `slopweaver dev build` restores the fast path.",
    );
  });

  it("keeps the exact four-line refusal for every verb that needs the built tree, asking about no source", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const { announce, seams } = seamsFor({ builtRoot, onPause: () => undefined });
    const { asked, sourceLaunch } = launchable();

    const guarded = await Promise.all(
      BUILT_TREE_VERBS.map(({ noun, verb }) =>
        guardInvocation({
          announce,
          argv: ["node", "dist-cli/cli/index.js", noun, verb, "--json"],
          builtRoot,
          env: {},
          sourceLaunch,
          waitSeams: seams,
        }),
      ),
    );

    expect(guarded).toEqual(BUILT_TREE_VERBS.map(() => ({ disposition: "refuse", lines: STALE_REFUSAL })));
    expect(asked).toEqual([]);
  });

  it("keeps the exact four-line refusal when the checkout cannot run its own source, for each reason", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const { announce, seams } = seamsFor({ builtRoot, onPause: () => undefined });
    const reasons: readonly SourceLaunchError[] = [
      SourceLaunchErrors.noExecve({ version: "v0.0.0" }),
      SourceLaunchErrors.fileMissing({
        code: "NO_TSX_PREFLIGHT",
        path: join(root, "node_modules/tsx/dist/preflight.cjs"),
      }),
      SourceLaunchErrors.fileMissing({ code: "NO_TSX_LOADER", path: join(root, "node_modules/tsx/dist/loader.mjs") }),
      SourceLaunchErrors.fileMissing({ code: "NO_SOURCE_ENTRY", path: join(root, "src/cli/index.ts") }),
    ];

    const guarded = await Promise.all(
      reasons.map((reason) =>
        guardInvocation({ announce, builtRoot, env: {}, sourceLaunch: () => err(reason), waitSeams: seams }),
      ),
    );

    expect(guarded).toEqual(reasons.map(() => ({ disposition: "refuse", lines: STALE_REFUSAL })));
  });

  it("runs an ordinary stale invocation under the open hatch from the build, never the source", async () => {
    const { builtRoot, root } = builtCheckout();
    pull({ root });
    const { announce, seams } = seamsFor({ builtRoot, onPause: () => undefined });
    const { asked, sourceLaunch } = launchable();

    const guarded = await guardInvocation({
      announce,
      builtRoot,
      env: { SLOPWEAVER_ALLOW_STALE_BUILD: "1" },
      sourceLaunch,
      waitSeams: seams,
    });

    expect(guarded).toEqual({ disposition: "run", lines: hatchLines({ builtRoot, root }) });
    expect(guarded.lines.length).toBe(2);
    expect(asked).toEqual([]);
  });

  it("refuses an ordinary invocation over an unreadable manifest or a vanished checkout, naming no source", async () => {
    const unreadable = builtCheckout();
    writeFileSync(join(unreadable.builtRoot, BUILD_MANIFEST_FILE), "{}");
    const vanished = builtCheckout();
    writeFileSync(
      join(vanished.builtRoot, BUILD_MANIFEST_FILE),
      JSON.stringify({ builtAtIso: new Date(0).toISOString(), root: `${vanished.root}-gone`, stamps: [] }),
    );
    const { asked, sourceLaunch } = launchable();

    const guarded = await Promise.all(
      [unreadable, vanished].map(({ builtRoot }) => {
        const { announce, seams } = seamsFor({ builtRoot, onPause: () => undefined });
        return guardInvocation({ announce, builtRoot, env: {}, sourceLaunch, waitSeams: seams });
      }),
    );

    expect(guarded).toEqual([
      { disposition: "refuse", lines: refusalOver({ detail: unreadableDetail({ builtRoot: unreadable.builtRoot }) }) },
      { disposition: "refuse", lines: refusalOver({ detail: vanishedDetail({ root: `${vanished.root}-gone` }) }) },
    ]);
    expect(asked).toEqual([]);
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

    expect(guarded).toEqual({ disposition: "run", lines: hatchLines({ builtRoot, root }) });
    expect(guarded.lines.length).toBe(2);
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

    expect(guarded).toEqual({ disposition: "refuse", lines: refusalOver({ detail: unreadableDetail({ builtRoot }) }) });
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

    expect(guarded).toEqual({
      disposition: "refuse",
      lines: refusalOver({ detail: vanishedDetail({ root: `${root}-gone` }) }),
    });
    expect(pauses()).toBe(0);
  });
});
