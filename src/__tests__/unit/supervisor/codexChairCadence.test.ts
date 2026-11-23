/** A Codex chair's hand-off cadence: stale canon alone, and its Claude-only reasons named UNMEASURED (slice 4c). */
import { describe, expect, it } from "vitest";

import type { CanonCommit } from "../../../supervisor/chairCanon.js";
import {
  CODEX_CHAIR_BUDGET_UNMEASURED,
  CODEX_CHAIR_CLI_UNMEASURED,
  CODEX_CHAIR_CONTEXT_UNMEASURED,
  judgeCodexChairCadence,
} from "../../../supervisor/codexChairCadence.js";

const THREAD = "019a1a98-9b15-7482-8000-000000000001";
const NOW_ISO = "2026-11-06T12:00:00.000Z";
const ROUTE = { alias: "codex-one", kind: "picks" } as const;
const CHANGED: readonly CanonCommit[] = [
  {
    committedIso: "2026-11-05T09:00:00Z",
    sha: "34e48e7b7accbdca0b1c7a73d355db7f7f51a443",
    subject: "A skill changed (#1)",
  },
];
const UNMEASURED_NOTES = [
  `Codex thread ${THREAD}: ${CODEX_CHAIR_BUDGET_UNMEASURED}`,
  `Codex thread ${THREAD}: ${CODEX_CHAIR_CLI_UNMEASURED}`,
  `Codex thread ${THREAD}: ${CODEX_CHAIR_CONTEXT_UNMEASURED}`,
];

/** The verdict for a chair whose record took it `hoursAgo` before the tick, with `changed` on main since. */
function judgedAt({ hoursAgo, changed }: { hoursAgo: number; changed: readonly CanonCommit[] }) {
  const bootedIso = new Date(Date.parse(NOW_ISO) - hoursAgo * 3_600_000).toISOString();
  return judgeCodexChairCadence({
    canon: { bootedIso, changed, kind: "measured" },
    nowIso: NOW_ISO,
    route: ROUTE,
    threadId: THREAD,
  });
}

describe("judgeCodexChairCadence", () => {
  it("hands off at exactly 36h when canon changed since, carrying the route", () => {
    const verdict = judgedAt({ changed: CHANGED, hoursAgo: 36 });

    expect(verdict).toStrictEqual({
      kind: "hand-off",
      notes: UNMEASURED_NOTES,
      reasons: [
        {
          ageHours: 36,
          bootedIso: "2026-11-05T00:00:00.000Z",
          commits: 1,
          kind: "canon-stale",
          newestSha: "34e48e7b7",
          newestSubject: "A skill changed (#1)",
        },
      ],
      route: ROUTE,
    });
  });

  it("stays at 35h even with canon changed — age alone is never enough", () => {
    expect(judgedAt({ changed: CHANGED, hoursAgo: 35 })).toStrictEqual({ kind: "stay", notes: UNMEASURED_NOTES });
  });

  it("stays at 40h when canon has not changed — a change alone is never enough either", () => {
    expect(judgedAt({ changed: [], hoursAgo: 40 })).toStrictEqual({ kind: "stay", notes: UNMEASURED_NOTES });
  });

  it("stays and names the canon UNMEASURED when its floor could not be read", () => {
    const verdict = judgeCodexChairCadence({
      canon: {
        kind: "unmeasured",
        why: "no supervisor pin or chain link records when this Codex thread took the chair",
      },
      nowIso: NOW_ISO,
      route: ROUTE,
      threadId: THREAD,
    });

    expect(verdict).toStrictEqual({
      kind: "stay",
      notes: [
        `session ${THREAD}: whether its loaded canon is stale is UNMEASURED — no supervisor pin or chain link records when this Codex thread took the chair`,
        ...UNMEASURED_NOTES,
      ],
    });
  });

  it("never reads an unparseable tick instant as stale", () => {
    const verdict = judgeCodexChairCadence({
      canon: { bootedIso: "2026-11-01T00:00:00.000Z", changed: CHANGED, kind: "measured" },
      nowIso: "not-an-instant",
      route: ROUTE,
      threadId: THREAD,
    });

    expect(verdict.kind).toBe("stay");
    expect(verdict.notes[0]).toContain("its age is UNMEASURED");
  });
});
