/**
 * `resync-signed-out`: a scheduled resync that stopped at a sign-in page raises exactly ONE step for that sign-in, and a
 * failure that is not a sign-in raises none, through the evaluator and the REAL pass.
 *
 * The two resync records are the measured shapes of that day: Trelica's sync stopped at
 * `https://acme.trelica.app`'s sign-in, Vanta's sync exited 1 on its OAuth client with no sign-in at all.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSettledRow } from "../../../hand/row.js";
import { appendHandRow, handRegisterPath, readHandRows, readOpenHandSteps } from "../../../hand/store.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../live/automation/definition.js";
import type { ResyncAttempt, ResyncState } from "../../../live/resync/outcome.js";
import { writeResyncState } from "../../../live/resync/outcomeStore.js";
import { buildArrival } from "../../../monitor/card.js";
import { runMonitorPass } from "../../../monitor/pass.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import { evaluateResyncSignedOut, signInAnswered, signInSubjectKey } from "../../../monitor/resyncSignedOut.js";
import { RESYNC_SIGNED_OUT } from "../../../monitor/resyncSignedOutDefinition.js";
import { signInCardHistory } from "../../../monitor/resyncSignedOutSource.js";
import type { MonitorReading } from "../../../monitor/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryPlanHealthPorts } from "../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "../../orgHealthStoreFixture.js";
import { memoryPagesPublished } from "../../pagesPublishedFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../processesFake.js";

const TRELICA = "https://acme.trelica.app";
/** The instant every evaluation judges a sign-in look's freshness at. */
const LOOK_NOW = "2026-10-06T11:00:00.000Z";
const WALL_AT = "2026-09-30T04:24:00.000Z";
const PIN = "/Users/owner/.slopweaver/chrome-pin.sh";

/**
 * One target's state whose newest attempt failed.
 *
 * @param recipeId the row
 * @param signInWall the origin its attempt stopped at, when it did
 * @param finishedAtIso when the attempt finished
 * @returns the state
 */
function failed({
  recipeId,
  signInWall,
  finishedAtIso = WALL_AT,
}: {
  recipeId: string;
  signInWall?: string;
  finishedAtIso?: string;
}): ResyncState {
  const attempt: ResyncAttempt = {
    afterClock: null,
    beforeClock: "2026-09-29T00:00:00.000Z",
    exitCode: 1,
    finishedAtIso,
    outcome: "failed",
    problems: ["exited 1"],
    recipeId,
    startedAtIso: "2026-09-30T04:20:00.000Z",
    ...(signInWall === undefined ? {} : { signInWall }),
  };
  return { blocker: null, lastAttempt: attempt, lastSuccessAtIso: null, recipeId };
}

/** Evaluate with no card history and the pin written. */
function evaluate({ states }: { states: readonly ResyncState[] }): MonitorReading {
  return evaluateResyncSignedOut({
    blindSpot: undefined,
    cards: new Map(),
    nowIso: LOOK_NOW,
    pinPath: PIN,
    probes: [],
    states,
  });
}

describe("evaluateResyncSignedOut", () => {
  it("raises exactly one subject for a sign-in wall, whose origin the pass opens and nothing the owner pastes", () => {
    const reading = evaluate({ states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })] });
    expect(reading.state).toBe("firing");
    const { subjects } = reading as Extract<MonitorReading, { state: "firing" }>;
    expect(subjects.length).toBe(1);
    expect(subjects[0]!.id).toBe("acme.trelica.app");
    expect(subjects[0]!.key).toBe("acme-trelica-app");
    expect(subjects[0]!.opens).toBe(TRELICA);
    expect(Object.keys(subjects[0]!)).not.toContain("literal");
  });

  it("raises nothing for a failure that is not a sign-in", () => {
    expect(evaluate({ states: [failed({ recipeId: "resync-atlas-vanta" })] })).toEqual({
      monitorId: "resync-signed-out",
      state: "clear",
    });
  });

  it("raises one subject for two rows that stopped at the same origin, naming both", () => {
    const reading = evaluate({
      states: [
        failed({ recipeId: "resync-atlas-xero", signInWall: "https://go.xero.com" }),
        failed({ recipeId: "resync-atlas-xero-reports", signInWall: "https://go.xero.com" }),
      ],
    }) as Extract<MonitorReading, { state: "firing" }>;
    expect(reading.subjects.map((subject) => subject.label)).toEqual([
      "resync-atlas-xero, resync-atlas-xero-reports stopped at go.xero.com's sign-in page",
    ]);
  });

  it("forgets a wall once a later attempt got past it", () => {
    const state = failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA });
    const succeeded: ResyncState = {
      ...state,
      lastAttempt: { ...state.lastAttempt!, outcome: "succeeded", problems: [], signInWall: undefined },
    };
    expect(evaluate({ states: [succeeded] }).state).toBe("clear");
  });

  it("holds a card the owner pressed Done on after the attempt that met the wall", () => {
    const reading = evaluateResyncSignedOut({
      blindSpot: undefined,
      cards: new Map([["acme-trelica-app", { lastSettledIso: "2026-09-30T11:30:00.000Z", open: false }]]),
      nowIso: LOOK_NOW,
      pinPath: PIN,
      probes: [],
      states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })],
    }) as Extract<MonitorReading, { state: "firing" }>;
    expect(reading.subjects[0]!.delivery!.kind).toBe("hold");
  });

  it("posts afresh when a NEWER attempt meets the wall again after the owner's Done", () => {
    const reading = evaluateResyncSignedOut({
      blindSpot: undefined,
      cards: new Map([["acme-trelica-app", { lastSettledIso: "2026-09-30T11:30:00.000Z", open: false }]]),
      nowIso: LOOK_NOW,
      pinPath: PIN,
      probes: [],
      states: [
        failed({ finishedAtIso: "2026-09-30T14:00:00.000Z", recipeId: "resync-atlas-trelica", signInWall: TRELICA }),
      ],
    }) as Extract<MonitorReading, { state: "firing" }>;
    expect(Object.keys(reading.subjects[0]!)).not.toContain("delivery");
  });

  it("opens no page before any pin is written, and the card still names the host", () => {
    const reading = evaluateResyncSignedOut({
      blindSpot: undefined,
      cards: new Map(),
      nowIso: LOOK_NOW,
      pinPath: undefined,
      probes: [],
      states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })],
    }) as Extract<MonitorReading, { state: "firing" }>;
    expect(Object.keys(reading.subjects[0]!)).not.toContain("opens");
    expect(monitorDefinition({ monitorId: "resync-signed-out" }).what({ subject: reading.subjects[0]! })).toBe(
      "Sign in to acme.trelica.app in your work Chrome — a scheduled resync stopped at its sign-in page",
    );
  });

  it("holds a Datadog wall no look stands behind — the fleet presses it, never the owner's card", () => {
    const reading = evaluateResyncSignedOut({
      blindSpot: undefined,
      cards: new Map(),
      nowIso: LOOK_NOW,
      pinPath: PIN,
      probes: [],
      states: [failed({ recipeId: "resync-atlas-datadog", signInWall: "https://ap1.datadoghq.com" })],
    }) as Extract<MonitorReading, { state: "firing" }>;
    expect(reading.subjects[0]!.delivery).toEqual({
      kind: "hold",
      why:
        "a datadog sign-in is the fleet's to press, not your card: no look stands behind " +
        "it — run `slopweaver browser sign-in --provider datadog` first",
    });
    // What tells the fleet-health line this hold is the fleet's press, not the owner's Done.
    expect(reading.subjects[0]!.fleetPresses).toBe("datadog");
    expect(Object.keys(reading.subjects[0]!)).not.toContain("opens");
  });

  it("keeps who asked on a held wall, so a fleet-pressed sign-in still names the mention", () => {
    const state = failed({ recipeId: "resync-atlas-datadog", signInWall: "https://ap1.datadoghq.com" });
    const demand = { author: "Tobias Wren", occurredAt: "2026-10-06T22:03:01Z", source: "slack", url: "https://x/p1" };
    const reading = evaluateResyncSignedOut({
      blindSpot: undefined,
      cards: new Map(),
      nowIso: LOOK_NOW,
      pinPath: PIN,
      probes: [],
      states: [{ ...state, lastAttempt: { ...state.lastAttempt!, demand } }],
    }) as Extract<MonitorReading, { state: "firing" }>;
    const subject = reading.subjects[0]!;
    expect([subject.fleetPresses, subject.wantedBy, subject.details]).toEqual([
      "datadog",
      demand,
      ["walked because Tobias Wren in slack at 2026-10-06T22:03:01Z: https://x/p1"],
    ]);
  });

  it("cards a Datadog wall a fresh look found genuinely the owner's", () => {
    const reading = evaluateResyncSignedOut({
      blindSpot: undefined,
      cards: new Map(),
      nowIso: LOOK_NOW,
      pinPath: PIN,
      probes: [
        {
          atIso: "2026-10-06T10:50:00.000Z",
          page: "https://ap1.datadoghq.com/account/login",
          provider: "datadog",
          verdict: "owner-hands",
          why: "ap1.datadoghq.com asks for a password, passkey or second factor",
        },
      ],
      states: [failed({ recipeId: "resync-atlas-datadog", signInWall: "https://ap1.datadoghq.com" })],
    }) as Extract<MonitorReading, { state: "firing" }>;
    expect(Object.keys(reading.subjects[0]!)).not.toContain("delivery");
    expect(Object.keys(reading.subjects[0]!)).not.toContain("fleetPresses");
    expect(reading.subjects[0]!.opens).toBe("https://ap1.datadoghq.com");
  });
});

describe("the resync-signed-out card", () => {
  it("is one the hand register accepts, naming the sign-in in the window the pass opened, with nothing to paste", () => {
    const reading = evaluate({
      states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })],
    }) as Extract<MonitorReading, { state: "firing" }>;
    const arrival = unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition: monitorDefinition({ monitorId: "resync-signed-out" }),
        nowIso: "2026-09-30T11:40:00.000Z",
        postedBy: "workspace:29",
        subject: reading.subjects[0]!,
      }),
    );
    expect(arrival.what).toBe(
      "Sign in to acme.trelica.app in the work Chrome window just opened, so its resync can read again",
    );
    expect(arrival.opened).toBe(TRELICA);
    expect(arrival.where).toBe(
      "Your work Chrome profile, on that platform's sign-in page — sign in there, then press Done",
    );
    expect(Object.keys(arrival)).not.toContain("literal");
  });

  it("is the declaration the registry lists for resync-signed-out, floating and one card per origin", () => {
    const definition = monitorDefinition({ monitorId: "resync-signed-out" });
    expect(definition).toBe(RESYNC_SIGNED_OUT);
    expect([definition.floats, definition.perSubject, definition.context, definition.prefix]).toEqual([
      true,
      true,
      "work",
      "signin",
    ]);
  });

  it("says who a demand-gated walk was for, and keeps the mention behind the disclosure row", () => {
    // The shape: Aether walked because Tobias named DVuln in a thread, and met the sign-in page.
    const state = failed({ recipeId: "resync-atlas-aether", signInWall: "https://app.tryaether.ai" });
    const demand = {
      author: "Tobias Wren",
      occurredAt: "2026-10-06T22:03:01Z",
      source: "slack",
      url: "https://acme.slack.com/archives/C0SYN000019/p1791324181655509",
    };
    const reading = evaluate({
      states: [
        { ...state, lastAttempt: { ...state.lastAttempt!, demand }, lastSuccessAtIso: "2026-10-04T21:27:13.151Z" },
      ],
    }) as Extract<MonitorReading, { state: "firing" }>;
    const subject = reading.subjects[0]!;
    expect(subject.wantedBy).toEqual(demand);
    expect(subject.details).toEqual([
      "walked because Tobias Wren in slack at 2026-10-06T22:03:01Z: https://acme.slack.com/archives/C0SYN000019/p1791324181655509",
    ]);
    expect(RESYNC_SIGNED_OUT.ifIgnored!({ subject })).toBe(
      "app.tryaether.ai's read stays as of 2026-10-04. It walked because Tobias Wren named it on 2026-10-06 — the stored read may already answer them",
    );
  });

  it("still calls a calendar walk's wall routine freshness, carrying no mention", () => {
    const reading = evaluate({
      states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })],
    }) as Extract<MonitorReading, { state: "firing" }>;
    expect(Object.keys(reading.subjects[0]!)).not.toContain("wantedBy");
    expect(RESYNC_SIGNED_OUT.ifIgnored!({ subject: reading.subjects[0]! })).toContain(
      "routine freshness the schedule raised, not a run",
    );
  });

  it("keys a long host inside the register's id budget", () => {
    const key = signInSubjectKey({ origin: `https://${"a".repeat(80)}.example.com` });
    expect(`mon-signin-${key}.12`.length).toBeLessThanOrEqual(60);
  });
});

describe("signInAnswered", () => {
  const answered = ({ history }: { history: { lastSettledIso: string | undefined; open: boolean } }): boolean =>
    signInAnswered({
      cards: new Map([["acme-trelica-app", history]]),
      origin: TRELICA,
      wallIso: WALL_AT,
    });

  it("answers a wall once the owner's card was settled after it and none is open", () => {
    expect(answered({ history: { lastSettledIso: "2026-09-30T11:30:00.000Z", open: false } })).toBe(true);
  });

  it("answers a wall the owner's card was settled at the same instant as", () => {
    expect(answered({ history: { lastSettledIso: WALL_AT, open: false } })).toBe(true);
  });

  it("does not answer a wall met again after the owner's last Done", () => {
    expect(answered({ history: { lastSettledIso: "2026-09-30T04:00:00.000Z", open: false } })).toBe(false);
  });

  it("does not answer a wall while a card for it is still open", () => {
    expect(answered({ history: { lastSettledIso: "2026-09-30T11:30:00.000Z", open: true } })).toBe(false);
  });

  it("does not answer a wall whose card was never settled", () => {
    expect(answered({ history: { lastSettledIso: undefined, open: false } })).toBe(false);
  });

  it("does not answer a wall at an origin the owner has no card for", () => {
    expect(signInAnswered({ cards: new Map(), origin: TRELICA, wallIso: WALL_AT })).toBe(false);
  });
});

describe("signInCardHistory", () => {
  it("reads a card settled by the owner's Done, and an open re-post of it", () => {
    const history = signInCardHistory({
      prefix: "mon-signin-",
      rows: [
        {
          bySession: "owner",
          did: "signed in",
          id: "mon-signin-go-xero-com",
          kind: "settled",
          settledIso: "2026-09-30T11:30:00.000Z",
        },
        {
          bySession: "owner",
          did: "signed in",
          id: "mon-health-syncs",
          kind: "settled",
          settledIso: "2026-09-30T12:00:00.000Z",
        },
      ],
    });
    expect([...history.entries()]).toEqual([
      ["go-xero-com", { lastSettledIso: "2026-09-30T11:30:00.000Z", open: false }],
    ]);
  });
});

describe("resync-signed-out through the pass", () => {
  let home = "";
  /** What the pass did on the owner's screen, in order: each page it opened and each note it raised. */
  let screen: string[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "signin-pass-"));
    screen = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /**
   * Store each state in the home with a definition for its row, and write the pin so the card carries its paste.
   *
   * @param states the rows' remembered states
   * @param retired the rows whose definition the registrar has removed, so only their state file is left
   */
  function remember({ states, retired = [] }: { states: readonly ResyncState[]; retired?: readonly string[] }): void {
    const recipe = stateHomePaths({ home }).live.recipe;
    mkdirSync(recipe.definitionsDir, { recursive: true });
    for (const state of states) {
      unwrap(writeResyncState({ state, stateDir: recipe.resyncStateDir }));
      if (!retired.includes(state.recipeId)) {
        writeFileSync(
          join(recipe.definitionsDir, `${state.recipeId}.json`),
          JSON.stringify({
            cadence: "0 10 * * 1-5",
            destination: { kind: "slack" },
            effect: "read-write",
            kind: "alert-summary",
            params: {},
            recipeId: state.recipeId,
            schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
          }),
        );
      }
    }
    writeFileSync(stateHomePaths({ home }).chromePin, "#!/bin/sh\n");
  }

  /**
   * One FIRED pass of `resync-signed-out` alone.
   *
   * @param openIds the open hand-step ids
   * @returns every action this monitor took, as kind and step id
   */
  async function firedPass({
    openIds,
    pageFails = false,
  }: {
    openIds: readonly string[];
    pageFails?: boolean;
  }): Promise<readonly string[]> {
    const nowIso = "2026-09-30T11:40:00.000Z";
    const passed = await runMonitorPass({
      consoleBase: "http://localhost:3000",
      fire: true,
      inputs: {
        claudeProjectsDir: join(home, "claude-projects"),
        fleetCapPort: memoryCodexFleetCapPort(),
        orgHealthPort: memoryOrgHealthPort(),
        pagePublished: memoryPagesPublished(),
        registerPort: memoryPlanRegisterPort(),
        ...memoryPlanHealthPorts(),
        processes: NO_FSEVENTSD,
        home,
        landingPath: undefined,
        nowIso,
        nowMs: Date.parse(nowIso),
        only: "resync-signed-out",
      },
      nowIso,
      openIds,
      openWithDecision: new Set(),
      openPage: async ({ url }) => {
        if (pageFails) {
          return err("no work Chrome pin");
        }
        screen.push(`page ${url}`);
        return ok(`opened ${url}`);
      },
      postedBy: "workspace:29",
      postedIds: unwrap(readOpenHandSteps({ home })).postedIds,
      raiseNote: ({ step }) => {
        screen.push(`note ${step.id}`);
        return ok("drawn");
      },
    });
    return passed.actions.map((action) => `${action.kind} ${action.stepId}`);
  }

  /** Every step id the home's hand register holds a posting for. */
  function postedIds(): readonly string[] {
    const { rows } = unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) }));
    return rows.flatMap((row) => (row.kind === "posted" ? [row.step.id] : []));
  }

  it("posts exactly one step for a sign-in-class failure", async () => {
    remember({ states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })] });
    expect((await firedPass({ openIds: [] })).filter((line) => line.startsWith("posted "))).toEqual([
      "posted mon-signin-acme-trelica-app",
    ]);
    expect(postedIds()).toEqual(["mon-signin-acme-trelica-app"]);
  });

  // Xero's schedule is retired. Its definition is gone, its last walled state file is not.
  it("posts nothing for a retired row's last wall, while a live row's wall still posts", async () => {
    remember({
      retired: ["resync-atlas-xero"],
      states: [
        failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA }),
        failed({ recipeId: "resync-atlas-xero", signInWall: "https://go.xero.com" }),
      ],
    });
    expect((await firedPass({ openIds: [] })).filter((line) => line.startsWith("posted "))).toEqual([
      "posted mon-signin-acme-trelica-app",
    ]);
    expect(postedIds()).toEqual(["mon-signin-acme-trelica-app"]);
  });

  it("opens the sign-in page on the owner's screen BEFORE the note that says to sign in there", async () => {
    remember({ states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })] });
    expect(await firedPass({ openIds: [] })).toEqual([
      "posted mon-signin-acme-trelica-app",
      "noted mon-signin-acme-trelica-app",
      "noted mon-signin-acme-trelica-app",
    ]);
    expect(screen).toEqual([`page ${TRELICA}`, "note mon-signin-acme-trelica-app"]);
  });

  it("posts the card saying only which sign-in when the page would not open, never claiming a window", async () => {
    remember({ states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })] });
    expect(await firedPass({ openIds: [], pageFails: true })).toEqual([
      "posted mon-signin-acme-trelica-app",
      "refused mon-signin-acme-trelica-app",
      "noted mon-signin-acme-trelica-app",
    ]);
    const { rows } = unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) }));
    const posted = rows.flatMap((row) => (row.kind === "posted" ? [row.step] : []))[0]!;
    // The page is cited, so the card still links the host its sentence names.
    expect([posted.what, posted.opened, posted.cites]).toEqual([
      "Sign in to acme.trelica.app in your work Chrome — a scheduled resync stopped at its sign-in page",
      undefined,
      [TRELICA],
    ]);
  });

  it("cites no page beside a window it opened on that page", async () => {
    remember({ states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })] });
    await firedPass({ openIds: [] });
    const { rows } = unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) }));
    const posted = rows.flatMap((row) => (row.kind === "posted" ? [row.step] : []))[0]!;
    expect([posted.opened, posted.cites]).toEqual([TRELICA, undefined]);
  });

  it("opens no page again while the owner's card is already open", async () => {
    remember({ states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })] });
    await firedPass({ openIds: [] });
    screen = [];
    await firedPass({ openIds: ["mon-signin-acme-trelica-app"] });
    expect(screen).toEqual([]);
  });

  it("posts no step for a failure that is not a sign-in", async () => {
    remember({ states: [failed({ recipeId: "resync-atlas-vanta" })] });
    expect((await firedPass({ openIds: [] })).filter((line) => line.startsWith("posted "))).toEqual([]);
    expect(postedIds()).toEqual([]);
  });

  it("posts nothing again after the owner's Done, while the row still waits on its next attempt", async () => {
    remember({ states: [failed({ recipeId: "resync-atlas-trelica", signInWall: TRELICA })] });
    await firedPass({ openIds: [] });
    const settled = unwrap(
      buildSettledRow({
        draft: {
          bySession: "owner",
          did: "signed in to Trelica",
          id: "mon-signin-acme-trelica-app",
          settledIso: "2026-09-30T11:45:00.000Z",
        },
      }),
    );
    unwrap(await appendHandRow({ home, nowIso: "2026-09-30T11:45:00.000Z", row: settled }));
    expect((await firedPass({ openIds: [] })).filter((line) => line.startsWith("posted "))).toEqual([]);
    expect(postedIds()).toEqual(["mon-signin-acme-trelica-app"]);
  });
});
