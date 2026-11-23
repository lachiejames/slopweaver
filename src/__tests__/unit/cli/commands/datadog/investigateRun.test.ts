import { describe, expect, it } from "vitest";

import {
  datadogApmCommand,
  datadogCiCommand,
  datadogDbmCommand,
  datadogLogsCommand,
  datadogProfilesCommand,
  datadogRumCommand,
  datadogTestsCommand,
} from "../../../../../cli/commands/datadog/investigateRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** Every product's command, with the verb name the router dispatches it under. */
const COMMANDS = [
  { command: datadogLogsCommand, verb: "logs" },
  { command: datadogApmCommand, verb: "apm" },
  { command: datadogRumCommand, verb: "rum" },
  { command: datadogCiCommand, verb: "ci" },
  { command: datadogTestsCommand, verb: "tests" },
  { command: datadogDbmCommand, verb: "dbm" },
  { command: datadogProfilesCommand, verb: "profiles" },
] as const;

describe("the seven investigation verbs — the dispatcher, before any network", () => {
  it("ships one command per declared product", () => {
    expect(COMMANDS.length).toBe(7);
  });

  it("prints its own usage for --help and exits EXIT_OK, touching no credential", async () => {
    for (const entry of COMMANDS) {
      expect(await entry.command(["node", "slopweaver", "datadog", entry.verb, "--help"])).toBe(EXIT_OK);
    }
  });

  it("refuses an unparseable window before it resolves a credential", async () => {
    for (const entry of COMMANDS) {
      expect(await entry.command(["node", "slopweaver", "datadog", entry.verb, "--from", "a fortnight"])).toBe(
        EXIT_USAGE,
      );
    }
  });

  it("refuses a row count that is not a whole number", async () => {
    expect(await datadogLogsCommand(["node", "slopweaver", "datadog", "logs", "--rows", "lots"])).toBe(EXIT_USAGE);
  });
});
