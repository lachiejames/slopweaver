/**
 * The hint `handover register` prints for an ask a session registered by hand with no anchor: printed to the session
 * that can act on it, never to an automation registering through the same seam, and never for a row that already
 * names where it came from.
 *
 * Per `testing.md`, every write goes to a `home` this file minted — never the ambient one.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerAskRow } from "../../../../../cli/commands/handover/askRowRun.js";
import { registerWordsHint } from "../../../../../cli/commands/handover/registerWords.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";

const HINT =
  "  no anchor, so its card names no words of the owner's — if they said this: slopweaver profile words --phrase \"<a few " +
  "of the owner's words>\" --since 1d, then slopweaver handover quote a-row --anchor <anchor> --apply";

describe("registerWordsHint", () => {
  const bare = { anchor: undefined, dispatch: false, finding: false, origin: "command", slug: "a-row" } as const;

  it("tells a session typing the verb how to tie an unanchored ask to the owner's words", () => {
    expect(registerWordsHint(bare)).toBe(HINT);
  });

  it("says nothing to an automation, nor for an anchored row, a finding or a dispatch", () => {
    expect([
      registerWordsHint({ ...bare, origin: "automation" }),
      registerWordsHint({ ...bare, anchor: "https://example.slack.com/archives/C1/p1" }),
      registerWordsHint({ ...bare, finding: true }),
      registerWordsHint({ ...bare, dispatch: true }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("handover register's receipt", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "register-words-"));
    mkdirSync(join(home, "handovers"), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const argv = (): readonly string[] => [
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    "Should a session ask Rosa about the queued jobs?",
    "--problem",
    "jobs sit queued",
    "--options",
    "ask Rosa :: one message\nkeep pulling :: hours",
    "--lean",
    "ask Rosa",
    "--risk",
    "merges stay blocked",
    "--blast-radius",
    "every merge",
    "--still-real",
    "the run is still queued",
    "--example-gap",
    "a fixture row, with no scene behind it",
    "--slug",
    "a-row",
    "--asked-iso",
    "2026-10-04T09:00:00.000Z",
    "--home",
    home,
  ];

  /** Register through the seam, collecting the receipt. */
  async function register({ origin }: { origin: "command" | "automation" }): Promise<readonly string[]> {
    const lines: string[] = [];
    const code = await registerAskRow({
      argv: argv(),
      origin,
      out: ({ line }) => {
        lines.push(line);
      },
    });
    expect(code).toBe(EXIT_OK);
    return lines;
  }

  it("carries the hint when a session typed it", async () => {
    expect(await register({ origin: "command" })).toContain(HINT);
  });

  it("carries no hint when another verb registered through it", async () => {
    expect((await register({ origin: "automation" })).filter((line) => line.includes("profile words"))).toEqual([]);
  });
});
