/**
 * Which monitor a note speaks for, and which kind answers it offers: a monitor card needs BOTH the monitor witness and
 * a declared `mon-<prefix>-` id, a notice kind is never offered a mute, and worse is strict.
 */
import { describe, expect, it } from "vitest";

import { MONITOR_WITNESS } from "../../../hand/step.js";
import {
  isWorse,
  kindAnswerOffer,
  monitorOfStep,
  monitorOfStepId,
  worsenMeasure,
} from "../../../monitor/noteAnswers.js";
import { monitorDefinition } from "../../../monitor/registry.js";

describe("monitorOfStep", () => {
  it("names the monitor of a card carrying the monitor witness and its prefix, whichever occurrence it is", () => {
    expect(monitorOfStep({ step: { id: "mon-health-0a1b2c", witness: MONITOR_WITNESS } })!.id).toBe("fleet-unhealthy");
    expect(monitorOfStep({ step: { id: "mon-fsev-97860.3", witness: MONITOR_WITNESS } })!.id).toBe("fseventsd-bloated");
  });

  it("refuses a mon- id posted under any other witness — an id alone is a string any session could post", () => {
    expect(
      monitorOfStep({ step: { id: "mon-health-0a1b2c", witness: "slopweaver hand done mon-health-0a1b2c" } }),
    ).toBe(undefined);
  });

  it("refuses an id whose prefix is no declared monitor's, or runs on past one without its dash", () => {
    expect(monitorOfStepId({ id: "mon-nosuch-1" })).toBe(undefined);
    expect(monitorOfStepId({ id: "mon-healthz-1" })).toBe(undefined);
    expect(monitorOfStepId({ id: "gcloud-signin" })).toBe(undefined);
  });
});

describe("kindAnswerOffer", () => {
  it("offers both answers on a monitor that declares what worse means", () => {
    expect(kindAnswerOffer({ step: { id: "mon-fsev-97860", witness: MONITOR_WITNESS } })).toEqual({
      muteKind: true,
      whenWorse: true,
    });
  });

  it("offers Never alone on a monitor with no idea of worse", () => {
    expect(kindAnswerOffer({ step: { id: "mon-chair-unpinned", witness: MONITOR_WITNESS } })).toEqual({
      muteKind: true,
      whenWorse: false,
    });
  });

  it("never offers a notice kind a mute — its note is its only delivery", () => {
    expect(kindAnswerOffer({ step: { id: "mon-repairing-abc", witness: MONITOR_WITNESS } })).toEqual({
      muteKind: false,
      whenWorse: false,
    });
  });

  it("offers neither on a step no monitor speaks for", () => {
    expect(kindAnswerOffer({ step: { id: "gcloud-signin", witness: "slopweaver hand done gcloud-signin" } })).toEqual({
      muteKind: false,
      whenWorse: false,
    });
  });
});

describe("worsenMeasure", () => {
  it("reads fseventsd's footprint off its subject, and nothing off a monitor declaring no worse", () => {
    const subject = { footprintBytes: 3_000_000_000, id: "fseventsd", key: "97860", label: "2.8 GB" };
    expect(worsenMeasure({ definition: monitorDefinition({ monitorId: "fseventsd-bloated" }), subject })).toBe(
      3_000_000_000,
    );
    expect(worsenMeasure({ definition: monitorDefinition({ monitorId: "chair-off-fable" }), subject })).toBe(undefined);
  });
});

describe("isWorse", () => {
  it("is strict either way: equal never brings a held note back", () => {
    expect(isWorse({ baseline: 4, direction: "higher", measure: 5 })).toBe(true);
    expect(isWorse({ baseline: 4, direction: "higher", measure: 4 })).toBe(false);
    expect(isWorse({ baseline: 4, direction: "higher", measure: 3 })).toBe(false);
    expect(isWorse({ baseline: 4, direction: "lower", measure: 3 })).toBe(true);
    expect(isWorse({ baseline: 4, direction: "lower", measure: 4 })).toBe(false);
  });
});
