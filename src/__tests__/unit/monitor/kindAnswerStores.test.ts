/**
 * The two kind-answer stores — note mutes and escalation holds: a round trip, removal, and FAIL CLOSED, so a torn or
 * mismatched record still keeps its note down and is named as unreadable rather than silently dropped.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { MonitorErrors } from "../../../monitor/errors.js";
import {
  escalationDir,
  escalationHeld,
  forgetEscalationHold,
  readEscalationHolds,
  recordEscalationHold,
} from "../../../monitor/escalationHolds.js";
import { forgetNoteMute, kindMuted, noteMuteDir, readNoteMutes, recordNoteMute } from "../../../monitor/noteMutes.js";

const PRESSED = "2026-11-05T01:00:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kind-stores-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("note mutes", () => {
  it("round-trips a mute pressed on a note, and reads the kind muted until it is removed", () => {
    const mute = {
      from: { kind: "note", stepId: "mon-chair-unpinned" },
      monitorId: "chair-off-fable",
      mutedIso: PRESSED,
    } as const;
    unwrap(recordNoteMute({ home, mute }));
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
    expect(kindMuted({ home, monitorId: "fseventsd-bloated" })).toBe(false);
    expect(readNoteMutes({ home })).toEqual({ problems: [], records: [mute], unreadable: [] });
    expect(unwrap(forgetNoteMute({ home, monitorId: "chair-off-fable" }))).toBe(true);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(false);
    expect(unwrap(forgetNoteMute({ home, monitorId: "chair-off-fable" }))).toBe(false);
  });

  it("reads an absent store as no mutes", () => {
    expect(readNoteMutes({ home })).toEqual({ problems: [], records: [], unreadable: [] });
  });

  it("keeps a torn record's kind muted, and names it unreadable", () => {
    mkdirSync(noteMuteDir({ home }), { recursive: true });
    const path = join(noteMuteDir({ home }), "chair-off-fable.json");
    writeFileSync(path, "{not json");
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
    const read = readNoteMutes({ home });
    expect(read.records).toEqual([]);
    expect(read.unreadable).toEqual(["chair-off-fable"]);
    expect(read.problems.map((problem) => problem.path)).toEqual([path]);
  });

  it("keeps a kind muted while a DIRECTORY stands at its record path, and the remove the list prints takes it", () => {
    const path = join(noteMuteDir({ home }), "chair-off-fable.json");
    mkdirSync(join(path, "inside"), { recursive: true });
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
    expect(readNoteMutes({ home }).unreadable).toEqual(["chair-off-fable"]);
    expect(unwrap(forgetNoteMute({ home, monitorId: "chair-off-fable" }))).toBe(true);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(false);
  });

  it("keeps a kind muted while a DANGLING symlink stands at its record path, and forgetting it says it stood", () => {
    mkdirSync(noteMuteDir({ home }), { recursive: true });
    symlinkSync(join(home, "nowhere"), join(noteMuteDir({ home }), "chair-off-fable.json"));
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
    expect(readNoteMutes({ home }).unreadable).toEqual(["chair-off-fable"]);
    expect(unwrap(forgetNoteMute({ home, monitorId: "chair-off-fable" }))).toBe(true);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(false);
  });

  it("keeps a kind muted while a FIFO stands at its record path, and lists it unread rather than hanging", () => {
    mkdirSync(noteMuteDir({ home }), { recursive: true });
    const path = join(noteMuteDir({ home }), "chair-off-fable.json");
    execFileSync("mkfifo", [path]);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
    expect(readNoteMutes({ home })).toEqual({
      problems: [MonitorErrors.kindAnswerStore({ cause: "the record is no regular file", path })],
      records: [],
      unreadable: ["chair-off-fable"],
    });
    expect(unwrap(forgetNoteMute({ home, monitorId: "chair-off-fable" }))).toBe(true);
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(false);
  });

  it("lists a record whose suffix is upper-cased, which a case-insensitive volume reads as standing", () => {
    mkdirSync(noteMuteDir({ home }), { recursive: true });
    writeFileSync(join(noteMuteDir({ home }), "chair-off-fable.JSON"), "{torn");
    expect(readNoteMutes({ home }).unreadable).toEqual(["chair-off-fable"]);
  });

  it("lists an upper-cased record under the lower-case key every verb accepts", () => {
    mkdirSync(noteMuteDir({ home }), { recursive: true });
    writeFileSync(join(noteMuteDir({ home }), "CHAIR-OFF-FABLE.json"), "{torn");
    expect(readNoteMutes({ home }).unreadable).toEqual(["chair-off-fable"]);
  });

  it("keeps a kind muted, and names the failure as an error, when its store cannot be searched", () => {
    unwrap(
      recordNoteMute({ home, mute: { from: { kind: "command" }, monitorId: "chair-off-fable", mutedIso: PRESSED } }),
    );
    chmodSync(noteMuteDir({ home }), 0o000);
    try {
      expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
      const forgotten = forgetNoteMute({ home, monitorId: "chair-off-fable" });
      expect(unwrapErr(forgotten).path).toBe(join(noteMuteDir({ home }), "chair-off-fable.json"));
    } finally {
      chmodSync(noteMuteDir({ home }), 0o700);
    }
  });

  it("reads a record file named for no kind as no record, keeping nothing down", () => {
    const dir = noteMuteDir({ home });
    mkdirSync(join(dir, "chair-off-fable x.json"), { recursive: true });
    expect(readNoteMutes({ home })).toEqual({ problems: [], records: [], unreadable: [] });
    expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(false);
  });

  it("names a store that lists but cannot be searched, never reading it as empty", () => {
    const dir = noteMuteDir({ home });
    mkdirSync(dir, { recursive: true });
    // Readable, never searchable: the listing answers empty while every lookup under it fails closed.
    chmodSync(dir, 0o400);
    try {
      expect(kindMuted({ home, monitorId: "chair-off-fable" })).toBe(true);
      const read = readNoteMutes({ home });
      expect(read.records).toEqual([]);
      expect(read.problems.map((problem) => problem.path)).toEqual([dir]);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it("refuses a record naming a kind other than its file's, applying it to neither", () => {
    mkdirSync(noteMuteDir({ home }), { recursive: true });
    const path = join(noteMuteDir({ home }), "chair-off-fable.json");
    writeFileSync(
      path,
      JSON.stringify({ from: { kind: "command" }, monitorId: "fseventsd-bloated", mutedIso: PRESSED }),
    );
    expect(readNoteMutes({ home })).toEqual({
      problems: [
        MonitorErrors.kindAnswerStore({
          cause: "the record names fseventsd-bloated, not its file's chair-off-fable",
          path,
        }),
      ],
      records: [],
      unreadable: ["chair-off-fable"],
    });
    expect(kindMuted({ home, monitorId: "fseventsd-bloated" })).toBe(false);
  });
});

describe("escalation holds", () => {
  const hold = {
    base: "mon-fsev-97860",
    monitorId: "fseventsd-bloated",
    pressedIso: PRESSED,
    state: { baseline: 3_000_000_000, kind: "holding", measuredIso: PRESSED },
    stepId: "mon-fsev-97860.2",
  } as const;

  it("round-trips a holding hold keyed by the occurrence base, and forgets it", () => {
    unwrap(recordEscalationHold({ hold, home }));
    expect(escalationHeld({ base: "mon-fsev-97860", home })).toBe(true);
    expect(readEscalationHolds({ home })).toEqual({ problems: [], records: [hold], unreadable: [] });
    expect(unwrap(forgetEscalationHold({ base: "mon-fsev-97860", home }))).toBe(true);
    expect(escalationHeld({ base: "mon-fsev-97860", home })).toBe(false);
  });

  it("round-trips a pending hold, which carries no number yet", () => {
    const pending = { ...hold, state: { kind: "pending" } } as const;
    unwrap(recordEscalationHold({ hold: pending, home }));
    expect(readEscalationHolds({ home }).records).toEqual([pending]);
  });

  it("keeps a torn hold's note down, and names it unreadable", () => {
    mkdirSync(escalationDir({ home }), { recursive: true });
    writeFileSync(join(escalationDir({ home }), "mon-fsev-97860.json"), "");
    expect(escalationHeld({ base: "mon-fsev-97860", home })).toBe(true);
    expect(readEscalationHolds({ home }).unreadable).toEqual(["mon-fsev-97860"]);
  });
});
