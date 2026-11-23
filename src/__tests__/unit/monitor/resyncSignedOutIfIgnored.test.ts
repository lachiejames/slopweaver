/*
 * What the resync-signed-out card says doing nothing costs the owner: the platform's read as of the OLDEST last success
 * among the rows the page stopped (or that it never synced), and that a schedule raised it rather than a run.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import type { ResyncState } from "../../../live/resync/outcome.js";
import { buildArrival } from "../../../monitor/card.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import { evaluateResyncSignedOut, syncedThrough } from "../../../monitor/resyncSignedOut.js";
import { signInIfIgnored } from "../../../monitor/resyncSignedOutDefinition.js";
import type { MonitorReading, MonitorSubject } from "../../../monitor/types.js";

const TRELICA = "https://acme.trelica.app";
/** The instant every evaluation judges a sign-in look's freshness at. */
const LOOK_NOW = "2026-10-06T11:00:00.000Z";

/**
 * One row whose newest attempt stopped at Trelica's sign-in page.
 *
 * @param recipeId the row
 * @param lastSuccessAtIso its last clean run, or null when it has never had one
 * @returns the state
 */
function walled({ recipeId, lastSuccessAtIso }: { recipeId: string; lastSuccessAtIso: string | null }): ResyncState {
  return {
    blocker: null,
    lastAttempt: {
      afterClock: null,
      beforeClock: "2026-10-04T00:00:00.000Z",
      exitCode: 1,
      finishedAtIso: "2026-10-05T00:24:00.000Z",
      outcome: "failed",
      problems: ["exited 1"],
      recipeId,
      signInWall: TRELICA,
      startedAtIso: "2026-10-05T00:20:00.000Z",
    },
    lastSuccessAtIso,
    recipeId,
  };
}

/**
 * The one subject the monitor raises for these rows.
 *
 * @param states the rows' resync states
 * @returns the subject
 */
function subjectOf({ states }: { states: readonly ResyncState[] }): MonitorSubject {
  const reading = evaluateResyncSignedOut({
    blindSpot: undefined,
    cards: new Map(),
    nowIso: LOOK_NOW,
    pinPath: undefined,
    probes: [],
    states,
  });
  return (reading as Extract<MonitorReading, { state: "firing" }>).subjects[0]!;
}

describe("syncedThrough", () => {
  it("is the oldest last success among the rows", () => {
    expect(
      syncedThrough({
        rows: [{ lastSuccessAtIso: "2026-10-04T12:00:00.000Z" }, { lastSuccessAtIso: "2026-10-01T06:00:00.000Z" }],
      }),
    ).toEqual({ iso: "2026-10-01T06:00:00.000Z", kind: "at" });
  });

  it("is never when any row has never synced, however fresh the others", () => {
    expect(
      syncedThrough({ rows: [{ lastSuccessAtIso: "2026-10-04T12:00:00.000Z" }, { lastSuccessAtIso: null }] }),
    ).toEqual({ kind: "never" });
  });
});

describe("signInIfIgnored", () => {
  it("names the host's read as of the stalest row's date, and that a schedule raised it", () => {
    const subject = subjectOf({
      states: [
        walled({ lastSuccessAtIso: "2026-10-04T12:00:00.000Z", recipeId: "resync-atlas-trelica" }),
        walled({ lastSuccessAtIso: "2026-10-02T06:00:00.000Z", recipeId: "resync-atlas-trelica-apps" }),
      ],
    });
    expect(signInIfIgnored({ subject })).toBe(
      "acme.trelica.app's read stays as of 2026-10-02, and each scheduled resync stops at this page again — routine freshness the schedule raised, not a run",
    );
  });

  it("says the read stays empty when the row has never synced", () => {
    const subject = subjectOf({ states: [walled({ lastSuccessAtIso: null, recipeId: "resync-atlas-trelica" })] });
    expect(signInIfIgnored({ subject })).toBe(
      "acme.trelica.app's read stays empty — it has never synced, and each scheduled resync stops at this page again — routine freshness the schedule raised, not a run",
    );
  });

  it("is the line the posted card carries", () => {
    const subject = subjectOf({
      states: [walled({ lastSuccessAtIso: "2026-10-04T12:00:00.000Z", recipeId: "resync-atlas-trelica" })],
    });
    const arrival = unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition: monitorDefinition({ monitorId: "resync-signed-out" }),
        nowIso: "2026-10-05T01:00:00.000Z",
        postedBy: "workspace:29",
        subject,
      }),
    );
    expect(arrival.ifIgnored).toBe(signInIfIgnored({ subject }));
  });

  it("is absent from a monitor that declares none", () => {
    expect(monitorDefinition({ monitorId: "fleet-unhealthy" }).ifIgnored).toBe(undefined);
  });
});
