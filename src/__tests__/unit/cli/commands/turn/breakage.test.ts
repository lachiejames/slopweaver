/**
 * `turn breakage` — the verb that replaced the loop skills' `printf >>`: a complete row is written once, and a
 * row with no cause, or any other blank field, exits 2 and writes nothing.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseTurnBreakageArgs, runTurnBreakage } from "../../../../../cli/commands/turn/breakage.js";
import { TURN_BREAKAGE_USAGE } from "../../../../../cli/commands/turn/breakageUsage.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { turnManifest } from "../../../../../cli/manifests/turn.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "turn-breakage-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const NOW = (): Date => new Date("2026-10-23T01:00:00.000Z");

const ledgerPath = (): string => join(home, "ledgers", "loop-breakage.jsonl");

/** A complete argv tail, with any flag's value replaced by `over`. */
function argvWith({ over = {} }: { over?: Readonly<Record<string, string>> } = {}): string[] {
  const values: Record<string, string> = {
    cause: "the flag keeps only its last value, so two later messages cannot both be accounted for",
    "did-instead": "answered the newest message first",
    error: "the thread moved since this answer was composed",
    thread: "C123/1712345678.000100",
    what: "turn answer --accounted-for-ts with two later messages",
    ...over,
  };
  return [...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]), "--home", home];
}

describe("runTurnBreakage", () => {
  it("writes one exact cause-bearing row, stamped by the injected clock", () => {
    expect(runTurnBreakage({ now: NOW, rest: argvWith() })).toBe(EXIT_OK);
    expect(JSON.parse(readFileSync(ledgerPath(), "utf8"))).toStrictEqual({
      at: "2026-10-23T01:00:00.000Z",
      cause: "the flag keeps only its last value, so two later messages cannot both be accounted for",
      didInstead: "answered the newest message first",
      error: "the thread moved since this answer was composed",
      thread: "C123/1712345678.000100",
      what: "turn answer --accounted-for-ts with two later messages",
    });
  });

  it("exits 2 and writes nothing when --cause is absent", () => {
    const rest = argvWith();
    const at = rest.indexOf("--cause");
    rest.splice(at, 2);
    expect(runTurnBreakage({ now: NOW, rest })).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "ledgers"))).toBe(false);
  });

  it("exits 2 and writes nothing when --cause is blank", () => {
    expect(runTurnBreakage({ now: NOW, rest: argvWith({ over: { cause: "   " } }) })).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "ledgers"))).toBe(false);
  });

  it("exits 2 and writes nothing when another field is blank", () => {
    expect(runTurnBreakage({ now: NOW, rest: argvWith({ over: { "did-instead": "" } }) })).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "ledgers"))).toBe(false);
  });

  it("is idempotent: the same thread and step twice is one row and exit 0", () => {
    expect(runTurnBreakage({ now: NOW, rest: argvWith() })).toBe(EXIT_OK);
    expect(runTurnBreakage({ now: NOW, rest: argvWith() })).toBe(EXIT_OK);
    expect(readFileSync(ledgerPath(), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("prints usage and exits 0 on --help, writing nothing", () => {
    expect(runTurnBreakage({ now: NOW, rest: ["--help", "--home", home] })).toBe(EXIT_OK);
    expect(existsSync(join(home, "ledgers"))).toBe(false);
  });

  it("exits 2 and writes nothing when --home is blank, rather than writing relative to the working directory", () => {
    const rest = [...argvWith().slice(0, -2), "--home", ""];
    expect(runTurnBreakage({ now: NOW, rest })).toBe(EXIT_USAGE);
    expect(existsSync(join(process.cwd(), "ledgers", "loop-breakage.jsonl"))).toBe(false);
  });

  it("prints the class table and exits 0 on --classes, writing nothing even with every field given", () => {
    expect(runTurnBreakage({ now: NOW, rest: [...argvWith(), "--classes"] })).toBe(EXIT_OK);
    expect(existsSync(join(home, "ledgers"))).toBe(false);
  });
});

describe("parseTurnBreakageArgs", () => {
  it("accepts every declared flag, keeping each value as given", () => {
    const values = unwrap(parseTurnBreakageArgs({ rest: argvWith() })).values;
    expect(values["cause"]).toBe(
      "the flag keeps only its last value, so two later messages cannot both be accounted for",
    );
    expect(values["did-instead"]).toBe("answered the newest message first");
    expect(values["home"]).toBe(home);
  });

  it("refuses an unknown flag, naming it", () => {
    expect(unwrapErr(parseTurnBreakageArgs({ rest: ["--turn", "run-1"] })).join("\n")).toContain("--turn");
  });
});

describe("the manifest row", () => {
  it("is a local-state write with no door, quoting the verb's own usage", () => {
    const entry = turnManifest["breakage"]!;
    expect(entry.meta.effect).toBe("local-state");
    expect(entry.meta.doorRouted).toBe(false);
    expect(entry.meta.createsWorkItem).toBe(false);
    expect(entry.meta.usage).toBe(TURN_BREAKAGE_USAGE);
  });
});
