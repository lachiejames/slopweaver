/** How `github checks` reads its argv tail: defaults, every flag, and each combination it refuses. */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { parseGithubChecksArgs } from "../../../../../../cli/commands/github/checksCore.js";

describe("parseGithubChecksArgs", () => {
  it("requires --number and defaults every other flag", () => {
    expect(unwrap(parseGithubChecksArgs({ rest: ["--number", "9"] }))).toEqual({
      home: undefined,
      json: false,
      limit: 100,
      lines: 40,
      log: false,
      number: 9,
      repo: undefined,
      since: undefined,
      timeoutSeconds: 1200,
      until: undefined,
      wait: false,
    });
  });

  it("parses every flag when given", () => {
    expect(
      unwrap(
        parseGithubChecksArgs({
          rest: [
            "--number",
            "9",
            "--repo",
            "acme/widget",
            "--wait",
            "--timeout-seconds",
            "60",
            "--limit",
            "10",
            "--json",
            "--home",
            "/h",
          ],
        }),
      ),
    ).toEqual({
      home: "/h",
      json: true,
      limit: 10,
      lines: 40,
      log: false,
      number: 9,
      repo: "acme/widget",
      since: undefined,
      timeoutSeconds: 60,
      until: undefined,
      wait: true,
    });
  });

  it("parses the log read and its own window", () => {
    const args = unwrap(parseGithubChecksArgs({ rest: ["--number", "9", "--log", "--lines", "120"] }));

    expect(args.log).toBe(true);
    expect(args.lines).toBe(120);
  });

  it("refuses --lines above the measured ceiling rather than clamping it", () => {
    expect(unwrapErr(parseGithubChecksArgs({ rest: ["--number", "9", "--log", "--lines", "2001"] }))).toEqual([
      "--lines must be an integer from 0 to 2000",
    ]);
  });

  it("refuses --lines with no --log, which would silently do nothing", () => {
    expect(unwrapErr(parseGithubChecksArgs({ rest: ["--number", "9", "--lines", "10"] }))).toEqual([
      "--lines only means something with --log",
    ]);
  });

  it("refuses --log with --wait, because a log read is one shot over a settled head", () => {
    expect(unwrapErr(parseGithubChecksArgs({ rest: ["--number", "9", "--log", "--wait"] }))).toEqual([
      "--log is a one-shot read and cannot be combined with --wait or --until",
    ]);
  });

  it("refuses --log with --until for the same reason", () => {
    expect(unwrapErr(parseGithubChecksArgs({ rest: ["--number", "9", "--log", "--until", "ci"] }))).toEqual([
      "--log is a one-shot read and cannot be combined with --wait or --until",
    ]);
  });

  it("refuses a missing --number", () => {
    expect(unwrapErr(parseGithubChecksArgs({ rest: [] }))).toEqual(["--number must be a positive whole number"]);
  });

  it("refuses a non-positive --number", () => {
    expect(unwrapErr(parseGithubChecksArgs({ rest: ["--number", "0"] }))).toEqual([
      "--number must be a positive whole number",
    ]);
  });

  it("refuses a limit outside 1..100", () => {
    expect(unwrapErr(parseGithubChecksArgs({ rest: ["--number", "9", "--limit", "101"] }))).toEqual([
      "--limit must be an integer from 1 to 100",
    ]);
  });

  it("refuses a non-positive --timeout-seconds", () => {
    expect(unwrapErr(parseGithubChecksArgs({ rest: ["--number", "9", "--timeout-seconds", "0"] }))).toEqual([
      "--timeout-seconds must be a positive whole number",
    ]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(unwrapErr(parseGithubChecksArgs({ rest: ["--number", "9", "--kind"] }))).toEqual(["unknown flag: --kind"]);
  });
});

describe("parseGithubChecksArgs — --until and --since", () => {
  it("accepts each mode, implies --wait, and carries the cursor", () => {
    const parsed = unwrap(
      parseGithubChecksArgs({ rest: ["--number", "9", "--until", "review", "--since", "2026-09-03T00:00:00Z"] }),
    );
    expect(parsed.until).toBe("review");
    expect(parsed.since).toBe("2026-09-03T00:00:00Z");
    expect(parsed.wait).toBe(true);
    for (const mode of ["ci", "any", "merge"]) {
      expect(unwrap(parseGithubChecksArgs({ rest: ["--number", "9", "--until", mode] })).until).toBe(mode);
    }
  });

  it("refuses an unknown mode, a non-Z cursor, and a cursor without a mode", () => {
    expect(unwrapErr(parseGithubChecksArgs({ rest: ["--number", "9", "--until", "forever"] }))).toEqual([
      "--until must be one of ci, review, any, merge",
    ]);
    expect(
      unwrapErr(
        parseGithubChecksArgs({ rest: ["--number", "9", "--until", "any", "--since", "2026-09-03T10:00:00+10:00"] }),
      ),
    ).toEqual(["--since must be a UTC ISO-8601 instant ending in Z, e.g. 2026-09-03T01:30:00Z"]);
    expect(unwrapErr(parseGithubChecksArgs({ rest: ["--number", "9", "--since", "2026-09-03T00:00:00Z"] }))).toEqual([
      "--since only means something with --until",
    ]);
  });
});
