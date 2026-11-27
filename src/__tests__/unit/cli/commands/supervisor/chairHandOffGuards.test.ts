/**
 * What stops the control plane's chair hand-off before it closes a run: another chair's journal, a run the chair no
 * longer holds, a pin moved under the close's one await, a journal that will not take the close, an app that does not
 * answer. The real `runChairHandOff` runs over a real home with the plain fake seams of `./chairHandOffFixtures.ts`.
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendSessionEvent } from "../../../../../sessions/sessionStore.js";
import { writeSupervisorPin } from "../../../../../sessions/supervisorPinStore.js";
import type { ChairHandOffStarted } from "../../../../../supervisor/chairHandOff.js";
import { episodeJournalPath } from "../../../../../supervisor/chairHandOffStore.js";
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

describe("supervisor hand-off — never another chair's episode, never a run the chair no longer holds", () => {
  /** A `started` event as another chair's hand-off would have journalled it. */
  function foreignStarted({ episodeId, predecessor }: { episodeId: string; predecessor: string }): ChairHandOffStarted {
    return {
      alias: "plan-two",
      atIso: "2026-11-27T07:30:00.000Z",
      basis: { kind: "auto" },
      episodeId,
      kind: "started",
      noteWaitSeconds: 0,
      predecessor,
      predecessorSlug: "fresh-supervisor-handoff-9001",
      reasons: [],
      vendor: "claude",
    };
  }

  it.each([
    {
      line: `supervisor hand-off: refused: the journal for ${EPISODE} was started as episode chair-hand-off:chair/old/1; nothing was journalled, closed or seated — read that journal before re-running`,
      started: foreignStarted({ episodeId: "chair-hand-off:chair/old/1", predecessor: OLD_CHAIR }),
    },
    {
      line: `supervisor hand-off: refused: the journal for ${EPISODE} hands off chair app:chair-other-9, not the pinned app:${OLD_CHAIR}; nothing was journalled, closed or seated — read that journal before re-running`,
      started: foreignStarted({ episodeId: EPISODE, predecessor: "chair-other-9" }),
    },
  ])("(m) a journal another chair started is refused with exit 1, journalling nothing", async ({ started, line }) => {
    const world = handOffWorld({ pin: "app" });
    const journal = episodeJournalPath({ episodeId: EPISODE, home: world.home });
    mkdirSync(dirname(journal), { recursive: true });
    writeFileSync(journal, `${JSON.stringify(started)}\n`);
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });

    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(1);

    expect(readFileSync(journal, "utf8")).toBe(`${JSON.stringify(started)}\n`);
    expect(world.lines).toEqual([line]);
    expect(world.messages.length).toBe(0);
    expect(world.spawns.length).toBe(0);
    expect(predecessorPhase({ world })).not.toBe("closed");
  });

  /** Run once with the owner's hold in force, so the episode stops at the close, its note step settled. */
  async function stoppedBeforeClose({ world }: { world: HandOffWorld }): Promise<void> {
    const held = handOffDeps({ note: undefined, script: { ...HAND_OFF, hold: HOLD }, world });
    expect(await handOff({ args: ["--note-wait", "0"], deps: held, world })).toBe(1);
    expect(episode({ world }).at(-1)!.kind).toBe("stopped");
  }

  it("(n) a chair whose ledger now names another run is refused before its run is closed", async () => {
    const world = handOffWorld({ pin: "app" });
    await stoppedBeforeClose({ world });
    appendSessionEvent({
      event: { kind: "closed", sessionKey: OLD_SLUG, tsIso: "2026-11-27T07:39:00.000Z" },
      home: world.home,
    });
    appendSessionEvent({
      event: {
        branch: "main",
        cwd: world.chairDir,
        harness: "app",
        kind: "spawned",
        sessionId: OLD_CHAIR,
        sessionKey: "fresh-supervisor-handoff-9010",
        slug: "fresh-supervisor-handoff-9010",
        surfaceRef: `app:${OLD_CHAIR}`,
        tsIso: "2026-11-27T07:40:00.000Z",
        workspaceRef: `app:${OLD_CHAIR}`,
      },
      home: world.home,
    });

    expect(
      await handOff({
        args: ["--note-wait", "0"],
        deps: handOffDeps({ note: undefined, script: HAND_OFF, world }),
        world,
      }),
    ).toBe(1);

    expect(predecessorPhase({ world })).not.toBe("closed");
    expect(episode({ world }).some((event) => event.kind === "row-closed")).toBe(false);
    expect(world.spawns.length).toBe(0);
    expect(world.lines.at(-1)).toBe(
      `supervisor hand-off: refused: the outgoing chair's run is fresh-supervisor-handoff-9010 now, not ${OLD_SLUG} that ${EPISODE} began over; nothing was closed — read both runs before re-running`,
    );
  });

  it("(p) a pin moved while the app answers for the chair is read before the close: no await sits between them", async () => {
    const world = handOffWorld({ pin: "app" });
    await stoppedBeforeClose({ world });
    // The close's only await is the app re-resolving the chair's run; the pin moves inside it.
    world.app.duringResolve = () => {
      writeSupervisorPin({
        home: world.home,
        record: {
          appSessionId: "someone-else",
          pinnedAtIso: "2026-11-27T07:50:00.000Z",
          session: { host: "claude-code", id: "s-other" },
        },
      });
    };

    expect(
      await handOff({
        args: ["--note-wait", "0"],
        deps: handOffDeps({ note: undefined, script: HAND_OFF, world }),
        world,
      }),
    ).toBe(1);

    expect(predecessorPhase({ world })).not.toBe("closed");
    expect(episode({ world }).some((event) => event.kind === "row-closed")).toBe(false);
    expect(world.spawns.length).toBe(0);
    expect(world.lines.at(-1)).toBe(
      "supervisor hand-off: abandoned: the pin names another chair now, so this hand-off has no chair to replace; nothing was closed or seated",
    );
  });

  it("(q) a journal that will not take row-closed stops the run at once, never re-looping the close", async () => {
    const world = handOffWorld({ pin: "app" });
    await stoppedBeforeClose({ world });
    // Reads still follow the link; the append refuses a link at the journal's own name.
    const journal = episodeJournalPath({ episodeId: EPISODE, home: world.home });
    const copy = join(world.home, "episode-copy.jsonl");
    writeFileSync(copy, readFileSync(journal, "utf8"));
    rmSync(journal);
    symlinkSync(copy, journal);
    const before = world.lines.length;

    expect(
      await handOff({
        args: ["--note-wait", "0"],
        deps: handOffDeps({ note: undefined, script: HAND_OFF, world }),
        world,
      }),
    ).toBe(1);

    expect(predecessorPhase({ world })).toBe("closed");
    expect(world.spawns.length).toBe(0);
    expect(world.lines.slice(before).length).toBe(1);
    expect(
      world.lines.at(-1)!.startsWith("supervisor hand-off: refused: the journal would not take row-closed: "),
    ).toBe(true);
  });

  it("(n) an app that no longer answers for the chair stops the close deferred, exit 4", async () => {
    const world = handOffWorld({ pin: "app" });
    await stoppedBeforeClose({ world });
    world.app.resolveFails = true;

    expect(
      await handOff({
        args: ["--note-wait", "0"],
        deps: handOffDeps({ note: undefined, script: HAND_OFF, world }),
        world,
      }),
    ).toBe(4);

    expect(predecessorPhase({ world })).not.toBe("closed");
    expect(episode({ world }).some((event) => event.kind === "row-closed")).toBe(false);
    expect(world.spawns.length).toBe(0);
    expect(world.lines.at(-1)).toContain("not yet: the app does not answer for");
  });
});
