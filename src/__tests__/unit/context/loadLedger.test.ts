/**
 * `src/context/loadLedger.ts` — whether each session holds the owner's profile, folded from load rows and transcript
 * observations. The verdict is the NEWEST observation, and a session with none is `unobserved`, never `unloaded`.
 * The transcript reader has its own file, `loadTranscript.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  byHandRows,
  decodeProfileLoadRow,
  mergeObservations,
  observationOfRow,
  type ProfileLoadObservation,
  type ProfileLoadRow,
  sessionLoadVerdict,
  unloadedSessions,
  unloadedWarningLines,
} from "../../../context/loadLedger.js";

/** One row, with every field a test does not name set to a load that arrived. */
function row(over: Partial<ProfileLoadRow> = {}): ProfileLoadRow {
  return {
    atIso: "2026-10-05T10:00:00.000Z",
    cwd: "/repo/wt",
    event: "SessionStart:startup",
    origin: "live",
    reason: "",
    sessionId: "s-1",
    source: "hook",
    ...over,
  };
}

/** One observation. */
function seen(over: Partial<ProfileLoadObservation> = {}): ProfileLoadObservation {
  return {
    atIso: "2026-10-05T10:00:00.000Z",
    cwd: "",
    event: "SessionStart:startup",
    outcome: "loaded",
    sessionId: "s-1",
    why: "w",
    ...over,
  };
}

describe("decodeProfileLoadRow", () => {
  it("decodes a row it wrote, field for field", () => {
    const written = row({ origin: "none", reason: "store down" });
    expect(decodeProfileLoadRow({ value: JSON.parse(JSON.stringify(written)) })).toEqual(written);
  });

  it("refuses a row with an origin outside the three, a blank session or an unparseable instant", () => {
    expect([
      decodeProfileLoadRow({ value: { ...row(), origin: "maybe" } }),
      decodeProfileLoadRow({ value: { ...row(), sessionId: "" } }),
      decodeProfileLoadRow({ value: { ...row(), atIso: "yesterday" } }),
      decodeProfileLoadRow({ value: "not a record" }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("observationOfRow", () => {
  it("reads origin none as a failure carrying its reason and event, and a cached copy as a load", () => {
    expect(observationOfRow({ row: row({ origin: "none", reason: "store down" }) })).toEqual({
      atIso: "2026-10-05T10:00:00.000Z",
      cwd: "/repo/wt",
      event: "SessionStart:startup",
      outcome: "failed",
      sessionId: "s-1",
      why: "the SessionStart:startup profile hook found no profile to load: store down",
    });
    expect(observationOfRow({ row: row({ origin: "cache" }) }).outcome).toBe("loaded");
  });
});

describe("mergeObservations", () => {
  const failedBoot = seen({ atIso: "2026-10-05T10:00:08.000Z", outcome: "failed" });
  const compacted = seen({ atIso: "2026-10-05T12:00:01.000Z", event: "SessionStart:compact", why: "printed it" });
  const postRow = seen({ atIso: "2026-10-05T12:00:40.000Z", event: "PostCompact" });

  it("keeps a transcript load beside a session's rows, so a run that wrote no row still clears an older failure", () => {
    const merged = mergeObservations({ ledger: [postRow], transcript: [failedBoot, compacted] });
    expect([merged, sessionLoadVerdict({ observations: merged, sessionIds: ["s-1"] }).kind]).toEqual([
      [failedBoot, compacted],
      "loaded",
    ]);
  });

  it("puts ledger rows last, so a row in the same instant as a transcript failure wins the tie", () => {
    const reload = seen({ atIso: failedBoot.atIso, event: "by-hand" });
    const merged = mergeObservations({ ledger: [reload], transcript: [failedBoot] });
    expect(sessionLoadVerdict({ observations: merged, sessionIds: ["s-1"] })).toEqual({
      kind: "loaded",
      latest: reload,
    });
  });
});

describe("sessionLoadVerdict", () => {
  it("is unobserved for a session nothing recorded — silence is not a failure", () => {
    expect(sessionLoadVerdict({ observations: [seen({ sessionId: "other" })], sessionIds: ["s-1"] })).toEqual({
      kind: "unobserved",
    });
  });

  it("is unloaded when the newest observation failed, even after an earlier load", () => {
    const failed = seen({ atIso: "2026-10-05T11:00:00.000Z", outcome: "failed" });
    expect(sessionLoadVerdict({ observations: [seen(), failed], sessionIds: ["s-1"] })).toEqual({
      kind: "unloaded",
      latest: failed,
    });
  });

  it("is loaded when a by-hand reload follows the failure", () => {
    const reload = seen({ atIso: "2026-10-05T11:00:00.000Z", event: "by-hand" });
    const verdict = sessionLoadVerdict({ observations: [seen({ outcome: "failed" }), reload], sessionIds: ["s-1"] });
    expect(verdict).toEqual({ kind: "loaded", latest: reload });
  });

  it("gives a tie to the later item, so a reload in the same instant as the failure wins", () => {
    const verdict = sessionLoadVerdict({ observations: [seen({ outcome: "failed" }), seen()], sessionIds: ["s-1"] });
    expect(verdict.kind).toBe("loaded");
  });

  it("decides a caller with two ids by its newest observation across both", () => {
    const codexFailed = seen({ atIso: "2026-10-05T11:00:00.000Z", outcome: "failed", sessionId: "codex" });
    const verdict = sessionLoadVerdict({
      observations: [seen({ sessionId: "claude" }), codexFailed],
      sessionIds: ["claude", "codex"],
    });
    expect(verdict).toEqual({ kind: "unloaded", latest: codexFailed });
  });

  it("is loaded for a Claude session whose inherited stale Codex id failed before it booted", () => {
    const staleThread = seen({ atIso: "2026-10-05T09:00:00.000Z", outcome: "failed", sessionId: "codex" });
    const verdict = sessionLoadVerdict({
      observations: [staleThread, seen({ sessionId: "claude" })],
      sessionIds: ["claude", "codex"],
    });
    expect(verdict.kind).toBe("loaded");
  });
});

describe("sessionLoadVerdict — a PostCompact run reaches no context", () => {
  const compactLoaded = seen({ atIso: "2026-10-05T12:00:01.500Z", event: "SessionStart:compact" });
  const compactFailed = { ...compactLoaded, outcome: "failed" as const };
  const postLoaded = seen({ atIso: "2026-10-05T12:00:40.200Z", event: "PostCompact" });
  const postFailed = { ...postLoaded, outcome: "failed" as const };

  it("is loaded when the compaction's SessionStart run delivered and a later PostCompact run failed", () => {
    const verdict = sessionLoadVerdict({ observations: [compactLoaded, postFailed], sessionIds: ["s-1"] });
    expect(verdict).toEqual({ kind: "loaded", latest: compactLoaded });
  });

  it("is unloaded when the compaction's SessionStart run failed and a later PostCompact run loaded", () => {
    const verdict = sessionLoadVerdict({ observations: [compactFailed, postLoaded], sessionIds: ["s-1"] });
    expect(verdict).toEqual({ kind: "unloaded", latest: compactFailed });
  });

  it("is unobserved for a session whose only rows are PostCompact runs", () => {
    expect(sessionLoadVerdict({ observations: [postFailed], sessionIds: ["s-1"] })).toEqual({ kind: "unobserved" });
  });

  it("is unloaded when a compaction failed seconds after a resume loaded, which it summarised away", () => {
    const resumed = { ...compactLoaded, atIso: "2026-10-05T11:59:58.000Z", event: "SessionStart:resume" };
    expect(sessionLoadVerdict({ observations: [resumed, compactFailed], sessionIds: ["s-1"] }).kind).toBe("unloaded");
  });
});

describe("unloadedSessions", () => {
  it("names each session whose newest observation failed, newest failure first", () => {
    const observations = [
      seen({ atIso: "2026-10-05T09:00:00.000Z", outcome: "failed", sessionId: "a" }),
      seen({ atIso: "2026-10-05T10:00:00.000Z", outcome: "failed", sessionId: "b" }),
      seen({ atIso: "2026-10-05T08:00:00.000Z", outcome: "failed", sessionId: "c" }),
      seen({ atIso: "2026-10-05T09:30:00.000Z", sessionId: "c" }),
    ];
    expect(unloadedSessions({ observations }).map((observation) => observation.sessionId)).toEqual(["b", "a"]);
  });

  it("is empty when nothing failed", () => {
    expect(unloadedSessions({ observations: [] })).toEqual([]);
  });
});

describe("byHandRows and the warning", () => {
  it("writes one by-hand row per id, and none for a terminal that names no session", () => {
    const base = {
      atIso: "2026-10-05T10:00:00.000Z",
      cwd: "/c",
      origin: "none" as const,
      ownerAbsent: false,
      reason: "down",
    };
    expect(byHandRows({ ...base, sessionIds: ["x", "y"] }).map((entry) => [entry.sessionId, entry.source])).toEqual([
      ["x", "by-hand"],
      ["y", "by-hand"],
    ]);
    expect(byHandRows({ ...base, sessionIds: [] })).toEqual([]);
  });

  it("marks a by-hand row whose live read found no owner row, and only that one", () => {
    const base = {
      atIso: "2026-10-05T10:00:00.000Z",
      cwd: "/c",
      origin: "live" as const,
      reason: "",
      sessionIds: ["x"],
    };
    expect(byHandRows({ ...base, ownerAbsent: true })[0]!.ownerAbsent).toBe(true);
    expect(Object.keys(byHandRows({ ...base, ownerAbsent: false })[0]!)).not.toContain("ownerAbsent");
  });

  it("decodes an owner-absent row as one, and anything but a literal true as no claim of absence", () => {
    const wire = {
      atIso: "2026-10-05T10:00:00.000Z",
      cwd: "",
      event: "by-hand",
      origin: "live",
      reason: "",
      sessionId: "x",
      source: "by-hand",
    };
    expect(decodeProfileLoadRow({ value: { ...wire, ownerAbsent: true } })!.ownerAbsent).toBe(true);
    expect(Object.keys(decodeProfileLoadRow({ value: { ...wire, ownerAbsent: "yes" } })!)).not.toContain("ownerAbsent");
  });

  it("leads with STOP, names the reason and the command that repairs it", () => {
    const lines = unloadedWarningLines({ reason: "the store did not answer within 2000ms" });
    expect(lines[0]).toBe("# STOP — the owner's profile did NOT load into this session");
    expect(lines).toContain("Why: the store did not answer within 2000ms.");
    expect(lines.join("\n")).toContain("`slopweaver profile context`");
  });
});
