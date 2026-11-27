/**
 * `seatStoppedRecipes` driven directly, its child launcher a plain recording fake: the acts it launches for an
 * unheld set, and the reads that make it launch nothing. The whole verb around it is `tick/*.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ScratchDeps } from "../../../../../cli/commands/supervisor/scratchDeps.js";
import { seatStoppedRecipes } from "../../../../../cli/commands/supervisor/tickOpenStoppedRecipes.js";
import { EXIT_DEFERRED } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { repairSlugOf } from "../../../../../supervisor/stoppedRecipeSeat.js";
import { memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";

const EPISODE = "bump-fix-slopweaver-f9f0c5d6eeecb3b9";

/** A live reading: the owner's closed card, still carrying the set no seat holds. */
const STOPPED = {
  kind: "json",
  value: {
    actions: [],
    readings: [
      {
        monitorId: "recipe-stopped",
        state: "steered",
        steers: [
          {
            count: 1,
            instead: "you closed this card, and none of its recipes has run since",
            repair: { episodeKey: EPISODE, recipeIds: ["bump-fix-slopweaver"] },
            steerId: "closed-by-owner",
          },
        ],
      },
    ],
  },
} as const;

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A board reading with no row of the episode on it. */
function board({ fleet }: { fleet: "observed" | "unavailable" }): { kind: "json"; value: unknown } {
  return { kind: "json", value: { aligned: [], fleet, held: [], misaligned: [], ready: [], unprioritised: [] } };
}

/** Scratch seams whose child launcher records every argv and exits 0 (`cmux spawn` exits `spawnExit`). */
function recording({ spawnExit = 0 }: { spawnExit?: number } = {}): {
  deps: ScratchDeps;
  launched: (readonly string[])[];
} {
  const launched: (readonly string[])[] = [];
  const deps: ScratchDeps = {
    ambientHome: () => "/ambient/home",
    autonomy: memoryAutonomyLedgerPort(),
    defaultBin: () => "slopweaver",
    defaultRepo: () => ok("o/r"),
    now: () => "2026-10-13T13:20:00.000Z",
    readBuild: () => ({ kind: "unbuilt" }),
    recordReading: () => ok("unused"),
    runChild: async ({ argv }) => {
      launched.push(argv);
      return { durationMs: 1, exitCode: argv[0] === "cmux" ? spawnExit : 0, kind: "exited" };
    },
    waitForBuild: () => Promise.reject(new Error("seating never waits for a rebuild")),
    writeDiagnostic: () => undefined,
    writeOut: () => undefined,
  };
  return { deps, launched };
}

/** A throwaway home with its handovers and runs directories. */
function home(): { handoverDir: string; runsDir: string; captureDir: string } {
  const root = mkdtempSync(join(tmpdir(), "seat-stopped-"));
  dirs.push(root);
  const paths = { captureDir: join(root, "tick"), handoverDir: join(root, "handovers"), runsDir: join(root, "runs") };
  mkdirSync(paths.captureDir);
  return paths;
}

describe("seatStoppedRecipes", () => {
  it("registers one p0 repair row in the checkout and spawns it on opus, the same tick", async () => {
    const { deps, launched } = recording();
    const slug = repairSlugOf({ episodeKey: EPISODE, tickId: "handoff-9323-tick-4" });
    const seated = await seatStoppedRecipes({
      ...home(),
      bin: "slopweaver",
      checkout: () => ok("/checkout"),
      deps,
      home: undefined,
      reconcile: board({ fleet: "observed" }),
      stopped: STOPPED,
      tickId: "handoff-9323-tick-4",
    });

    expect(launched.map((argv) => argv.slice(0, 2).join(" "))).toEqual(["handover register", "cmux spawn"]);
    expect(launched[1]).toEqual(["cmux", "spawn", slug, "--model", "opus"]);
    expect(seated.actions.map(({ kind, outcome }) => `${kind}:${outcome}`)).toEqual([
      "state-amended:completed",
      "spawned:completed",
    ]);
    expect(seated.lines).toEqual([`stopped recipes: seated ${slug} on opus`]);
  });

  it("records a spawn the backoff deferred as held, never failed, and names the next tick's retry", async () => {
    const { deps } = recording({ spawnExit: EXIT_DEFERRED });
    const slug = repairSlugOf({ episodeKey: EPISODE, tickId: "handoff-9323-tick-4" });
    const seated = await seatStoppedRecipes({
      ...home(),
      bin: "slopweaver",
      checkout: () => ok("/checkout"),
      deps,
      home: undefined,
      reconcile: board({ fleet: "observed" }),
      stopped: STOPPED,
      tickId: "handoff-9323-tick-4",
    });

    expect(seated.actions.map(({ kind, outcome }) => `${kind}:${outcome}`)).toEqual([
      "state-amended:completed",
      "spawned:held",
    ]);
    expect(seated.lines).toEqual([
      `stopped recipes: the spawn backoff deferred ${slug} (exit 4), so the next tick spawns it again — or hold it before close`,
    ]);
  });

  it("launches nothing when cmux was unread", async () => {
    const { deps, launched } = recording();
    const seated = await seatStoppedRecipes({
      ...home(),
      bin: "slopweaver",
      checkout: () => ok("/checkout"),
      deps,
      home: undefined,
      reconcile: board({ fleet: "unavailable" }),
      stopped: STOPPED,
      tickId: "handoff-9323-tick-4",
    });

    expect(launched).toEqual([]);
    expect(seated.lines).toEqual([
      "stopped recipes: nothing seated — with cmux unread, a seat on this stop cannot be ruled out",
    ]);
  });

  it("launches nothing when no checkout resolves to cut the seat from", async () => {
    const { deps, launched } = recording();
    const seated = await seatStoppedRecipes({
      ...home(),
      bin: "slopweaver",
      checkout: () => err(["no declared main checkout"]),
      deps,
      home: undefined,
      reconcile: board({ fleet: "observed" }),
      stopped: STOPPED,
      tickId: "handoff-9323-tick-4",
    });

    expect(launched).toEqual([]);
    expect(seated.lines).toEqual([
      "stopped recipes: nothing seated — no checkout to cut the seat from: no declared main checkout",
    ]);
  });

  it("registers but does not spawn once a journal shows an earlier attempt ran", async () => {
    const { deps, launched } = recording();
    const paths = home();
    mkdirSync(paths.runsDir);
    writeFileSync(
      join(paths.runsDir, `${repairSlugOf({ episodeKey: EPISODE, tickId: "handoff-9323-tick-1" })}.jsonl`),
      "",
    );
    await seatStoppedRecipes({
      ...paths,
      bin: "slopweaver",
      checkout: () => ok("/checkout"),
      deps,
      home: undefined,
      reconcile: board({ fleet: "observed" }),
      stopped: STOPPED,
      tickId: "handoff-9323-tick-4",
    });

    expect(launched.map((argv) => argv.slice(0, 2).join(" "))).toEqual(["handover register"]);
  });
});
