/**
 * The console-origin flag group `talk transcript` and `talk relay` take: all three or none, an absolute root, real
 * ports.
 */
import { describe, expect, it } from "vitest";

import { parseTranscriptArgs } from "../../../../../cli/commands/talk/callArgs.js";
import {
  ConsoleInstanceErrors,
  parseConsoleInstance,
  parseConsoleOriginArgs,
} from "../../../../../cli/commands/talk/consoleOriginArgs.js";
import { parseRelayArgs } from "../../../../../cli/commands/talk/relayArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseConsoleOriginArgs", () => {
  it("reads no flag of the group as a hand-run verb", () => {
    const parsed = parseConsoleOriginArgs({ defaultPort: undefined, port: undefined, root: undefined });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toBe(undefined);
  });

  it("reads the whole group", () => {
    const parsed = parseConsoleOriginArgs({ defaultPort: "3000", port: "3001", root: "/w/seat" });
    expect(unwrap(parsed)).toEqual({ checkoutRoot: "/w/seat", defaultPort: 3000, port: 3001 });
  });

  it("refuses a partial group", () => {
    const parsed = parseConsoleOriginArgs({ defaultPort: undefined, port: "3001", root: "/w/seat" });
    expect(unwrapErr(parsed)).toEqual([
      "--console-default-port is missing: the console-origin flags are passed together or not at all",
    ]);
  });

  it("names every bad value at once", () => {
    const parsed = parseConsoleOriginArgs({ defaultPort: "0", port: "65536", root: "w/seat" });
    expect(unwrapErr(parsed)).toEqual([
      "--console-root must be an absolute path, not w/seat",
      "--console-port must be a port from 1 to 65535, not 65536",
      "--console-default-port must be a port from 1 to 65535, not 0",
    ]);
  });

  it("refuses a relative root alone", () => {
    const parsed = parseConsoleOriginArgs({ defaultPort: "3000", port: "3000", root: "seat" });
    expect(unwrapErr(parsed)).toEqual(["--console-root must be an absolute path, not seat"]);
  });
});

describe("parseConsoleInstance", () => {
  it("reads no flag as an unmarked batch", () => {
    expect(unwrap(parseConsoleInstance({ hasOrigin: true, instance: undefined }))).toBe(undefined);
  });

  it("reads exactly e2e beside the origin group", () => {
    expect(unwrap(parseConsoleInstance({ hasOrigin: true, instance: "e2e" }))).toBe("e2e");
  });

  it("refuses any other value", () => {
    expect(unwrapErr(parseConsoleInstance({ hasOrigin: true, instance: "E2E" }))).toEqual(
      ConsoleInstanceErrors.unknown({ instance: "E2E" }),
    );
  });

  it("refuses the marker as a substitute for the server's own origin", () => {
    const refused = unwrapErr(parseConsoleInstance({ hasOrigin: false, instance: "e2e" }));
    expect(refused.code).toBe("CONSOLE_INSTANCE_WITHOUT_ORIGIN");
    expect(refused.message).toBe(
      "--console-instance is passed only beside --console-root, --console-port and --console-default-port: it marks a batch a console server placed",
    );
  });
});

describe("--console-instance on the talk verbs", () => {
  const group = ["--console-root", "/w/main", "--console-port", "3000", "--console-default-port", "3000"];
  const transcript = ["--call", "c", "--entries-file", "/b.jsonl"];

  it("marks a transcript's console origin", () => {
    const parsed = parseTranscriptArgs({ rest: [...transcript, ...group, "--console-instance", "e2e"] });
    expect(unwrap(parsed).consoleOrigin).toEqual({
      checkoutRoot: "/w/main",
      defaultPort: 3000,
      instance: "e2e",
      port: 3000,
    });
  });

  it("leaves a transcript with no marker unmarked", () => {
    expect(unwrap(parseTranscriptArgs({ rest: [...transcript, ...group] })).consoleOrigin).toEqual({
      checkoutRoot: "/w/main",
      defaultPort: 3000,
      port: 3000,
    });
  });

  it("refuses the marker on a transcript with no origin group", () => {
    expect(unwrapErr(parseTranscriptArgs({ rest: [...transcript, "--console-instance", "e2e"] }))).toEqual([
      "--console-instance is passed only beside --console-root, --console-port and --console-default-port: it marks a batch a console server placed",
    ]);
  });

  it("is no flag of talk relay's, which a test instance never reaches", () => {
    const parsed = parseRelayArgs({ rest: ["--turn", "t", ...group, "--console-instance", "e2e"] });
    expect(unwrapErr(parsed).some((problem) => problem.includes("--console-instance"))).toBe(true);
  });
});
