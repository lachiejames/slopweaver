import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseAccountedForTs } from "../../../../live/turn/accountedForTs.js";

describe("parseAccountedForTs", () => {
  it("names no timestamps when the flag was not passed", () => {
    const result = parseAccountedForTs({ raw: undefined });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([]);
  });

  it("reads the single timestamp the compound-instruction case passes", () => {
    const result = parseAccountedForTs({ raw: "1787287180.226079" });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(["1787287180.226079"]);
  });

  it("reads every timestamp of a comma-separated list, in the order given", () => {
    const result = parseAccountedForTs({ raw: "1787287310.724569,1787287521.074179,1787288467.452869" });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(["1787287310.724569", "1787287521.074179", "1787288467.452869"]);
  });

  it("tolerates the spaces a caller pastes after each comma", () => {
    const result = parseAccountedForTs({ raw: "1787287310.724569, 1787287521.074179" });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(["1787287310.724569", "1787287521.074179"]);
  });

  it("refuses a trailing comma rather than silently accounting for one fewer message", () => {
    const result = parseAccountedForTs({ raw: "1787287310.724569," });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual([
      "--accounted-for-ts has an empty entry — comma-separate the timestamps, with no trailing comma",
    ]);
  });

  it("refuses a value that is not a Slack message timestamp, naming the entry", () => {
    const result = parseAccountedForTs({ raw: "1787287310.724569,not-a-ts" });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(["--accounted-for-ts is not a Slack message timestamp: not-a-ts"]);
  });

  it("reports every malformed entry at once, not just the first", () => {
    const result = parseAccountedForTs({ raw: "nope,1787287310.724569,also-nope" });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual([
      "--accounted-for-ts is not a Slack message timestamp: nope",
      "--accounted-for-ts is not a Slack message timestamp: also-nope",
    ]);
  });

  it("refuses whole seconds with no fractional part — the likeliest paste mistake", () => {
    const result = parseAccountedForTs({ raw: "1787287180" });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(["--accounted-for-ts is not a Slack message timestamp: 1787287180"]);
  });

  it("refuses an empty flag value", () => {
    const result = parseAccountedForTs({ raw: "" });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual([
      "--accounted-for-ts has an empty entry — comma-separate the timestamps, with no trailing comma",
    ]);
  });
});
