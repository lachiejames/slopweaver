/**
 * REPLAY LANE — the second progress card, re-run against the SHIPPED binary.
 *
 * The incident, on a bot thread in `#proj-launch-room`: a double progress post. One tag of the owner's asked the
 * bot to add two people to the allow-list and answer one of their earlier
 * questions. The loop did the adds under the owner's ask's card, then dispatched that earlier question as its own turn,
 * and `turn dispatch`'s card gate — finding no card for THAT ask — posted a second one in the same thread.
 *
 * The fixture (`fixtures/replay/sub-ask-posted-a-second-card-23sep`) is the sub-ask's record set frozen
 * `--through captured`: the state the gate fired FROM. Its brief still carries the `started` ref the incident's
 * dispatch wrote back — the SECOND card, `1790146216.256649` — so the first assertion pins that binding, and
 * every run then strips it to stand where the gate stood.
 *
 * **What this home is given that the fixture does not carry.** The parent: the owner's own ask and its card,
 * the rows the listener wrote for them in the incident (`1790146101.489459`, card `1790146110.096759`). The
 * freeze keeps one ask's rows, never its thread's, so they are appended here verbatim from the incident log,
 * channel synthetic. Plus `responders.json` and the remapped capability ids, exactly as
 * `dispatchedWithNoLiveCard.test.ts` gives its home and for the same reason: they are upstream gates.
 *
 * **The falsifiable witnesses.** Three runs differing in one variable each. With no `ridesOn`, the gate
 * reaches its post and — with no bot token in this home — refuses: the incident's path, reached. With
 * `ridesOn` naming the open parent, it prints the ride line naming the PARENT's card and appends a
 * `checklist-posted` for the sub-ask carrying that card, and never refuses. With the parent already
 * answered it still rides: whether that card still stands is asked of Slack, never inferred from the log.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "sub-ask-posted-a-second-card-23sep";

/** The owner's own ask in the incident thread, and the card the listener posted for it. */
const PARENT_TS = "1790146101.489459";
const PARENT_CARD = { turnId: "turn-1790146109374", workingTs: "1790146110.096759" } as const;
/** The second card the incident's dispatch posted, which the frozen brief still names. */
const SECOND_CARD = { turnId: "turn-1790146214748", workingTs: "1790146216.256649" } as const;

let workspace: string;
let home: string;
let briefPath: string;
let decisionPath: string;
let ask: { channel: string; messageTs: string; threadTs: string; askedBy: string };
let frozenStarted: unknown;

/** Append lifecycle rows for the parent ask, as the listener wrote them. */
function appendParentRows({ rows }: { rows: readonly Record<string, unknown>[] }): void {
  const lines = rows.map((row) =>
    JSON.stringify({ channel: ask.channel, messageTs: PARENT_TS, schemaVersion: 1, threadTs: ask.threadTs, ...row }),
  );
  appendFileSync(join(home, "live", "slack", "asks.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

/** Rewrite the brief with the frozen `started` stripped, and `ridesOn` set when given. */
function writeBrief({ ridesOn }: { ridesOn: string | undefined }): void {
  const { started, ...brief } = JSON.parse(readFileSync(briefPath, "utf8")) as Record<string, unknown>;
  frozenStarted = started;
  writeFileSync(briefPath, JSON.stringify({ ...brief, ...(ridesOn === undefined ? {} : { ridesOn }) }), "utf8");
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-ride-"));
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

  appendParentRows({
    rows: [
      { kind: "captured", surface: "channel", tsIso: "2026-09-23T07:01:41.489Z", userId: "UFIXTUREOW" },
      { kind: "checklist-posted", tsIso: "2026-09-23T07:01:50.096Z", ...PARENT_CARD },
    ],
  });
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised home, with no bot token and no cmux daemon reachable.
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

/** The sub-ask's own `checklist-posted` rows — which card its lifecycle says it carries. */
function subAskCards(): readonly { turnId: string; workingTs: string }[] {
  return readFileSync(join(home, "live", "slack", "asks.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { kind: string; messageTs: string; turnId: string; workingTs: string })
    .filter((row) => row.kind === "checklist-posted" && row.messageTs === ask.messageTs)
    .map(({ turnId, workingTs }) => ({ turnId, workingTs }));
}

/** Dispatch the sub-ask through the shipped verb. */
function dispatch(): { status: number; stdout: string; stderr: string } {
  return runSlopweaver({
    args: ["turn", "dispatch", "--home", home, "--brief", briefPath, "--decision", decisionPath],
  });
}

describe("replay: sub-ask-posted-a-second-card-23sep", () => {
  it(
    "reaches the incident's own path — a post of a second card — when the brief rides nothing",
    { timeout: 60_000 },
    () => {
      writeBrief({ ridesOn: undefined });
      // The binding: the frozen brief names the incident's second card, so this fixture IS that dispatch.
      expect(frozenStarted).toEqual(SECOND_CARD);

      const result = dispatch();

      expect(result.status).toBe(1);
      // Printed only once the gate has decided to POST — the branch that put the second card in the thread.
      expect(result.stderr).toContain("this ask has no live progress card and one could not be posted");
      expect(subAskCards()).toEqual([]);
    },
  );

  it("RIDES the owner's card when the brief names their ask, and posts nothing", { timeout: 60_000 }, () => {
    writeBrief({ ridesOn: PARENT_TS });

    const result = dispatch();

    expect(result.stdout).toContain(
      `live progress card of the ask this one was dispatched from (${PARENT_TS}) ridden, not a second card — ` +
        `ts ${PARENT_CARD.workingTs}, turn ${PARENT_CARD.turnId}`,
    );
    expect(result.stderr).not.toContain("this ask has no live progress card");
    expect(subAskCards()).toEqual([PARENT_CARD]);
    // Past the card, the fresh-visible-session tier still cannot start with no token — downstream of the gate.
    expect(result.stderr).toContain("no Slack bot token configured");
  });

  it(
    "still RIDES once the owner's ask has been answered — whether the card stands is Slack's to say",
    { timeout: 60_000 },
    () => {
      appendParentRows({
        rows: [{ answerTs: "1790146300.000100", kind: "answered", tsIso: "2026-09-23T07:05:00.000Z" }],
      });
      writeBrief({ ridesOn: PARENT_TS });

      const result = dispatch();

      expect(result.stdout).toContain(
        `live progress card of the ask this one was dispatched from (${PARENT_TS}) ridden`,
      );
      // With no token the Slack check cannot answer, so it is REPORTED on the line — never read as "gone".
      expect(result.stdout).toContain("the advance was refused — no Slack bot token");
      expect(subAskCards()).toEqual([PARENT_CARD]);
    },
  );
});
