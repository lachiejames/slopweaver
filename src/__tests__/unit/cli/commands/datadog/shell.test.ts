/**
 * The Datadog pre-flight over an injected flag parser, a fixed instant and an injected config load: one
 * ordered event log of the parse and the config load, so each case pins the documented order — flags first,
 * then the window (a caller mistake, `EXIT_USAGE`), and credentials last (`EXIT_EXPECTED_EMPTY`) — and that a
 * failure at one step never reaches the next. Every Datadog host in this file reads the synthetic `ap1` site rather
 * than the install's own.
 */
import { describe, expect, it } from "vitest";

import { type DatadogArgsError, DatadogArgsErrors } from "../../../../../cli/commands/datadog/errors.js";
import { resolveDatadogPreflight } from "../../../../../cli/commands/datadog/shell.js";
import { EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { DatadogConfig } from "../../../../../datadog/config.js";
import { type DatadogConfigError, DatadogConfigErrors } from "../../../../../datadog/configErrors.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";

const USAGE = "usage: slopweaver datadog probe --from <window> [--to <window>]";

/** The fixed instant every relative window resolves against. */
const NOW_MS = 1_760_313_600_000;

const HOUR_MS = 3_600_000;

const CONFIG: DatadogConfig = {
  apiHost: "api.ap1.datadoghq.com",
  apiKey: "0123456789abcdef0123456789abcdef",
  appKey: "0123456789abcdef0123456789abcdef01234567",
  consoleHost: "ap1.datadoghq.com",
  site: "ap1.datadoghq.com",
};

/** The flags a fake parser hands back. */
interface Flags {
  readonly from: string;
  readonly to: string;
  readonly verbose: boolean;
}

/** Run the pre-flight with a parser and config load answering the given results, logging both calls. */
function preflight({
  parsed,
  config = ok(CONFIG),
}: {
  parsed: Result<Flags, DatadogArgsError>;
  config?: Result<DatadogConfig, DatadogConfigError>;
}): { events: string[]; result: ReturnType<typeof resolveDatadogPreflight<Flags>> } {
  const events: string[] = [];
  const result = resolveDatadogPreflight<Flags>({
    loadConfig: () => {
      events.push("config");
      return config;
    },
    clockMs: () => {
      events.push("clock");
      return NOW_MS;
    },
    parseFlags: ({ rest }) => {
      events.push(`parse ${rest.join(" ")}`);
      return parsed;
    },
    rest: ["--from", "8h"],
    usage: USAGE,
  });
  return { events, result };
}

describe("resolveDatadogPreflight", () => {
  it("parses the flags, then reads the clock for the window, then loads the config", () => {
    const { events, result } = preflight({ parsed: ok({ from: "8h", to: "now", verbose: true }) });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      config: CONFIG,
      flags: { from: "8h", to: "now", verbose: true },
      window: { fromMs: NOW_MS - 8 * HOUR_MS, toMs: NOW_MS },
    });
    expect(events).toEqual(["parse --from 8h", "clock", "config"]);
  });

  it("refuses a flag error with EXIT_USAGE, its lines then the usage, before the clock or the config", () => {
    const { events, result } = preflight({
      parsed: err(DatadogArgsErrors.flagsInvalid({ reasons: ["unknown flag: --nope", "--from needs a value"] })),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: EXIT_USAGE,
      errors: ["unknown flag: --nope", "--from needs a value", USAGE],
    });
    expect(events).toEqual(["parse --from 8h"]);
  });

  it("refuses an unparseable window with EXIT_USAGE before loading the config, so absent credentials cannot mask it", () => {
    const { events, result } = preflight({
      config: err(DatadogConfigErrors.siteMissing({ acceptedSites: ["ap1.datadoghq.com"] })),
      parsed: ok({ from: "yesterday", to: "now", verbose: false }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: EXIT_USAGE,
      errors: [
        "--from 'yesterday' is not a window: expected a duration (30m, 8h, 7d), 'now', or epoch milliseconds",
        USAGE,
      ],
    });
    expect(events).toEqual(["parse --from 8h", "clock"]);
  });

  it("reports a missing credential as EXIT_EXPECTED_EMPTY with its own line and no usage", () => {
    const missing = DatadogConfigErrors.credentialMissing({
      name: "DD_API_KEY",
      secretName: "datadog-api-key",
      shapeLabel: "32 hex characters",
    });
    const { events, result } = preflight({
      config: err(missing),
      parsed: ok({ from: "8h", to: "now", verbose: false }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: EXIT_EXPECTED_EMPTY,
      errors: [
        "DD_API_KEY is not set — store it with `slopweaver secrets set datadog-api-key`, or export DD_API_KEY (32 hex characters)",
      ],
    });
    expect(events).toEqual(["parse --from 8h", "clock", "config"]);
  });

  it("reports an invalid config as EXIT_EXPECTED_EMPTY, one line per reason", () => {
    const { result } = preflight({
      config: err(DatadogConfigErrors.configInvalid({ reasons: ["DD_SITE is set twice", "profile.json is not JSON"] })),
      parsed: ok({ from: "8h", to: "now", verbose: false }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: EXIT_EXPECTED_EMPTY,
      errors: ["DD_SITE is set twice", "profile.json is not JSON"],
    });
  });
});
