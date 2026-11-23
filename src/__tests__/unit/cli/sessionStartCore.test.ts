import { describe, expect, it } from "vitest";
import { parseSessionStartArgs, parseTop, sessionStartOptions } from "../../../cli/commands/sessionStart/core.js";
import { SessionStartErrors } from "../../../cli/commands/sessionStart/errors.js";
import { sessionStartCommand } from "../../../cli/commands/sessionStart/run.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { DEFAULT_TOP } from "../../../sessionStart/render.js";

describe("parseTop", () => {
  it("defaults when the flag was not passed", () => {
    expect(unwrap(parseTop({ raw: undefined }))).toBe(DEFAULT_TOP);
  });

  it("takes a positive whole number", () => {
    expect(unwrap(parseTop({ raw: "30" }))).toBe(30);
  });

  it("refuses zero rather than clamping it", () => {
    const result = parseTop({ raw: "0" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(SessionStartErrors.topNotPositive({ got: "0" }));
    expect(result._unsafeUnwrapErr().message).toBe("--top must be a whole number of at least 1, got 0");
  });

  it("refuses a fraction", () => {
    const result = parseTop({ raw: "2.5" });
    expect(unwrapErr(result)).toEqual(SessionStartErrors.topNotPositive({ got: "2.5" }));
    expect(unwrapErr(result).message).toBe("--top must be a whole number of at least 1, got 2.5");
  });

  it("refuses text", () => {
    const result = parseTop({ raw: "ten" });
    expect(unwrapErr(result)).toEqual(SessionStartErrors.topNotPositive({ got: "ten" }));
    expect(unwrapErr(result).message).toBe("--top must be a whole number of at least 1, got ten");
  });

  it("refuses a negative", () => {
    const result = parseTop({ raw: "-1" });
    expect(unwrapErr(result)).toEqual(SessionStartErrors.topNotPositive({ got: "-1" }));
    expect(unwrapErr(result).message).toBe("--top must be a whole number of at least 1, got -1");
  });
});

describe("sessionStartOptions", () => {
  it("reads the defaults from an empty argument list", () => {
    const options = unwrap(sessionStartOptions({ parsed: unwrap(parseSessionStartArgs({ rest: [] })) }));
    expect(options.json).toBe(false);
    expect(options.probe).toBe(false);
    expect(options.top).toBe(DEFAULT_TOP);
    expect(options.now).toBe(undefined);
    expect(options.home).toBe(undefined);
  });

  it("reads every flag it was given", () => {
    const parsed = unwrap(
      parseSessionStartArgs({
        rest: ["--json", "--probe", "--top", "3", "--now", "2026-08-30T00:00:00.000Z", "--home", "/tmp/h"],
      }),
    );
    const options = unwrap(sessionStartOptions({ parsed }));
    expect(options.json).toBe(true);
    expect(options.probe).toBe(true);
    expect(options.top).toBe(3);
    expect(options.now).toBe("2026-08-30T00:00:00.000Z");
    expect(options.home).toBe("/tmp/h");
  });

  it("reads --out as the JSON document's path, implying --json, and leaves it unset by default", () => {
    const given = unwrap(
      sessionStartOptions({ parsed: unwrap(parseSessionStartArgs({ rest: ["--out", "/s/run.fresh.json"] })) }),
    );
    const bare = unwrap(sessionStartOptions({ parsed: unwrap(parseSessionStartArgs({ rest: [] })) }));

    expect(given.out).toBe("/s/run.fresh.json");
    expect(given.json).toBe(true);
    expect(bare.out).toBe(undefined);
  });

  it("carries the top refusal out rather than falling back to the default", () => {
    const parsed = unwrap(parseSessionStartArgs({ rest: ["--top", "0"] }));

    const options = sessionStartOptions({ parsed });
    expect(unwrapErr(options)).toEqual(SessionStartErrors.topNotPositive({ got: "0" }));
    expect(unwrapErr(options).message).toBe("--top must be a whole number of at least 1, got 0");
  });
});

describe("sessionStartCommand", () => {
  it("is wired as a dispatchable verb the manifest can load", async () => {
    expect(await sessionStartCommand(["node", "cli", "session-start", "--help"])).toBe(0);
  });

  it("refuses an unparseable --top before reading anything off disk", async () => {
    expect(await sessionStartCommand(["node", "cli", "session-start", "--top", "0"])).toBe(2);
  });
});
