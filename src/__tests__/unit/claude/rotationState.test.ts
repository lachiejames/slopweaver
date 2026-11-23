import { describe, expect, it } from "vitest";

import {
  EMPTY_ROTATION_STATE,
  expireUnavailability,
  holdAccount,
  isSelectable,
  parseRotationState,
  selectAccount,
} from "../../../claude/rotationState.js";

const NOW = "2026-09-04T00:00:00.000Z";

describe("parseRotationState", () => {
  it("reads a full record back", () => {
    const state = parseRotationState({
      value: {
        reason: "five_hour refused on plan-one",
        selected: "plan-two",
        selectedAtIso: NOW,
        unavailable: [{ alias: "plan-one", reason: "five_hour refused", untilIso: "2026-09-04T04:50:00.000Z" }],
      },
    });
    expect(state.selected).toBe("plan-two");
    expect(state.selectedAtIso).toBe(NOW);
    expect(state.unavailable).toStrictEqual([
      { alias: "plan-one", reason: "five_hour refused", untilIso: "2026-09-04T04:50:00.000Z" },
    ]);
  });

  it("returns the empty state for a missing file rather than throwing", () => {
    expect(parseRotationState({ value: undefined })).toStrictEqual(EMPTY_ROTATION_STATE);
  });

  it("drops a malformed hold and keeps the well-formed ones beside it", () => {
    const state = parseRotationState({
      value: {
        unavailable: [
          { alias: "plan-one", untilIso: 7 },
          { alias: "plan-two", reason: "seven_day refused", untilIso: "2026-09-11T00:00:00.000Z" },
        ],
      },
    });
    expect(state.unavailable.length).toBe(1);
    expect(state.unavailable[0]?.alias).toBe("plan-two");
  });

  it("forgets a selection it cannot read rather than inventing one", () => {
    const state = parseRotationState({ value: { selected: 42, unavailable: [] } });
    expect(state.selected).toBe(undefined);
  });
});

describe("expireUnavailability", () => {
  it("frees a plan once its reset has passed", () => {
    const held = holdAccount({
      alias: "plan-one",
      reason: "five_hour refused",
      state: EMPTY_ROTATION_STATE,
      untilIso: "2026-09-03T23:00:00.000Z",
    });
    expect(expireUnavailability({ nowIso: NOW, state: held }).unavailable).toStrictEqual([]);
  });

  it("keeps a hold whose reset is still ahead", () => {
    const held = holdAccount({
      alias: "plan-one",
      reason: "five_hour refused",
      state: EMPTY_ROTATION_STATE,
      untilIso: "2026-09-04T04:50:00.000Z",
    });
    expect(expireUnavailability({ nowIso: NOW, state: held }).unavailable.length).toBe(1);
  });
});

describe("holdAccount", () => {
  it("replaces a standing hold for the same plan rather than stacking a second", () => {
    const once = holdAccount({
      alias: "plan-one",
      reason: "five_hour refused",
      state: EMPTY_ROTATION_STATE,
      untilIso: "2026-09-04T04:50:00.000Z",
    });
    const twice = holdAccount({
      alias: "plan-one",
      reason: "seven_day refused",
      state: once,
      untilIso: "2026-09-11T00:00:00.000Z",
    });
    expect(twice.unavailable.length).toBe(1);
    expect(twice.unavailable[0]?.untilIso).toBe("2026-09-11T00:00:00.000Z");
  });

  it("holds one plan without touching another", () => {
    const first = holdAccount({ alias: "a", reason: "r", state: EMPTY_ROTATION_STATE, untilIso: NOW });
    const both = holdAccount({ alias: "b", reason: "r", state: first, untilIso: NOW });
    expect(both.unavailable.map((entry) => entry.alias)).toStrictEqual(["a", "b"]);
  });
});

describe("isSelectable", () => {
  it("refuses a plan whose hold has not expired — the flap guard", () => {
    const held = holdAccount({
      alias: "plan-one",
      reason: "five_hour refused",
      state: EMPTY_ROTATION_STATE,
      untilIso: "2026-09-04T04:50:00.000Z",
    });
    expect(isSelectable({ alias: "plan-one", nowIso: NOW, state: held })).toBe(false);
  });

  it("allows it again once the reset it named has passed", () => {
    const held = holdAccount({
      alias: "plan-one",
      reason: "five_hour refused",
      state: EMPTY_ROTATION_STATE,
      untilIso: "2026-09-04T04:50:00.000Z",
    });
    expect(isSelectable({ alias: "plan-one", nowIso: "2026-09-04T05:00:00.000Z", state: held })).toBe(true);
  });

  it("allows a plan no hold was ever recorded against", () => {
    expect(isSelectable({ alias: "plan-nine", nowIso: NOW, state: EMPTY_ROTATION_STATE })).toBe(true);
  });
});

describe("selectAccount", () => {
  it("records the plan, the instant and the reason, and keeps standing holds", () => {
    const held = holdAccount({
      alias: "plan-one",
      reason: "five_hour refused",
      state: EMPTY_ROTATION_STATE,
      untilIso: "2026-09-04T04:50:00.000Z",
    });
    const state = selectAccount({ alias: "plan-two", nowIso: NOW, reason: "plan-one is spent", state: held });
    expect(state.selected).toBe("plan-two");
    expect(state.selectedAtIso).toBe(NOW);
    expect(state.reason).toBe("plan-one is spent");
    expect(state.unavailable.length).toBe(1);
  });

  it("round-trips through the parser unchanged", () => {
    const state = selectAccount({ alias: "plan-two", nowIso: NOW, reason: "why", state: EMPTY_ROTATION_STATE });
    expect(parseRotationState({ value: JSON.parse(JSON.stringify(state)) })).toStrictEqual(state);
  });
});
