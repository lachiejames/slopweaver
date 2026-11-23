import { describe, expect, it } from "vitest";

import { checkInRules } from "../../../autonomy/checkIns.js";
import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { foldAutonomy } from "../../../autonomy/query.js";
import type { AutonomyActionRow, AutonomyRecord } from "../../../autonomy/types.js";
import { recordRuling } from "../../../cli/commands/talk/relayRuling.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { applyCheckInRuling, checkInRulingRows } from "../../../talk/checkInRuling.js";
import { STILL_SPEAKING_HOLD } from "../../../talk/relayCutHold.js";
import {
  AUTONOMY_FIXTURE_OUTAGE,
  heldAutonomyRecords,
  memoryAutonomyLedgerPort,
  seedAutonomyRecords,
  unavailableAutonomyLedgerPort,
} from "../../autonomyLedgerFixture.js";

const TURN = "0e7c3a52-1d7e-4c55-9a43-2f1f6f0d8b11";
const NOW = "2026-10-02T01:00:00.000Z";
const HEARD = "yeah that pushback reason was valid there";

/** One CodeRabbit pushback act on one pull request of one repository. */
function pushback({ actionId, repo, pr, doneIso }: { actionId: string; repo: string; pr: number; doneIso: string }) {
  const row: AutonomyActionRow = {
    actionId,
    bySession: "workspace:1",
    doneIso,
    kind: "push-back-on-coderabbit",
    subject: `https://github.com/acme/${repo}/pull/${String(pr)}`,
    why: "the comment asked for a guard the caller already holds",
    witness: "slopweaver github comment reply -> posted",
  };
  return row;
}

/** Three acme-admin pushback cards and one slopweaver one. */
const RECORDS: readonly AutonomyRecord[] = [
  pushback({ actionId: "ev-1", doneIso: "2026-10-01T09:00:00Z", pr: 1, repo: "acme-admin" }),
  pushback({ actionId: "ev-2", doneIso: "2026-10-01T10:00:00Z", pr: 2, repo: "acme-admin" }),
  pushback({ actionId: "ev-3", doneIso: "2026-10-01T11:00:00Z", pr: 3, repo: "acme-admin" }),
  pushback({ actionId: "sw-1", doneIso: "2026-10-01T12:00:00Z", pr: 9, repo: "slopweaver" }),
];

/** The home the ports are asked about; the in-memory port ignores it. */
const HOME = "/fixture-home";

/** An in-memory autonomy ledger holding the records. */
async function seededLedger({ records }: { records: readonly AutonomyRecord[] }): Promise<AutonomyLedgerPort> {
  const ledger = memoryAutonomyLedgerPort();
  await seedAutonomyRecords({ port: ledger, records });
  return ledger;
}

/** How many cards are still waiting on the owner in that ledger. */
async function waitingCards({ ledger }: { ledger: AutonomyLedgerPort }): Promise<number> {
  const actions = unwrap(foldAutonomy({ records: await heldAutonomyRecords({ port: ledger }) }));
  return checkInRules({ actions }).reduce((sum, rule) => sum + rule.cards, 0);
}

describe("applyCheckInRuling", () => {
  it("clears every card sharing the read card's rule with one reaction, and the waiting count falls by that many", async () => {
    const ledger = await seededLedger({ records: RECORDS });
    expect(await waitingCards({ ledger })).toBe(4);
    const ruling = unwrap(
      await applyCheckInRuling({
        about: "act:ev-2",
        covers: "rule",
        heard: HEARD,
        home: HOME,
        ledger,
        nowIso: NOW,
        turnId: TURN,
      }),
    );
    expect(ruling.settled).toEqual(["ev-2", "ev-3", "ev-1"]);
    expect(ruling.written).toBe(3);
    expect([ruling.kind, ruling.place]).toEqual(["push-back-on-coderabbit", "acme/acme-admin"]);
    expect(await waitingCards({ ledger })).toBe(1);
    const words = (await heldAutonomyRecords({ port: ledger })).filter((record) => !("kind" in record));
    expect(words.map((record) => [record.actionId, record.bySession, "steer" in record && record.steer])).toEqual([
      ["ev-2", `talk:${TURN}`, HEARD],
      ["ev-3", `talk:${TURN}`, HEARD],
      ["ev-1", `talk:${TURN}`, HEARD],
    ]);
  });

  it("clears only the read card for 'this'", async () => {
    const ledger = await seededLedger({ records: RECORDS });
    const ruling = unwrap(
      await applyCheckInRuling({
        about: "act:ev-2",
        covers: "this",
        heard: HEARD,
        home: HOME,
        ledger,
        nowIso: NOW,
        turnId: TURN,
      }),
    );
    expect(ruling.settled).toEqual(["ev-2"]);
    expect(await waitingCards({ ledger })).toBe(3);
  });

  it("writes nothing twice when the same turn is replayed", async () => {
    const ledger = await seededLedger({ records: RECORDS });
    const rule = {
      about: "act:ev-2",
      covers: "rule",
      heard: HEARD,
      home: HOME,
      ledger,
      nowIso: NOW,
      turnId: TURN,
    } as const;
    unwrap(await applyCheckInRuling(rule));
    const replay = unwrap(await applyCheckInRuling(rule));
    expect(replay.written).toBe(0);
    expect(replay.settled).toEqual(["ev-2", "ev-3", "ev-1"]);
    expect((await heldAutonomyRecords({ port: ledger })).length).toBe(RECORDS.length + 3);
  });

  it("refuses a second turn's reaction to a card the first already settled", async () => {
    const ledger = await seededLedger({ records: RECORDS });
    unwrap(
      await applyCheckInRuling({
        about: "act:ev-2",
        covers: "this",
        heard: HEARD,
        home: HOME,
        ledger,
        nowIso: NOW,
        turnId: TURN,
      }),
    );
    const other = "5f0a1d8e-6b2c-4e3f-8a9b-0c1d2e3f4a5b";
    const refused = unwrapErr(
      await applyCheckInRuling({
        about: "act:ev-2",
        covers: "rule",
        heard: HEARD,
        home: HOME,
        ledger,
        nowIso: NOW,
        turnId: other,
      }),
    );
    expect(refused.code).toBe("CHECK_IN_SETTLED");
  });

  it("refuses the whole ruling when the ledger's store is down, writing nothing", async () => {
    const refused = unwrapErr(
      await applyCheckInRuling({
        about: "act:ev-2",
        covers: "rule",
        heard: HEARD,
        home: HOME,
        ledger: unavailableAutonomyLedgerPort(),
        nowIso: NOW,
        turnId: TURN,
      }),
    );
    expect(refused).toEqual(AUTONOMY_FIXTURE_OUTAGE);
  });
});

describe("checkInRulingRows", () => {
  it("finishes a run that died part way through, writing only the cards it had not reached", () => {
    const partial: readonly AutonomyRecord[] = [
      ...RECORDS,
      { actionId: "ev-2", bySession: `talk:${TURN}`, steer: HEARD, steeredIso: NOW },
    ];
    const planned = unwrap(
      checkInRulingRows({
        actionId: "ev-2",
        covers: "rule",
        heard: HEARD,
        nowIso: NOW,
        records: partial,
        turnId: TURN,
      }),
    );
    expect(planned.rows.map((row) => row.actionId)).toEqual(["ev-3", "ev-1"]);
  });

  it("refuses an act the register does not carry", () => {
    const refused = unwrapErr(
      checkInRulingRows({
        actionId: "gone",
        covers: "rule",
        heard: HEARD,
        nowIso: NOW,
        records: RECORDS,
        turnId: TURN,
      }),
    );
    expect(refused.code).toBe("CHECK_IN_UNKNOWN");
  });
});

describe("talk relay's recordRuling", () => {
  const draft = { about: "act:ev-2", heard: HEARD, turnId: TURN };

  it("records nothing, and says nothing, for a relay with no --covers", async () => {
    const ledger = await seededLedger({ records: RECORDS });
    const outcome = await recordRuling({
      args: { covers: undefined },
      draft,
      hold: undefined,
      home: HOME,
      ledger,
      nowIso: NOW,
    });
    expect(outcome).toBeUndefined();
    expect(await waitingCards({ ledger })).toBe(4);
  });

  it("reports the cards a --covers rule relay settled", async () => {
    const ledger = await seededLedger({ records: RECORDS });
    const outcome = (await recordRuling({
      args: { covers: "rule" },
      draft,
      hold: undefined,
      home: HOME,
      ledger,
      nowIso: NOW,
    }))!;
    expect(outcome.kind).toBe("recorded");
    expect(await waitingCards({ ledger })).toBe(1);
  });

  // A relay made while the owner was still speaking settled every card its rule covered.
  it("refuses a held relay's ruling naming why, and settles no card", async () => {
    const ledger = await seededLedger({ records: RECORDS });
    const outcome = await recordRuling({
      args: { covers: "rule" },
      draft,
      hold: STILL_SPEAKING_HOLD,
      home: HOME,
      ledger,
      nowIso: NOW,
    });
    expect(outcome).toEqual({ kind: "refused", why: STILL_SPEAKING_HOLD });
    expect(await waitingCards({ ledger })).toBe(4);
  });

  it("turns a ruling that cannot be recorded into a refusal naming why, never a failure", async () => {
    const ledger = await seededLedger({ records: RECORDS });
    const outcome = await recordRuling({
      args: { covers: "rule" },
      draft: { ...draft, about: "act:ev-9" },
      hold: undefined,
      home: HOME,
      ledger,
      nowIso: NOW,
    });
    expect(outcome).toEqual({ kind: "refused", why: "no act in the register carries the id ev-9" });
  });
});
