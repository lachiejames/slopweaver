/**
 * Unit: the `calendar` write shells against injected seams, a temporary home and the REAL door. What is
 * under test is the thing no other lane can prove: an outward write is HELD and never performed, the
 * refusal is what the caller sees, and the matching digest is what lets it through.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { CommitAnchorErrors } from "../../../../../cli/commands/calendar/commitAnchor.js";
import type { CalendarWriteDeps } from "../../../../../cli/commands/calendar/writeDeps.js";
import { runCalendarCommit, runCalendarWrite } from "../../../../../cli/commands/calendar/writeRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { type HisWordsError, HisWordsErrors } from "../../../../../handover/hisWordsErrors.js";
import type { RawWords } from "../../../../../handover/hisWordsResolve.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { CalendarErrors } from "../../../../../live/calendar/errors.js";
import type { CalendarWriteOutcome } from "../../../../../live/calendar/write.js";
import type { CalendarWritePlan } from "../../../../../live/calendar/writePlan.js";
import { type MemoryDoorLedger, memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const ME = "me@x.test";

const DIGEST = "9c1e4b7a2d5f8e01";
const ANCHOR = "talk-call:a0000024-0000-4000-8000-000000000027#turn_000000000000000000020";

/** The owner's whole words at {@link ANCHOR}, as the shared resolver reads a call stretch. */
const HIS_YES: RawWords = {
  atIso: "2026-10-12T00:19:00.000Z",
  context: { kind: "call-segment", open: undefined },
  headKnown: true,
  headLost: false,
  tailKnown: true,
  tailLost: false,
  text: "yeah send that invite to Tobias, that's good",
  where: "call",
};

/**
 * A plan with the outward verdict the test needs; the digest is fixed so an approval can be written down, and
 * `previewDigest` is what the intent stored at prepare (`null` for an intent written before it was stored).
 */
function planFor({
  outward,
  previewDigest = DIGEST,
}: {
  outward: boolean;
  previewDigest?: string | null;
}): CalendarWritePlan {
  return {
    attendeesAfter: outward ? ["a@x.test"] : [],
    attendeesBefore: [],
    conferenceDataVersion: 0,
    digest: DIGEST,
    intent: {
      ...(previewDigest === null ? {} : { previewDigest }),
      account: ME,
      before: undefined,
      calendarId: "primary",
      createdAtIso: "2026-09-13T04:00:00.000Z",
      eventId: "evt-1",
      form: {
        attendees: outward ? ["a@x.test"] : [],
        description: undefined,
        kind: "book",
        location: undefined,
        meet: false,
        span: { allDay: false, end: "2026-09-20T10:30", start: "2026-09-20T10:00", zone: undefined },
        title: "Sync",
      },
      intentId: "intent-1",
      state: "pending",
      version: 1,
    },
    mutation: { body: { id: "evt-1", summary: "Sync" }, kind: "insert" },
    outward: { outward, reasons: outward ? ["reaches a@x.test"] : [] },
    residue: ["r"],
    sendUpdates: outward ? "all" : "none",
  };
}

const OUTCOME: CalendarWriteOutcome = {
  event: { id: "evt-1", summary: "Sync" },
  eventId: "evt-1",
  intentId: "intent-1",
  meetLink: undefined,
  residue: ["applied"],
  status: "applied",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-calendar-shell-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Deps recording every apply and every anchor read, over a fixed plan and fixed words. */
function deps({
  outward,
  previewDigest,
  words = ok(HIS_YES),
  ledger,
}: {
  outward: boolean;
  previewDigest?: string | null;
  words?: Result<RawWords, HisWordsError>;
  ledger?: DoorLedgerPort;
}): {
  deps: CalendarWriteDeps;
  door: MemoryDoorLedger;
  out: string[];
  diagnostics: string[];
  applied: CalendarWritePlan[];
  anchorsRead: string[];
  commitsPrepared: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const applied: CalendarWritePlan[] = [];
  const anchorsRead: string[] = [];
  const commitsPrepared: string[] = [];
  const plan = planFor({ outward, ...(previewDigest === undefined ? {} : { previewDigest }) });
  const door = memoryDoorLedger();
  let doorLedger: DoorLedgerPort = door.port;
  if (ledger !== undefined) {
    doorLedger = ledger;
  }
  return {
    anchorsRead,
    applied,
    commitsPrepared,
    deps: {
      apply: async ({ plan: performed }) => {
        applied.push(performed);
        return ok(OUTCOME);
      },
      doorLedger,
      home: () => home,
      newIntentId: () => "intent-1",
      prepare: async () => ok(plan),
      prepareCommit: async ({ intentId }) => {
        commitsPrepared.push(intentId);
        return ok(plan);
      },
      readOwnerWords: ({ anchor }) => {
        anchorsRead.push(anchor);
        return words;
      },
      readStdin: async () => JSON.stringify({ end: "2026-09-20T10:30", start: "2026-09-20T10:00", title: "Sync" }),
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    door,
    out,
  };
}

describe("runCalendarWrite", () => {
  it("applies an inward write on the first call, with the preview printed first", async () => {
    const d = deps({ outward: false });
    const code = await runCalendarWrite({ deps: d.deps, rest: ["--form", "-", "--home", home], verb: "book" });
    expect(code).toBe(EXIT_OK);
    expect(d.applied.length).toBe(1);
    expect(d.out[0]).toContain("reaches: nobody but you");
    expect(d.out[1]).toContain("calendar write applied");
  });

  it("HOLDS an outward write, performs nothing, and prints the commit on the owner's anchored yes", async () => {
    const d = deps({ outward: true });
    const code = await runCalendarWrite({ deps: d.deps, rest: ["--form", "-", "--home", home], verb: "book" });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.out[0]).toContain(
      "to send on the owner's yes: slopweaver calendar commit intent-1 --anchor <where the owner said yes>",
    );
    expect(d.diagnostics.join("\n")).toContain("calendar.write-unapproved");
  });

  it("refuses on the parser before reading stdin or touching a seam", async () => {
    const d = deps({ outward: false });
    expect(await runCalendarWrite({ deps: d.deps, rest: [], verb: "edit" })).toBe(EXIT_USAGE);
    expect(d.applied).toStrictEqual([]);
    expect(d.diagnostics[0]).toBe("missing <event-id>");
  });

  it("refuses a form the schema rejects, before any write", async () => {
    const d = deps({ outward: false });
    expect(await runCalendarWrite({ deps: d.deps, rest: ["--form", "{}", "--home", home], verb: "book" })).toBe(
      EXIT_USAGE,
    );
    expect(d.applied).toStrictEqual([]);
  });

  it("reports a prepare failure by its message and exits non-zero", async () => {
    const base = deps({ outward: false });
    const failing: CalendarWriteDeps = { ...base.deps, prepare: async () => err(CalendarErrors.notConnected()) };
    expect(await runCalendarWrite({ deps: failing, rest: ["--form", "-", "--home", home], verb: "book" })).toBe(
      EXIT_ERROR,
    );
    expect(base.diagnostics[0]).toBe(CalendarErrors.notConnected().message);
  });
});

describe("runCalendarCommit", () => {
  it("performs the write when --approve matches the rebuilt digest", async () => {
    const d = deps({ outward: true });
    const code = await runCalendarCommit({
      deps: d.deps,
      rest: ["intent-1", "--approve", "9c1e4b7a2d5f8e01", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    expect(d.applied.length).toBe(1);
  });

  it("still demands a matching digest when the rebuilt plan has drifted INWARD, and performs nothing", async () => {
    // The guest left the event between the preview and the commit, so the rebuilt cancel reaches nobody.
    // The approval still has to name THIS version: it was given over a different one.
    const d = deps({ outward: false });
    const code = await runCalendarCommit({
      deps: d.deps,
      rest: ["intent-1", "--approve", "0000000000000000", "--home", home],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.diagnostics.join("\n")).toContain("it was approved, then the event or the form changed");
  });

  it("refuses a drifted-inward commit carrying NO approval at all", async () => {
    const d = deps({ outward: false });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
  });

  it("performs a drifted-inward commit once the approval names the REBUILT digest", async () => {
    const d = deps({ outward: false });
    const code = await runCalendarCommit({
      deps: d.deps,
      rest: ["intent-1", "--approve", "9c1e4b7a2d5f8e01", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    expect(d.applied.length).toBe(1);
  });

  it("holds again on a digest that no longer matches, and performs nothing", async () => {
    const d = deps({ outward: true });
    const code = await runCalendarCommit({
      deps: d.deps,
      rest: ["intent-1", "--approve", "0000000000000000", "--home", home],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.diagnostics.join("\n")).toContain("it was approved, then the event or the form changed");
  });

  it("refuses a missing intent id, having read nothing", async () => {
    const d = deps({ outward: true });
    expect(await runCalendarCommit({ deps: d.deps, rest: [] })).toBe(EXIT_USAGE);
    expect(d.diagnostics[0]).toBe("missing <intent-id>");
  });
});

describe("runCalendarCommit --anchor", () => {
  it("still HOLDS an outward commit carrying neither an anchor nor a digest, reading no words", async () => {
    const d = deps({ outward: true });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.anchorsRead).toStrictEqual([]);
    expect(d.diagnostics.join("\n")).toContain("has not been approved");
  });

  it("sends on the owner's whole words when the rebuilt digest is the one the preview printed, and records the anchor", async () => {
    const d = deps({ outward: true });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--anchor", ANCHOR, "--home", home] });
    expect(code).toBe(EXIT_OK);
    expect(d.anchorsRead).toStrictEqual([ANCHOR]);
    expect(d.applied.length).toBe(1);
    expect(d.applied[0]!.intent.approvedBy).toStrictEqual({ anchor: ANCHOR, atIso: "2026-10-12T00:19:00.000Z" });
    expect(d.out.at(-1)).toBe(
      `approved on the owner's word: ${ANCHOR} (2026-10-12T00:19:00.000Z), recorded on intent intent-1`,
    );
  });

  it("journals the anchor and its instant at the door, and never the owner's words", async () => {
    const d = deps({ outward: true });
    await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--anchor", ANCHOR, "--home", home] });
    const ledger = d.door.text();
    const line = JSON.parse(ledger.trim().split("\n").at(-1)!) as Record<string, unknown>;
    expect(line["status"]).toBe("pass");
    expect(line["approvedBy"]).toBe(ANCHOR);
    expect(line["approvedAtIso"]).toBe("2026-10-12T00:19:00.000Z");
    expect(ledger).toContain("2026-10-12T00:19:00.000Z");
    expect(ledger).not.toContain(HIS_YES.text);
  });

  it("names the anchor in --json output as well as text", async () => {
    const d = deps({ outward: true });
    const rest = ["intent-1", "--anchor", ANCHOR, "--json", "--home", home];
    expect(await runCalendarCommit({ deps: d.deps, rest })).toBe(EXIT_OK);
    const doc = JSON.parse(d.out.at(-1)!) as Record<string, unknown>;
    expect(doc["approvedBy"]).toStrictEqual({ anchor: ANCHOR, atIso: "2026-10-12T00:19:00.000Z" });
  });

  it("holds when the event drifted from the preview the owner's yes was given over, and performs nothing", async () => {
    const d = deps({ outward: true, previewDigest: "0000000000000000" });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--anchor", ANCHOR, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.diagnostics.join("\n")).toContain(
      `the owner's yes at ${ANCHOR} was given over the preview 0000000000000000, and this write now digests to ${DIGEST}`,
    );
    const ledger = d.door.text();
    const line = JSON.parse(ledger.trim().split("\n").at(-1)!) as Record<string, unknown>;
    expect(line["status"]).toBe("hold");
    expect(Object.keys(line).filter((key) => key.startsWith("approved"))).toStrictEqual([]);
  });

  it("refuses an anchor whose record holds only part of what the owner said, before reading Google", async () => {
    const d = deps({ outward: true, words: ok({ ...HIS_YES, tailLost: true }) });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--anchor", ANCHOR, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.commitsPrepared).toStrictEqual([]);
    expect(d.door.text()).toBe("");
    expect(d.diagnostics).toStrictEqual([
      CommitAnchorErrors.partial({ anchor: ANCHOR, why: "the record holds only part of what the owner said there" })
        .message,
    ]);
  });

  it("performs nothing and exits 1 when the door cannot record its decision, naming the store rather than a hold", async () => {
    const d = deps({ ledger: unreachableDoorLedger(), outward: true });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--anchor", ANCHOR, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.diagnostics.join("\n")).toContain("not performed:");
    expect(d.diagnostics.join("\n")).toContain("fixture: the store is down");
    expect(d.door.text()).toBe("");
  });

  it("refuses a WHOLE, dated card landing, because its words were never re-read off the call", async () => {
    const landing: RawWords = {
      ...HIS_YES,
      context: { cardKey: "card-1", draftIds: [], draftIdsUnread: undefined, kind: "card-landing" },
    };
    const d = deps({ outward: true, words: ok(landing) });
    const code = await runCalendarCommit({
      deps: d.deps,
      rest: ["intent-1", "--anchor", "call:c1#s1", "--home", home],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.commitsPrepared).toStrictEqual([]);
    expect(d.diagnostics).toStrictEqual([
      CommitAnchorErrors.partial({
        anchor: "call:c1#s1",
        why: "a card landing holds the words as the card left, not the call — name talk-call:<call>#<segment>",
      }).message,
    ]);
  });

  it("refuses an anchor that does not resolve to the owner's words", async () => {
    const cause = HisWordsErrors.notOwnerScheme({ anchor: "https://example.test/x" });
    const d = deps({ outward: true, words: err(cause) });
    const rest = ["intent-1", "--anchor", "https://example.test/x", "--home", home];
    expect(await runCalendarCommit({ deps: d.deps, rest })).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.diagnostics).toStrictEqual([
      CommitAnchorErrors.unreadable({ anchor: "https://example.test/x", cause }).message,
    ]);
  });

  it("refuses an intent prepared before its previewed digest was stored, never reaching the door", async () => {
    const d = deps({ outward: true, previewDigest: null });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--anchor", ANCHOR, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.door.text()).toBe("");
    expect(d.diagnostics).toStrictEqual([CommitAnchorErrors.previewDigestAbsent({ intentId: "intent-1" }).message]);
    // The recovery re-prepares a possibly CHANGED event, so it must not steer the session to reuse this anchor.
    expect(d.diagnostics[0]).toContain("never reuse the anchor this commit carried");
  });

  it("an anchor with a record undated as an instant is refused", async () => {
    const d = deps({ outward: true, words: ok({ ...HIS_YES, atIso: "yesterday" }) });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--anchor", ANCHOR, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.diagnostics).toStrictEqual([
      CommitAnchorErrors.partial({
        anchor: ANCHOR,
        why: "the record does not date the owner's words as an instant (yesterday)",
      }).message,
    ]);
  });

  it("refuses a relay that predates recording whether its start was cut", async () => {
    const d = deps({ outward: true, words: ok({ ...HIS_YES, headKnown: false }) });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--anchor", ANCHOR, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.diagnostics[0]).toContain("the relay predates recording whether its start was cut");
  });

  // A relay made mid-stretch may end before the "no, wait" that follows.
  it("refuses a relay made mid-sentence, naming the call's own stretch", async () => {
    const relayed: RawWords = {
      ...HIS_YES,
      context: { about: "", kind: "relay", triageRuling: null },
      tailLost: true,
    };
    const d = deps({ outward: true, words: ok(relayed) });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--anchor", ANCHOR, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.diagnostics).toStrictEqual([
      CommitAnchorErrors.partial({
        anchor: ANCHOR,
        why: "the relay was made while the owner was still speaking — name the call's own stretch instead",
      }).message,
    ]);
  });

  it("refuses a relay that predates recording whether the owner was still speaking", async () => {
    const d = deps({ outward: true, words: ok({ ...HIS_YES, tailKnown: false }) });
    const code = await runCalendarCommit({ deps: d.deps, rest: ["intent-1", "--anchor", ANCHOR, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(d.applied).toStrictEqual([]);
    expect(d.diagnostics[0]).toContain("the relay predates recording whether the owner was still speaking");
  });
});
