import { describe, expect, it } from "vitest";
import type { ClaudePlanFault } from "../../../claude/planProbeRecord.js";
import { claudeFaultKey, evaluateClaudePlanUnusable } from "../../../monitor/claudePlanUnusable.js";
import { CLAUDE_PLAN_UNUSABLE } from "../../../monitor/claudePlanUnusableDefinition.js";
import { foldOpenCards } from "../../../monitor/openCards.js";

import { KEY, LAST, NONE, plan, record, SHUT, SIGNED_OUT, SINCE, STORE } from "./claudePlanFixture.js";
import { firing } from "./readings.js";

/** Plan-two with a fault of `code` that one probe has seen, and no later probe yet. */
const seenOnce = ({ code }: { code: ClaudePlanFault["code"] }) =>
  plan({ record: record({ fault: { ...SIGNED_OUT, code, lastSeenIso: SINCE }, observedAtIso: SINCE }) });

describe("evaluateClaudePlanUnusable, confirming a provider-answered fault on a second probe", () => {
  it("floats nothing on ONE probe's headerless usage answer, naming the plan as waiting for the next probe", () => {
    const blip: ClaudePlanFault = {
      code: "USAGE_SHAPE_CHANGED",
      lastSeenIso: SINCE,
      message: "the rate-limit gauge is missing or unparseable at `anthropic-ratelimit-unified-7d-status`",
      sinceIso: SINCE,
    };
    const plans = [plan({ record: record({ fault: blip, observedAtIso: SINCE }) })];
    const reading = evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans });
    expect(reading).toEqual({
      because: `plan-two: USAGE_SHAPE_CHANGED seen by one probe at ${SINCE}, waiting for the next probe to confirm it`,
      monitorId: "claude-plan-unusable",
      state: "unmeasurable",
    });
  });

  it("holds every provider-answered fault for a second probe, and floats the episode once a later probe confirms it", () => {
    const heldStates = (["CREDENTIAL_REJECTED", "SETUP_TOKEN_REJECTED", "USAGE_SHAPE_CHANGED"] as const).map(
      (code) => evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [seenOnce({ code })] }).state,
    );
    const confirmed: ClaudePlanFault = { ...SIGNED_OUT, code: "USAGE_SHAPE_CHANGED", message: "no 7d-status" };
    const [subject] = firing({
      reading: evaluateClaudePlanUnusable({
        closedByOwner: NONE,
        openKeys: SHUT,
        plans: [plan({ record: record({ fault: confirmed }) })],
      }),
    }).subjects;
    expect([heldStates, subject!.key, subject!.claudeFault]).toEqual([
      ["unmeasurable", "unmeasurable", "unmeasurable"],
      claudeFaultKey({ alias: "plan-two", fault: confirmed, storeDir: STORE }),
      "USAGE_SHAPE_CHANGED",
    ]);
  });

  it("floats a fault read off this machine's disk on the one probe that saw it", () => {
    const firedCodes = (["STORE_MISSING", "STORE_NOT_READY", "SETUP_TOKEN_UNREADABLE"] as const).map(
      (code) =>
        firing({
          reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: SHUT, plans: [seenOnce({ code })] }),
        }).subjects[0]!.claudeFault,
    );
    expect(firedCodes).toEqual(["STORE_MISSING", "STORE_NOT_READY", "SETUP_TOKEN_UNREADABLE"]);
  });

  it("keeps a confirmed card up through one probe of another provider code, its return, and its confirmation", () => {
    const confirmed: ClaudePlanFault = { ...SIGNED_OUT, code: "CREDENTIAL_REJECTED", message: "401" };
    const confirmedKey = claudeFaultKey({ alias: "plan-two", fault: confirmed, storeDir: STORE });
    const open = new Set([confirmedKey]);
    const at = (fault: ClaudePlanFault) =>
      evaluateClaudePlanUnusable({
        closedByOwner: NONE,
        openKeys: open,
        plans: [plan({ record: record({ fault, observedAtIso: fault.lastSeenIso }) })],
      });
    const blip = at({
      ...confirmed,
      code: "USAGE_SHAPE_CHANGED",
      lastSeenIso: "2026-01-01T01:00:00.000Z",
      sinceIso: "2026-01-01T01:00:00.000Z",
    });
    const back = { ...confirmed, lastSeenIso: "2026-01-01T01:05:00.000Z", sinceIso: "2026-01-01T01:05:00.000Z" };
    const returned = at(back);
    const again = firing({ reading: at({ ...back, lastSeenIso: "2026-01-01T01:10:00.000Z" }) });
    expect([blip.state, returned.state, again.subjects.map((subject) => subject.key)]).toEqual([
      "unmeasurable",
      "unmeasurable",
      [claudeFaultKey({ alias: "plan-two", fault: back, storeDir: STORE })],
    ]);
  });

  it("preserves departures when one plan is unconfirmed and another plan's card goes up in the same pass", () => {
    const confirmed: ClaudePlanFault = { ...SIGNED_OUT, code: "CREDENTIAL_REJECTED", message: "401" };
    const threeKey = claudeFaultKey({ alias: "plan-three", fault: confirmed, storeDir: STORE });
    const blip: ClaudePlanFault = { ...SIGNED_OUT, code: "USAGE_SHAPE_CHANGED", lastSeenIso: LAST, sinceIso: LAST };
    const plans = [plan(), plan({ alias: "plan-three", record: record({ alias: "plan-three", fault: blip }) })];
    const reading = firing({
      reading: evaluateClaudePlanUnusable({ closedByOwner: NONE, openKeys: new Set([threeKey]), plans }),
    });
    const folded = foldOpenCards({
      definition: CLAUDE_PLAN_UNUSABLE,
      openIds: [`mon-claude-${threeKey}`],
      openWithDecision: new Set(),
      reading,
    }).folded;
    expect([reading.subjects.map((subject) => subject.key), reading.preservesDepartures, folded.departed]).toEqual([
      [KEY],
      true,
      [],
    ]);
  });

  it("reads a record whose last sighting is not after its first as unconfirmed", () => {
    const reversed: ClaudePlanFault = {
      ...SIGNED_OUT,
      code: "USAGE_SHAPE_CHANGED",
      lastSeenIso: SINCE,
      sinceIso: LAST,
    };
    const reading = evaluateClaudePlanUnusable({
      closedByOwner: NONE,
      openKeys: SHUT,
      plans: [plan({ record: record({ fault: reversed }) })],
    });
    expect(reading.state).toBe("unmeasurable");
  });
});
