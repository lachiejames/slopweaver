/*
 * The shape checks both app wires build their guards from, on the CLI's mirror: what counts as an object a guard may
 * read, a required or an optional string field, and an object carrying no field outside its shape. The desktop copy is
 * byte-identical (`desktop/__tests__/unit/sessionControlProtocolMirror.test.ts`).
 */
import { describe, expect, it } from "vitest";

import {
  APP_SESSION_STATES,
  hasOnlyKeys,
  hasOptionalStrings,
  hasStrings,
  isObject,
} from "../../../sessionHarness/wireBasics.js";

describe("isObject", () => {
  it("takes a plain object and refuses null, an array and a primitive", () => {
    expect(isObject({ kind: "usage" })).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isObject(["usage"])).toBe(false);
    expect(isObject("usage")).toBe(false);
  });
});

describe("hasStrings and hasOptionalStrings", () => {
  it("wants every named field a string", () => {
    expect(hasStrings({ keys: ["title", "ledgerKey"], value: { ledgerKey: "abc-1", title: "abc-1" } })).toBe(true);
    expect(hasStrings({ keys: ["title", "ledgerKey"], value: { title: "abc-1" } })).toBe(false);
    expect(hasStrings({ keys: ["title"], value: { title: 1 } })).toBe(false);
  });

  it("lets an optional field be absent but never another type", () => {
    expect(hasOptionalStrings({ keys: ["askedModel"], value: {} })).toBe(true);
    expect(hasOptionalStrings({ keys: ["askedModel"], value: { askedModel: "opus" } })).toBe(true);
    expect(hasOptionalStrings({ keys: ["askedModel"], value: { askedModel: 5 } })).toBe(false);
  });
});

describe("hasOnlyKeys", () => {
  it("refuses a field outside the shape, and allows one the shape names but the object omits", () => {
    expect(hasOnlyKeys({ keys: ["vendor", "totalTokens"], value: { vendor: "codex" } })).toBe(true);
    expect(hasOnlyKeys({ keys: ["vendor"], value: { inputTokens: 1, vendor: "codex" } })).toBe(false);
  });
});

describe("APP_SESSION_STATES", () => {
  it("holds every state a card shows, and nothing else", () => {
    expect([...APP_SESSION_STATES]).toEqual(["starting", "idle", "running", "stopping", "closed", "failed"]);
  });
});
