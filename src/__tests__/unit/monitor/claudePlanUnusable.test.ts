import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClaudePlanFault } from "../../../claude/planProbeRecord.js";
import { postingRefusal } from "../../../hand/posting.js";
import { postingOrRowRefusal } from "../../../hand/postingChecks.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../../../hand/step.js";
import { appendHandRow, readOpenHandSteps } from "../../../hand/store.js";
import { ok, unwrap } from "../../../lib/result.js";
import { buildArrival } from "../../../monitor/card.js";
import {
  claudeFaultKey,
  claudeRegisterFaultKey,
  evaluateClaudePlanUnusable,
} from "../../../monitor/claudePlanUnusable.js";
import { CLAUDE_PLAN_UNUSABLE } from "../../../monitor/claudePlanUnusableDefinition.js";
import { readClaudePlanUnusable } from "../../../monitor/claudePlanUnusableSource.js";
import { foldOpenCards } from "../../../monitor/openCards.js";
import { runMonitorPass } from "../../../monitor/pass.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import type { MonitorReading, MonitorSubject } from "../../../monitor/types.js";
import { PlanRegisterErrors } from "../../../plans/errors.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  memoryClaudePlanProbesPort,
  memoryPlanHealthPorts,
  unavailableClaudePlanProbesPort,
} from "../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "../../orgHealthStoreFixture.js";
import { memoryPagesPublished } from "../../pagesPublishedFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../processesFake.js";

import { EMAIL, KEY, LAST, NONE, plan, record, SHUT, SIGNED_OUT, SINCE, STORE } from "./claudePlanFixture.js";
import { firing, unmeasurable } from "./readings.js";

describe("evaluateClaudePlanUnusable", () => {
  it("is clear when every plan's last probe read its usage", () => {
    const well = record({ fault: undefined, latest: "ok" });
    expect(
      evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [plan({ record: well })] }).state,
    ).toBe("clear");
  });

  it("fires on a signed-out plan-two state with the owner's sign-in command on the pasteboard", () => {
    const [subject] = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [plan()] }),
    }).subjects;
    expect([subject!.id, subject!.key, subject!.email, subject!.literal, subject!.claudeFault]).toEqual([
      "plan-two",
      KEY,
      EMAIL,
      `CLAUDE_SECURESTORAGE_CONFIG_DIR=${STORE} claude auth login --email ${EMAIL}`,
      "STORE_NOT_READY",
    ]);
    expect(subject!.delivery).toBeUndefined();
  });

  it("binds a row with no cached address to its store, pre-filling nothing", () => {
    const [subject] = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [plan({ email: undefined })] }),
    }).subjects;
    expect([subject!.email, subject!.claudeStoreDir, subject!.literal]).toEqual([
      undefined,
      STORE,
      `CLAUDE_SECURESTORAGE_CONFIG_DIR=${STORE} claude auth login`,
    ]);
  });

  it("keys the card by the fault EPISODE: a repeat of the same fault keeps it, a new episode is a new key", () => {
    const later = { ...SIGNED_OUT, lastSeenIso: "2026-11-03T06:18:01.000Z" };
    const again = { ...SIGNED_OUT, lastSeenIso: "2026-11-04T01:00:00.000Z", sinceIso: "2026-11-04T01:00:00.000Z" };
    expect([
      claudeFaultKey({ alias: "plan-two", fault: later, storeDir: STORE }),
      claudeFaultKey({ alias: "plan-two", fault: again, storeDir: STORE }) === KEY,
    ]).toEqual([KEY, false]);
    expect(KEY).toMatch(/^plan-two-[0-9a-f]{16}$/);
  });

  it("tells apart the two plans whose 32-bit keys collided, sharing a stem", () => {
    const fault = { code: "STORE_NOT_READY", sinceIso: "2026-11-04T00:00:00.000Z" } as const;
    const a = claudeFaultKey({ alias: "abcdefghijklmnopqrst-53240", fault, storeDir: "/s/53240" });
    const b = claudeFaultKey({ alias: "abcdefghijklmnopqrst-96963", fault, storeDir: "/s/96963" });
    expect([a.slice(0, 29), b.slice(0, 29), a === b, `mon-claude-${a}.99`.length]).toEqual([
      "abcdefghijklmnopqrst-52ec75fd",
      "abcdefghijklmnopqrst-52ec75fd",
      false,
      51,
    ]);
  });

  it("HOLDS the card the owner pressed Done on until a probe re-tests the plan after it", () => {
    const closed = new Map([[KEY, "2026-10-31T08:00:00.000Z"]]);
    const [subject] = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: closed, openKeys: SHUT, plans: [plan()] }),
    }).subjects;
    expect(subject!.delivery).toEqual({
      kind: "hold",
      why: `the owner's Done at 2026-10-31T08:00:00.000Z is after the last probe that saw the fault (${LAST}) — the next probe re-tests it`,
    });
  });

  it("posts again when a probe AFTER the owner's Done confirms the same fault — the sign-in did not take", () => {
    const closed = new Map([[KEY, "2026-10-31T07:00:00.000Z"]]);
    const [subject] = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: closed, openKeys: SHUT, plans: [plan()] }),
    }).subjects;
    expect(subject!.delivery).toBeUndefined();
  });

  it("carries the fault through an unmeasured probe, and names the blind spot", () => {
    const blip = record({ latest: "unmeasured", unmeasuredBecause: "the probe could not reach Anthropic" });
    const reading = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [plan({ record: blip })] }),
    });
    expect([reading.subjects.length, reading.blindSpot]).toEqual([
      1,
      `plan-two: its last probe at ${LAST} reached no verdict (the probe could not reach Anthropic)`,
    ]);
  });

  it("is unmeasurable, never clear, for a plan with no probe recorded for its current store", () => {
    const moved = record({ storeDir: "/Users/owner/.claude-accounts/old" });
    const plans = [plan({ alias: "plan-one", record: undefined }), plan({ record: moved })];
    expect(
      unmeasurable({ reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans }) }).because,
    ).toBe("plan-one: no probe is recorded for its store yet; plan-two: no probe is recorded for its store yet");
  });

  it("drops the blind spot when a recovered plan's card is still open, so one unprobed plan never pins it up", () => {
    const plans = [
      plan({ alias: "plan-one", record: undefined }),
      plan({ record: record({ fault: undefined, latest: "ok" }) }),
    ];
    const reading = evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: new Set([KEY]), plans });
    expect(reading).toEqual({ monitorId: "claude-plan-unusable", state: "clear" });
  });

  it("drops a firing reading's blind spot too when another plan's card is stale, and keeps it when none is", () => {
    const token: ClaudePlanFault = { ...SIGNED_OUT, code: "SETUP_TOKEN_REJECTED", message: "token rejected" };
    const three = plan({ alias: "plan-three", record: record({ alias: "plan-three", fault: token }) });
    const plans = [
      plan({ alias: "plan-one", record: undefined }),
      plan({ record: record({ fault: undefined, latest: "ok" }) }),
      three,
    ];
    const threeKey = claudeFaultKey({ alias: "plan-three", fault: token, storeDir: STORE });
    const stale = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: new Set([KEY, threeKey]), plans }),
    });
    const current = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: new Set([threeKey]), plans }),
    });
    expect([stale.blindSpot, current.blindSpot]).toEqual([
      undefined,
      "plan-one: no probe is recorded for its store yet",
    ]);
  });

  it("posts one subject per faulted plan, and no sign-in command for a fault a sign-in does not fix", () => {
    const token: ClaudePlanFault = { ...SIGNED_OUT, code: "SETUP_TOKEN_REJECTED", message: "token rejected" };
    const plans = [plan(), plan({ alias: "plan-three", record: record({ alias: "plan-three", fault: token }) })];
    const { subjects } = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans }),
    });
    expect(subjects.map((subject) => [subject.id, subject.literal])).toEqual([
      ["plan-two", `CLAUDE_SECURESTORAGE_CONFIG_DIR=${STORE} claude auth login --email ${EMAIL}`],
      ["plan-three", undefined],
    ]);
  });
});

describe("foldOpenCards over claude-plan-unusable", () => {
  it("settles the recovered plan's card and leaves the still-faulted plan's card standing", () => {
    const definition = monitorDefinition({ monitorId: "claude-plan-unusable" });
    const reading = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [plan()] }),
    });
    const recovered = `mon-claude-${claudeFaultKey({ alias: "plan-one", fault: SIGNED_OUT, storeDir: "/s/plan-one" })}`;
    const faulted = `mon-claude-${KEY}`;
    const fold = foldOpenCards({ definition, openIds: [recovered, faulted], openWithDecision: new Set(), reading });
    expect([[...fold.returned], fold.folded.arrived.length, [...fold.folded.departed]]).toEqual([[], 0, [recovered]]);
  });
});

describe("readClaudePlanUnusable", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "claude-plan-unusable-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Seed the register with plan-two. */
  function seed(): void {
    const rows = [{ alias: "plan-two", email: EMAIL, pinned: true, provider: "claude", storeDir: STORE }];
    writeFileSync(stateHomePaths({ home }).plansJson, JSON.stringify({ rows, version: 1 }), "utf8");
  }

  it("fires on a recorded fault for an unpaused registered plan", async () => {
    seed();
    const probesPort = memoryClaudePlanProbesPort();
    await probesPort.record({
      home,
      observed: [
        {
          alias: "plan-two",
          observation: { code: "STORE_NOT_READY", kind: "fault", message: "no sign-in" },
          observedAtIso: SINCE,
          storeDir: STORE,
        },
      ],
    });
    const reading = await readClaudePlanUnusable({
      home,
      port: memoryPlanRegisterPort(),
      probesPort,
    });
    expect(firing({ reading }).subjects.map((subject) => subject.id)).toEqual(["plan-two"]);
  });

  it("is unmeasurable, never clear, when the probes cannot be read", async () => {
    seed();
    const reading = await readClaudePlanUnusable({
      home,
      port: memoryPlanRegisterPort(),
      probesPort: unavailableClaudePlanProbesPort(),
    });
    expect(unmeasurable({ reading }).because).toContain("the Claude plan probes could not be read");
  });

  it("reads this monitor's open card off the hand register, so a card no probe backs settles, never pins", async () => {
    seed();
    const subject = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [plan()] }),
    }).subjects[0]!;
    const step = unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition: monitorDefinition({ monitorId: "claude-plan-unusable" }),
        nowIso: LAST,
        postedBy: "supervisor",
        subject,
      }),
    );
    unwrap(await appendHandRow({ home, nowIso: LAST, row: { kind: "posted", step } }));
    const read = async (): Promise<MonitorReading> =>
      readClaudePlanUnusable({
        home,
        port: memoryPlanRegisterPort(),
        probesPort: memoryClaudePlanProbesPort(),
      });
    expect([step.id, await read()]).toEqual([
      `mon-claude-${KEY}`,
      { monitorId: "claude-plan-unusable", state: "clear" },
    ]);
  });

  it("fires ONE register card, keeping every plan's card standing, when the plan register cannot be read", async () => {
    const reading = await readClaudePlanUnusable({
      home,
      port: unavailablePlanRegisterPort(),
      probesPort: memoryClaudePlanProbesPort(),
    });
    const fired = firing({ reading });
    const outage = PlanRegisterErrors.registerStoreUnavailable({ doing: "be opened", reason: "another pass's port" });
    expect([
      fired.preservesDepartures,
      fired.subjects.map((subject) => [subject.key, subject.claudeRegisterFault]),
    ]).toEqual([true, [[claudeRegisterFaultKey({ error: outage }), "REGISTER_STORE_UNAVAILABLE"]]]);
  });

  it("posts the register card through a real pass and settles no plan's open card on it", async () => {
    const subject = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [plan()] }),
    }).subjects[0]!;
    const definition = monitorDefinition({ monitorId: "claude-plan-unusable" });
    const address = { consoleBase: "http://localhost:3000", occurrence: 1 };
    const step = unwrap(buildArrival({ address, definition, nowIso: LAST, postedBy: "supervisor", subject }));
    unwrap(await appendHandRow({ home, nowIso: LAST, row: { kind: "posted", step } }));
    const before = unwrap(readOpenHandSteps({ home }));
    const outcome = await runMonitorPass({
      consoleBase: "http://localhost:3000",
      fire: true,
      inputs: {
        claudeProjectsDir: join(home, "claude-projects"),
        fleetCapPort: memoryCodexFleetCapPort(),
        orgHealthPort: memoryOrgHealthPort(),
        pagePublished: memoryPagesPublished(),
        registerPort: unavailablePlanRegisterPort(),
        ...memoryPlanHealthPorts(),
        processes: NO_FSEVENTSD,
        home,
        landingPath: undefined,
        nowIso: LAST,
        nowMs: Date.parse(LAST),
      },
      nowIso: LAST,
      openIds: before.steps.map((open) => open.id),
      openWithDecision: new Set(),
      openPage: async () => ok("no page in this case"),
      postedBy: "supervisor",
      postedIds: before.postedIds,
      raiseNote: () => ok("not drawn in this case"),
    });
    const mine = outcome.actions.filter((action) => action.monitorId === "claude-plan-unusable");
    const open = unwrap(readOpenHandSteps({ home })).steps.filter((card) => card.id.startsWith("mon-claude-"));
    const outage = PlanRegisterErrors.registerStoreUnavailable({ doing: "be opened", reason: "any" });
    const registerCard = `mon-claude-${claudeRegisterFaultKey({ error: outage })}`;
    expect(mine.map((action) => [action.kind, action.stepId])).toEqual([
      ["posted", registerCard],
      ["noted", registerCard],
      ["refused", "claude-plan-unusable"],
    ]);
    expect(open.map((card) => card.id).toSorted()).toEqual([step.id, registerCard].toSorted());
  });
});

describe("the claude-plan-unusable card", () => {
  const definition = monitorDefinition({ monitorId: "claude-plan-unusable" });
  const subject = firing({
    reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [plan()] }),
  }).subjects[0]!;
  const card = (over: Partial<MonitorSubject> = {}) =>
    unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition,
        nowIso: "2026-11-04T01:00:00.000Z",
        postedBy: "supervisor",
        subject: { ...subject, ...over },
      }),
    );

  it("is the declaration its own module carries, listed in the registry, floating one card per plan", () => {
    expect([definition, definition.floats, definition.perSubject, definition.context]).toEqual([
      CLAUDE_PLAN_UNUSABLE,
      true,
      true,
      "work",
    ]);
  });

  it("names the plan by the address the owner signs in with, and their one step", () => {
    expect(card().what).toBe(`Sign in as ${EMAIL} on Claude (plan-two) — paste the copied command into your terminal`);
    expect(postingRefusal({ step: card() })).toBeUndefined();
  });

  it("passes the register's lock-held posting check that refuses a sign-in naming no address", () => {
    const plans = [{ alias: "plan-two", email: EMAIL }];
    expect(postingOrRowRefusal({ plans, replacing: undefined, rows: [], step: card(), unparsed: [] }).isOk()).toBe(
      true,
    );
  });

  it("names a row with no cached address by its store, never the alias alone, and still posts", () => {
    const bare = card({ email: undefined });
    const plans = [{ alias: "plan-two", email: undefined }];
    expect([
      bare.what,
      postingRefusal({ step: bare }),
      postingOrRowRefusal({ plans, replacing: undefined, rows: [], step: bare, unparsed: [] }).isOk(),
    ]).toEqual([`Sign in to the Claude store ${STORE} — paste the copied command into your terminal`, undefined, true]);
  });

  it("still builds the card when the probe's message runs long and spans lines", () => {
    const message = `${"x".repeat(321)}\n${"y ".repeat(200)}`;
    const long = record({ fault: { ...SIGNED_OUT, message } });
    const [noisy] = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [plan({ record: long })] }),
    }).subjects;
    const built = buildArrival({
      address: { consoleBase: "http://localhost:3000", occurrence: 1 },
      definition,
      nowIso: "2026-11-04T01:00:00.000Z",
      postedBy: "supervisor",
      subject: noisy!,
    });
    expect(built.isOk()).toBe(true);
    expect(noisy!.details).toEqual([`STORE_NOT_READY since ${SINCE}, last confirmed ${LAST}:`]);
  });

  it("still builds the card, naming the verb that walks the sign-in, when the register's store outgrows a copy", () => {
    // Codex's own counterexample: four 190-apostrophe components, which shell-quoting expands past the literal cap.
    const longStore = `/${Array.from({ length: 4 }, () => "'".repeat(190)).join("/")}`;
    const [longSubject] = firing({
      reading: evaluateClaudePlanUnusable({
        closedByOwner: NONE,
        openKeys: SHUT,
        plans: [plan({ record: record({ storeDir: longStore }), storeDir: longStore })],
      }),
    }).subjects;
    const arrival = buildArrival({
      address: { consoleBase: "http://localhost:3000", occurrence: 1 },
      definition,
      nowIso: "2026-11-04T01:00:00.000Z",
      postedBy: "supervisor",
      subject: longSubject!,
    });
    expect(arrival.isOk()).toBe(true);
    expect([longSubject!.literal, longSubject!.details!.at(-1)]).toEqual([
      undefined,
      expect.stringMatching(
        /^the sign-in command is \d+ characters, past what a card can copy — run `slopweaver claude signin --plan plan-two`$/,
      ),
    ]);
  });

  it("still posts a card for a register address far past the headline's room, its purpose kept", () => {
    const longEmail = `${"a".repeat(2_000)}@example.com`;
    const [longSubject] = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [plan({ email: longEmail })] }),
    }).subjects;
    const built = buildArrival({
      address: { consoleBase: "http://localhost:3000", occurrence: 1 },
      definition,
      nowIso: "2026-11-04T01:00:00.000Z",
      postedBy: "supervisor",
      subject: longSubject!,
    });
    const step = unwrap(built);
    const plans = [{ alias: "plan-two", email: longEmail }];
    expect([
      step.what.endsWith(" — paste the copied command into your terminal"),
      postingRefusal({ step }),
      postingOrRowRefusal({ plans, replacing: undefined, rows: [], step, unparsed: [] }).isOk(),
    ]).toEqual([true, undefined, true]);
  });

  it("says what failed, since when, and what doing nothing costs", () => {
    expect(card().unblocks).toBe(
      `plan-two: it is signed out — its store holds no sign-in, since ${SINCE}. Routing skips the plan, so its paid usage goes unspent until a probe finds it working`,
    );
  });

  it("asks for the repair on the card on a fault a sign-in does not fix, dictating no words, in a card that posts", () => {
    const remint = card({ claudeFault: "SETUP_TOKEN_REJECTED" });
    const reader = card({ claudeFault: "USAGE_SHAPE_CHANGED" });
    expect([remint.what, reader.what, postingRefusal({ step: remint }), postingRefusal({ step: reader })]).toEqual([
      `Ask on this card for a new setup token for ${EMAIL} on Claude, so the plan works again`,
      `Ask on this card for a usage reader fix for ${EMAIL} on Claude, so the plan works again`,
      undefined,
      undefined,
    ]);
  });

  it("fits the longest alias and a long address inside both caps", () => {
    const long = { ...subject, email: `${"a".repeat(40)}@slopweaver.ai`, id: "a".repeat(32), label: "x ".repeat(200) };
    expect([
      definition.what({ subject: long }).length <= WHAT_CAP,
      definition.unblocks({ subject: long }).length <= UNBLOCKS_CAP,
    ]).toEqual([true, true]);
  });

  it("opens its own queue item under the claude prefix", () => {
    expect(card().id).toBe(`mon-claude-${KEY}`);
  });
});
