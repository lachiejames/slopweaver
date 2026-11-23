import { describe, expect, it } from "vitest";
import { rosterFrom, STANDING_BLIND_SPOTS, sessionLiveness } from "../../../measurement/sessions.js";
import { measured, renderLiveness, unmeasurable } from "../../../measurement/status.js";
import type { SessionScan } from "../../../sessions/liveSessionStore.js";

/** A registry record, defaulted so each test varies only the field it is about. */
const record = (over: { pid?: number; sessionId?: string } = {}) => ({
  cwd: "/repo",
  entrypoint: "cli",
  kind: "interactive",
  name: "repo-ab",
  pid: 4242,
  sessionId: "sess-a",
  startedAtMs: 1_700_000_000_000,
  status: "busy",
  ...over,
});

/** A scan, defaulted to one live session and no refusals. */
const scanOf = (over: Partial<SessionScan> = {}): SessionScan => ({
  records: [record()],
  refused: [],
  unreadable: undefined,
  ...over,
});

describe("rosterFrom", () => {
  it("counts a session whose registry entry AND process both answer", () => {
    const roster = rosterFrom({ processAlive: () => true, scan: scanOf() });

    expect(roster.known).toBe(true);
    expect([...(roster.known ? roster.value.liveIds : [])]).toEqual(["sess-a"]);
  });

  it("drops a session whose registry file outlived its process, because an unclean exit leaves one behind", () => {
    const roster = rosterFrom({ processAlive: () => false, scan: scanOf() });

    expect(roster.known).toBe(true);
    expect([...(roster.known ? roster.value.liveIds : [])]).toEqual([]);
  });

  it("REFUSES a record that names no session rather than dropping it, because it cannot be matched", () => {
    const roster = rosterFrom({ processAlive: () => true, scan: scanOf({ records: [record({ sessionId: "" })] }) });

    expect(roster.known).toBe(true);
    expect([...(roster.known ? roster.value.liveIds : [])]).toEqual([]);
    expect(roster.known ? roster.value.refused.length : 0).toBe(1);
    expect(roster.known ? roster.value.refused[0] : "").toContain("names no session");
  });

  it("withholds a NEGATIVE verdict while an unnamed record is unaccounted for", () => {
    const roster = rosterFrom({ processAlive: () => true, scan: scanOf({ records: [record({ sessionId: "" })] }) });

    const verdict = sessionLiveness({ roster, sessionId: "sess-somewhere" });

    expect(verdict.known).toBe(false);
  });

  it("is NOT MEASURED when the registry directory could not be read — never an empty roster", () => {
    const roster = rosterFrom({ processAlive: () => true, scan: scanOf({ unreadable: "/nope could not be read" }) });

    expect(roster.known).toBe(false);
    expect(roster.known === false ? roster.why : "").toBe("/nope could not be read");
  });

  it("carries an undecodable registry file as a refusal instead of silently dropping the session", () => {
    const roster = rosterFrom({
      processAlive: () => true,
      scan: scanOf({ refused: ["7.json: the session registry file records no pid"] }),
    });

    expect(roster.known).toBe(true);
    expect(roster.known ? roster.value.refused : []).toEqual(["7.json: the session registry file records no pid"]);
  });

  it("always states the standing blind spots, so no answer implies completeness", () => {
    const roster = rosterFrom({ processAlive: () => true, scan: scanOf() });

    expect(roster.known ? roster.value.blindSpots : []).toEqual(STANDING_BLIND_SPOTS);
  });
});

describe("sessionLiveness", () => {
  const live = measured({ value: { blindSpots: [], liveIds: new Set(["sess-a"]), refused: [] } });

  it("is true for a session in the roster", () => {
    const verdict = sessionLiveness({ roster: live, sessionId: "sess-a" });

    expect(verdict.known).toBe(true);
    expect(verdict.known ? verdict.value : null).toBe(true);
  });

  it("is false for a session the roster does not carry", () => {
    const verdict = sessionLiveness({ roster: live, sessionId: "sess-gone" });

    expect(verdict.known).toBe(true);
    expect(verdict.known ? verdict.value : null).toBe(false);
  });

  it("is NOT MEASURED when the journal named no session at all", () => {
    const verdict = sessionLiveness({ roster: live, sessionId: undefined });

    expect(verdict.known).toBe(false);
    expect(verdict.known === false ? verdict.why : "").toBe(
      "the journal records no session id, so there is nothing to ask about",
    );
  });

  it("is NOT MEASURED — never false — when the roster itself could not be built", () => {
    const verdict = sessionLiveness({
      roster: unmeasurable({ why: "the directory is gone" }),
      sessionId: "sess-a",
    });

    expect(verdict.known).toBe(false);
    expect(verdict.known === false ? verdict.why : "").toBe(
      "the live-session registry could not be read — the directory is gone",
    );
  });
});

describe("a refusal withholds the NEGATIVE answer, never the positive one", () => {
  /**
   * Found by an adversarial review pass against the first version of this function. A refusal names a FILE,
   * and a file is named after a pid — so a live session behind a half-written registry file is
   * indistinguishable from one that ended. Answering `false` there would let `fleet reap` end a running
   * agent's work, which is the exact defect this module was written to remove.
   */
  it("is NOT MEASURED for a session absent from a roster that refused a file", () => {
    const roster = rosterFrom({
      processAlive: () => true,
      scan: {
        records: [],
        refused: ["4242.json: the session registry file is not readable JSON"],
        unreadable: undefined,
      },
    });

    const verdict = sessionLiveness({ roster, sessionId: "sess-a" });

    expect(verdict.known).toBe(false);
    expect(verdict.known === false ? verdict.why : "").toContain("a refusal names a file rather than a session");
  });

  it("still answers TRUE for a session that IS present, because presence is positive evidence", () => {
    const roster = rosterFrom({
      processAlive: () => true,
      scan: scanOf({ refused: ["9.json: not readable JSON"] }),
    });

    const verdict = sessionLiveness({ roster, sessionId: "sess-a" });

    expect(verdict.known).toBe(true);
    expect(verdict.known ? verdict.value : null).toBe(true);
  });

  it("answers FALSE only when every registry file decoded", () => {
    const roster = rosterFrom({ processAlive: () => true, scan: scanOf() });

    const verdict = sessionLiveness({ roster, sessionId: "sess-gone" });

    expect(verdict.known).toBe(true);
    expect(verdict.known ? verdict.value : null).toBe(false);
  });
});

describe("renderLiveness", () => {
  it("prints ALIVE with the journal's pid as evidence, not as the answer", () => {
    expect(renderLiveness({ liveness: measured({ value: true }), pid: 98_051 })).toBe(
      "ALIVE · journal recorded pid 98051",
    );
  });

  it("prints gone for a session the roster proved absent", () => {
    expect(renderLiveness({ liveness: measured({ value: false }), pid: 98_051 })).toBe(
      "gone · journal recorded pid 98051",
    );
  });

  it("prints the reason rather than a verdict when liveness was not established", () => {
    expect(renderLiveness({ liveness: unmeasurable({ why: "the registry is unreadable" }), pid: undefined })).toBe(
      "NOT MEASURED — the registry is unreadable",
    );
  });

  it("omits the pid clause entirely when the journal recorded none", () => {
    expect(renderLiveness({ liveness: measured({ value: true }), pid: undefined })).toBe("ALIVE");
  });
});

describe("the defect this replaces", () => {
  /**
   * The regression guard. `handover start` records `process.pid` — the `slopweaver` CLI, which exits at once —
   * so a pid probe answers "dead" for a session that is running. Keyed on the session, the same journal line
   * answers ALIVE. If liveness is ever re-keyed on the pid, this goes red.
   */
  it("reports a hand-opened run as ALIVE even though its recorded pid is long gone", () => {
    const journalledPid = 98_051;
    const roster = rosterFrom({
      // The live session's own process, which is NOT the pid the journal recorded.
      processAlive: ({ pid }) => pid === 83_773,
      scan: scanOf({ records: [record({ pid: 83_773, sessionId: "abebd788" })] }),
    });

    const verdict = sessionLiveness({ roster, sessionId: "abebd788" });

    expect(verdict.known).toBe(true);
    expect(verdict.known ? verdict.value : null).toBe(true);
    expect(renderLiveness({ liveness: verdict, pid: journalledPid })).toBe("ALIVE · journal recorded pid 98051");
  });
});
