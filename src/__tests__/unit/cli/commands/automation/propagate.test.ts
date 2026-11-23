import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseRecipePropagateArgs, runRecipePropagate } from "../../../../../cli/commands/automation/propagate.js";
import {
  type CorpusPropagationDeps,
  propagateCorpusSync,
  type SyncToPropagate,
} from "../../../../../cli/commands/automation/propagateRun.js";
import {
  PASS_MODEL,
  passRegisterArgv,
  passSessionFrom,
  SPAWN_DEFERRED_PROBLEM,
} from "../../../../../cli/commands/automation/propagateSeat.js";
import { EXIT_DEFERRED, EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { PassSession } from "../../../../../live/resync/propagationBatch.js";
import { readActiveBatch, readPropagationRecord } from "../../../../../live/resync/propagationStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const NOW = "2026-09-27T14:30:00.000Z";

/** What the fake edges saw, in order. */
interface Seen {
  readonly out: string[];
  readonly readings: string[];
  readonly registered: (readonly string[])[];
  readonly spawned: (readonly string[])[];
}

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "propagate-home-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Plain fake edges — no mocks — recording every landing read, register and spawn. */
function fakeDeps({
  seen,
  admitted = true,
  landing = "ok",
  spawnExit = 0,
  session = "open",
}: {
  seen: Seen;
  admitted?: boolean;
  landing?: "ok" | "fail";
  spawnExit?: number;
  session?: PassSession;
}): CorpusPropagationDeps {
  let minted = 0;
  return {
    mintId: () => {
      minted += 1;
      return `${String(minted).padStart(8, "0")}-batch`;
    },
    now: () => NOW,
    repositories: () => ({ slugs: ["lachiejames/slopweaver"], unresolved: [] }),
    seatAdmitted: () => admitted,
    seatEdges: {
      checkoutFor: () => ok("/checkouts/slopweaver"),
      openSession: ({ argv }) => {
        seen.spawned.push(argv);
        return Promise.resolve(spawnExit);
      },
      register: ({ argv }) => {
        seen.registered.push(argv);
        return Promise.resolve(0);
      },
      passSession: () => Promise.resolve(session),
      rowExists: () => false,
    },
    takeLandingReading: ({ by }) => {
      seen.readings.push(by);
      if (landing === "fail") {
        return Promise.resolve(err("github landing exited 1 and recorded no reading"));
      }
      return Promise.resolve(ok({ observedAtIso: NOW, readingId: `reading-${String(seen.readings.length)}` }));
    },
    withBatchLock: async ({ run }) => ok(await run()),
    writeOut: (line) => {
      seen.out.push(line);
    },
  };
}

function seenSink(): Seen {
  return { out: [], readings: [], registered: [], spawned: [] };
}

function sync(over: Partial<SyncToPropagate> = {}): SyncToPropagate {
  return {
    home,
    recipeId: "resync-corpus-github",
    source: "github",
    syncFinishedAtIso: "2026-09-27T14:20:00.000Z",
    ...over,
  };
}

const SOURCES = ["github", "slack", "linear", "notion", "gmail", "calendar", "fathom"] as const;

describe("propagateCorpusSync", () => {
  it("takes a fresh landing reading after a github sync and records its receipt on the sync's record", async () => {
    const seen = seenSink();
    const record = await propagateCorpusSync({ deps: fakeDeps({ seen }), sync: sync() });

    expect(seen.readings).toEqual([`corpus-propagation:${record.propagationId}`]);
    expect(record.surfaces[0]).toEqual({
      observedAtIso: NOW,
      producer: "github landing",
      readingId: "reading-1",
      status: "re-derived",
      surface: "pull-requests-review-state",
    });
    const dir = stateHomePaths({ home }).live.recipe.propagationDir;
    expect(unwrap(readPropagationRecord({ dir, propagationId: record.propagationId }))).toEqual(record);
  });

  it("takes no landing reading after a source the review state does not read", async () => {
    const seen = seenSink();
    const record = await propagateCorpusSync({
      deps: fakeDeps({ seen }),
      sync: sync({ recipeId: "resync-corpus-linear", source: "linear" }),
    });
    expect(seen.readings).toEqual([]);
    expect(record.surfaces.map((outcome) => outcome.status)).toEqual(["live", "live", "judgement", "judgement"]);
  });

  it("seats ONE visible Opus pass for seven syncs: the first opens and seats it, the rest join", async () => {
    const seen = seenSink();
    const deps = fakeDeps({ seen });
    for (const source of SOURCES) {
      await propagateCorpusSync({ deps, sync: sync({ recipeId: `resync-corpus-${source}`, source }) });
    }
    const batch = unwrap(readActiveBatch({ dir: stateHomePaths({ home }).live.recipe.propagationDir }))!;

    expect(seen.registered.length).toBe(1);
    expect(seen.spawned).toEqual([[batch.seat.slug, "--model", PASS_MODEL, "--home", home]]);
    expect([batch.revision, batch.doneThrough, batch.seat.seatedAtIso]).toEqual([7, 0, NOW]);
    expect(batch.seat.slug).toBe("corpus-propagation-pass-2026-09-27-00000001");
  });

  it("never seats a second pass while the first one's workspace is open or cmux cannot say, however late", async () => {
    const seen = seenSink();
    await propagateCorpusSync({ deps: fakeDeps({ seen }), sync: sync() });
    const later = [
      { session: "open", source: "slack" },
      { session: "unknown", source: "linear" },
    ] as const;
    for (const { session, source } of later) {
      await propagateCorpusSync({
        deps: fakeDeps({ seen, session }),
        sync: sync({ recipeId: `resync-corpus-${source}`, source }),
      });
    }
    expect([seen.registered.length, seen.spawned.length]).toEqual([1, 1]);
  });

  it("seats a fresh pass on a fresh slug once the first one's workspace is gone with syncs pending", async () => {
    const seen = seenSink();
    await propagateCorpusSync({ deps: fakeDeps({ seen }), sync: sync() });
    await propagateCorpusSync({
      deps: fakeDeps({ seen, session: "gone" }),
      sync: sync({ recipeId: "resync-corpus-slack", source: "slack" }),
    });
    const batch = unwrap(readActiveBatch({ dir: stateHomePaths({ home }).live.recipe.propagationDir }))!;
    expect(seen.spawned.map((argv) => argv[0])).toEqual([
      "corpus-propagation-pass-2026-09-27-00000001",
      batch.seat.slug,
    ]);
    expect(batch.seat.slug).not.toBe("corpus-propagation-pass-2026-09-27-00000001");
    expect(batch.revision).toBe(2);
  });

  it("writes a lapsed pass's fresh slug to disk BEFORE spawning it, so a failed save cannot lose it", async () => {
    const seen = seenSink();
    const dir = stateHomePaths({ home }).live.recipe.propagationDir;
    await propagateCorpusSync({ deps: fakeDeps({ seen }), sync: sync() });
    const onDiskAtSpawn: string[] = [];
    const gone = fakeDeps({ seen, session: "gone" });
    const deps: CorpusPropagationDeps = {
      ...gone,
      seatEdges: {
        ...gone.seatEdges,
        openSession: ({ argv }) => {
          onDiskAtSpawn.push(unwrap(readActiveBatch({ dir }))!.seat.slug);
          return gone.seatEdges.openSession({ argv });
        },
      },
    };
    await propagateCorpusSync({ deps, sync: sync({ recipeId: "resync-corpus-slack", source: "slack" }) });
    expect(onDiskAtSpawn).toEqual([seen.spawned[1]![0]]);
  });

  it("records the batch but seats nothing outside a visible session, printing the verb that seats it", async () => {
    const seen = seenSink();
    await propagateCorpusSync({ deps: fakeDeps({ admitted: false, seen }), sync: sync() });

    expect([seen.registered.length, seen.spawned.length]).toEqual([0, 0]);
    expect(seen.out.at(-1)).toBe(
      `  propagation · pass not seated: this resync is not a visible session on the ambient home — \`slopweaver automation propagate --seat --home ${home}\` opens it`,
    );
  });

  it("puts a failed landing read on the record and still joins the pass", async () => {
    const seen = seenSink();
    const record = await propagateCorpusSync({ deps: fakeDeps({ landing: "fail", seen }), sync: sync() });

    expect(record.surfaces[0]).toEqual({
      detail: "github landing exited 1 and recorded no reading",
      status: "failed",
      surface: "pull-requests-review-state",
    });
    expect(seen.spawned.length).toBe(1);
  });

  it("stamps a failed spawn on the seat, and a retry spawns again without registering twice", async () => {
    const seen = seenSink();
    await propagateCorpusSync({ deps: fakeDeps({ seen, spawnExit: 1 }), sync: sync() });
    const dir = stateHomePaths({ home }).live.recipe.propagationDir;
    const failed = unwrap(readActiveBatch({ dir }))!;
    expect([failed.seat.registeredAtIso, failed.seat.seatedAtIso, failed.seat.lastProblem]).toEqual([
      NOW,
      null,
      "cmux spawn exited 1",
    ]);

    const code = await runRecipePropagate({
      argv: ["node", "slopweaver", "recipe", "propagate", "--seat", "--home", home],
      deps: { propagation: fakeDeps({ seen, session: "gone" }), writeDiagnostic: () => undefined },
    });
    expect(code).toBe(0);
    expect([seen.registered.length, seen.spawned.length]).toEqual([1, 2]);
    expect(unwrap(readActiveBatch({ dir }))!.seat.seatedAtIso).toBe(NOW);
  });

  it("exits 4 on --seat when the spawn backoff defers the spawn, and keeps the batch unseated for the next attempt", async () => {
    const seen = seenSink();
    await propagateCorpusSync({ deps: fakeDeps({ seen, spawnExit: EXIT_DEFERRED }), sync: sync() });
    const dir = stateHomePaths({ home }).live.recipe.propagationDir;

    const code = await runRecipePropagate({
      argv: ["node", "slopweaver", "recipe", "propagate", "--seat", "--home", home],
      deps: {
        propagation: fakeDeps({ seen, session: "gone", spawnExit: EXIT_DEFERRED }),
        writeDiagnostic: () => undefined,
      },
    });
    const batch = unwrap(readActiveBatch({ dir }))!;
    expect([code, batch.seat.seatedAtIso, batch.seat.lastProblem, seen.spawned.length]).toEqual([
      EXIT_DEFERRED,
      null,
      SPAWN_DEFERRED_PROBLEM,
      2,
    ]);
  });

  it("still exits 4 on --seat when the deferral's marker cannot be saved, leaving the batch unseated", async () => {
    const seen = seenSink();
    // The first attempt fails outright, so the batch on disk carries a plain failure, never the deferral marker.
    await propagateCorpusSync({ deps: fakeDeps({ seen, spawnExit: EXIT_ERROR }), sync: sync() });
    const dir = stateHomePaths({ home }).live.recipe.propagationDir;
    const before = unwrap(readActiveBatch({ dir }))!;
    expect(before.seat.lastProblem).toBe("cmux spawn exited 1");
    // Readable, not writable: the batch reads back, but the attempt's save is refused.
    chmodSync(dir, 0o500);
    try {
      const code = await runRecipePropagate({
        argv: ["node", "slopweaver", "recipe", "propagate", "--seat", "--home", home],
        deps: {
          propagation: fakeDeps({ seen, session: "gone", spawnExit: EXIT_DEFERRED }),
          writeDiagnostic: () => undefined,
        },
      });
      const batch = unwrap(readActiveBatch({ dir }))!;
      expect([code, batch.seat.seatedAtIso, batch.seat.lastProblem, seen.spawned.length]).toEqual([
        EXIT_DEFERRED,
        null,
        before.seat.lastProblem,
        2,
      ]);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it("stamps a seat edge that THROWS on the seat rather than losing it — checkout, register or spawn", async () => {
    const throwing = (): never => {
      throw new Error("boom");
    };
    const dir = stateHomePaths({ home }).live.recipe.propagationDir;
    const problems: (string | null)[] = [];
    for (const edge of ["checkoutFor", "register", "openSession"] as const) {
      rmSync(dir, { force: true, recursive: true });
      const base = fakeDeps({ seen: seenSink() });
      await propagateCorpusSync({
        deps: { ...base, seatEdges: { ...base.seatEdges, [edge]: throwing } },
        sync: sync(),
      });
      const batch = unwrap(readActiveBatch({ dir }))!;
      problems.push(batch.seat.seatedAtIso, batch.seat.lastProblem);
    }
    expect(problems).toEqual([
      null,
      "the checkout lookup threw: boom",
      null,
      "handover register threw: boom",
      null,
      "cmux spawn threw: boom",
    ]);
  });

  it("adopts a failed spawn's workspace that opened anyway, and spawns nothing while cmux cannot say", async () => {
    const seen = seenSink();
    await propagateCorpusSync({ deps: fakeDeps({ seen, spawnExit: 1 }), sync: sync() });
    const dir = stateHomePaths({ home }).live.recipe.propagationDir;
    const seat = ({ session }: { session: PassSession }): Promise<number> =>
      runRecipePropagate({
        argv: ["node", "slopweaver", "recipe", "propagate", "--seat", "--home", home],
        deps: { propagation: fakeDeps({ seen, session }), writeDiagnostic: () => undefined },
      });

    await seat({ session: "unknown" });
    expect([seen.spawned.length, unwrap(readActiveBatch({ dir }))!.seat.seatedAtIso]).toEqual([1, null]);
    await seat({ session: "open" });
    expect([seen.registered.length, seen.spawned.length]).toEqual([1, 1]);
    expect(unwrap(readActiveBatch({ dir }))!.seat.seatedAtIso).toBe(NOW);
  });
});

describe("passSessionFrom", () => {
  const alive = { kind: "alive", pid: 7, process: "2.1.241", workspaceId: "w1" } as const;
  const empty = { kind: "phantom", reason: "idle shell", why: "host-exited", workspaceId: "w2" } as const;
  const unread = { kind: "unknown", reason: "timeout", workspaceId: "w3" } as const;

  it("counts a workspace only when a session runs in it — an empty terminal a timed-out spawn left is gone", () => {
    expect(
      [[], [empty], [empty, unread], [empty, alive], [unread, alive]].map((verdicts) => passSessionFrom({ verdicts })),
    ).toEqual(["gone", "gone", "unknown", "open", "open"]);
  });
});

describe("passRegisterArgv", () => {
  it("registers a DISPATCH row on the declared checkout, pointing the session at its procedure", () => {
    const argv = passRegisterArgv({ checkout: "/checkouts/slopweaver", home, nowIso: NOW, slug: "pass-slug" });
    expect(argv.slice(2)).toEqual([
      "--dispatch",
      "--slug",
      "pass-slug",
      "--priority",
      "p2",
      "--asked-iso",
      NOW,
      "--workspace",
      "self",
      "--workspace-because",
      "a pass over this installation's own corpus, queue and store",
      "--repo",
      "/checkouts/slopweaver",
      "--home",
      home,
    ]);
    expect(argv[1]).toContain("skills/automation/reference/corpus-propagation.md");
  });
});

describe("parseRecipePropagateArgs", () => {
  it("resolves each mode", () => {
    expect(
      [["--status", "--json"], ["--done", "--batch", "b1", "--through-revision", "3"], ["--seat"]].map(
        (rest) => unwrap(parseRecipePropagateArgs({ defaultHome: "/h", rest })).action,
      ),
    ).toEqual([{ json: true, kind: "status" }, { batchId: "b1", kind: "done", through: 3 }, { kind: "seat" }]);
  });

  it("refuses no mode, two modes, a stray --json or --batch, and a --done with no revision or batch", () => {
    expect(
      [
        [],
        ["--status", "--seat"],
        ["--seat", "--json"],
        ["--done"],
        ["--done", "--through-revision", "1"],
        ["--status", "--batch", "b1"],
      ].map((rest) => unwrapErr(parseRecipePropagateArgs({ defaultHome: "/h", rest })).message),
    ).toEqual([
      "name exactly one of --status, --done or --seat",
      "name exactly one of --status, --done or --seat",
      "--json only means anything beside --status",
      "--done needs --through-revision <n>, the revision `automation propagate --status` printed",
      "--done needs --batch <id>, the batch `automation propagate --status` printed",
      "--through-revision and --batch only mean anything beside --done",
    ]);
  });
});

describe("runRecipePropagate", () => {
  function run({ rest, seen }: { rest: readonly string[]; seen: Seen }): Promise<number> {
    return runRecipePropagate({
      argv: ["node", "slopweaver", "recipe", "propagate", ...rest, "--home", home],
      deps: { propagation: fakeDeps({ seen }), writeDiagnostic: () => undefined },
    });
  }

  it("exits 3 on --status, --done and --seat while no pass is open", async () => {
    const seen = seenSink();
    const codes = [
      await run({ rest: ["--status"], seen }),
      await run({ rest: ["--done", "--batch", "00000001-batch", "--through-revision", "1"], seen }),
      await run({ rest: ["--seat"], seen }),
    ];
    expect(codes).toEqual([3, 3, 3]);
  });

  it("lists what the pass covers, then confirms it and retires the batch", async () => {
    const seen = seenSink();
    await propagateCorpusSync({ deps: fakeDeps({ seen }), sync: sync() });
    seen.out.length = 0;

    expect(await run({ rest: ["--status"], seen })).toBe(0);
    expect(seen.out.slice(0, 3)).toEqual([
      `automation propagate · pass corpus-propagation-pass-2026-09-27-00000001 · revision 1, confirmed through 0 · seated ${NOW}`,
      "  1 sync(s) pending — confirm with `slopweaver automation propagate --done --batch 00000001-batch --through-revision 1`",
      "  r1 resync-corpus-github · synced 2026-09-27T14:20:00.000Z",
    ]);

    expect(await run({ rest: ["--done", "--batch", "00000001-batch", "--through-revision", "1"], seen })).toBe(0);
    expect(unwrap(readActiveBatch({ dir: stateHomePaths({ home }).live.recipe.propagationDir }))).toBe(null);
  });

  it("refuses a stale confirmation naming a batch retired since, leaving the newer one open", async () => {
    const seen = seenSink();
    const deps = fakeDeps({ seen });
    await propagateCorpusSync({ deps, sync: sync() });
    expect(await run({ rest: ["--done", "--batch", "00000001-batch", "--through-revision", "1"], seen })).toBe(0);
    await propagateCorpusSync({ deps, sync: sync({ recipeId: "resync-corpus-slack", source: "slack" }) });
    const opened = unwrap(readActiveBatch({ dir: stateHomePaths({ home }).live.recipe.propagationDir }))!;
    seen.out.length = 0;

    expect(await run({ rest: ["--done", "--batch", "00000001-batch", "--through-revision", "1"], seen })).toBe(1);
    expect(unwrap(readActiveBatch({ dir: stateHomePaths({ home }).live.recipe.propagationDir }))).toEqual(opened);
  });

  it("keeps the pass open when a sync joined after the revision it read", async () => {
    const seen = seenSink();
    const deps = fakeDeps({ seen });
    await propagateCorpusSync({ deps, sync: sync() });
    await propagateCorpusSync({ deps, sync: sync({ recipeId: "resync-corpus-slack", source: "slack" }) });
    seen.out.length = 0;

    expect(await run({ rest: ["--done", "--batch", "00000001-batch", "--through-revision", "1"], seen })).toBe(0);
    expect(seen.out[1]).toBe("  r2 resync-corpus-slack synced 2026-09-27T14:20:00.000Z");
    expect(unwrap(readActiveBatch({ dir: stateHomePaths({ home }).live.recipe.propagationDir }))!.doneThrough).toBe(1);
  });
});
