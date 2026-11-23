import { describe, expect, it } from "vitest";

import { SlackReadErrors, slackReadErrorLines } from "../../../../../cli/commands/slack/readErrors.js";
import {
  parseSlackReadThreadArgs,
  SLACK_READ_THREAD_FLAG_NAMES,
} from "../../../../../cli/commands/slack/readThreadCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const LINK = "https://example.slack.com/archives/C123/p1785114398557099";

describe("parseSlackReadThreadArgs", () => {
  it("takes the permalink as the sole positional", () => {
    const options = unwrap(parseSlackReadThreadArgs({ rest: [LINK] }));

    expect(options.permalink).toBe(LINK);
    expect(options.json).toBe(false);
    expect(options.maxFileBytes).toBe(undefined);
    expect(options.home).toBe(undefined);
    expect(options.around).toBe(undefined);
    expect(options.channelAround).toBe(undefined);
  });

  it("reads --json and --home", () => {
    const options = unwrap(parseSlackReadThreadArgs({ rest: [LINK, "--json", "--home", "/tmp/home"] }));

    expect(options.json).toBe(true);
    expect(options.home).toBe("/tmp/home");
  });

  it("converts --max-file-mb to bytes", () => {
    const options = unwrap(parseSlackReadThreadArgs({ rest: [LINK, "--max-file-mb", "10"] }));

    expect(options.maxFileBytes).toBe(10 * 1024 * 1024);
  });

  it("requires a permalink", () => {
    const result = parseSlackReadThreadArgs({ rest: [] });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(SlackReadErrors.permalinkMissing());
    expect(slackReadErrorLines({ error: unwrapErr(result) }).join(" ")).toContain("permalink is required");
  });

  it("refuses two permalinks rather than silently reading one", () => {
    const result = parseSlackReadThreadArgs({ rest: [LINK, LINK] });

    expect(result.isErr()).toBe(true);
    expect(slackReadErrorLines({ error: unwrapErr(result) }).join(" ")).toContain("expected one permalink, got 2");
  });

  it("refuses a non-numeric size cap instead of falling back to the default", () => {
    const result = parseSlackReadThreadArgs({ rest: [LINK, "--max-file-mb", "big"] });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("INVALID_FLAG_VALUE");
    expect(slackReadErrorLines({ error: unwrapErr(result) }).join(" ")).toContain("must be a positive number");
  });

  it("refuses a zero or negative size cap", () => {
    expect(
      slackReadErrorLines({ error: unwrapErr(parseSlackReadThreadArgs({ rest: [LINK, "--max-file-mb", "0"] })) }),
    ).toEqual(["--max-file-mb must be a positive number, got 0"]);
    expect(
      slackReadErrorLines({ error: unwrapErr(parseSlackReadThreadArgs({ rest: [LINK, "--max-file-mb", "-5"] })) }),
    ).toEqual(["--max-file-mb must be a positive number, got -5"]);
  });

  it("refuses an unknown flag", () => {
    const result = parseSlackReadThreadArgs({ rest: [LINK, "--delta", "abc"] });

    expect(result.isErr()).toBe(true);
    expect(slackReadErrorLines({ error: unwrapErr(result) }).join(" ")).toContain("--delta");
  });

  it("reads --since as a Slack timestamp", () => {
    const options = unwrap(parseSlackReadThreadArgs({ rest: [LINK, "--since", "1785114398.557099"] }));

    expect(options.sinceTs).toBe("1785114398.557099");
  });

  it("reads independent zero-inclusive thread and channel bounds", () => {
    const options = unwrap(parseSlackReadThreadArgs({ rest: [LINK, "--around", "0", "--channel-around", "7"] }));

    expect(options.around).toBe(0);
    expect(options.channelAround).toBe(7);
  });

  it("refuses fractional, negative, and unsafe context bounds", () => {
    expect(
      slackReadErrorLines({ error: unwrapErr(parseSlackReadThreadArgs({ rest: [LINK, "--around", "1.5"] })) }),
    ).toEqual(["--around must be a non-negative integer, got 1.5"]);
    expect(
      slackReadErrorLines({ error: unwrapErr(parseSlackReadThreadArgs({ rest: [LINK, "--channel-around", "-1"] })) }),
    ).toEqual(["--channel-around must be a non-negative integer, got -1"]);
    expect(
      slackReadErrorLines({
        error: unwrapErr(parseSlackReadThreadArgs({ rest: [LINK, "--around", "9007199254740992"] })),
      }),
    ).toEqual(["--around must be a non-negative integer, got 9007199254740992"]);
  });

  it("refuses --since with either progressive context mode", () => {
    const withThread = parseSlackReadThreadArgs({
      rest: [LINK, "--since", "1785114398.557099", "--around", "1"],
    });
    const withChannel = parseSlackReadThreadArgs({
      rest: [LINK, "--since", "1785114398.557099", "--channel-around", "1"],
    });

    expect(slackReadErrorLines({ error: unwrapErr(withThread) })).toEqual([
      "--since cannot be combined with --around or --channel-around",
    ]);
    expect(slackReadErrorLines({ error: unwrapErr(withChannel) })).toEqual([
      "--since cannot be combined with --around or --channel-around",
    ]);
  });

  it("leaves --since absent when it is not given, which is what selects a full read", () => {
    expect(unwrap(parseSlackReadThreadArgs({ rest: [LINK] })).sinceTs).toBe(undefined);
  });

  it("refuses a --since that is not a timestamp BEFORE any network call", () => {
    const result = parseSlackReadThreadArgs({ rest: [LINK, "--since", "yesterday"] });

    expect(result.isErr()).toBe(true);
    expect(slackReadErrorLines({ error: unwrapErr(result) }).join(" ")).toContain("must be a Slack timestamp");
  });

  it("refuses a permalink-style ts with the dot stripped, rather than reading a nonsense moment", () => {
    const result = parseSlackReadThreadArgs({ rest: [LINK, "--since", "1785114398557099"] });

    expect(result.isErr()).toBe(true);
    expect(slackReadErrorLines({ error: unwrapErr(result) }).join(" ")).toContain("must be a Slack timestamp");
  });

  it("accepts a real timestamp whose fraction is not six digits wide", () => {
    // The anchor is always copied out of a previous read, so it is whatever Slack emitted. Refusing a
    // width we have not seen before would refuse the one input guaranteed to be legitimate.
    expect(unwrap(parseSlackReadThreadArgs({ rest: [LINK, "--since", "1785114398.5570991"] })).sinceTs).toBe(
      "1785114398.5570991",
    );
  });

  it("refuses --since with no value", () => {
    const result = parseSlackReadThreadArgs({ rest: [LINK, "--since"] });

    expect(result.isErr()).toBe(true);
    // The WHOLE sentence, not just the flag name: a bare `--since` match also succeeds against "unknown
    // flag: --since", which is the assertion this file used to make and which is now exactly wrong.
    expect(unwrapErr(result)).toEqual(SlackReadErrors.flagsInvalid({ reasons: ["--since requires a value"] }));
    expect(slackReadErrorLines({ error: unwrapErr(result) }).join(" ")).toContain("--since requires a value");
  });

  it("publishes its flag names with the -- prefix the help ratchet compares against", () => {
    expect(SLACK_READ_THREAD_FLAG_NAMES).toEqual([
      "--around",
      "--channel-around",
      "--home",
      "--json",
      "--max-file-mb",
      "--since",
    ]);
  });
});
