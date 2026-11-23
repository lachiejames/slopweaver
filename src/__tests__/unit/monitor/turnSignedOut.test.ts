/**
 * `turn-signed-out`: a bot turn blocked on a browser sign-in raises ONE floating work card per origin, saying "log
 * into <host> now" with the page opened in the owner's work Chrome — through the evaluator, the
 * source read over a real ask log, and the REAL pass.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSettledRow } from "../../../hand/row.js";
import { appendHandRow, handRegisterPath, readHandRows, readOpenHandSteps } from "../../../hand/store.js";
import { ok, unwrap } from "../../../lib/result.js";
import type { BlockedOnHumanEvent, CapturedEvent, UnblockedEvent } from "../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, askLifecyclePath } from "../../../live/ask/store.js";
import type { BlockedAsk } from "../../../live/turn/blockedOnHuman.js";
import { buildArrival } from "../../../monitor/card.js";
import { runMonitorPass } from "../../../monitor/pass.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import { signInSubjectKey } from "../../../monitor/resyncSignedOut.js";
import { blockBearingUnreadable, evaluateTurnSignedOut } from "../../../monitor/turnSignedOut.js";
import { TURN_SIGNED_OUT } from "../../../monitor/turnSignedOutDefinition.js";
import { readTurnSignedOut } from "../../../monitor/turnSignedOutSource.js";
import type { MonitorReading } from "../../../monitor/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryPlanHealthPorts } from "../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "../../orgHealthStoreFixture.js";
import { memoryPagesPublished } from "../../pagesPublishedFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../processesFake.js";

const ADMIN = "https://admin.google.com";
const LOOK_NOW = "2026-09-29T05:00:00.000Z";
const BLOCKED_AT = "2026-09-29T04:19:00.000Z";
const PIN = "/Users/owner/.slopweaver/chrome-pin.sh";
const STEP = `mon-login-${signInSubjectKey({ origin: ADMIN })}`;

/** One ask standing against the owner. */
function ask({
  need = "sign-in",
  page = ADMIN,
  standing = "waiting",
  threadTs = "1785000000.000100",
  tsIso = BLOCKED_AT,
}: {
  need?: BlockedOnHumanEvent["need"];
  /** The origin the block recorded, or `null` for a block naming no page. */
  page?: string | null;
  standing?: BlockedAsk["standing"];
  threadTs?: string;
  tsIso?: string;
} = {}): BlockedAsk {
  const identity = { channel: "C1", messageTs: threadTs, threadTs };
  return {
    ...identity,
    blocked: {
      ...identity,
      kind: "blocked-on-human",
      need,
      stepText: "Waiting on the owner: log into the Google Admin console",
      tsIso,
      what: "log into the Google Admin console",
      ...(page === null ? {} : { signInOrigin: page }),
    },
    standing,
  };
}

/** Evaluate with no card history, no looks and the pin written. */
function evaluate({ asks }: { asks: readonly BlockedAsk[] }): MonitorReading {
  return evaluateTurnSignedOut({
    asks,
    blindSpot: undefined,
    cards: new Map(),
    nowIso: LOOK_NOW,
    pinPath: PIN,
    probes: [],
  });
}

describe("evaluateTurnSignedOut", () => {
  it("raises one subject per origin, naming every thread waiting on it, with the page to open", () => {
    const reading = evaluate({
      asks: [ask(), ask({ threadTs: "1785000000.000200", tsIso: "2026-09-29T04:30:00.000Z" })],
    });

    expect(reading).toEqual({
      monitorId: "turn-signed-out",
      state: "firing",
      subjects: [
        {
          details: [
            `blocked since ${BLOCKED_AT}: C1/1785000000.000100`,
            "blocked since 2026-09-29T04:30:00.000Z: C1/1785000000.000200",
          ],
          id: "admin.google.com",
          key: "admin-google-com",
          label: "2 bot turns are blocked on admin.google.com's sign-in page",
          opens: ADMIN,
          page: ADMIN,
        },
      ],
    });
  });

  it("is clear on a block with no page — a CLI login — on another need, and on a block already lifted", () => {
    expect(
      evaluate({
        asks: [ask({ page: null }), ask({ need: "risky-approval", page: null }), ask({ standing: "ready-to-resume" })],
      }),
    ).toEqual({ monitorId: "turn-signed-out", state: "clear" });
  });

  it("opens no window with no pin written, so the page cannot land in the owner's personal profile", () => {
    const reading = evaluateTurnSignedOut({
      asks: [ask()],
      blindSpot: undefined,
      cards: new Map(),
      nowIso: LOOK_NOW,
      pinPath: undefined,
      probes: [],
    });

    expect(reading.state).toBe("firing");
    const subject = (reading as Extract<MonitorReading, { state: "firing" }>).subjects[0]!;
    expect([subject.opens, subject.page]).toEqual([undefined, ADMIN]);
  });

  it("holds a card the owner pressed Done on after the newest block, and posts again for a block entered after it", () => {
    const cards = new Map([["admin-google-com", { lastSettledIso: "2026-09-29T04:40:00.000Z", open: false }]]);
    const held = evaluateTurnSignedOut({
      asks: [ask()],
      blindSpot: undefined,
      cards,
      nowIso: LOOK_NOW,
      pinPath: PIN,
      probes: [],
    });
    const fresh = evaluateTurnSignedOut({
      asks: [ask({ tsIso: "2026-09-29T04:50:00.000Z" })],
      blindSpot: undefined,
      cards,
      nowIso: LOOK_NOW,
      pinPath: PIN,
      probes: [],
    });

    expect((held as Extract<MonitorReading, { state: "firing" }>).subjects[0]!.delivery).toEqual({
      kind: "hold",
      why: "your card for admin.google.com was settled after the newest turn blocked on it — the session holding the turn unblocks it",
    });
    expect((fresh as Extract<MonitorReading, { state: "firing" }>).subjects[0]!.delivery).toBe(undefined);
  });

  it("holds a GitHub sign-in as the fleet's until a fresh look found it the owner's, then cards it", () => {
    const github = "https://github.com";
    const held = evaluateTurnSignedOut({
      asks: [ask({ page: github })],
      blindSpot: undefined,
      cards: new Map(),
      nowIso: LOOK_NOW,
      pinPath: PIN,
      probes: [],
    });
    const ownersOwn = evaluateTurnSignedOut({
      asks: [ask({ page: github })],
      blindSpot: undefined,
      cards: new Map(),
      nowIso: LOOK_NOW,
      pinPath: PIN,
      probes: [
        {
          atIso: LOOK_NOW,
          page: "https://github.com/login",
          provider: "github",
          verdict: "owner-hands",
          why: "GitHub wants the owner's own sign-in at /login",
        },
      ],
    });

    expect((held as Extract<MonitorReading, { state: "firing" }>).subjects[0]!.delivery?.kind).toBe("hold");
    expect((ownersOwn as Extract<MonitorReading, { state: "firing" }>).subjects[0]!.delivery).toBe(undefined);
  });

  it("counts an unreadable line only when it could have been a block or its lift", () => {
    const text = [
      '{"kind":"dispatched","decision":{"tier":"inline"}}',
      "{not json",
      '{"kind":"blocked-on-human","need":"sign-in"}',
      '{"kind":"unblocked"}',
      '{"no":"kind"}',
    ].join("\n");

    expect(blockBearingUnreadable({ text, unreadable: [1, 2, 3, 4, 5] })).toEqual([2, 3, 4, 5]);
    expect(blockBearingUnreadable({ text, unreadable: [] })).toEqual([]);
  });

  it("reads unmeasurable, never clear, when part of the log would not read and nothing else was seen", () => {
    expect(
      evaluateTurnSignedOut({
        asks: [],
        blindSpot: "2 lines",
        cards: new Map(),
        nowIso: LOOK_NOW,
        pinPath: PIN,
        probes: [],
      }),
    ).toEqual({ because: "2 lines", monitorId: "turn-signed-out", state: "unmeasurable" });
  });

  it("words the card as the owner's step the register accepts — log into the host, now, in the window just opened", () => {
    const reading = evaluate({ asks: [ask()] });
    const arrival = unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition: monitorDefinition({ monitorId: "turn-signed-out" }),
        nowIso: LOOK_NOW,
        postedBy: "workspace:29",
        subject: (reading as Extract<MonitorReading, { state: "firing" }>).subjects[0]!,
      }),
    );

    expect([arrival.what, arrival.opened, arrival.context]).toEqual([
      "Log into admin.google.com now in the work Chrome window just opened — a Slack answer is waiting on it",
      ADMIN,
      "work",
    ]);
  });
});

describe("TURN_SIGNED_OUT", () => {
  it("is a floating, top-tier, per-origin card — the high-priority shape the ask named", () => {
    expect(TURN_SIGNED_OUT).toMatchObject({
      context: "work",
      floats: true,
      id: "turn-signed-out",
      perSubject: true,
      prefix: "login",
    });
    expect(monitorDefinition({ monitorId: "turn-signed-out" })).toBe(TURN_SIGNED_OUT);
  });
});

describe("readTurnSignedOut, over a real ask log", () => {
  let home: string;
  const screen: string[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "turn-signed-out-"));
    screen.length = 0;
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const identity = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };
  const captured: CapturedEvent = {
    ...identity,
    kind: "captured",
    surface: "channel",
    tsIso: "2026-09-29T04:10:00.000Z",
    userId: "U_ASKER",
  };
  const blocked: BlockedOnHumanEvent = {
    ...identity,
    kind: "blocked-on-human",
    need: "sign-in",
    signInOrigin: ADMIN,
    stepText: "Waiting on the owner: log into the Google Admin console",
    tsIso: BLOCKED_AT,
    what: "log into the Google Admin console",
  };
  const unblocked: UnblockedEvent = {
    ...identity,
    kind: "unblocked",
    lifted: { need: "sign-in", what: blocked.what },
    note: "signed in",
    tsIso: "2026-09-29T04:45:00.000Z",
  };

  /** One FIRED pass of `turn-signed-out` alone, every action as kind and step id. */
  async function firedPass({ openIds }: { openIds: readonly string[] }): Promise<readonly string[]> {
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
        home,
        landingPath: undefined,
        nowIso: LOOK_NOW,
        nowMs: Date.parse(LOOK_NOW),
        only: "turn-signed-out",
        processes: NO_FSEVENTSD,
      },
      nowIso: LOOK_NOW,
      openIds,
      openPage: async ({ url }) => {
        screen.push(`page ${url}`);
        return ok(`opened ${url}`);
      },
      openWithDecision: new Set(),
      postedBy: "workspace:29",
      postedIds: unwrap(readOpenHandSteps({ home })).postedIds,
      raiseNote: ({ step }) => {
        screen.push(`note ${step.id}`);
        return ok("drawn");
      },
    });
    return passed.actions.map((action) => `${action.kind} ${action.stepId}`);
  }

  it("is clear on a home that never captured an ask", () => {
    expect(readTurnSignedOut({ home })).toEqual({ monitorId: "turn-signed-out", state: "clear" });
  });

  it("opens admin.google.com in the owner's work Chrome BEFORE the note saying to log in there, and posts one card", async () => {
    appendAskLifecycleEvent({ event: captured, home });
    appendAskLifecycleEvent({ event: blocked, home });
    writeFileSync(stateHomePaths({ home }).chromePin, "#!/bin/sh\n");

    expect((await firedPass({ openIds: [] })).filter((line) => line.startsWith("posted "))).toEqual([`posted ${STEP}`]);
    expect(screen).toEqual([`page ${ADMIN}`, `note ${STEP}`]);
  });

  it("settles the card once the turn is unblocked", async () => {
    appendAskLifecycleEvent({ event: captured, home });
    appendAskLifecycleEvent({ event: blocked, home });
    await firedPass({ openIds: [] });
    appendAskLifecycleEvent({ event: unblocked, home });

    expect(await firedPass({ openIds: [STEP] })).toEqual([`settled ${STEP}`]);
  });

  it("holds the card the owner pressed Done on while the turn still waits for its session to unblock it", async () => {
    appendAskLifecycleEvent({ event: captured, home });
    appendAskLifecycleEvent({ event: blocked, home });
    await firedPass({ openIds: [] });
    const settled = unwrap(
      buildSettledRow({
        draft: {
          bySession: "owner",
          did: "logged into the Google Admin console",
          id: STEP,
          settledIso: "2026-09-29T04:40:00.000Z",
        },
      }),
    );
    unwrap(await appendHandRow({ home, nowIso: "2026-09-29T04:40:00.000Z", row: settled }));

    expect((await firedPass({ openIds: [] })).filter((line) => line.startsWith("posted "))).toEqual([]);
    const { rows } = unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) }));
    expect(rows.flatMap((row) => (row.kind === "posted" ? [row.step.id] : []))).toEqual([STEP]);
  });

  it("reads a torn log line as a blind spot rather than as nothing blocked", () => {
    const path = askLifecyclePath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json\n");

    expect(readTurnSignedOut({ home })).toEqual({
      because: "1 ask-lifecycle line(s) could not be read (lines 1), so a blocked turn may be missing",
      monitorId: "turn-signed-out",
      state: "unmeasurable",
    });
  });

  it("reads a hand-register line that will not parse as a blind spot, since it may be the owner's Done on the card", () => {
    const path = handRegisterPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json\n");

    const reading = readTurnSignedOut({ home });

    expect(reading.state).toBe("unmeasurable");
    expect(JSON.stringify(reading)).toContain(
      "1 hand-register line(s) did not read, so your Done on a card may be missing",
    );
  });
});
