/**
 * The pure decision behind the hook-level cmux-send-into-the-supervisor refusal — text-matched against a
 * recorded pin, never a live cmux call.
 */
import { describe, expect, it } from "vitest";

import {
  cmuxSendSupervisorRefusal,
  talkCourierRefusalMessage,
  talkRelayRefusalMessage,
  talkWakeChairRefusalMessage,
} from "../../../admit/cmuxSendSupervisorGuard.js";
import { supervisorSendRefusalMessage } from "../../../cmux/supervisorWorkspace.js";
import type { SupervisorPinRecord } from "../../../sessions/supervisorPin.js";

const PIN: SupervisorPinRecord = {
  session: { host: "claude-code", id: "sess-super" },
  pinnedAtIso: "2026-09-02T04:47:00.000Z",
  workspaceId: "ws-super-id",
  workspaceRef: "workspace:936",
};

describe("cmuxSendSupervisorRefusal", () => {
  it("refuses a --workspace ref naming the pinned supervisor, from a different session", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command: "slopweaver cmux send --workspace workspace:936 'the report'",
      pin: PIN,
    });
    expect(refusal).toBe(supervisorSendRefusalMessage({ workspaceRef: "workspace:936" }));
  });

  it("refuses the same command addressed by the pinned workspace's own id", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command: "slopweaver cmux send --workspace ws-super-id 'the report'",
      pin: PIN,
    });
    expect(refusal).toBe(supervisorSendRefusalMessage({ workspaceRef: "workspace:936" }));
  });

  it("refuses the --workspace=value inline form", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command: "slopweaver cmux send --workspace=workspace:936 'the report'",
      pin: PIN,
    });
    expect(refusal).toBe(supervisorSendRefusalMessage({ workspaceRef: "workspace:936" }));
  });

  it("refuses when nested inside a compound command", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command: "echo hi && slopweaver cmux send --workspace workspace:936 'the report'",
      pin: PIN,
    });
    expect(refusal).toBe(supervisorSendRefusalMessage({ workspaceRef: "workspace:936" }));
  });

  it("refuses a bin/slopweaver invocation by an absolute path", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command: "/repo/bin/slopweaver cmux send --workspace workspace:936 'the report'",
      pin: PIN,
    });
    expect(refusal).toBe(supervisorSendRefusalMessage({ workspaceRef: "workspace:936" }));
  });

  it("allows the pinned supervisor sending to its own workspace", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-super",
      command: "slopweaver cmux send --workspace workspace:936 'note to self'",
      pin: PIN,
    });
    expect(refusal).toBeUndefined();
  });

  it("allows a cmux send at a different workspace", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command: "slopweaver cmux send --workspace workspace:1 'hello'",
      pin: PIN,
    });
    expect(refusal).toBeUndefined();
  });

  it("allows an unrelated command", () => {
    const refusal = cmuxSendSupervisorRefusal({ callerSessionId: "sess-worker", command: "ls -la", pin: PIN });
    expect(refusal).toBeUndefined();
  });

  it("allows a cmux send with no --workspace at all", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command: "slopweaver cmux send 'hello'",
      pin: PIN,
    });
    expect(refusal).toBeUndefined();
  });

  it("refuses a session shelling out to the voice's sender, which types into the same box", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command:
        "slopweaver talk relay --turn a0000086-0000-4000-8000-000000000093 --say x --heard merge --deliver-to-supervisor",
      pin: PIN,
    });
    expect(refusal).toBe(talkRelayRefusalMessage({ workspaceRef: "workspace:936" }));
  });

  it.each([
    ["the flag quoted", "slopweaver talk relay --turn t --say x '--deliver-to-supervisor'"],
    ["the verb word quoted", 'slopweaver talk "relay" --turn t --say x --deliver-to-supervisor'],
    ["a bash -c wrapper", 'bash -c "slopweaver talk relay --turn t --say x --deliver-to-supervisor"'],
    ["a yarn wrapper", "yarn slopweaver talk relay --turn t --say x --deliver-to-supervisor"],
    ["a node wrapper", "node bin/slopweaver talk relay --turn t --say x --deliver-to-supervisor"],
    [
      "the entry file under tsx",
      "node_modules/.bin/tsx src/cli/index.ts talk relay --turn t --say x --deliver-to-supervisor",
    ],
    ["a capitalised binary", "./bin/Slopweaver talk relay --turn t --say x --deliver-to-supervisor"],
    ["tsx on the cli folder", "./node_modules/.bin/tsx src/cli talk relay --turn t --say x --deliver-to-supervisor"],
    [
      "tsx on an extensionless entry",
      "./node_modules/.bin/tsx src/cli/index talk relay --turn t --say x --deliver-to-supervisor",
    ],
    [
      "a cd before a bare index.ts",
      "cd src/cli && ../../node_modules/.bin/tsx index.ts talk relay --turn t --say x --deliver-to-supervisor",
    ],
  ])("refuses a worker's delivery through %s", (_, command) => {
    expect(cmuxSendSupervisorRefusal({ callerSessionId: "sess-worker", command, pin: PIN })).toBe(
      talkRelayRefusalMessage({ workspaceRef: "workspace:936" }),
    );
  });

  it("leaves a grep for the flag alone", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command: "grep -rn deliver-to-supervisor src/talk",
      pin: PIN,
    });
    expect(refusal).toBe(undefined);
  });

  it("leaves a relay that only writes the board row alone", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command: "slopweaver talk relay --turn a0000086-0000-4000-8000-000000000093 --say x",
      pin: PIN,
    });
    expect(refusal).toBeUndefined();
  });

  it.each([
    ["bare", "slopweaver talk wake-chair"],
    ["with --json", "slopweaver talk wake-chair --json"],
    ["through tsx", "node_modules/.bin/tsx src/cli/index.ts talk 'wake-chair' --json"],
  ])("refuses a worker typing the chair's wake, %s", (_, command) => {
    expect(cmuxSendSupervisorRefusal({ callerSessionId: "sess-worker", command, pin: PIN })).toBe(
      talkWakeChairRefusalMessage({ workspaceRef: "workspace:936" }),
    );
  });

  it("leaves a wake that types nothing alone, and the pinned chair's own", () => {
    expect([
      cmuxSendSupervisorRefusal({
        callerSessionId: "sess-worker",
        command: "slopweaver talk wake-chair --dry-run",
        pin: PIN,
      }),
      cmuxSendSupervisorRefusal({
        callerSessionId: "sess-worker",
        command: "slopweaver talk wake-chair --help",
        pin: PIN,
      }),
      cmuxSendSupervisorRefusal({
        callerSessionId: PIN.session.id,
        command: "slopweaver talk wake-chair",
        pin: PIN,
      }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it.each([
    ["following", "slopweaver talk courier --follow"],
    ["once", "slopweaver talk courier --once --json"],
    ["through tsx", 'node_modules/.bin/tsx src/cli/index.ts talk "courier" --once'],
  ])("refuses a worker starting the relay courier, %s", (_, command) => {
    expect(cmuxSendSupervisorRefusal({ callerSessionId: "sess-worker", command, pin: PIN })).toBe(
      talkCourierRefusalMessage({ workspaceRef: "workspace:936" }),
    );
  });

  it("leaves the courier's usage alone, and the pinned chair's own courier", () => {
    expect([
      cmuxSendSupervisorRefusal({
        callerSessionId: "sess-worker",
        command: "slopweaver talk courier --help",
        pin: PIN,
      }),
      cmuxSendSupervisorRefusal({
        callerSessionId: PIN.session.id,
        command: "slopweaver talk courier --follow",
        pin: PIN,
      }),
    ]).toEqual([undefined, undefined]);
  });

  it("is inert when nothing is registered", () => {
    const refusal = cmuxSendSupervisorRefusal({
      callerSessionId: "sess-worker",
      command: "slopweaver cmux send --workspace workspace:936 'the report'",
      pin: undefined,
    });
    expect(refusal).toBeUndefined();
  });
});
