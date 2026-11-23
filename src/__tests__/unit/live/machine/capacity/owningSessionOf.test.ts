import { describe, expect, it } from "vitest";
import { owningSessionOf } from "../../../../../live/machine/sessionOwner.js";
import { INCIDENT_PROCESSES, INCIDENT_SESSION } from "./fixtures.js";

describe("owningSessionOf", () => {
  it("attributes a heredoc's interpreter to the session two parents up", () => {
    expect(owningSessionOf({ pid: 98_575, processes: INCIDENT_PROCESSES, sessions: [INCIDENT_SESSION] })).toEqual(
      INCIDENT_SESSION,
    );
  });

  it("attributes the session's own claude process to itself", () => {
    expect(
      owningSessionOf({ pid: 88_556, processes: INCIDENT_PROCESSES, sessions: [INCIDENT_SESSION] })?.sessionId,
    ).toBe(INCIDENT_SESSION.sessionId);
  });

  it("owns nothing for a process whose chain reaches init without a registered session", () => {
    expect(owningSessionOf({ pid: 371, processes: INCIDENT_PROCESSES, sessions: [INCIDENT_SESSION] })).toBeUndefined();
  });

  it("owns nothing when the registry could not be read — the child reads as it always did", () => {
    expect(owningSessionOf({ pid: 98_575, processes: INCIDENT_PROCESSES, sessions: [] })).toBeUndefined();
  });

  it("never lets a stale registry file own a child whose parent is no longer in the snapshot", () => {
    const orphaned = [{ argv: "Python -", pid: 98_575, ppid: 88_556 }];
    expect(owningSessionOf({ pid: 98_575, processes: orphaned, sessions: [INCIDENT_SESSION] })).toBeUndefined();
  });

  it("never attributes to a registry record that carries no session id", () => {
    expect(
      owningSessionOf({
        pid: 98_575,
        processes: INCIDENT_PROCESSES,
        sessions: [{ ...INCIDENT_SESSION, sessionId: "" }],
      }),
    ).toBeUndefined();
  });

  it("ends the walk on a cycle in a racing snapshot rather than spinning", () => {
    const cycle = [
      { argv: "a", pid: 7, ppid: 8 },
      { argv: "b", pid: 8, ppid: 7 },
    ];
    expect(owningSessionOf({ pid: 7, processes: cycle, sessions: [INCIDENT_SESSION] })).toBeUndefined();
  });
});
