import { describe, expect, it } from "vitest";

import { decodeCursorRecord } from "../../../lib/cursorRecord.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("decodeCursorRecord", () => {
  it("reads the position under the key it is given, with its instant", () => {
    expect(
      unwrap(decodeCursorRecord({ positionKey: "seq", text: '{"seq":9,"recordedAtIso":"2026-09-28T00:00:00Z"}' })),
    ).toEqual({ position: 9, recordedAtIso: "2026-09-28T00:00:00Z" });
  });

  it("reads a record with no instant as the position alone", () => {
    expect(unwrap(decodeCursorRecord({ positionKey: "offset", text: '{"offset":0}' }))).toEqual({ position: 0 });
  });

  it("refuses text that is not JSON", () => {
    expect(unwrapErr(decodeCursorRecord({ positionKey: "offset", text: "{" }))).toEqual(["it is not JSON"]);
  });

  it("refuses JSON that is not an object", () => {
    expect(unwrapErr(decodeCursorRecord({ positionKey: "offset", text: "[12]" }))).toEqual(["it is not an object"]);
  });

  it("refuses a position under the other key, naming the key it wanted", () => {
    expect(unwrapErr(decodeCursorRecord({ positionKey: "seq", text: '{"offset":12}' }))).toEqual([
      "its seq is not a non-negative integer",
    ]);
  });

  it("refuses a negative or fractional position", () => {
    expect(unwrapErr(decodeCursorRecord({ positionKey: "seq", text: '{"seq":-1}' }))).toEqual([
      "its seq is not a non-negative integer",
    ]);
    expect(unwrapErr(decodeCursorRecord({ positionKey: "seq", text: '{"seq":1.5}' }))).toEqual([
      "its seq is not a non-negative integer",
    ]);
  });

  it("refuses an instant that is there but not a string, null included", () => {
    expect(unwrapErr(decodeCursorRecord({ positionKey: "seq", text: '{"seq":3,"recordedAtIso":null}' }))).toEqual([
      "its recordedAtIso is not a string",
    ]);
  });
});
