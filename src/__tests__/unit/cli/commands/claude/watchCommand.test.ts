import { describe, expect, it } from "vitest";

import { claudeWatchCommand } from "../../../../../cli/commands/claude/watch.js";
import { parseClaudeWatchArgs } from "../../../../../cli/commands/claude/watchArgs.js";
import { claudeManifest } from "../../../../../cli/manifests/claude.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** What a bare `claude watch` asks for. */
const DEFAULTS = { dryRun: false, intervalMinutes: 5, once: false, wait: false, wantsJson: false };

describe("claudeWatchCommand", () => {
  it("takes the one argv parameter the CLI verb contract dispatches with", () => {
    expect(claudeWatchCommand.length).toBe(1);
  });
});

describe("parseClaudeWatchArgs", () => {
  it("defaults to a five-minute standing loop", () => {
    expect(unwrap(parseClaudeWatchArgs({ rest: [] }))).toStrictEqual(DEFAULTS);
  });

  it("reads every switch it advertises", () => {
    expect(unwrap(parseClaudeWatchArgs({ rest: ["--once", "--json", "--wait"] }))).toStrictEqual({
      ...DEFAULTS,
      once: true,
      wait: true,
      wantsJson: true,
    });
    expect(unwrap(parseClaudeWatchArgs({ rest: ["--dry-run"] }))).toStrictEqual({ ...DEFAULTS, dryRun: true });
  });

  it("accepts both interval spellings at both bounds", () => {
    expect(unwrap(parseClaudeWatchArgs({ rest: ["--interval", "1"] })).intervalMinutes).toBe(1);
    expect(unwrap(parseClaudeWatchArgs({ rest: ["--interval=60"] })).intervalMinutes).toBe(60);
  });

  it("refuses an interval outside 1..60, or one that is not a whole number", () => {
    expect(unwrapErr(parseClaudeWatchArgs({ rest: ["--interval", "61"] }))).toStrictEqual([
      "--interval must be between 1 and 60 minutes",
    ]);
    expect(unwrapErr(parseClaudeWatchArgs({ rest: ["--interval", "0"] }))).toStrictEqual([
      "--interval must be a positive integer",
    ]);
    expect(unwrapErr(parseClaudeWatchArgs({ rest: ["--interval", "1.5"] }))).toStrictEqual([
      "--interval must be a positive integer",
    ]);
  });

  it("refuses an interval with no value", () => {
    expect(unwrapErr(parseClaudeWatchArgs({ rest: ["--interval"] }))).toStrictEqual(["--interval requires a value"]);
  });

  // The duplicate: the hand-rolled parser IGNORED a mistyped flag and started a second full
  // watch beside the running one. A flag this verb does not know is now refused before anything runs.
  it("refuses a flag it does not know, rather than starting a watch that ignores it", () => {
    expect(unwrapErr(parseClaudeWatchArgs({ rest: ["--not-a-flag"] }))).toStrictEqual(["unknown flag: --not-a-flag"]);
  });

  it("refuses --wait with --dry-run, since a dry run writes nothing and so has no turn to wait for", () => {
    expect(unwrapErr(parseClaudeWatchArgs({ rest: ["--wait", "--dry-run"] }))).toStrictEqual([
      "--wait cannot be combined with --dry-run: a dry run writes nothing, so there is no turn to wait for",
    ]);
  });

  it("allows --wait with --once: wait for admission, then perform one real tick", () => {
    expect(unwrap(parseClaudeWatchArgs({ rest: ["--wait", "--once"] }))).toStrictEqual({
      ...DEFAULTS,
      once: true,
      wait: true,
    });
  });
});

describe("the watch verb's manifest entry", () => {
  // It refreshes each non-active store in place AND, unless --dry-run is passed, performs the rotation a
  // tick chooses — `manifests/claude.ts` says so because this test's own name once denied it.
  it("declares a local-state effect, because it writes credentials: store refreshes and, by default, rotations", () => {
    expect(claudeManifest["watch"]?.meta.effect).toBe("local-state");
  });

  it("advertises --wait, and boots with it, so a start beside a running watch queues rather than duplicates", () => {
    expect(claudeManifest["watch"]?.meta.usage).toBe(
      "usage: slopweaver claude watch [--interval <1..60>] [--once] [--dry-run] [--json] [--wait]",
    );
    expect(claudeManifest["watch"]?.meta.example).toBe("slopweaver claude watch --wait");
  });

  it("routes nothing through the door — its writes are local credential stores, not a provider", () => {
    expect(claudeManifest["watch"]?.meta.doorRouted).toBe(false);
  });
});

describe("parseClaudeWatchArgs — one interval rule, shared with the process-table classifier", () => {
  // `Number("1e0")` is 1, so the parser accepted a watch the classifier refused,
  // and that running watch read NOT running. Both now apply `acceptedWatchInterval`.
  it.each(["1e0", "0x5", "5.0", " 5", "+5"])("refuses --interval %s, which the classifier would also refuse", (raw) => {
    expect(unwrapErr(parseClaudeWatchArgs({ rest: ["--interval", raw] }))).toStrictEqual([
      "--interval must be a positive integer",
    ]);
  });
});
