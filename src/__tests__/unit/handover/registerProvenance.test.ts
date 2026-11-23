/*
 * Which run a registering session holds, matched only against a journal that names it as the writer — so a
 * worktree or branch that merely shares a slug never becomes a claim on the row's provenance line.
 */

import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { heldRunAmong, soleOpenRunWrittenBy } from "../../../handover/registerProvenance.js";

const AT = "2026-09-30T04:21:25.457Z";
const STARTED: RunEvent = { atIso: AT, branch: "carry-out", docHash: "h", kind: "started" };

function launched({ sessionId }: { sessionId: string }): RunEvent {
  return { atIso: AT, kind: "launched", pid: 69195, sessionId, worktree: "/w/carry-out" };
}

describe("heldRunAmong", () => {
  it("names the candidate whose journal this session writes", () => {
    const journals = [
      { events: [STARTED, launched({ sessionId: "other" })], slug: "main" },
      { events: [STARTED, launched({ sessionId: "a0000056" })], slug: "carry-out" },
    ];
    expect(heldRunAmong({ journals, sessionId: "a0000056" })).toBe("carry-out");
  });

  it("names no run when another session writes the only candidate", () => {
    const journals = [{ events: [STARTED, launched({ sessionId: "other" })], slug: "carry-out" }];
    expect(heldRunAmong({ journals, sessionId: "a0000056" })).toBe(undefined);
  });

  it("names no run for a candidate never started", () => {
    expect(heldRunAmong({ journals: [{ events: [], slug: "carry-out" }], sessionId: "a0000056" })).toBe(undefined);
  });

  it("names no run once the session released it", () => {
    const released: RunEvent = { atIso: AT, kind: "released", sessionId: "a0000056", why: "handing off" };
    const journals = [{ events: [STARTED, launched({ sessionId: "a0000056" }), released], slug: "carry-out" }];
    expect(heldRunAmong({ journals, sessionId: "a0000056" })).toBe(undefined);
  });
});

describe("soleOpenRunWrittenBy", () => {
  const FINISHED: RunEvent = { atIso: AT, kind: "finished", residue: [] };

  it("finds the open run this session writes whatever its slug, past a closed one and another session's", () => {
    // a run started on `--branch work` from a checkout named otherwise is still the publisher's.
    const journals = [
      { events: [STARTED, launched({ sessionId: "a0000056" }), FINISHED], slug: "old-page-job" },
      { events: [STARTED, launched({ sessionId: "other" })], slug: "theirs" },
      { events: [STARTED, launched({ sessionId: "a0000056" })], slug: "page-job" },
    ];
    expect(soleOpenRunWrittenBy({ journals, sessionId: "a0000056" })).toBe("page-job");
  });

  it("names no run when the session writes two open ones, rather than guessing", () => {
    const journals = [
      { events: [STARTED, launched({ sessionId: "a0000056" })], slug: "one" },
      { events: [STARTED, launched({ sessionId: "a0000056" })], slug: "two" },
    ];
    expect(soleOpenRunWrittenBy({ journals, sessionId: "a0000056" })).toBe(undefined);
  });
});
