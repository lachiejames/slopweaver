/**
 * The fleet configuration reader: the default only when no file exists, and a typed error for a file that is
 * present and wrong, so the capacity line never reads a number the file did not say.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { isFleetCapacity, MAX_FLEET_CAPACITY, parseFleetConfig } from "../../../fleet/config.js";

const PATH = "/home/fleet/config.json";

describe("isFleetCapacity", () => {
  it("accepts the whole numbers from 1 to the maximum, both ends included", () => {
    expect([1, 15, MAX_FLEET_CAPACITY].map((value) => isFleetCapacity({ value }))).toEqual([true, true, true]);
  });

  it("refuses zero, one past the maximum, a fraction, a negative and a non-finite number", () => {
    const refused = [0, MAX_FLEET_CAPACITY + 1, 2.5, -3, Number.NaN, Number.POSITIVE_INFINITY];
    expect(refused.map((value) => isFleetCapacity({ value }))).toEqual([false, false, false, false, false, false]);
  });
});

describe("parseFleetConfig", () => {
  it("reads no file as the default capacity", () => {
    const result = parseFleetConfig({ path: PATH, value: undefined });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({ capacity: 15, schemaVersion: 1 });
  });

  it("reads a valid file as exactly what it says", () => {
    const result = parseFleetConfig({ path: PATH, value: { capacity: 7, schemaVersion: 1 } });
    expect(unwrap(result)).toEqual({ capacity: 7, schemaVersion: 1 });
  });

  it("refuses a value that is not an object, naming the file and the reason", () => {
    const error = unwrapErr(parseFleetConfig({ path: PATH, value: "15" }));
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toContain(`${PATH} is not a valid fleet configuration (not an object)`);
  });

  it("refuses null rather than reading it as no file", () => {
    const error = unwrapErr(parseFleetConfig({ path: PATH, value: null }));
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toContain("(not an object)");
  });

  it("refuses a schema version other than 1", () => {
    const error = unwrapErr(parseFleetConfig({ path: PATH, value: { capacity: 7, schemaVersion: 2 } }));
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toContain("(schemaVersion is not 1)");
  });

  it("refuses a capacity that is out of range, fractional or not a number, stating the range", () => {
    const values = [0, MAX_FLEET_CAPACITY + 1, 4.5, "7"];
    const messages = values.map(
      (capacity) => unwrapErr(parseFleetConfig({ path: PATH, value: { capacity, schemaVersion: 1 } })).message,
    );
    expect(messages.every((message) => message.includes("capacity must be a whole number from 1 to 100"))).toBe(true);
  });

  it("refuses a file with no capacity key, never defaulting past it", () => {
    const error = unwrapErr(parseFleetConfig({ path: PATH, value: { schemaVersion: 1 } }));
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toContain("capacity must be a whole number");
  });
});
