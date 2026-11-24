/**
 * REPLAY LANE — the inline turn whose card never moved, re-run against the SHIPPED binary.
 *
 * The owner replied "yo" under the bot's own digest. The loop routed it `inline` and the answer landed two
 * independent-review rounds later — and for all fifty minutes the card
 * sat on its capture-time placeholder, because nothing on the inline path ever wrote it: no stage, no ticker,
 * and a sweep push that reads a fresh session's dispatch record an inline turn never has. Midway the owner read
 * the unmoved card as a failure.
 *
 * The fixture (`fixtures/replay/inline-turn-silent-card-19sep`) is that ask frozen `--through dispatched`
 * with the clock stopped at the instant the owner looked. Two witnesses, each falsifiable against the
 * code that shipped the incident:
 *
 * - **The handoff asks for the ticker.** `turn dispatch` re-run over the frozen decision prints the
 *   `turn watch` line, and prints it BEFORE the compose line. Before the fix that line was absent.
 * - **The ticker's card says how long the owner has waited.** `tickNowLine` over this home, at the frozen clock, with the
 *   empty activity an inline turn with no stage always reads, is `now: still working, 22m`. Before the fix it
 *   was the constant `now: still working — 0 tool calls so far`, which says nothing a reader can use.
 *
 * `responders.json` is excluded from every freeze (it is an identity allowlist), so this home is given one
 * naming the asker; the decision is the frozen `dispatched` row's own, whose `needs` is empty, so no
 * capability id needs remapping.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { tickNowLine } from "../../../cli/commands/turn/watchNowLine.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "inline-turn-silent-card-19sep";

let workspace: string;
let home: string;
let briefPath: string;
let decisionPath: string;
let manifest: ReturnType<typeof materialiseFixture>;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-inline-card-"));
  home = join(workspace, "home");
  manifest = materialiseFixture({ into: home, slug: SLUG });
  const { ask } = manifest;
  briefPath = join(home, "briefs", `${ask.channel}-${ask.messageTs}.json`);
  decisionPath = join(workspace, "decision.json");
  writeFileSync(join(home, "responders.json"), JSON.stringify([ask.askedBy]), "utf8");
  const dispatched = readFileSync(join(home, "live", "slack", "asks.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { kind: string; decision?: unknown })
    .find((event) => event.kind === "dispatched")!;
  writeFileSync(decisionPath, JSON.stringify(dispatched.decision), "utf8");
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment carrying none of this
 * machine's real config: `HOME` is the throwaway directory, so no bot token and no cmux daemon is reachable.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, [...args], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"),
      HOME: workspace,
      PATH: process.env["PATH"]!,
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  return { status: result.status!, stderr: result.stderr, stdout: result.stdout };
}

describe("replay: inline-turn-silent-card-19sep", () => {
  it("the inline handoff starts the card's ticker before it asks for an answer", { timeout: 60_000 }, () => {
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--home", home, "--brief", briefPath, "--decision", decisionPath],
    });

    expect(result.status).toBe(0);
    // The positive witness that the dispatch reached the tier at all, on the card this ask really had.
    expect(result.stdout).toContain("live progress card already on the brief — ts 1789788130.088049");
    const lines = result.stdout.split("\n");
    const ticker = lines.findIndex((line) => line.endsWith(`turn watch --brief ${briefPath} --home ${home} &`));
    const compose = lines.findIndex((line) => line.startsWith("inline — compose the answer now"));
    expect(lines[ticker]).toBe(`  "${BIN}" turn watch --brief ${briefPath} --home ${home} &`);
    expect(compose).toBeGreaterThan(ticker);
  });

  it("the ticker's card says how long the owner had waited when they looked", () => {
    const line = tickNowLine({
      activity: { callsSoFar: 0, latest: undefined },
      askIdentity: manifest.ask,
      home,
      nowIso: manifest.replayNowIso,
    });

    expect(manifest.replayNowIso).toBe("2026-09-19T03:45:00.000Z");
    expect(line).toBe("now: still working, 22m");
  });
});
