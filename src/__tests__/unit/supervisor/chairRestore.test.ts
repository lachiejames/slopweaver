/**
 * The restore decision — which tick types `/model <required>` into its own tab, which does not, and what each one
 * tells the reader. The chair switches back to the model its plans require itself, without the owner asking: Fable
 * while more than one Claude plan stands, Opus once one does.
 *
 * Every case here is a way the restore could fire when it must not, or fail to fire when it must.
 */
import { describe, expect, it } from "vitest";

import type { ChairRead, ChairSessionReading } from "../../../supervisor/chairGate.js";
import { type ChairRequirement, FABLE_CHAIR_REQUIREMENT } from "../../../supervisor/chairPolicy.js";
import {
  chairRestoreKey,
  chairRestoreLines,
  MAX_RESTORE_ATTEMPTS,
  planChairRestore,
} from "../../../supervisor/chairRestore.js";

/** The pinned workspace's cmux id. */
const PINNED = "WS-PINNED";

/** The lean shape: one Claude plan standing, so the chair must be on Opus. */
const OPUS_REQUIRED: ChairRequirement = { kind: "claude", model: "opus", why: "exactly one Claude plan stands" };

/** The measured fallback, as `chairModel.ts` reports it. */
const OFF_FABLE: ChairSessionReading = {
  pid: 111,
  sessionId: "a0000023",
  verdict: {
    atIso: "2026-09-15T20:58:32.701Z",
    fallback: {
      atIso: "2026-09-15T19:23:30.360Z",
      category: "cyber",
      fallbackModel: "claude-opus-4-8",
      originalModel: "claude-fable-5-1",
    },
    kind: "off-fable",
    model: "claude-opus-4-8",
  },
};

/** A seat on Fable, which the lean shape moves off. */
const ON_FABLE: ChairSessionReading = {
  pid: 222,
  sessionId: "a0000078",
  verdict: { atIso: "2026-11-21T09:00:00.000Z", kind: "on-fable", model: "claude-fable-5-1" },
};

/** A pinned workspace holding just that seat. */
const READ: ChairRead = {
  kind: "resolved",
  sessions: [OFF_FABLE],
  workspaceCwd: "/wt/fresh-supervisor-handoff-9271",
  workspaceId: PINNED,
};

/** A plan taken with no attempts on record and the caller sitting in the pinned workspace, under today's rule. */
const planFresh = ({
  read = READ,
  caller = PINNED,
  attempts = 0,
  requirement = FABLE_CHAIR_REQUIREMENT,
}: { read?: ChairRead; caller?: string; attempts?: number; requirement?: ChairRequirement } = {}) =>
  planChairRestore({ attemptsFor: () => attempts, callerWorkspaceId: caller, read, requirement });

describe("planChairRestore — when it attempts", () => {
  it("attempts, keyed on the FALLBACK instant rather than on the session alone", () => {
    const plan = planFresh();

    expect(plan.kind).toBe("attempt");
    const attempt = plan as Extract<typeof plan, { kind: "attempt" }>;
    expect(attempt.workspaceId).toBe(PINNED);
    expect(attempt.text).toBe("/model fable");
    expect(attempt.target).toBe("fable");
    expect(attempt.key).toBe("a0000023@2026-09-15T19:23:30.360Z");
    expect(attempt.sessionIds).toStrictEqual(["a0000023"]);
  });

  it("gives a SECOND trip in the same chair its own budget, because the key carries the instant", () => {
    const first = chairRestoreKey({ atIso: "2026-09-15T19:23:30.360Z", sessionId: "a0000023", target: "fable" });
    const second = chairRestoreKey({ atIso: "2026-09-16T21:59:32.000Z", sessionId: "a0000023", target: "fable" });

    expect(first).not.toBe(second);
  });

  it("keys on the seat's own newest turn when no fallback record was read — a hand-typed /model", () => {
    const read: ChairRead = {
      ...READ,
      sessions: [
        {
          pid: 111,
          sessionId: "a0000023",
          verdict: {
            atIso: "2026-09-18T07:00:00.000Z",
            fallback: undefined,
            kind: "off-fable",
            model: "claude-opus-4-8",
          },
        },
      ],
    };

    const plan = planFresh({ read });

    expect((plan as Extract<typeof plan, { kind: "attempt" }>).key).toBe("a0000023@2026-09-18T07:00:00.000Z");
  });

  it("names every off-Fable seat in the workspace, not only the one it keys on", () => {
    const second: ChairSessionReading = { ...OFF_FABLE, pid: 222, sessionId: "a0000078" };
    const plan = planFresh({ read: { ...READ, sessions: [OFF_FABLE, second] } });

    expect((plan as Extract<typeof plan, { kind: "attempt" }>).sessionIds).toStrictEqual(["a0000023", "a0000078"]);
  });
});

describe("planChairRestore — the lean shape", () => {
  it("types /model opus into a Fable seat, keyed with its target so a Fable budget is never spent", () => {
    const plan = planFresh({ read: { ...READ, sessions: [ON_FABLE] }, requirement: OPUS_REQUIRED });

    expect(plan).toStrictEqual({
      key: "a0000078@2026-11-21T09:00:00.000Z>opus",
      kind: "attempt",
      sessionIds: ["a0000078"],
      target: "opus",
      text: "/model opus",
      workspaceId: PINNED,
    });
  });

  it("has nothing to restore on a seat already on Opus, the fallback-reseated one included", () => {
    expect(planFresh({ requirement: OPUS_REQUIRED }).kind).toBe("nothing-to-restore");
  });

  it("types nothing at all when no Claude plan stands", () => {
    const plan = planFresh({ requirement: { kind: "claude-unavailable", why: "no Claude plan stands" } });

    expect(plan).toStrictEqual({
      kind: "nothing-to-restore",
      why: "no Claude plan stands, so there is no model to switch to",
    });
  });
});

describe("planChairRestore — when it refuses to type", () => {
  it("refuses when this process runs in a DIFFERENT workspace", () => {
    const plan = planFresh({ caller: "WS-OTHER" });

    expect(plan.kind).toBe("not-self");
    expect((plan as Extract<typeof plan, { kind: "not-self" }>).why).toContain("WS-OTHER");
    expect((plan as Extract<typeof plan, { kind: "not-self" }>).why).toContain(PINNED);
  });

  it("refuses when this process is outside cmux", () => {
    expect(
      planChairRestore({
        attemptsFor: () => 0,
        callerWorkspaceId: undefined,
        read: READ,
        requirement: FABLE_CHAIR_REQUIREMENT,
      }).kind,
    ).toBe("not-self");
  });

  it("refuses on a blank workspace id rather than matching one", () => {
    expect(planFresh({ caller: "   " }).kind).toBe("not-self");
  });

  it("refuses when the chair could not be read at all", () => {
    const plan = planFresh({ read: { cause: "no-chair", kind: "unresolved", why: "no workspace is pinned" } });

    expect(plan.kind).toBe("nothing-to-restore");
    expect((plan as Extract<typeof plan, { kind: "nothing-to-restore" }>).why).toContain("no workspace is pinned");
  });

  it("refuses when the only flagged seat is UNREAD, which a model switch cannot repair", () => {
    const read: ChairRead = {
      ...READ,
      sessions: [{ pid: 9, sessionId: "s9", verdict: { kind: "unreadable", why: "no transcript" } }],
    };

    expect(planFresh({ read }).kind).toBe("nothing-to-restore");
  });

  it("refuses an empty workspace", () => {
    expect(planFresh({ read: { ...READ, sessions: [] } }).kind).toBe("nothing-to-restore");
  });

  it("stops at the attempt ceiling, naming the instant it has already answered", () => {
    const plan = planFresh({ attempts: MAX_RESTORE_ATTEMPTS });

    expect(plan.kind).toBe("exhausted");
    const exhausted = plan as Extract<typeof plan, { kind: "exhausted" }>;
    expect(exhausted.why).toContain("2026-09-15T19:23:30.360Z");
    expect(exhausted.key).toBe("a0000023@2026-09-15T19:23:30.360Z");
  });

  it("still attempts one below the ceiling", () => {
    expect(planFresh({ attempts: MAX_RESTORE_ATTEMPTS - 1 }).kind).toBe("attempt");
  });
});

describe("chairRestoreLines", () => {
  it("keeps the handoff behind every outcome, because cmux cannot address the tab", () => {
    const plan = planFresh();
    const lines = chairRestoreLines({ outcome: { detail: "submitted", sent: true }, plan, required: "fable" });

    expect(lines.some((line) => line.includes("RESTORE SENT"))).toBe(true);
    expect(lines.some((line) => line.includes("cmux spawn <handoff slug> --model fable"))).toBe(true);
    expect(lines.some((line) => line.includes("close that tab"))).toBe(true);
  });

  it("says a send is a send, never that the chair is back on Fable", () => {
    const lines = chairRestoreLines({
      outcome: { detail: "submitted", sent: true },
      plan: planFresh(),
      required: "fable",
    });
    const sent = lines.find((line) => line.includes("RESTORE SENT"))!;

    expect(sent).toContain("That is a send, NOT a confirmation");
    expect(sent).not.toContain("is back on Fable");
  });

  it("keeps the fill shape's sent line byte for byte", () => {
    const lines = chairRestoreLines({
      outcome: { detail: "submitted", sent: true },
      plan: planFresh(),
      required: "fable",
    });

    expect(lines.slice(0, 2)).toStrictEqual([
      "RESTORE SENT: `/model fable` has been typed into this workspace (submitted). That is a send, NOT a " +
        "confirmation — Claude Code applies it at the next turn boundary, so THIS tick still refuses and the next " +
        "one passes on its own once a Fable turn lands. Nothing is owed to the owner.",
      "If the next tick still reads off Fable, the send is not reaching the right tab (1 session(s) live in this " +
        "workspace, and cmux addresses a workspace rather than a session) — take the handoff below.",
    ]);
  });

  it("names Opus throughout under the lean shape, the handoff's spawn included", () => {
    const plan = planFresh({ read: { ...READ, sessions: [ON_FABLE] }, requirement: OPUS_REQUIRED });
    const lines = chairRestoreLines({ outcome: { detail: "submitted", sent: true }, plan, required: "opus" });

    expect(lines[0]!).toContain("once an Opus turn lands");
    expect(lines.some((line) => line.includes("cmux spawn <handoff slug> --model opus"))).toBe(true);
    expect(lines.some((line) => line.includes("--model fable"))).toBe(false);
  });

  it("leads with the handoff when there was no restore to make", () => {
    const lines = chairRestoreLines({ outcome: undefined, plan: planFresh({ caller: "WS-OTHER" }), required: "fable" });

    expect(lines[0]!).toContain("NO RESTORE");
    expect(lines[0]!).toContain("A chair restores only its OWN seat");
  });

  it("renders the handoff alone when a plan was made but nothing was performed", () => {
    const lines = chairRestoreLines({ outcome: undefined, plan: planFresh(), required: "fable" });

    expect(lines.length).toBe(2);
    expect(lines[0]!).toContain("write the handoff now");
  });
});
