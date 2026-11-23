/**
 * `session close-done`'s last look before a close judges ONE journal read: the park action is derived again off the
 * read its session was bound against, so a checkpoint that matches only by its instant never closes a seat the
 * ownership fold does not call that checkpoint's predecessor.
 */
import { afterEach, describe, expect, it } from "vitest";

import { closeDoneWithClient } from "../../../../../cli/commands/session/closeDone.js";
import type { ParkSeatDeps } from "../../../../../cli/commands/session/closeDoneParkLook.js";
import type { CmuxClient } from "../../../../../cmux/client.js";
import { appendRunEvent, readRunJournal } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import { fakeClient } from "./closeDoneFakeCmux.js";
import { deps, outcomesOf, registry, removeFixtureDirs, sessionRecord } from "./closeDoneHarness.js";
import { AT_REST, PARKED_DIR, parkedFixture, predecessorPark, SEAT, SEAT_TREE } from "./closeDoneParkFixture.js";

afterEach(removeFixtureDirs);

describe("closeDoneWithClient — the last look's one journal read", () => {
  it("keeps a predecessor seat when a new cycle parks under another session at the same instant before the last look", async () => {
    const { fixture, runsDir } = parkedFixture();
    predecessorPark({ runsDir });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const base = registry({ records: [sessionRecord()] });
    let looks = 0;
    const parkSeat: ParkSeatDeps = {
      ...base,
      registry: () => {
        looks += 1;
        return base.registry();
      },
    };
    let restarted = false;
    const append = (event: Parameters<typeof appendRunEvent>[0]["event"]): void => {
      appendRunEvent({ event, runsDir, slug: "parked-doc" });
    };
    // After the first two looks have each bound the session, and before the last look reads its journal: a new
    // cycle another session launches and parks, its park stamped the predecessor checkpoint's own instant.
    const client: CmuxClient = {
      ...fake.client,
      readScreen: (args) => {
        if (looks === 2 && !restarted) {
          restarted = true;
          append({ atIso: "2026-09-03T09:10:00.000Z", branch: "parked-doc", docHash: "h2", kind: "started" });
          append({
            atIso: "2026-09-03T09:11:00.000Z",
            kind: "launched",
            pid: 4343,
            sessionId: "session-other",
            worktree: PARKED_DIR,
          });
          append({
            atIso: "2026-09-03T09:00:00.000Z",
            branch: "parked-doc",
            kind: "parked",
            screenTail: "❯ ",
            sessionId: "session-other",
            workspaceRef: "workspace:1",
            worktree: PARKED_DIR,
          });
        }
        return fake.client.readScreen(args);
      },
    };
    const swept = await closeDoneWithClient({ deps: deps({ client, fixture, parkSeat }) });
    expect(restarted).toBe(true);
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "seat-moved",
        why: "its journal moved before the close (6 lines, 3 at the look)",
      },
    ]);
    expect(fake.closed).toEqual([]);
  });

  it("keeps a predecessor seat when a line lands while the last look reads its session", async () => {
    const { fixture, runsDir } = parkedFixture();
    predecessorPark({ runsDir });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const base = registry({ records: [sessionRecord()] });
    let looks = 0;
    // The third registry read is the last look's session read, taken after its first journal read.
    const parkSeat: ParkSeatDeps = {
      ...base,
      registry: () => {
        looks += 1;
        if (looks === 3) {
          appendRunEvent({
            event: { atIso: "2026-09-03T09:40:00.000Z", kind: "artifact", url: "https://example.invalid/a" },
            runsDir,
            slug: "parked-doc",
          });
        }
        return base.registry();
      },
    };
    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, parkSeat }) });
    expect(looks).toBe(3);
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "seat-moved",
        why: "its journal moved before the close (4 lines, 3 at the look)",
      },
    ]);
    expect(fake.closed).toEqual([]);
  });

  it("keeps a predecessor seat whose session re-claims and parks again between the two looks", async () => {
    const { fixture, runsDir } = parkedFixture();
    predecessorPark({ runsDir });
    const firstPark = unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.length;
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const base = registry({ records: [sessionRecord()] });
    let looks = 0;
    const parkSeat: ParkSeatDeps = {
      ...base,
      registry: () => {
        looks += 1;
        return base.registry();
      },
    };
    let reparked = false;
    const append = (event: Parameters<typeof appendRunEvent>[0]["event"]): void => {
      appendRunEvent({ event, runsDir, slug: "parked-doc" });
    };
    // After the first look has bound the session, before the second reads: the same session claims and parks again.
    const client: CmuxClient = {
      ...fake.client,
      readScreen: (args) => {
        if (looks === 1 && !reparked) {
          reparked = true;
          append({
            atIso: "2026-09-03T09:10:00.000Z",
            host: "claude-code",
            kind: "claimed",
            pid: 4242,
            sessionId: "session-parked",
            why: "picked the run back up",
            worktree: PARKED_DIR,
          });
          append({
            atIso: "2026-09-03T09:20:00.000Z",
            branch: "parked-doc",
            kind: "parked",
            screenTail: "❯ ",
            sessionId: "session-parked",
            workspaceRef: "workspace:1",
            worktree: PARKED_DIR,
          });
        }
        return fake.client.readScreen(args);
      },
    };
    const swept = await closeDoneWithClient({ deps: deps({ client, fixture, parkSeat }) });
    expect(reparked).toBe(true);
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "seat-moved",
        why: `the run moved between looks: ${String(firstPark)} journal lines, parked 2026-09-03T09:00:00.000Z as journal event ${String(firstPark)} → ${String(firstPark + 2)} journal lines, parked 2026-09-03T09:20:00.000Z as journal event ${String(firstPark + 2)}`,
      },
    ]);
    expect(fake.closed).toEqual([]);
  });
});
