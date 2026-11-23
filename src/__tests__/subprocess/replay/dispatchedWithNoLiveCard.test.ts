/**
 * REPLAY LANE — the card-less public dispatch, re-run against the SHIPPED binary.
 *
 * The incident, in the owner's words on their own public #dev-alerts ask: _"now I've got some eyes emojis on
 * this public one, but where's the live progress card? … This should not be structurally possible."_ Worker
 * `workspace:152` had reacted and run subagents for seventeen minutes with nothing standing in the thread.
 *
 * The fixture (`fixtures/replay/dispatched-with-no-live-card-21sep`) is that ask's whole record set frozen
 * `--through captured`, which is the precise state the defect fired FROM: one `captured` row, no
 * `checklist-posted` between it and the `dispatched` the old code went on to write, a brief carrying no
 * `started` ref, and the durable dispatch record the old code left behind. Frozen whole it would carry the
 * bad `dispatched` event itself, and replaying that would prove only that the reader can read one.
 *
 * **The falsifiable witness, and why there are two runs.** The gate's own refusal
 * (`cli/commands/turn/ensureCard.ts`) is a line printed when, and only when, a dispatch reached the card
 * check and could not satisfy it — so its presence is evidence the gate ran rather than that something else
 * failed first. The control run differs in ONE byte of state, a `started` ref on the brief, and must print
 * the opposite positive witness, `live progress card already on the brief — ts …`: without it, a refusal
 * would be indistinguishable from a verb that refuses everything this fixture hands it.
 *
 * **Two things this home is given that the fixture does not carry**, both upstream of the gate and neither
 * part of what is under test. `responders.json` is excluded from every freeze (it is an identity allowlist),
 * and the frozen decision's `needs` name capability ids the freeze redacted into synthetics, so they are
 * remapped onto the brief's own — the admission checks are `turn dispatch`'s other gates, tested elsewhere,
 * and a replay that could not get past them would never reach the one it exists to prove.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "dispatched-with-no-live-card-21sep";

/** The card a control run puts on the brief — any ref at all, which is the whole point of the contrast. */
const CONTROL_CARD = { turnId: "turn-control-1789952400000", workingTs: "1789952400.000100" } as const;

let workspace: string;
let home: string;
let briefPath: string;
let decisionPath: string;
let ask: { channel: string; messageTs: string; threadTs: string; askedBy: string };

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-no-card-"));
  home = join(workspace, "home");
  const manifest = materialiseFixture({ into: home, slug: SLUG });
  ask = manifest.ask;
  briefPath = join(home, "briefs", `${ask.channel}-${ask.messageTs}.json`);
  decisionPath = join(workspace, "decision.json");
  writeFileSync(join(home, "responders.json"), JSON.stringify([ask.askedBy]), "utf8");

  const brief = JSON.parse(readFileSync(briefPath, "utf8")) as {
    routingInput: { availableCapabilities: readonly { id: string }[] };
  };
  const record = JSON.parse(
    readFileSync(join(home, "live", "slack", "dispatches", `${ask.channel}-${ask.messageTs}.json`), "utf8"),
  ) as { decision: { needs: { capabilityId: string }[] } };
  const offered = brief.routingInput.availableCapabilities;
  record.decision.needs = record.decision.needs.map((need, index) => ({
    ...need,
    capabilityId: offered[index]!.id,
  }));
  writeFileSync(decisionPath, JSON.stringify(record.decision), "utf8");
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment carrying none of this
 * machine's real config: `HOME` is the throwaway directory, so no bot token and no cmux daemon is reachable.
 *
 * `status` is non-null on every run here because none of them is killed by a signal, and an honest `!`
 * says so rather than an operator quietly substituting a sentinel a later assertion would compare against.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, [...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"), HOME: workspace, PATH: process.env["PATH"]! },
    maxBuffer: 8 * 1024 * 1024,
  });
  return { status: result.status!, stderr: result.stderr, stdout: result.stdout };
}

/** Every `kind` in the ask's lifecycle log, in order — what the dispatch did or did not commit. */
function lifecycleKinds(): readonly string[] {
  return readFileSync(join(home, "live", "slack", "asks.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { kind: string }).kind);
}

describe("replay: dispatched-with-no-live-card-21sep", () => {
  it("REFUSES the whole dispatch when no card exists and none can be posted", { timeout: 60_000 }, () => {
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--home", home, "--brief", briefPath, "--decision", decisionPath],
    });

    expect(result.status).toBe(1);
    // The witness: printed only by the card gate, and only once a dispatch has reached it.
    expect(result.stderr).toContain(
      "this ask has no live progress card and one could not be posted, so no worker was started",
    );
    expect(result.stderr).toContain("a public ask never reaches a worker without a card standing in its thread");
    // And the whole point of refusing BEFORE the lease: the old code's `dispatched` row is not written, so no
    // worker is ever told it owns this ask.
    expect(lifecycleKinds()).toEqual(["captured"]);
  });

  it("proceeds past that gate when the brief carries a card, which is the control", { timeout: 60_000 }, () => {
    const brief = JSON.parse(readFileSync(briefPath, "utf8")) as Record<string, unknown>;
    writeFileSync(briefPath, JSON.stringify({ ...brief, started: CONTROL_CARD }), "utf8");

    const result = runSlopweaver({
      args: ["turn", "dispatch", "--home", home, "--brief", briefPath, "--decision", decisionPath],
    });

    // The opposite positive witness — the gate ran and was SATISFIED, naming the ts it was satisfied by.
    expect(result.stdout).toContain(
      `live progress card already on the brief — ts ${CONTROL_CARD.workingTs}, turn ${CONTROL_CARD.turnId}`,
    );
    expect(result.stderr).not.toContain("this ask has no live progress card");
    // This home has no bot token either, so the fresh-visible-session tier still cannot finish — but it fails
    // on the TIER, downstream of the card, which is what makes the contrast a single-variable one.
    expect(result.stderr).toContain("no Slack bot token configured");
  });
});
