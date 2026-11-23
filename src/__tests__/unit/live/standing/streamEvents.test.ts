/**
 * The standing-session projection onto the supervisor stream — pure, including the transition dedupe that
 * keeps a stale session from putting an alert on the stream every few minutes.
 */
import { describe, expect, it } from "vitest";

import { severityOf } from "../../../../events/event.js";
import { gradeStandingTree, standingSessionFreshness } from "../../../../live/standing/freshness.js";
import {
  newestStandingKind,
  standingEventKindFor,
  standingRespawnedEvent,
  standingStreamEvent,
} from "../../../../live/standing/streamEvents.js";
import { SUPERVISOR_CHAIN_PATHS } from "../../../../live/standing/supervisor.js";

/** One session's folded freshness, built through the real grader so a fixture cannot drift from it. */
function freshnessOf({
  behind,
  changedPaths,
  role = "bin",
  sensitivePaths,
  session = "loop",
}: {
  behind: number | undefined;
  changedPaths: readonly string[];
  role?: "bin" | "plugin-dir";
  sensitivePaths?: readonly string[];
  session?: string;
}): ReturnType<typeof standingSessionFreshness> {
  return standingSessionFreshness({
    session,
    trees: [
      gradeStandingTree({
        reading: { behind, changedPaths, head: "923f6490", path: "/wt/x" },
        role,
        ...(sensitivePaths === undefined ? {} : { sensitivePaths }),
      }),
    ],
  });
}

describe("standingEventKindFor", () => {
  it("maps stale to the stale kind", () => {
    expect(
      standingEventKindFor({ freshness: freshnessOf({ behind: 63, changedPaths: ["skills/loop/SKILL.md"] }) }),
    ).toBe("stale");
  });

  it("maps behind to the clearing kind — it is not alerting", () => {
    expect(standingEventKindFor({ freshness: freshnessOf({ behind: 2, changedPaths: ["docs/x.md"] }) })).toBe(
      "current",
    );
  });

  it("publishes nothing for an unmeasurable session — neither claim would be honest", () => {
    expect(standingEventKindFor({ freshness: freshnessOf({ behind: undefined, changedPaths: [] }) })).toBeUndefined();
  });
});

describe("standingStreamEvent", () => {
  it("publishes an alert-severity event the first time a session goes stale", () => {
    const event = standingStreamEvent({
      atIso: "2026-08-28T14:20:00.000Z",
      freshness: freshnessOf({ behind: 63, changedPaths: ["skills/loop/SKILL.md"] }),
      previousKind: "current",
    });

    expect(event!.kind).toBe("stale");
    expect(event?.session).toBe("loop");
    expect(event!.head).toBe("923f6490");
    expect(severityOf({ event: event! })).toBe("alert");
  });

  it("names the verb that clears it, so the sentence is actionable on its own", () => {
    const event = standingStreamEvent({
      atIso: "2026-08-28T14:20:00.000Z",
      freshness: freshnessOf({ behind: 63, changedPaths: ["skills/loop/SKILL.md"] }),
      previousKind: undefined,
    });

    expect(event!.why).toBe(
      "the loop standing session is STALE: its bin is 63 commit(s) behind origin/main and those commits " +
        "changed skills/loop/SKILL.md — it is running code or prose the fleet has already replaced, and " +
        "every worker it dispatches inherits that. Respawn it: " +
        "`slopweaver session respawn loop --successor <today's dated loop doc>`. Write today's doc first, " +
        "then name its slug in place of the placeholder.",
    );
  });

  it("publishes nothing when the stream already says stale — no wall of repeats", () => {
    expect(
      standingStreamEvent({
        atIso: "2026-08-28T14:20:00.000Z",
        freshness: freshnessOf({ behind: 63, changedPaths: ["skills/loop/SKILL.md"] }),
        previousKind: "stale",
      }),
    ).toBeUndefined();
  });

  it("publishes the first-ever reading, so a briefing has a baseline rather than silence", () => {
    const event = standingStreamEvent({
      atIso: "2026-08-28T14:20:00.000Z",
      freshness: freshnessOf({ behind: 0, changedPaths: [] }),
      previousKind: undefined,
    });

    expect(event!.kind).toBe("current");
    expect(severityOf({ event: event! })).toBe("info");
  });

  it("publishes the clearing half when a stale session becomes current", () => {
    const event = standingStreamEvent({
      atIso: "2026-08-28T14:20:00.000Z",
      freshness: freshnessOf({ behind: 0, changedPaths: [] }),
      previousKind: "stale",
    });

    expect(event!.kind).toBe("current");
    expect(event!.why).toBe("the loop standing session is current with origin/main.");
  });

  it("says a behind session owes no respawn, rather than calling it current", () => {
    const event = standingStreamEvent({
      atIso: "2026-08-28T14:20:00.000Z",
      freshness: freshnessOf({ behind: 4, changedPaths: ["docs/x.md"] }),
      previousKind: "stale",
    });

    expect(event!.why).toBe(
      "the loop standing session is 4 commit(s) behind origin/main, none of it under a path that session runs — no respawn is owed.",
    );
  });

  it("publishes nothing at all for an unmeasurable session", () => {
    expect(
      standingStreamEvent({
        atIso: "2026-08-28T14:20:00.000Z",
        freshness: freshnessOf({ behind: undefined, changedPaths: [] }),
        previousKind: "current",
      }),
    ).toBeUndefined();
  });
});

describe("standingRespawnedEvent", () => {
  it("records the action with info severity and the successor's head", () => {
    const event = standingRespawnedEvent({
      atIso: "2026-08-28T15:00:00.000Z",
      detail: "`recipe scheduler-start` booted a replacement",
      head: "fede05d2",
      session: "scheduler",
    });

    expect(event.kind).toBe("respawned");
    expect(severityOf({ event })).toBe("info");
    expect(event.why).toBe(
      "the scheduler standing session was retired and respawned on fede05d2 — `recipe scheduler-start` booted a replacement",
    );
  });
});

describe("newestStandingKind", () => {
  it("returns the newest reading for the named session", () => {
    const events = [
      { kind: "stale", session: "loop", source: "standing-session" },
      { kind: "current", session: "loop", source: "standing-session" },
    ];

    expect(newestStandingKind({ events, session: "loop" })).toBe("current");
  });

  it("ignores another session's readings", () => {
    const events = [
      { kind: "stale", session: "scheduler", source: "standing-session" },
      { kind: "current", session: "loop", source: "standing-session" },
    ];

    expect(newestStandingKind({ events, session: "scheduler" })).toBe("stale");
  });

  it("ignores other sources entirely", () => {
    expect(newestStandingKind({ events: [{ kind: "died", source: "listener" }], session: "loop" })).toBeUndefined();
  });

  it("never lets a respawned record become the baseline a later reading dedupes against", () => {
    const events = [
      { kind: "stale", session: "loop", source: "standing-session" },
      { kind: "respawned", session: "loop", source: "standing-session" },
    ];

    expect(newestStandingKind({ events, session: "loop" })).toBe("stale");
  });

  it("returns undefined when the session has never published", () => {
    expect(newestStandingKind({ events: [], session: "loop" })).toBeUndefined();
  });
});

describe("the remedy sentence names a command that actually exists", () => {
  // The loop's respawn REFUSES with EXIT_USAGE unless --successor names today's dated doc
  // (`cli/commands/session/respawn.ts`), so the bare verb was a usage error in the one sentence a
  // supervisor is meant to run verbatim. Both halves were tested and their composition was not.
  it("tells a stale loop to respawn WITH the successor the verb requires, not the bare verb", () => {
    const event = standingStreamEvent({
      atIso: "2026-09-07T09:00:00.000Z",
      freshness: freshnessOf({ behind: 63, changedPaths: ["skills/loop/SKILL.md"] }),
      previousKind: "current",
    });

    expect(event!.why).toBe(
      "the loop standing session is STALE: its bin is 63 commit(s) behind origin/main and those commits " +
        "changed skills/loop/SKILL.md — it is running code or prose the fleet has already replaced, and " +
        "every worker it dispatches inherits that. Respawn it: " +
        "`slopweaver session respawn loop --successor <today's dated loop doc>`. Write today's doc " +
        "first, then name its slug in place of the placeholder.",
    );
  });

  // `scheduler` was respawnable until that session was retired and `session respawn` stopped
  // accepting the name. A sentence still prescribing it would be the exact lying remedy this module exists
  // to prevent, so the name now takes the explicit fallback like any other non-respawnable session.
  it("names no respawn verb for `scheduler`, which the verb no longer accepts", () => {
    const event = standingStreamEvent({
      atIso: "2026-09-07T09:00:00.000Z",
      freshness: freshnessOf({ behind: 12, changedPaths: ["src/live/automation/seat.ts"], session: "scheduler" }),
      previousKind: "current",
    });

    expect(event!.why).toContain("STALE");
    expect(event!.why).not.toContain("session respawn scheduler");
  });

  // `session respawn` accepts the loop only, so a sentence prescribing it for the keep-alive
  // would be the same confident lie in a new costume.
  it("tells a stale keep-alive to restart, and names no respawn verb at all", () => {
    const event = standingStreamEvent({
      atIso: "2026-09-07T09:00:00.000Z",
      freshness: freshnessOf({
        behind: 9,
        changedPaths: ["src/claude/watchTick.ts"],
        sensitivePaths: ["src/claude"],
        session: "keep-alive",
      }),
      previousKind: "current",
    });

    // Asserted as the WHOLE remedy clause, not as fragments: two `toContain` checks would still pass
    // with a respawn instruction appended after them, which is exactly the guarantee this test names.
    expect(event!.why).toBe(
      "the keep-alive standing session is STALE: its bin is 9 commit(s) behind origin/main and those " +
        "commits changed src/claude/watchTick.ts — it is running code or prose the fleet has already " +
        "replaced, and every worker it dispatches inherits that. Interrupt it and start it again from a " +
        "current checkout — `session respawn` does not accept `keep-alive`, and this loop holds no state " +
        "to retire.",
    );
  });

  it("tells a stale supervisor BIN to run checkout sync — session respawn does not accept `supervisor`", () => {
    const event = standingStreamEvent({
      atIso: "2026-09-07T09:00:00.000Z",
      freshness: freshnessOf({
        behind: 40,
        changedPaths: ["src/cli/commands/session/closeDone.ts"],
        sensitivePaths: SUPERVISOR_CHAIN_PATHS,
        session: "supervisor",
      }),
      previousKind: "current",
    });

    expect(event!.why).toContain("slopweaver checkout sync");
    expect(event!.why).not.toContain("session respawn supervisor");
  });

  it("tells a stale supervisor PLUGIN-DIR to reopen the chat, and names no respawn verb", () => {
    const freshness = freshnessOf({
      behind: 40,
      changedPaths: ["skills/supervisor/SKILL.md"],
      role: "plugin-dir",
      sensitivePaths: SUPERVISOR_CHAIN_PATHS,
      session: "supervisor",
    });
    const event = standingStreamEvent({ atIso: "2026-09-07T09:00:00.000Z", freshness, previousKind: "current" });

    expect(event!.why).toContain("Reopen the supervisor chat on a current worktree");
    expect(event!.why).not.toContain("slopweaver session respawn");
  });
});
