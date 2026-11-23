/**
 * `handover wake` over a seat that parked again after its reseat: the wake journal holds a re-park on the very
 * condition its reseat acted on, wakes one on a new head, instant, cycle or answer, and lets a second wake stand
 * aside while the first is mid-reseat.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { runHandoverWake } from "../../../../../../cli/commands/handover/wakeRun.js";
import { EXIT_DEFERRED, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { ChecksWakeObservation, ParkWake } from "../../../../../../handover/parkWake.js";
import { appendRunEvent } from "../../../../../../handover/runStore.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { AFTER, green, NOW, PAST, record, spawnLine } from "./fixtures.js";
import { fakes, journalPath, mintWakeHome, parkedRow, stillParked, wakeJson } from "./harness.js";

describe("runHandoverWake", () => {
  let home: string;
  let runsDir: string;

  beforeEach(() => {
    ({ home, runsDir } = mintWakeHome());
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  /** The reseated seat parking again on the wake named, as a seat that found nothing left to do does. */
  function reparked({ slug, wake, atIso }: { slug: string; wake: ParkWake; atIso: string }): void {
    unwrap(
      appendRunEvent({
        event: { atIso, kind: "launched", pid: 9, sessionId: `s2-${slug}`, worktree: `/wt/${slug}` },
        runsDir,
        slug,
      }),
    );
    unwrap(
      appendRunEvent({
        event: {
          atIso,
          branch: slug,
          kind: "parked",
          screenTail: "❯ ",
          sessionId: `s2-${slug}`,
          wake,
          workspaceRef: "workspace:9",
          worktree: `/wt/${slug}`,
        },
        runsDir,
        slug,
      }),
    );
  }

  // The measured 9b sequence (`src/handover/wakeJournal.ts`): one wake reseats, the seat re-parks on the same green
  // head, and a second wake inside the same tick must not boot a second seat for it.
  it("holds a park re-parked on the very checks its reseat acted on, and wakes it on a new head", async () => {
    const wake: ParkWake = { kind: "checks", number: 10, repo: "o/r" };
    parkedRow({ slug: "enqueued", wake });
    const first = record();
    const tick = await wakeJson({ deps: fakes({ checks: { 10: green() }, recorded: first }), recorded: first });
    expect([tick.code, first.spawned]).toEqual([EXIT_OK, ["enqueued"]]);
    reparked({ atIso: "2026-10-15T03:15:00.000Z", slug: "enqueued", wake });

    const chair = record();
    const second = await wakeJson({ deps: fakes({ checks: { 10: green() }, recorded: chair }), recorded: chair });
    expect([second.code, chair.spawned, second.report.due]).toEqual([EXIT_EXPECTED_EMPTY, [], 0]);
    expect(second.report.rows.map((row) => [row.judgement.kind, row.action, row.detail])).toEqual([
      [
        "not-due",
        "none",
        `re-parked on the condition its reseat at ${NOW.toISOString()} (park of 2026-10-15T02:00:00.000Z) already acted on — it waits for a new head's checks, a re-run, a merge or a close`,
      ],
    ]);
    expect(stillParked({ slug: "enqueued" })).toBe(true);

    const pushed = record();
    const third = await wakeJson({
      deps: fakes({ checks: { 10: green({ headSha: "def" }) }, recorded: pushed }),
      recorded: pushed,
    });
    expect([third.code, pushed.spawned]).toEqual([EXIT_OK, ["enqueued"]]);
  });

  it("wakes a re-park once its checks re-ran on the same head, or its pull request merged", async () => {
    const changed: readonly [string, ChecksWakeObservation][] = [
      ["rerun", green({ runId: "202" })],
      ["merged", { mergeCommitOid: "m1", prState: "MERGED" }],
    ];
    for (const [index, [slug, after]] of changed.entries()) {
      const number = 20 + index;
      const wake: ParkWake = { kind: "checks", number, repo: "o/r" };
      parkedRow({ slug, wake });
      const first = record();
      await wakeJson({ deps: fakes({ checks: { [number]: green() }, recorded: first }), recorded: first });
      reparked({ atIso: "2026-10-15T03:15:00.000Z", slug, wake });
      const again = record();
      const { code } = await wakeJson({
        deps: fakes({ checks: { [number]: after }, recorded: again }),
        recorded: again,
      });
      expect([slug, code, again.spawned]).toEqual([slug, EXIT_OK, [slug]]);
      rmSync(join(home, "handovers", `${slug}.md`));
    }
  });

  it("holds a clock re-park on the instant its reseat acted on, and wakes one on a new instant", async () => {
    const wake: ParkWake = { atIso: PAST, kind: "at" };
    parkedRow({ slug: "clock", wake });
    const first = record();
    await wakeJson({ deps: fakes({ recorded: first }), recorded: first });
    reparked({ atIso: "2026-10-15T03:15:00.000Z", slug: "clock", wake });
    const held = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded: held }), recorded: held });
    expect([code, held.spawned]).toEqual([EXIT_EXPECTED_EMPTY, []]);
    expect(report.rows[0]!.detail).toContain("it waits for a new wake instant");

    reparked({ atIso: "2026-10-15T03:16:00.000Z", slug: "clock", wake: { atIso: "2026-10-15T03:05:00Z", kind: "at" } });
    const fresh = record();
    const woke = await wakeJson({ deps: fakes({ recorded: fresh }), recorded: fresh });
    expect([woke.code, fresh.spawned]).toEqual([EXIT_OK, ["clock"]]);
  });

  it("lets a second wake do nothing while the first is mid-reseat on the same park", async () => {
    parkedRow({ slug: "racing", wake: { atIso: PAST, kind: "at" } });
    const firstRecord = record();
    let releaseSpawn = (): void => undefined;
    const spawnHeld = new Promise<void>((resolve) => {
      releaseSpawn = resolve;
    });
    let spawnEntered = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      spawnEntered = resolve;
    });
    const base = fakes({ recorded: firstRecord });
    const firstDeps: HandoverWakeDeps = {
      ...base,
      reseat: async (args) => {
        spawnEntered();
        await spawnHeld;
        return base.reseat(args);
      },
    };
    const first = runHandoverWake({ deps: firstDeps, rest: ["--home", home, "--json"] });
    await entered;

    const secondRecord = record();
    const second = await wakeJson({ deps: fakes({ recorded: secondRecord }), recorded: secondRecord });
    releaseSpawn();
    expect(await first).toBe(EXIT_OK);
    // The first wake's spawn may still fail, so the second reads NOT YET, never done.
    expect([second.code, secondRecord.spawned, second.report.rows[0]!.action]).toEqual([
      EXIT_DEFERRED,
      [],
      "reseat-in-flight",
    ]);
    expect(firstRecord.spawned).toEqual(["racing"]);
    const attempts = readFileSync(journalPath(), "utf8")
      .split("\n")
      .filter((line) => line.includes('"kind":"attempt"'));
    expect(attempts).toHaveLength(1);
  });

  // The counterexample: the same slug re-run is a new cycle, so its first park on the old condition wakes.
  it("wakes a park in a later run cycle whatever an earlier cycle's reseat observed", async () => {
    const wake: ParkWake = { atIso: PAST, kind: "at" };
    parkedRow({ slug: "again", wake });
    const first = record();
    await wakeJson({ deps: fakes({ recorded: first }), recorded: first });
    for (const event of [
      { atIso: AFTER, kind: "abandoned", why: "cancelled" },
      { atIso: "2026-10-15T03:15:00.000Z", branch: "again", docHash: "h2", kind: "started" },
    ] as const) {
      unwrap(appendRunEvent({ event, runsDir, slug: "again" }));
    }
    reparked({ atIso: "2026-10-15T03:16:00.000Z", slug: "again", wake });
    const second = record();
    const { code } = await wakeJson({ deps: fakes({ recorded: second }), recorded: second });
    expect([code, second.spawned]).toEqual([EXIT_OK, ["again"]]);
  });

  it("wakes a re-park whose seat last came up off the owner's answer, not off the wake that saw the condition", async () => {
    const wake: ParkWake = { atIso: PAST, kind: "at" };
    parkedRow({ slug: "answered", wake });
    const first = record();
    await wakeJson({ deps: fakes({ recorded: first }), recorded: first });
    unwrap(
      appendRunEvent({
        event: { atIso: AFTER, kind: "launched", pid: 9, sessionId: "s2-answered", worktree: "/wt/answered" },
        runsDir,
        slug: "answered",
      }),
    );
    unwrap(
      appendRunEvent({
        event: {
          atIso: "2026-10-15T03:15:00.000Z",
          branch: "answered",
          kind: "parked",
          question: "which base?",
          screenTail: "❯ ",
          sessionId: "s2-answered",
          workspaceRef: "workspace:9",
          worktree: "/wt/answered",
        },
        runsDir,
        slug: "answered",
      }),
    );
    unwrap(appendRunEvent({ event: spawnLine({ kind: "dispatched", slug: "answered" }), runsDir, slug: "answered" }));
    reparked({ atIso: "2026-10-15T03:20:00.000Z", slug: "answered", wake });
    const second = record();
    const { code } = await wakeJson({ deps: fakes({ recorded: second }), recorded: second });
    expect([code, second.spawned]).toEqual([EXIT_OK, ["answered"]]);
  });
});
