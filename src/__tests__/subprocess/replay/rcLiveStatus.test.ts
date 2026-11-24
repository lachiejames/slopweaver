/**
 * REPLAY LANE — the `/rc` live-status incident, re-run against the SHIPPED binary and the
 * SHIPPED pure decision function.
 *
 * The fixture (`fixtures/replay/rc-live-status`) is the real ask this was measured on — `D0SYN000001/
 * 1787993553.285869`, `workspace:548` in the doc — frozen through its `dispatched` event: the exact
 * machine state while the worker was mid-investigation and the card's live in-flight line was live-scraping
 * that workspace's screen.
 *
 * Two halves, because the defect itself lives ABOVE the cmux boundary this lane deliberately never fakes
 * (`../replayFixture.ts`'s own doctrine — no fixture-aware code in `src/`, and a replay's cmux is always
 * UNREACHABLE, the hard case a broken oracle must not be read as a dead worker):
 *
 * 1. The real CLI, over the real frozen ask, proves the machine-state half never regressed — the sweep still
 *    reports this ask as running rather than losing it.
 * 2. The real PURE function (`liveChecklistUpdatePlan`), fed the ask's own real `lastEvent.tsIso` from that
 *    same frozen state plus the exact screen measured live off `workspace:548` (quoted verbatim in the
 *    handover doc), proves the actual incident — the screen scrape returning the literal string `/rc` — is
 *    fixed for the real ask it happened to, not just a synthetic one.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { liveChecklistUpdatePlan } from "../../../cli/commands/turn/sweepCard.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { liveLineOf } from "../../../live/turn/progressCard.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "rc-live-status";

/** The exact screen measured live off `workspace:548`, quoted verbatim in the handover doc. */
const MEASURED_SCREEN = [
  "✢ Moonwalking… (5m 12s · ↓ 7.5k tokens · thinking more with high effort)",
  "❯\xa0",
  "─".repeat(83),
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← 3 agents",
  `${" ".repeat(78)}/rc`,
].join("\n");

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-rc-live-status-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment that carries none of
 * this machine's real config.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(BIN, args, {
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
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

describe("replay: rc-live-status", () => {
  it("sweeps the frozen in-flight ask as still working", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `still working: ${manifest.ask.channel}/${manifest.ask.messageTs} — worker ask-${manifest.ask.channel}-${manifest.ask.messageTs} (workspace:548)`,
    );
  });

  it("reads through the slash-command hint to the real work above it, for this ask's own real lastEvent", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const { events } = parseAskLifecycleLog({
      text: readFileSync(join(home, "live/slack/asks.jsonl"), "utf8"),
    });
    const entry = foldAskLifecycle({ events }).get(JSON.stringify([manifest.ask.channel, manifest.ask.messageTs]))!;

    const plan = liveChecklistUpdatePlan({
      entry,
      nowIso: manifest.replayNowIso,
      question: "what are my open PRs?",
      screen: MEASURED_SCREEN,
      timeline: [],
    });

    const liveLine = liveLineOf({ steps: plan!.steps });
    expect(liveLine).toBe("✢ Moonwalking… (5m 12s · ↓ 7.5k tokens · thinking more with high effort)");
    expect(liveLine).not.toBe("/rc");
  });

  it("froze through dispatched, withholding the answer this ask went on to compose", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    expect(manifest.through).toBe("dispatched");
    expect(manifest.withheldEventKinds).toEqual(["answered"]);
  });
});
