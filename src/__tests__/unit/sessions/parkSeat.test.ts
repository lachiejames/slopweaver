/**
 * Which session a parking seat is, and what `session close-done` may do with it — every input built inline.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import { identifyParkSeat, lstartToIso, parkActionOf, type SeatIdentity } from "../../../sessions/parkSeat.js";

const WRITER = "89e81284-ee20-4e94-8896-6c17a2d10a50";
const OTHER = "c28007f7-aa86-4925-ab52-14566f5daea2";
const PROC_START = "Fri Oct  9 11:36:11 2026";
/** The instant every look below is taken at — after every fixture's journal line. */
const NOW = "2026-10-10T00:00:00.000Z";

/** One interactive Claude Code session's registry record. */
function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    cwd: "/wt/a-doc",
    entrypoint: "cli",
    kind: "interactive",
    name: "a-doc",
    pid: 4242,
    procStart: PROC_START,
    sessionId: WRITER,
    startedAtMs: 0,
    status: "idle",
    ...over,
  };
}

const STARTS: ReadonlyMap<number, string> = new Map([[4242, PROC_START]]);

const STARTED: RunEvent = { atIso: "2026-10-09T11:00:00.000Z", branch: "a-doc", docHash: "h", kind: "started" };
const LAUNCHED: RunEvent = {
  atIso: "2026-10-09T11:00:01.000Z",
  kind: "launched",
  pid: 4242,
  sessionId: WRITER,
  worktree: "/wt/a-doc",
};

/** A park journalled at the instant named, by the writer unless another session is named. */
function parkedAt({ atIso, sessionId = WRITER }: { atIso: string; sessionId?: string }): RunEvent {
  return {
    atIso,
    branch: "a-doc",
    kind: "parked",
    screenTail: "❯ ",
    sessionId,
    workspaceRef: "workspace:7",
    worktree: "/wt/a-doc",
  };
}

/** An identified seat, as `identifyParkSeat` would name the writer's. */
function identified(over: Partial<SeatIdentity & { kind: "identified" }> = {}): SeatIdentity & { kind: "identified" } {
  return {
    host: "claude-code",
    kind: "identified",
    pid: 4242,
    sessionId: WRITER,
    startedIso: "2026-10-09T11:36:11.000Z",
    status: "idle",
    ...over,
  };
}

describe("lstartToIso", () => {
  it("reads a single-digit day padded with a space, in UTC", () => {
    expect(lstartToIso({ text: PROC_START })).toBe("2026-10-09T11:36:11.000Z");
  });

  it("reads a two-digit day and a trailing newline", () => {
    expect(lstartToIso({ text: "Mon Sep 28 23:05:59 2026\n" })).toBe("2026-09-28T23:05:59.000Z");
  });

  it("refuses text that is not such a stamp, and a month the C locale does not name", () => {
    expect(lstartToIso({ text: "" })).toBeUndefined();
    expect(lstartToIso({ text: "2026-10-09T11:36:11Z" })).toBeUndefined();
    expect(lstartToIso({ text: "Fri Okt  9 11:36:11 2026" })).toBeUndefined();
  });

  it("refuses an impossible stamp rather than rolling it into a later real instant", () => {
    expect(lstartToIso({ text: "Mon Feb 31 12:00:00 2026" })).toBeUndefined();
    expect(lstartToIso({ text: "Mon Feb 28 25:00:00 2026" })).toBeUndefined();
    expect(lstartToIso({ text: "Mon Feb 28 12:61:00 2026" })).toBeUndefined();
    expect(lstartToIso({ text: "Mon Feb 28 12:00:00 2026" })).toBeUndefined();
    expect(lstartToIso({ text: "Sat Feb 28 23:59:59 2026" })).toBe("2026-02-28T23:59:59.000Z");
  });
});

describe("identifyParkSeat", () => {
  it("names the one live session in the tree, with its start and status", () => {
    expect(identifyParkSeat({ records: [record()], refused: [], starts: STARTS, treePids: [1, 4242] })).toEqual(
      identified(),
    );
  });

  it("carries a working status through for the action to judge", () => {
    const seat = identifyParkSeat({
      records: [record({ status: "shell" })],
      refused: [],
      starts: STARTS,
      treePids: [4242],
    });
    expect(seat).toEqual(identified({ status: "shell" }));
  });

  it("names nobody when no session runs in the tree", () => {
    expect(identifyParkSeat({ records: [record()], refused: [], starts: STARTS, treePids: [1, 2] })).toEqual({
      kind: "unidentified",
      why: "no Claude Code session runs in its process tree",
    });
  });

  it("names nobody when two sessions run in the tree", () => {
    const two = [record(), record({ pid: 4343, sessionId: OTHER })];
    expect(identifyParkSeat({ records: two, refused: [], starts: STARTS, treePids: [4242, 4343] })).toEqual({
      kind: "unidentified",
      why: `2 Claude Code sessions run in its process tree (${WRITER}, ${OTHER})`,
    });
  });

  it("names nobody when a registry file it could not read is a pid in the tree, or carries no pid", () => {
    const inTree = identifyParkSeat({
      records: [record()],
      refused: ["4343.json: not JSON"],
      starts: STARTS,
      treePids: [4242, 4343],
    });
    expect(inTree).toEqual({
      kind: "unidentified",
      why: "a registry file this build could not read may be its session (4343.json: not JSON)",
    });
    const unplaceable = identifyParkSeat({
      records: [record()],
      refused: ["odd.json: x"],
      starts: STARTS,
      treePids: [4242],
    });
    expect(unplaceable.kind).toBe("unidentified");
  });

  it("names the session when a refused registry file is a dead pid outside the tree", () => {
    const seat = identifyParkSeat({
      records: [record()],
      refused: ["9.json: not JSON"],
      starts: STARTS,
      treePids: [4242],
    });
    expect(seat).toEqual(identified());
  });

  it("names nobody when a refused registry file is a running pid outside the tree — it may be this session twice", () => {
    const starts = new Map([...STARTS, [5151, PROC_START]]);
    expect(
      identifyParkSeat({ records: [record()], refused: ["5151.json: not JSON"], starts, treePids: [4242] }),
    ).toEqual({
      kind: "unidentified",
      why: "a registry file this build could not read may be its session (5151.json: not JSON)",
    });
  });

  it("names nobody when the same session's record on a running pid carries no start stamp to disprove it", () => {
    const { procStart: _dropped, ...unstamped } = record({ pid: 5151 });
    const starts = new Map([...STARTS, [5151, PROC_START]]);
    expect(identifyParkSeat({ records: [record(), unstamped], refused: [], starts, treePids: [4242] })).toEqual({
      kind: "unidentified",
      why: `session ${WRITER} also runs as pid 5151`,
    });
  });

  it("names nobody when the same session also runs as a live process outside the tree", () => {
    const twin = record({ pid: 5151 });
    const starts = new Map([...STARTS, [5151, PROC_START]]);
    expect(identifyParkSeat({ records: [record(), twin], refused: [], starts, treePids: [4242] })).toEqual({
      kind: "unidentified",
      why: `session ${WRITER} also runs as pid 5151`,
    });
  });

  it("names the session when its only twin is a stale record whose pid now runs something else", () => {
    const stale = record({ pid: 5151 });
    const starts = new Map([...STARTS, [5151, "Sat Oct 10 01:00:00 2026"]]);
    expect(identifyParkSeat({ records: [record(), stale], refused: [], starts, treePids: [4242] })).toEqual(
      identified(),
    );
  });

  it("names nobody when the pid now runs a different process than the record names", () => {
    const recycled = new Map([[4242, "Sat Oct 10 01:00:00 2026"]]);
    expect(identifyParkSeat({ records: [record()], refused: [], starts: recycled, treePids: [4242] })).toEqual({
      kind: "unidentified",
      why: "pid 4242 is not the interactive process its registry record names",
    });
  });

  it("names nobody for a record with no process start, or a headless one", () => {
    const { procStart: _dropped, ...bare } = record();
    expect(identifyParkSeat({ records: [bare], refused: [], starts: STARTS, treePids: [4242] }).kind).toBe(
      "unidentified",
    );
    const headless = record({ entrypoint: "sdk-cli" });
    expect(identifyParkSeat({ records: [headless], refused: [], starts: STARTS, treePids: [4242] }).kind).toBe(
      "unidentified",
    );
  });
});

describe("parkActionOf", () => {
  it("records a checkpoint for the seat whose session holds the run", () => {
    const action = parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED], identity: identified() });
    expect(action.kind).toBe("record");
  });

  describe("a run its writer released, with no park yet", () => {
    const released: RunEvent = {
      atIso: "2026-10-09T12:00:00.000Z",
      kind: "released",
      sessionId: WRITER,
      why: "waiting on the owner's answer",
    };

    it("records a checkpoint for the seat the release left open", () => {
      const action = parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED, released], identity: identified() });
      expect(action.kind).toBe("record");
    });

    it("keeps a reboot of that session started after the release", () => {
      const rebooted = identified({ pid: 5151, startedIso: "2026-10-09T12:30:00.000Z" });
      expect(parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED, released], identity: rebooted })).toEqual({
        kind: "keep",
        reason: "seat-not-predecessor",
      });
    });

    it("keeps that reboot when a later line naming the session moves no ownership", () => {
      const gated: RunEvent = {
        atIso: "2026-10-09T12:20:00.000Z",
        failed: 0,
        head: undefined,
        kind: "gated",
        notEvaluated: 0,
        passed: 1,
        sessionId: WRITER,
      };
      const rebooted = identified({ pid: 5151, startedIso: "2026-10-09T12:30:00.000Z" });
      expect(parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED, released, gated], identity: rebooted })).toEqual({
        kind: "keep",
        reason: "seat-not-predecessor",
      });
    });

    it("keeps a reboot between the release and a second release line of its own", () => {
      const again: RunEvent = { ...released, atIso: "2026-10-09T13:00:00.000Z" };
      const rebooted = identified({ pid: 5151, startedIso: "2026-10-09T12:30:00.000Z" });
      expect(parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED, released, again], identity: rebooted })).toEqual({
        kind: "keep",
        reason: "seat-not-predecessor",
      });
    });
  });

  it("keeps a seat whose registry says a turn or a background shell runs", () => {
    expect(
      parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED], identity: identified({ status: "busy" }) }),
    ).toEqual({
      kind: "keep",
      reason: "seat-working",
    });
    expect(
      parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED], identity: identified({ status: "shell" }) }),
    ).toEqual({
      kind: "keep",
      reason: "seat-working",
    });
  });

  it("keeps a seat whose session does not hold the run", () => {
    expect(
      parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED], identity: identified({ sessionId: OTHER }) }),
    ).toEqual({
      kind: "keep",
      reason: "seat-not-holder",
    });
  });

  describe("a Codex thread and a Claude session sharing one id string — Codex 4d r3", () => {
    const codexLaunch: RunEvent = {
      atIso: "2026-10-09T11:00:01.000Z",
      host: "codex",
      kind: "launched",
      pid: 4242,
      sessionId: WRITER,
      worktree: "/wt/a-doc",
    };
    const claudeClaim: RunEvent = {
      atIso: "2026-10-09T11:30:00.000Z",
      host: "claude-code",
      kind: "claimed",
      pid: 9999,
      sessionId: WRITER,
      why: "a foreign claim",
      worktree: "/wt/elsewhere",
    };
    const codexSeat = identified({ host: "codex" });

    it("records for the Codex seat while its own launch still holds the run", () => {
      expect(parkActionOf({ nowIso: NOW, events: [STARTED, codexLaunch], identity: codexSeat }).kind).toBe("record");
    });

    it("keeps the Codex seat once a Claude claim of the same id took the run", () => {
      expect(parkActionOf({ nowIso: NOW, events: [STARTED, codexLaunch, claudeClaim], identity: codexSeat })).toEqual({
        kind: "keep",
        reason: "seat-not-holder",
      });
    });

    it("keeps a Claude seat on a run a Codex thread of the same id holds", () => {
      expect(parkActionOf({ nowIso: NOW, events: [STARTED, codexLaunch], identity: identified() })).toEqual({
        kind: "keep",
        reason: "seat-not-holder",
      });
    });

    it("closes the Codex seat its own park left open", () => {
      const park = parkedAt({ atIso: "2026-10-09T12:00:00.000Z" });
      expect(parkActionOf({ nowIso: NOW, events: [STARTED, codexLaunch, park], identity: codexSeat }).kind).toBe(
        "close-only",
      );
    });

    it("keeps the Codex seat when the park is the Claude claimer's, never reading it as the thread's let-go", () => {
      const park = parkedAt({ atIso: "2026-10-09T12:00:00.000Z" });
      expect(
        parkActionOf({ nowIso: NOW, events: [STARTED, codexLaunch, claudeClaim, park], identity: codexSeat }),
      ).toEqual({ kind: "keep", reason: "seat-not-holder" });
    });

    describe("a hostless resume of the same id after another writer held the run seats Claude Code", () => {
      const claimOther: RunEvent = { ...claudeClaim, atIso: "2026-10-09T11:38:00.000Z", sessionId: OTHER };
      const resumed: RunEvent = {
        atIso: "2026-10-09T11:40:00.000Z",
        attempt: undefined,
        kind: "resumed",
        pid: 7000,
        sessionId: WRITER,
      };
      const park = parkedAt({ atIso: "2026-10-09T12:00:00.000Z" });

      it("keeps the Codex seat, whose thread never let the run go, off that Claude session's park", () => {
        expect(
          parkActionOf({ nowIso: NOW, events: [STARTED, codexLaunch, claimOther, resumed, park], identity: codexSeat }),
        ).toEqual({ kind: "keep", reason: "seat-not-holder" });
      });

      it("closes a Codex seat that released before handing on, as any predecessor left open is closed", () => {
        const released: RunEvent = { atIso: "2026-10-09T11:37:00.000Z", kind: "released", sessionId: WRITER, why: "x" };
        const events = [STARTED, codexLaunch, released, claimOther, resumed, park];
        expect(parkActionOf({ nowIso: NOW, events, identity: codexSeat }).kind).toBe("close-only");
      });
    });

    describe("a stale park naming a session that no longer held the run is nobody's let-go", () => {
      const claimOther: RunEvent = { ...claudeClaim, atIso: "2026-10-09T11:38:00.000Z", sessionId: OTHER };
      const stalePark = parkedAt({ atIso: "2026-10-09T11:50:00.000Z" });
      const otherPark = parkedAt({ atIso: "2026-10-09T12:00:00.000Z", sessionId: OTHER });

      it("keeps the displaced Codex seat when its successor parks", () => {
        const events = [STARTED, codexLaunch, claimOther, stalePark, otherPark];
        expect(parkActionOf({ nowIso: NOW, events, identity: codexSeat })).toEqual({
          kind: "keep",
          reason: "seat-not-holder",
        });
      });

      it("keeps a displaced Claude seat the same way", () => {
        const events = [STARTED, LAUNCHED, claimOther, stalePark, otherPark];
        expect(parkActionOf({ nowIso: NOW, events, identity: identified() })).toEqual({
          kind: "keep",
          reason: "seat-not-holder",
        });
      });
    });

    it("keeps a Codex seat on a hostless launch, which predates cross-host ownership and names Claude Code", () => {
      expect(parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED], identity: codexSeat })).toEqual({
        kind: "keep",
        reason: "seat-not-holder",
      });
    });
  });

  it("keeps a seat on a run no session ever held", () => {
    expect(parkActionOf({ nowIso: NOW, events: [STARTED], identity: identified() })).toEqual({
      kind: "keep",
      reason: "run-unowned",
    });
  });

  it("closes the seat a park left open when its process started before the park", () => {
    const park = parkedAt({ atIso: "2026-10-09T12:00:00.000Z" });
    expect(parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED, park], identity: identified() })).toEqual({
      checkpoint: park,
      kind: "close-only",
    });
  });

  it("keeps a reseat of the parked session whose process started after the park — or within its second", () => {
    const park = parkedAt({ atIso: "2026-10-09T11:36:11.500Z" });
    expect(parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED, park], identity: identified() })).toEqual({
      kind: "keep",
      reason: "seat-not-predecessor",
    });
    const later = identified({ startedIso: "2026-10-09T13:00:00.000Z" });
    const earlierPark = parkedAt({ atIso: "2026-10-09T12:00:00.000Z" });
    expect(parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED, earlierPark], identity: later })).toEqual({
      kind: "keep",
      reason: "seat-not-predecessor",
    });
  });

  it("keeps a seat rebooted after a park the journal stamps later than now", () => {
    const futurePark = parkedAt({ atIso: "2099-01-01T00:00:00.000Z" });
    const rebooted = identified({ pid: 5151, startedIso: "2026-10-09T13:00:00.000Z" });
    expect(parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED, futurePark], identity: rebooted })).toEqual({
      kind: "keep",
      reason: "seat-not-predecessor",
    });
  });

  it("keeps a seat on a parked run whose park named another session it never let go of", () => {
    const park = parkedAt({ atIso: "2026-10-09T12:00:00.000Z" });
    expect(
      parkActionOf({ nowIso: NOW, events: [STARTED, LAUNCHED, park], identity: identified({ sessionId: OTHER }) }),
    ).toEqual({
      kind: "keep",
      reason: "seat-not-holder",
    });
  });

  it("keeps a seat whose only let-go is in an earlier cycle, never closing it on this cycle's park (Codex 4d r3)", () => {
    const released: RunEvent = { atIso: "2026-10-09T11:20:00.000Z", kind: "released", sessionId: WRITER, why: "done" };
    const restarted: RunEvent = { atIso: "2026-10-09T11:40:00.000Z", branch: "a-doc", docHash: "h2", kind: "started" };
    const launchedOther: RunEvent = {
      atIso: "2026-10-09T11:41:00.000Z",
      kind: "launched",
      pid: 5151,
      sessionId: OTHER,
      worktree: "/wt/a-doc",
    };
    const park = parkedAt({ atIso: "2026-10-09T12:00:00.000Z", sessionId: OTHER });
    const events = [STARTED, LAUNCHED, released, restarted, launchedOther, park];
    const seat = identified({ startedIso: "2026-10-09T11:05:00.000Z" });
    expect(parkActionOf({ nowIso: NOW, events, identity: seat })).toEqual({ kind: "keep", reason: "seat-not-holder" });
  });

  describe("a writer that handed the run on and was left open — the chat-widget run's workspace:934", () => {
    const launchedOther: RunEvent = {
      atIso: "2026-10-09T11:00:01.000Z",
      kind: "launched",
      pid: 5151,
      sessionId: OTHER,
      worktree: "/wt/a-doc",
    };
    const released: RunEvent = {
      atIso: "2026-10-09T11:29:56.000Z",
      kind: "released",
      sessionId: OTHER,
      why: "next cut moves to workspace:985",
    };
    const claimed: RunEvent = {
      atIso: "2026-10-09T11:30:51.000Z",
      host: "claude-code",
      kind: "claimed",
      pid: 4242,
      sessionId: WRITER,
      why: "workspace:934 released it",
      worktree: "/wt/a-doc",
    };
    const park = parkedAt({ atIso: "2026-10-09T11:48:32.000Z" });

    it("closes it when its process started before its release, journalling nothing", () => {
      const seat = identified({ pid: 5151, sessionId: OTHER, startedIso: "2026-10-09T11:00:00.000Z" });
      expect(
        parkActionOf({ nowIso: NOW, events: [STARTED, launchedOther, released, claimed, park], identity: seat }),
      ).toEqual({
        checkpoint: park,
        kind: "close-only",
      });
    });

    it("keeps a reseat of that session started after its release", () => {
      const seat = identified({ pid: 5151, sessionId: OTHER, startedIso: "2026-10-09T11:40:00.000Z" });
      expect(
        parkActionOf({ nowIso: NOW, events: [STARTED, launchedOther, released, claimed, park], identity: seat }),
      ).toEqual({
        kind: "keep",
        reason: "seat-not-predecessor",
      });
    });

    it("keeps a writer taken over without a release, whose own last line still seats it", () => {
      const seat = identified({ pid: 5151, sessionId: OTHER, startedIso: "2026-10-09T11:00:00.000Z" });
      expect(parkActionOf({ nowIso: NOW, events: [STARTED, launchedOther, claimed, park], identity: seat })).toEqual({
        kind: "keep",
        reason: "seat-not-holder",
      });
    });
  });
});
