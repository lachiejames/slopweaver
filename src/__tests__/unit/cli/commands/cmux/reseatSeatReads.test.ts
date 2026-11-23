import { describe, expect, it } from "vitest";

import { readBootFor, seatLineFor } from "../../../../../cli/commands/cmux/reseatSeatReads.js";
import type { SessionRecord } from "../../../../../sessions/liveSessions.js";
import { unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

const SESSION: SessionRecord = {
  cwd: "/worktrees/some-doc",
  entrypoint: "cli",
  kind: "interactive",
  name: "some-doc",
  pid: 4242,
  sessionId: "a0000075-0000-4000-8000-000000000081",
  startedAtMs: 1_700_000_000_000,
  status: "idle",
};

describe("seatLineFor — a seat's verdict line over a register that cannot be read", () => {
  it("answers UNMEASURED rather than a verdict for a seat it never saw the plans of", async () => {
    const line = await seatLineFor({
      home: "/homes/unreadable",
      port: unavailablePlanRegisterPort(),
      sessionId: SESSION.sessionId,
    });
    expect(line).toBe("claude seat: UNMEASURED — the plan register could not be read");
  });
});

describe("readBootFor — what a live session booted on, over a register that cannot be read", () => {
  it("is unresolved, naming the register, never a seat that booted on nothing", async () => {
    const boot = await readBootFor({
      home: "/homes/unreadable",
      port: unavailablePlanRegisterPort(),
      session: SESSION,
    });
    expect(boot).toEqual({ kind: "unresolved", why: "the plan register could not be read" });
  });
});
