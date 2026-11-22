/**
 * `handover register`'s card-alignment gate, run through the SHIPPED binary over a throwaway home.
 *
 * Both cases are a review's counterexamples, each reproduced end to end before the fix. A multi-line
 * `--ask` passed the gate while the card read it as one sentence ending in `.`, because the summary is a
 * flat scalar and its newline reached the card as a literal `\n` the card's sentence split never breaks on.
 * And a `--finding` row carrying a whole shape waited on the owner's word with a statement for its title, because
 * the gate judged only rows with no `--finding`. The owner could not tell what such a card was asking.
 *
 * The environment is an allowlist so no inherited `SLOPWEAVER_ALLOW_UNALIGNED_CARD` can make a refusal green,
 * and `SLOPWEAVER_CLI_DIR` pins the binary to this checkout.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home with the directory the board lives in. */
function throwawayHome(): string {
  const home = mkdtempSync(join(tmpdir(), "register-align-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"));
  return home;
}

/** A whole ask shape, every field inside its cap. */
const SHAPE = [
  "--problem",
  "The finding was switched off with no assessment behind it.",
  "--options",
  "Switch it back on :: it counts as open until the fix merges\nLeave it off :: an auditor finds no reason",
  "--lean",
  "Switch it back on",
  "--risk",
  "An auditor samples it",
  "--blast-radius",
  "One Vanta finding",
  "--still-real",
  "Read from Vanta today",
  "--example",
  "You open Vanta and find the control switched off with no reason recorded. Should it go back on?",
] as const;

function register({ home, args }: { home: string; args: readonly string[] }): { status: number; stderr: string } {
  const result = spawnSync(BIN, ["handover", "register", ...args, "--home", home], {
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_CLI_DIR: repoRoot,
      TMPDIR: process.env["TMPDIR"]!,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === null) {
    throw new Error(`bin/slopweaver was signalled rather than exiting: ${String(result.signal)}`);
  }
  return { status: result.status, stderr: result.stderr };
}

describe("handover register — the ask the card is headed by", () => {
  it("writes a multi-line question as one line, so the card splits the sentences the gate judged", () => {
    const home = throwawayHome();
    const registered = register({
      args: ["--ask", "Should the fleet switch the finding back on?\nIt is critical.", "--slug", "multiline", ...SHAPE],
      home,
    });
    expect(registered.status).toBe(0);

    const text = readFileSync(join(home, "handovers", "multiline.md"), "utf8");
    expect(text).toContain('summary: "Should the fleet switch the finding back on? It is critical."\n');
    expect(text).not.toContain("\\n");
  });

  it("refuses a multi-line ask whose question sits past the card's two lead sentences", () => {
    const home = throwawayHome();
    const refused = register({
      args: ["--ask", "First statement.\nSecond statement.\nShould we ship it?", "--slug", "late-question", ...SHAPE],
      home,
    });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('neither of its first 2 sentences ends in "?"');
    expect(readdirSync(join(home, "handovers"))).toEqual([]);
  });

  it("refuses a shaped --finding row headed by a statement, since it waits on the owner's word too", () => {
    const home = throwawayHome();
    const refused = register({
      args: [
        "--ask",
        "The staging pool is exhausted and nothing alerts on it.",
        "--finding",
        "--evidence",
        "acme/widgets#1234",
        "--observed-by",
        "session-test",
        "--slug",
        "shaped-finding",
        ...SHAPE,
      ],
      home,
    });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("slopweaver handover register blocked because");
    expect(readdirSync(join(home, "handovers"))).toEqual([]);
  });

  it("still records an unshaped --finding row headed by a statement, which asks the owner nothing", () => {
    const home = throwawayHome();
    const registered = register({
      args: [
        "--ask",
        "The staging pool is exhausted and nothing alerts on it.",
        "--finding",
        "--evidence",
        "acme/widgets#1234",
        "--observed-by",
        "session-test",
        "--slug",
        "plain-finding",
      ],
      home,
    });
    expect(registered.status).toBe(0);
    expect(readdirSync(join(home, "handovers"))).toEqual(["plain-finding.md"]);
  });
});
