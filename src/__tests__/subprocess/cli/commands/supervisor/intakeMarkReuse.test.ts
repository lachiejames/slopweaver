/**
 * `supervisor intake-mark` against the shipped binary: one free-text witness marks three turns and is refused on
 * the fourth with the registered four-line refusal, the refused mark is never written, a row slug is never refused,
 * and the named hatch lets the fourth through. The incident this holds down is `../../../../../supervisor/intakeWitness.ts`'s.
 * And a pointer naming the chair's own reply rather than the owner's turn is refused before anything is written —
 * `../../../../../supervisor/intake.ts`'s `markTargetRefusal`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SESSION = "a0000036-0000-4000-8000-000000000039";
const BULK = "loop report from live-bot-loop-21sep-c-a4, acted on at the tick it arrived";

/** The turn uuid for a one-hex-digit suffix. */
const uuidOf = ({ n }: { n: number }): string => `039e15e9-6f1d-4a9e-881f-98e74bbf7d0${n.toString(16)}`;

/** The turn pointer for a one-hex-digit suffix. */
const at = ({ n }: { n: number }): string => `transcript:${SESSION}#${uuidOf({ n })}`;

/** The suffix of the chair's own assistant record, which no mark may name. */
const ASSISTANT = 15;

let workspace: string;
let home: string;
let claudeConfig: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "intake-mark-reuse-"));
  home = join(workspace, "home");
  mkdirSync(join(home, "handovers"), { recursive: true });
  // A `~/.claude` of the test's own, so the verb reads this transcript and never the operator's real one: turns 1–5
  // are the owner's, typed, so a witness routing one to a row carries readable words onto it; the last record is the chair's reply.
  claudeConfig = join(workspace, "claude");
  const project = join(claudeConfig, "projects", "-repo");
  mkdirSync(project, { recursive: true });
  const turns = [1, 2, 3, 4, 5].map((n) =>
    JSON.stringify({
      message: { content: [{ text: `steer ${String(n)}`, type: "text" }], role: "user" },
      promptSource: "typed",
      timestamp: `2026-09-22T12:0${String(n)}:00.000Z`,
      type: "user",
      uuid: uuidOf({ n }),
    }),
  );
  const reply = JSON.stringify({
    message: { content: "on it", role: "assistant" },
    timestamp: "2026-09-22T12:06:00.000Z",
    type: "assistant",
    uuid: uuidOf({ n: ASSISTANT }),
  });
  writeFileSync(join(project, `${SESSION}.jsonl`), `${[...turns, reply].join("\n")}\n`);
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run `supervisor intake-mark` against the temp home. The hatch variable is set only when asked and removed
 * otherwise, so a refusal proves the gate fires rather than the variable leaking in from this machine's shell.
 */
function mark({ n, witness, allow = false }: { n: number; witness: string; allow?: boolean }): {
  status: number | null;
  stderr: string;
} {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: claudeConfig,
    CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"),
    SLOPWEAVER_ALLOW_INTAKE_WITNESS_REUSE: undefined,
  };
  if (allow) {
    env["SLOPWEAVER_ALLOW_INTAKE_WITNESS_REUSE"] = "1";
  }
  const run = spawnSync(
    BIN,
    ["supervisor", "intake-mark", "--turn", at({ n }), "--as", "answered", "--witness", witness, "--home", home],
    { cwd: workspace, encoding: "utf8", env },
  );
  return { status: run.status, stderr: run.stderr };
}

/** The witnesses the ledger holds, in file order; none when no mark was ever written. */
function ledgerWitnesses(): readonly string[] {
  const ledger = join(home, "sessions", "intake-marks.jsonl");
  if (!existsSync(ledger)) {
    return [];
  }
  return readFileSync(ledger, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { witness: string }).witness);
}

describe("supervisor intake-mark witness reuse", () => {
  it("refuses the fourth turn one free-text witness would mark, and writes nothing for it", () => {
    expect([1, 2, 3].map((n) => mark({ n, witness: BULK }).status)).toEqual([0, 0, 0]);

    const refused = mark({ n: 4, witness: BULK });

    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("slopweaver supervisor intake-mark blocked because the same free-text witness");
    expect(refused.stderr).toContain(
      `already marks 3 other turn(s): ${at({ n: 1 })}, ${at({ n: 2 })}, ${at({ n: 3 })}`,
    );
    expect(refused.stderr).toContain("SLOPWEAVER_ALLOW_INTAKE_WITNESS_REUSE=1 slopweaver supervisor intake-mark");
    expect(ledgerWitnesses()).toEqual([BULK, BULK, BULK]);
  });

  it("never refuses a witness that is a row on the board", () => {
    writeFileSync(
      join(home, "handovers", "the-ask.md"),
      "---\nslug: the-ask\nkind: ask\nsummary: x\nstatus: ready\naskedIso: 2026-09-22T12:00:00.000Z\n---\n\n# x\n",
    );

    expect([1, 2, 3, 4, 5].map((n) => mark({ n, witness: "the-ask" }).status)).toEqual([0, 0, 0, 0, 0]);
  });

  it("lets the fourth through under the named hatch", () => {
    [1, 2, 3].forEach((n) => mark({ n, witness: BULK }));

    expect(mark({ allow: true, n: 4, witness: BULK }).status).toBe(0);
    expect(ledgerWitnesses()).toEqual([BULK, BULK, BULK, BULK]);
  });
});

describe("supervisor intake-mark on a record that is not the owner's turn", () => {
  it("refuses the chair's own assistant record and writes nothing — the handoff-9293 mark that witnessed nothing", () => {
    const refused = mark({ n: ASSISTANT, witness: "relayed to workspace:414" });

    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain(`${at({ n: ASSISTANT })} names neither one of the owner's turns`);
    expect(ledgerWitnesses()).toEqual([]);
  });
});
