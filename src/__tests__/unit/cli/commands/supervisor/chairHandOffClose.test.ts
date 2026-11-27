/**
 * The close step on its own: `closeRow` over a real home whose episode has already been started, with the plain fake
 * seams of `./chairHandOffFixtures.ts`. The walk that reaches it is proven in `./chairHandOffRun.test.ts` and its
 * refusals in `./chairHandOffGuards.test.ts`; this pins what the step itself journals and prints.
 */
import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { closeRow } from "../../../../../cli/commands/supervisor/chairHandOffClose.js";
import type { Ctx } from "../../../../../cli/commands/supervisor/chairHandOffContext.js";
import { applyRowEvent } from "../../../../../handover/rowEvent.js";
import { unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import type { ChairHandOffStarted } from "../../../../../supervisor/chairHandOff.js";
import {
  EPISODE,
  episode,
  HAND_OFF,
  type HandOffWorld,
  HOLD,
  handOff,
  handOffDeps,
  handOffWorld,
  OLD_CHAIR,
  OLD_SLUG,
  predecessorPhase,
  removeWorlds,
} from "./chairHandOffFixtures.js";

afterEach(() => {
  removeWorlds();
});

/**
 * Start the episode and stop it at the close (the owner's hold), then run `closeRow` once in a context over the
 * same world, the watch now clear.
 */
async function closeOnce({
  world,
  beforeClose,
}: {
  world: HandOffWorld;
  beforeClose: () => void;
}): Promise<number | undefined> {
  const held = handOffDeps({ note: undefined, script: { ...HAND_OFF, hold: HOLD }, world });
  expect(await handOff({ args: ["--note-wait", "0"], deps: held, world })).toBe(1);
  const started = episode({ world }).find((event): event is ChairHandOffStarted => event.kind === "started")!;
  beforeClose();
  const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });
  const lock = unwrap(acquireOperationLock({ home: world.home, key: "close-test", nowIso: deps.nowIso() }));
  try {
    return await deps.withHarness({
      body: async ({ harness }) => {
        const ctx: Ctx = {
          deps,
          episodeId: EPISODE,
          harness,
          lock,
          options: {
            home: world.home,
            namedHome: world.home,
            noteWaitSeconds: 0,
            now: undefined,
            plan: undefined,
            reason: undefined,
          },
          predecessor: OLD_CHAIR,
        };
        return closeRow({ ctx, started });
      },
    });
  } finally {
    lock.release();
  }
}

describe("closeRow", () => {
  it("closes the outgoing chair's run with a residue naming the episode, and journals row-closed", async () => {
    const world = handOffWorld({ pin: "app" });

    expect(await closeOnce({ beforeClose: () => undefined, world })).toBe(undefined);

    expect(predecessorPhase({ world })).toBe("closed");
    expect(episode({ world }).at(-1)).toEqual({
      alreadyClosed: false,
      atIso: new Date(world.clock.ms).toISOString(),
      kind: "row-closed",
      slug: OLD_SLUG,
    });
    expect(world.lines.at(-1)).toBe(
      `supervisor hand-off: closed the outgoing chair's run ${OLD_SLUG}, superseded by ${EPISODE}`,
    );
  });

  it("journals a run another writer already closed as already closed, and continues", async () => {
    const world = handOffWorld({ pin: "app" });
    const closeElsewhere = (): void => {
      unwrap(
        applyRowEvent({
          event: { atIso: "2026-11-27T07:45:00.000Z", kind: "closed", residue: ["closed by hand"], summary: "by hand" },
          runsDir: stateHomePaths({ home: world.home }).runs,
          slug: OLD_SLUG,
        }),
      );
    };

    expect(await closeOnce({ beforeClose: closeElsewhere, world })).toBe(undefined);

    expect(episode({ world }).at(-1)).toEqual({
      alreadyClosed: true,
      atIso: new Date(world.clock.ms).toISOString(),
      kind: "row-closed",
      slug: OLD_SLUG,
    });
    expect(world.lines.at(-1)).toBe(
      `supervisor hand-off: the outgoing chair's run ${OLD_SLUG} was already closed; continuing`,
    );
  });
});
