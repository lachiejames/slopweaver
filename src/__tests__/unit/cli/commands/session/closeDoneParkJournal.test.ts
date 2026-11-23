/**
 * The journal half of `session close-done`'s park: the checkpoint it builds, and the last journal read that keeps a
 * seat open — the owner's standing-session ruling included, landed after every look.
 */
import { appendFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendCloseDonePark,
  closeDoneParkedEvent,
  journalShortfall,
  type ReliedCheckpoint,
} from "../../../../../cli/commands/session/closeDoneParkJournal.js";
import {
  journalSize,
  type ParkCandidate,
  type ParkDeps,
} from "../../../../../cli/commands/session/closeDoneParkLook.js";
import type { ParsedLedger, RunEvent } from "../../../../../handover/ledger.js";
import { appendRunEvent, readRunJournal, runJournalPath } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import type { SeatIdentity } from "../../../../../sessions/parkSeat.js";
import { fakeClient } from "./closeDoneFakeCmux.js";
import { deps, NOW, removeFixtureDirs } from "./closeDoneHarness.js";
import { PARKED_DIR, parkedFixture, predecessorPark, SEAT } from "./closeDoneParkFixture.js";

afterEach(removeFixtureDirs);

const ITEM: ParkCandidate = {
  kind: "park-candidate",
  row: {
    lastEventIso: NOW,
    sessionKey: "parked-doc",
    slug: "parked-doc",
    status: "open",
    workspaceRef: "workspace:1",
  },
  workspace: SEAT,
};
/** The instant `predecessorPark` stamps its checkpoint with. */
const PARKED_AT = "2026-09-03T09:00:00.000Z";
/** That checkpoint as a close relies on it, read before anything else lands: `predecessorPark` appends it last. */
function reliedOn({ runsDir }: { runsDir: string }): ReliedCheckpoint {
  const journal = journalOf({ runsDir });
  return { atIso: PARKED_AT, ordinal: journal.events.length, size: journalSize({ journal }) };
}

/** A run with a predecessor's park on it, and the park deps that read it. */
function parkedRun(): { readonly parkDeps: ParkDeps; readonly runsDir: string } {
  const { fixture, runsDir } = parkedFixture();
  predecessorPark({ runsDir });
  const parkDeps = { ...deps({ client: fakeClient({ workspaces: [SEAT] }).client, fixture }), runsDir };
  return { parkDeps, runsDir };
}

/** The predecessor seat, bound before its park: the session the checkpoint let go. */
const SEAT_SESSION: SeatIdentity & { readonly kind: "identified" } = {
  host: "claude-code",
  kind: "identified",
  pid: 4242,
  sessionId: "session-parked",
  startedIso: "2026-09-03T08:00:00.000Z",
  status: "idle",
};

/** The last look's one journal read of the run. */
function journalOf({ runsDir }: { runsDir: string }): ParsedLedger {
  return unwrap(readRunJournal({ runsDir, slug: "parked-doc" }));
}

describe("journalShortfall", () => {
  it("lets the close go ahead when the journal still rests on the checkpoint it relies on", () => {
    const { parkDeps, runsDir } = parkedRun();
    const relied = reliedOn({ runsDir });
    expect(
      journalShortfall({
        deps: parkDeps,
        item: ITEM,
        journal: journalOf({ runsDir }),
        relied,
        seat: SEAT_SESSION,
      }),
    ).toBe(undefined);
  });

  it("keeps the seat when the owner's standing-session ruling landed after every look", () => {
    const { parkDeps, runsDir } = parkedRun();
    const relied = reliedOn({ runsDir });
    const ruling: RunEvent = {
      anchor: "talk:p9",
      atIso: "2026-09-03T09:30:00.000Z",
      decidedIso: "2026-09-03T09:30:00.000Z",
      kind: "ruling",
      ruling: "keep that session open for me",
      standingSession: {},
    };
    appendRunEvent({ event: ruling, runsDir, slug: "parked-doc" });
    const shortfall = journalShortfall({
      deps: parkDeps,
      item: ITEM,
      journal: journalOf({ runsDir }),
      relied,
      seat: SEAT_SESSION,
    });
    expect(shortfall!.reason).toBe("standing-session");
  });

  it("keeps the seat when the park it relies on is not the one the journal now rests on", () => {
    const { parkDeps, runsDir } = parkedRun();
    const relied = reliedOn({ runsDir });
    const shortfall = journalShortfall({
      deps: parkDeps,
      item: ITEM,
      journal: journalOf({ runsDir }),
      relied: { ...relied, atIso: NOW },
      seat: SEAT_SESSION,
    });
    expect(shortfall).toEqual({
      reason: "seat-moved",
      why: `its run's park moved before the close (now close-only on ${PARKED_AT} as journal event ${String(relied.ordinal)}, relied on ${NOW} as event ${String(relied.ordinal)})`,
    });
  });

  it("keeps the seat when a new cycle parks the same session at the relied-on instant", () => {
    const { parkDeps, runsDir } = parkedRun();
    const relied = reliedOn({ runsDir });
    const append = (event: RunEvent): void => {
      appendRunEvent({ event, runsDir, slug: "parked-doc" });
    };
    append({ atIso: "2026-09-03T09:10:00.000Z", branch: "parked-doc", docHash: "h2", kind: "started" });
    append({
      atIso: "2026-09-03T09:11:00.000Z",
      kind: "launched",
      pid: SEAT_SESSION.pid,
      sessionId: SEAT_SESSION.sessionId,
      worktree: PARKED_DIR,
    });
    append({
      atIso: PARKED_AT,
      branch: "parked-doc",
      kind: "parked",
      screenTail: "❯",
      sessionId: SEAT_SESSION.sessionId,
      workspaceRef: "workspace:1",
      worktree: PARKED_DIR,
    });
    // The journal's size matched, so the checkpoint's own place is what refuses.
    const shortfall = journalShortfall({
      deps: parkDeps,
      item: ITEM,
      journal: journalOf({ runsDir }),
      relied: { ...relied, size: relied.size + 3 },
      seat: SEAT_SESSION,
    });
    expect(shortfall).toEqual({
      reason: "seat-moved",
      why: `its run's park moved before the close (now close-only on ${PARKED_AT} as journal event ${String(relied.ordinal + 3)}, relied on ${PARKED_AT} as event ${String(relied.ordinal)})`,
    });
  });

  it("keeps the seat when the same session re-claims and parks again in the same cycle", () => {
    const { parkDeps, runsDir } = parkedRun();
    const relied = reliedOn({ runsDir });
    const append = (event: RunEvent): void => {
      appendRunEvent({ event, runsDir, slug: "parked-doc" });
    };
    append({
      atIso: "2026-09-03T09:10:00.000Z",
      host: "claude-code",
      kind: "claimed",
      pid: SEAT_SESSION.pid,
      sessionId: SEAT_SESSION.sessionId,
      why: "picked the run back up",
      worktree: PARKED_DIR,
    });
    append({
      atIso: "2026-09-03T09:20:00.000Z",
      branch: "parked-doc",
      kind: "parked",
      screenTail: "❯",
      sessionId: SEAT_SESSION.sessionId,
      workspaceRef: "workspace:1",
      worktree: PARKED_DIR,
    });
    const shortfall = journalShortfall({
      deps: parkDeps,
      item: ITEM,
      journal: journalOf({ runsDir }),
      relied: { ...relied, size: relied.size + 2 },
      seat: SEAT_SESSION,
    });
    expect(shortfall).toEqual({
      reason: "seat-moved",
      why: `its run's park moved before the close (now close-only on 2026-09-03T09:20:00.000Z as journal event ${String(relied.ordinal + 2)}, relied on ${PARKED_AT} as event ${String(relied.ordinal)})`,
    });
  });

  it("keeps the seat when any line lands after the look, even one that clears no park", () => {
    const { parkDeps, runsDir } = parkedRun();
    const relied = reliedOn({ runsDir });
    appendRunEvent({
      event: { atIso: "2026-09-03T09:40:00.000Z", kind: "artifact", url: "https://example.invalid/a" },
      runsDir,
      slug: "parked-doc",
    });
    const shortfall = journalShortfall({
      deps: parkDeps,
      item: ITEM,
      journal: journalOf({ runsDir }),
      relied,
      seat: SEAT_SESSION,
    });
    expect(shortfall).toEqual({
      reason: "seat-moved",
      why: `its journal moved before the close (${String(relied.size + 1)} lines, ${String(relied.size)} at the look)`,
    });
  });
});

describe("journalShortfall — a line this build cannot decode", () => {
  it("keeps the seat when a newer checkout's unknown kind, naming no session, lands after the look", () => {
    const { parkDeps, runsDir } = parkedRun();
    const relied = reliedOn({ runsDir });
    appendFileSync(
      runJournalPath({ runsDir, slug: "parked-doc" }),
      `${JSON.stringify({ atIso: "2026-09-03T09:40:00.000Z", kind: "park-invalidated-v2", reason: "reseated" })}\n`,
    );
    const journal = journalOf({ runsDir });
    expect(journal.events.length).toBe(relied.ordinal);
    const shortfall = journalShortfall({ deps: parkDeps, item: ITEM, journal, relied, seat: SEAT_SESSION });
    expect(shortfall).toEqual({
      reason: "seat-moved",
      why: `its journal moved before the close (${String(relied.size + 1)} lines, ${String(relied.size)} at the look)`,
    });
  });
});

describe("appendCloseDonePark", () => {
  it("journals nothing when the journal grew after the last look — a second close-done parked first", () => {
    // A run its session still holds, never parked: the park this close would record.
    const { fixture, runsDir } = parkedFixture();
    const parkDeps = { ...deps({ client: fakeClient({ workspaces: [SEAT] }).client, fixture }), runsDir };
    const grown = journalOf({ runsDir }).events.length;
    const event = closeDoneParkedEvent({
      drafts: [],
      events: journalOf({ runsDir }).events,
      item: ITEM,
      nowIso: NOW,
      runTree: PARKED_DIR,
      screen: "❯ ",
      sessionId: "session-parked",
    });
    const refused = appendCloseDonePark({ deps: parkDeps, event, item: ITEM, lookSize: grown - 1 });
    expect(refused).toEqual({
      item: ITEM,
      kind: "park-kept",
      reason: "seat-moved",
      why: `its journal moved between the last look and the park (${String(grown)} lines, ${String(grown - 1)} at the look)`,
    });
    expect(journalOf({ runsDir }).events.length).toBe(grown);
  });
});

describe("closeDoneParkedEvent", () => {
  it("builds the checkpoint off the last read: its recorded branch, the seat's tail and no empty drafts", () => {
    const events: readonly RunEvent[] = [
      { atIso: "2026-09-03T08:00:00.000Z", branch: "parked-doc", docHash: "h", kind: "started" },
    ];
    const event = closeDoneParkedEvent({
      drafts: [],
      events,
      item: ITEM,
      nowIso: NOW,
      runTree: PARKED_DIR,
      screen: "❯ ",
      sessionId: "session-parked",
    });
    expect(event).toEqual({
      atIso: NOW,
      branch: "parked-doc",
      kind: "parked",
      screenTail: "❯",
      sessionId: "session-parked",
      workspaceRef: "workspace:1",
      worktree: PARKED_DIR,
    });
  });
});
