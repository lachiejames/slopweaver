/**
 * `slopweaver atlas freshness` over a throwaway home — the sweep reading a real manifest and a real
 * live-read stamp off disk, through the real registry.
 *
 * The registry seam is injected as a plain function returning a hand-built registration, which is how a
 * platform's window and commands are stated without inventing a thirty-seventh atlas.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recordAtlasLiveRead } from "../../../../../atlas/kit/liveReadStamp.js";
import { VANTA_ATLAS_DESCRIPTOR } from "../../../../../atlas/vanta/descriptor.js";
import { type AtlasFreshnessDeps, runAtlasFreshness } from "../../../../../cli/commands/atlas/freshnessRun.js";
import { unwrap } from "../../../../../lib/result.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A home whose vanta atlas carries a manifest stamped at `updatedAt`. */
function homeWithVanta({ updatedAt }: { updatedAt: string | null }): string {
  const home = mkdtempSync(join(tmpdir(), "af-"));
  homes.push(home);
  const dir = join(home, "atlas", "vanta");
  mkdirSync(dir, { recursive: true });
  if (updatedAt !== null) {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ kinds: {}, schemaVersion: 1, updatedAt }), "utf8");
  }
  return home;
}

/** Recording edges over a registry holding vanta alone. */
function deps(): AtlasFreshnessDeps & { readonly out: string[]; readonly diag: string[] } {
  const out: string[] = [];
  const diag: string[] = [];
  return {
    diag,
    find: ({ platform }) =>
      platform === "vanta"
        ? {
            catalogue: { doorRouted: false, example: "slopweaver atlas x read", summary: null },
            platform,
            readDescriptor: () => Promise.resolve(VANTA_ATLAS_DESCRIPTOR),
            readSnapshot: () => Promise.reject(new Error("atlas freshness never reads a snapshot")),
            verbs: [],
          }
        : null,
    now: () => "2026-09-08T12:00:00.000Z",
    out,
    platforms: () => ["vanta"],
    writeDiagnostic: (line) => diag.push(line),
    writeOut: (line) => out.push(line),
  };
}

/** The full argv one invocation of this verb receives. */
function argvFor({ home, tail = [] }: { home: string; tail?: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "atlas", "freshness", "--home", home, ...tail];
}

describe("atlas freshness", () => {
  it("reads the manifest clock and calls a recent generation current, exiting clean", async () => {
    const home = homeWithVanta({ updatedAt: "2026-09-08T11:00:00.000Z" });
    const injected = deps();
    const code = await runAtlasFreshness({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(0);
    expect(injected.out[0]).toBe("atlas vanta · current · generation is 1.0h old, inside 4h");
  });

  it("calls a generation past four hours BEHIND and exits non-zero so a tick can act", async () => {
    const home = homeWithVanta({ updatedAt: "2026-09-08T02:00:00.000Z" });
    const injected = deps();
    const code = await runAtlasFreshness({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.out[0]).toBe(
      "atlas vanta · BEHIND · generation is 10.0h old, past 4h — slopweaver atlas vanta control-evidence --control <id>",
    );
  });

  it("counts a bounded live read inside the window as fresh, over a generation that is not", async () => {
    const home = homeWithVanta({ updatedAt: "2026-09-08T02:00:00.000Z" });
    unwrap(
      recordAtlasLiveRead({
        atIso: "2026-09-08T11:55:00.000Z",
        atlasDir: join(home, "atlas", "vanta"),
        scope: "control ctrl-42",
        verb: "atlas vanta control-evidence",
      }),
    );
    const injected = deps();
    const code = await runAtlasFreshness({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(0);
    expect(injected.out[0]).toBe("atlas vanta · current · a bounded live read 5.0m ago is inside 4h");
  });

  it("treats an atlas with no published generation as behind", async () => {
    const home = homeWithVanta({ updatedAt: null });
    const injected = deps();
    const code = await runAtlasFreshness({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.out[0]).toContain("BEHIND · no generation has been published");
  });

  it("judges against an explicit --window instead of the atlas's own", async () => {
    const home = homeWithVanta({ updatedAt: "2026-09-08T02:00:00.000Z" });
    const injected = deps();
    const code = await runAtlasFreshness({ argv: argvFor({ home, tail: ["--window", "7d"] }), deps: injected });
    expect(code).toBe(0);
    expect(injected.out[0]).toBe("atlas vanta · current · generation is 10.0h old, inside 7d");
  });

  it("answers --json with the counts a scheduled row reads", async () => {
    const home = homeWithVanta({ updatedAt: "2026-09-08T02:00:00.000Z" });
    const injected = deps();
    await runAtlasFreshness({ argv: argvFor({ home, tail: ["--json"] }), deps: injected });
    const payload: unknown = JSON.parse(injected.out.join("\n"));
    expect(payload).toMatchObject({ behind: 1, judged: 1, nowIso: "2026-09-08T12:00:00.000Z" });
  });

  it("refuses a platform this build has no atlas for", async () => {
    const home = homeWithVanta({ updatedAt: null });
    const injected = deps();
    const code = await runAtlasFreshness({ argv: argvFor({ home, tail: ["nope"] }), deps: injected });
    expect(code).toBe(2);
    expect(injected.diag[0]).toContain("no atlas for platform nope");
  });

  it("prints its usage and exits clean on --help", async () => {
    const injected = deps();
    const code = await runAtlasFreshness({
      argv: ["node", "slopweaver", "atlas", "freshness", "--help"],
      deps: injected,
    });
    expect(code).toBe(0);
    expect(injected.out[0]).toContain("usage: slopweaver atlas freshness");
  });
});
