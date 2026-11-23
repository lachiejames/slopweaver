/**
 * `session close-done` keeping a seat the owner's standing-session ruling holds open — at planning, and when the ruling lands
 * after every look, right before the close.
 */
import { afterEach, describe, expect, it } from "vitest";

import { closeDoneWithClient } from "../../../../../cli/commands/session/closeDone.js";
import type { CmuxClient } from "../../../../../cmux/client.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import { appendRunEvent, readRunJournal } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import { fakeClient } from "./closeDoneFakeCmux.js";
import { deps, outcomesOf, registry, removeFixtureDirs, SPAWNED_AT, sessionRecord } from "./closeDoneHarness.js";
import { AT_REST, parkedFixture, predecessorPark, SEAT, SEAT_TREE } from "./closeDoneParkFixture.js";

afterEach(removeFixtureDirs);

describe("closeDoneWithClient — keeping a standing seat", () => {
  /** The owner's standing-session ruling on the parked row, as `handover rule --standing-session` journals it. */
  const STANDING: RunEvent = {
    anchor: "talk:p9",
    atIso: SPAWNED_AT,
    decidedIso: SPAWNED_AT,
    kind: "ruling",
    ruling: "keep that session open for me",
    standingSession: {},
  };
  const STANDING_WHY =
    "the owner's standing-session ruling keeps this seat open until the owner ends it (anchor talk:p9)";

  it("keeps a seat the owner's standing-session ruling holds open, reading no screen and journalling nothing", async () => {
    const { fixture, runsDir } = parkedFixture();
    appendRunEvent({ event: STANDING, runsDir, slug: "parked-doc" });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, fixture, parkSeat: registry({ records: [sessionRecord()] }) }),
    });
    expect(outcomesOf(swept)).toEqual([
      { item: { kind: "kept", reason: "standing-session", row: expect.anything() }, kind: "kept" },
    ]);
    expect(fake.closed).toEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.at(-1)).toEqual(STANDING);
  });

  it("keeps a predecessor seat when the owner's standing-session ruling lands after the reobserve, right before the close", async () => {
    const { fixture, runsDir } = parkedFixture();
    predecessorPark({ runsDir });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    // The first look and the reobserve each read the screen once; the third read is the last look's, before its
    // journal read — so the ruling is on disk for that read alone.
    let reads = 0;
    const client: CmuxClient = {
      ...fake.client,
      readScreen: (args) => {
        reads += 1;
        if (reads === 3) {
          appendRunEvent({ event: STANDING, runsDir, slug: "parked-doc" });
        }
        return fake.client.readScreen(args);
      },
    };
    const swept = await closeDoneWithClient({
      deps: deps({ client, fixture, parkSeat: registry({ records: [sessionRecord()] }) }),
    });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "standing-session",
        why: STANDING_WHY,
      },
    ]);
    expect([reads, fake.closed]).toEqual([3, []]);
  });
});
