import { describe, expect, it } from "vitest";

import {
  type AgentToolBanRecord,
  liveAgentToolBan,
  parseAgentToolBans,
  withAgentToolBan,
} from "../../../sessions/agentToolBan.js";

/** A ban that stands until well after every `nowIso` below. */
const BAN: AgentToolBanRecord = {
  claudeSessionId: "aaaa-1111",
  expiresAtIso: "2026-09-19T00:00:00.000Z",
  recordedAtIso: "2026-09-18T06:00:00.000Z",
  why: "this loop must never block on a native subagent call",
};

/** A ban that lapsed before every `nowIso` below. */
const LAPSED: AgentToolBanRecord = { ...BAN, claudeSessionId: "bbbb-2222", expiresAtIso: "2026-09-17T00:00:00.000Z" };

describe("parseAgentToolBans", () => {
  it("reads a well-formed file", () => {
    expect(parseAgentToolBans({ text: JSON.stringify({ bans: [BAN] }) }).bans).toEqual([BAN]);
  });

  it("drops ONE corrupt row rather than losing every other session's declared ban", () => {
    const text = JSON.stringify({ bans: [{ claudeSessionId: 7 }, BAN, { why: "no session" }] });
    expect(parseAgentToolBans({ text }).bans).toEqual([BAN]);
  });

  it("reads an absent, non-JSON or wrong-shaped file as no bans at all", () => {
    expect(parseAgentToolBans({ text: "" }).bans).toEqual([]);
    expect(parseAgentToolBans({ text: "not json" }).bans).toEqual([]);
    expect(parseAgentToolBans({ text: JSON.stringify({ bans: "all of them" }) }).bans).toEqual([]);
  });
});

describe("liveAgentToolBan", () => {
  it("finds this session's standing ban", () => {
    expect(
      liveAgentToolBan({ claudeSessionId: "aaaa-1111", file: { bans: [BAN] }, nowIso: "2026-09-18T08:00:00.000Z" }),
    ).toEqual(BAN);
  });

  it("finds nothing for a session that declared none", () => {
    expect(
      liveAgentToolBan({ claudeSessionId: "cccc-3333", file: { bans: [BAN] }, nowIso: "2026-09-18T08:00:00.000Z" }),
    ).toBeUndefined();
  });

  it("treats a lapsed row as absent, so a stale file cannot wedge a session", () => {
    expect(
      liveAgentToolBan({ claudeSessionId: "bbbb-2222", file: { bans: [LAPSED] }, nowIso: "2026-09-18T08:00:00.000Z" }),
    ).toBeUndefined();
  });

  it("is inert on a payload that carried no session id", () => {
    expect(
      liveAgentToolBan({ claudeSessionId: "   ", file: { bans: [BAN] }, nowIso: "2026-09-18T08:00:00.000Z" }),
    ).toBeUndefined();
  });
});

describe("withAgentToolBan", () => {
  it("records a ban beside every other session's, and drops the lapsed ones", () => {
    const next = withAgentToolBan({
      claudeSessionId: "cccc-3333",
      file: { bans: [BAN, LAPSED] },
      nowIso: "2026-09-18T08:00:00.000Z",
      record: { ...BAN, claudeSessionId: "cccc-3333" },
    });
    expect(next.bans.map((row) => row.claudeSessionId)).toEqual(["aaaa-1111", "cccc-3333"]);
  });

  it("replaces this session's own row rather than stacking a second one", () => {
    const next = withAgentToolBan({
      claudeSessionId: "aaaa-1111",
      file: { bans: [BAN] },
      nowIso: "2026-09-18T08:00:00.000Z",
      record: { ...BAN, why: "a narrower clause" },
    });
    expect(next.bans.length).toBe(1);
    expect(next.bans[0]!.why).toBe("a narrower clause");
  });

  it("clears this session's ban and leaves everyone else's standing", () => {
    const next = withAgentToolBan({
      claudeSessionId: "aaaa-1111",
      file: { bans: [BAN, { ...BAN, claudeSessionId: "dddd-4444" }] },
      nowIso: "2026-09-18T08:00:00.000Z",
      record: undefined,
    });
    expect(next.bans.map((row) => row.claudeSessionId)).toEqual(["dddd-4444"]);
  });
});
