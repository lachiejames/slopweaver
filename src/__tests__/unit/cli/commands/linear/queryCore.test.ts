import { describe, expect, it } from "vitest";

import {
  linearQueryUsage,
  parseLinearQueryArgs,
  parseUpdatedSince,
  resolveOwnerLinearHandle,
} from "../../../../../cli/commands/linear/queryCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { IdentityRecord } from "../../../../../silver/identity.js";

const NOW_MS = Date.parse("2026-09-06T12:00:00.000Z");

describe("parseLinearQueryArgs", () => {
  it("defaults to issues, a page of ten, and verification ON", () => {
    const parsed = unwrap(parseLinearQueryArgs({ nowMs: NOW_MS, rest: [] }));
    expect(parsed.filter.kind).toBe("issue");
    expect(parsed.limit).toBe(10);
    expect(parsed.verify).toBe(true);
    expect(parsed.json).toBe(false);
  });

  it("turns verification off for --no-verify without changing anything else", () => {
    const parsed = unwrap(parseLinearQueryArgs({ nowMs: NOW_MS, rest: ["--no-verify"] }));
    expect(parsed.verify).toBe(false);
    expect(parsed.limit).toBe(10);
  });

  it("carries every facet onto the filter", () => {
    const parsed = unwrap(
      parseLinearQueryArgs({
        nowMs: NOW_MS,
        rest: [
          "--kind",
          "project",
          "--assignee",
          "kim.lee",
          "--state",
          "In Review",
          "--team",
          "ENG",
          "--project",
          "Pool rewrite",
          "--cycle",
          "134",
          "--label",
          "/ship, backend",
          "--priority",
          "2",
          "--text",
          "pool",
          "--limit",
          "25",
          "--json",
        ],
      }),
    );
    expect(parsed.filter.kind).toBe("project");
    expect(parsed.filter.assignee).toBe("kim.lee");
    expect(parsed.filter.state).toBe("In Review");
    expect(parsed.filter.team).toBe("ENG");
    expect(parsed.filter.project).toBe("Pool rewrite");
    expect(parsed.filter.cycle).toBe(134);
    expect(parsed.filter.labels).toEqual(["/ship", "backend"]);
    expect(parsed.filter.priority).toBe(2);
    expect(parsed.filter.text).toBe("pool");
    expect(parsed.limit).toBe(25);
    expect(parsed.json).toBe(true);
  });

  it("refuses a state type outside the closed set, naming every accepted value", () => {
    const error = unwrapErr(parseLinearQueryArgs({ nowMs: NOW_MS, rest: ["--state-type", "strted"] }));
    expect(error.code).toBe("UNKNOWN_FILTER_VALUE");
    expect(error.message).toContain("triage | backlog | unstarted | started | completed | canceled");
  });

  it("refuses a kind outside the closed set", () => {
    expect(unwrapErr(parseLinearQueryArgs({ nowMs: NOW_MS, rest: ["--kind", "comment"] })).code).toBe(
      "UNKNOWN_FILTER_VALUE",
    );
  });

  it("refuses a priority outside Linear's 0..4 scale", () => {
    expect(unwrapErr(parseLinearQueryArgs({ nowMs: NOW_MS, rest: ["--priority", "9"] })).code).toBe(
      "UNKNOWN_FILTER_VALUE",
    );
  });

  it("refuses a limit of zero and a limit past the cap", () => {
    expect(unwrapErr(parseLinearQueryArgs({ nowMs: NOW_MS, rest: ["--limit", "0"] })).code).toBe(
      "UNKNOWN_FILTER_VALUE",
    );
    expect(unwrapErr(parseLinearQueryArgs({ nowMs: NOW_MS, rest: ["--limit", "101"] })).code).toBe(
      "UNKNOWN_FILTER_VALUE",
    );
  });

  it("refuses an unknown flag as an invocation problem, listing the flags it does accept", () => {
    const error = unwrapErr(parseLinearQueryArgs({ nowMs: NOW_MS, rest: ["--nope"] }));
    expect(error.code).toBe("INVALID_INVOCATION");
    expect(error.message).toContain("--assignee");
  });

  it("drops an empty --label list rather than demanding a blank label", () => {
    const parsed = unwrap(parseLinearQueryArgs({ nowMs: NOW_MS, rest: ["--label", " , "] }));
    expect(parsed.filter.labels).toBe(undefined);
  });
});

describe("parseUpdatedSince", () => {
  it("reads an absolute ISO date", () => {
    expect(unwrap(parseUpdatedSince({ nowMs: NOW_MS, value: "2026-09-01" }))).toBe("2026-09-01T00:00:00.000Z");
  });

  it("reads an <n>d window back from the injected clock", () => {
    expect(unwrap(parseUpdatedSince({ nowMs: NOW_MS, value: "5d" }))).toBe("2026-09-01T12:00:00.000Z");
  });

  it("refuses a value that is neither form, naming both", () => {
    const error = unwrapErr(parseUpdatedSince({ nowMs: NOW_MS, value: "last tuesday" }));
    expect(error.code).toBe("UNKNOWN_FILTER_VALUE");
    expect(error.message).toContain("14d");
  });
});

const person = ({
  id,
  linearHandle,
  slackId,
}: {
  id: string;
  linearHandle?: string;
  slackId?: string;
}): IdentityRecord => ({
  handle: id,
  id,
  identities: [
    ...(linearHandle !== undefined
      ? [{ handle: linearHandle, nativeId: "linear-uuid", source: "linear" as const }]
      : []),
    ...(slackId !== undefined ? [{ nativeId: slackId, source: "slack" as const }] : []),
  ],
  name: id,
});

describe("resolveOwnerLinearHandle", () => {
  it("resolves through the roster person whose id IS the profile id", () => {
    const resolved = resolveOwnerLinearHandle({
      ownerSlackUserId: undefined,
      profileId: "person:kim",
      roster: [person({ id: "person:kim", linearHandle: "kim.lee" })],
    });
    expect(unwrap(resolved)).toBe("kim.lee");
  });

  it("falls back to the DECLARED Slack owner id when the profile id names nobody", () => {
    const resolved = resolveOwnerLinearHandle({
      ownerSlackUserId: "U123",
      profileId: "me",
      roster: [person({ id: "person:kim", linearHandle: "kim.lee", slackId: "U123" })],
    });
    expect(unwrap(resolved)).toBe("kim.lee");
  });

  it("refuses rather than guessing when the only roster person carries no Linear identity", () => {
    const error = unwrapErr(
      resolveOwnerLinearHandle({
        ownerSlackUserId: "U123",
        profileId: "me",
        roster: [person({ id: "person:kim", slackId: "U123" })],
      }),
    );
    expect(error.code).toBe("OWNER_UNRESOLVED");
    expect(error.message).toContain("--assignee <linear-handle>");
  });

  it("refuses rather than picking the single person in a one-person roster", () => {
    const error = unwrapErr(
      resolveOwnerLinearHandle({
        ownerSlackUserId: undefined,
        profileId: "me",
        roster: [person({ id: "person:kim", linearHandle: "kim.lee" })],
      }),
    );
    expect(error.code).toBe("OWNER_UNRESOLVED");
  });

  it("refuses on an empty roster", () => {
    expect(unwrapErr(resolveOwnerLinearHandle({ ownerSlackUserId: "U123", profileId: "me", roster: [] })).code).toBe(
      "OWNER_UNRESOLVED",
    );
  });
});

describe("linearQueryUsage", () => {
  it("documents every flag the parser accepts", () => {
    const usage = linearQueryUsage();
    for (const flag of ["--assignee", "--state-type", "--label", "--updated-since", "--no-verify", "--corpus"]) {
      expect(usage).toContain(flag);
    }
  });
});
