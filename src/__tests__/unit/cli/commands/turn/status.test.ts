/**
 * `slopweaver turn status` — the pure decision half (`turnStatusPlan`, `turnStatusTierFromFlag`), and the
 * CLI shell's refusals up to the point it would open a real Slack transport, the same boundary
 * `run/responderWhitelist.test.ts` draws for `turn answer`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { missingBotTokenRefusal } from "../../../../../cli/commands/turn/cardGates.js";
import { answerProvenanceLabel } from "../../../../../cli/commands/turn/core.js";
import {
  parseTurnStatusArgs,
  runTurnStatus,
  turnStatusCommand,
  turnStatusPlan,
  turnStatusTierFromFlag,
} from "../../../../../cli/commands/turn/status.js";
import { statusDeclaration, statusPushEvents } from "../../../../../cli/commands/turn/statusDeclaration.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { turnManifest } from "../../../../../cli/manifests/turn.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { buildTurnRoutingBrief } from "../../../../../live/turn/brief.js";
import type { RoutingJudgementInput } from "../../../../../live/turn/judgement.js";
import { LIVE_STATUS_CAP } from "../../../../../live/turn/liveStatusCap.js";
import { secretFilePath, stateHomePaths } from "../../../../../stateHome.js";

const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: { controlPlane: { ownerAddressingText: "what did we decide?", structuralMetadata: [] }, quotedEvidence: [] },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A well-formed v6 brief, WITH the capture-time checklist ref `turn status` needs to advance. */
function briefWithStarted(): ReturnType<typeof buildTurnRoutingBrief> {
  return buildTurnRoutingBrief({
    channel: "C1",
    messageTs: "1.1",
    question: "what did we decide about the rollout?",
    routingInput: ROUTING_INPUT,
    started: { turnId: "turn-1", workingTs: "1.2" },
    surface: "channel",
    threadTs: "1.1",
    unavailableCapabilities: [],
    userId: "U_ASKER",
  });
}

/** The same brief, but never captured by the listener — no `started` ref to advance. */
function briefWithoutStarted(): ReturnType<typeof buildTurnRoutingBrief> {
  return buildTurnRoutingBrief({
    channel: "C1",
    messageTs: "1.1",
    question: "what did we decide about the rollout?",
    routingInput: ROUTING_INPUT,
    surface: "channel",
    threadTs: "1.1",
    unavailableCapabilities: [],
    userId: "U_ASKER",
  });
}

describe("parseTurnStatusArgs", () => {
  it("does not mistake its own verb token for a stray argument", () => {
    const argv = ["node", "slopweaver", "turn", "status", "--brief", "/tmp/brief.json", "--status", "reading"];
    const parsed = parseTurnStatusArgs({ rest: argv.slice(4) });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : ["not parsed"]).toEqual([]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(unwrapErr(parseTurnStatusArgs({ rest: ["--not-a-flag", "x"] }))).toEqual([
      "unknown flag: --not-a-flag",
      "unexpected argument: x",
    ]);
  });
});

describe("turnStatusTierFromFlag", () => {
  it("defaults to inline when no --tier is given", () => {
    expect(turnStatusTierFromFlag({ raw: undefined })).toEqual({ tier: "inline" });
  });

  it("accepts read-only-subagent", () => {
    expect(turnStatusTierFromFlag({ raw: "read-only-subagent" })).toEqual({ tier: "read-only-subagent" });
  });

  it("accepts fresh-visible-session, so a dispatched worker can advance its own card", () => {
    expect(turnStatusTierFromFlag({ raw: "fresh-visible-session" })).toEqual({ tier: "fresh-visible-session" });
  });

  it("names all three tiers when refusing an unrecognised one", () => {
    const outcome = turnStatusTierFromFlag({ raw: "screen-scrape" });

    expect("error" in outcome ? outcome.error : "not refused").toBe(
      "--tier must be `inline`, `read-only-subagent` or `fresh-visible-session`, but got `screen-scrape`",
    );
  });

  it("refuses a value that is not any known tier", () => {
    const outcome = turnStatusTierFromFlag({ raw: "bogus" });

    expect("error" in outcome ? outcome.error : "not refused").toContain("--tier must be");
  });
});

describe("turnStatusPlan", () => {
  const stage = ({ text, tsIso }: { text: string; tsIso: string }) => ({ kind: "stage" as const, text, tsIso });

  it("puts the latest stage live with the now-line under it, and the trail in the loop below the fold", () => {
    const plan = turnStatusPlan({
      askIdentity: { channel: "C1" },
      nowDetail: "now: Bash — rg 'pool exhausted' · 12 tool calls so far",
      question: "why did the staging pool exhaust?",
      started: { workingTs: "1.2" },
      timeline: [
        stage({ text: "reading the pool metrics", tsIso: "2026-08-29T09:00:00.000Z" }),
        stage({ text: "metrics in — 40 of 40 connections held by one job", tsIso: "2026-08-29T09:04:00.000Z" }),
      ],
    });

    expect(plan.posted).toEqual({ channel: "C1", ts: "1.2" });
    expect(plan.steps.map((step) => step.title)).toEqual([
      "2 updates so far",
      "Read the question",
      "metrics in — 40 of 40 connections held by one job",
      "started",
    ]);
    expect(plan.steps[2]!.children).toEqual(["now: Bash — rg 'pool exhausted' · 12 tool calls so far"]);
    expect(plan.steps[3]!.children).toEqual([
      "reading the pool metrics",
      "metrics in — 40 of 40 connections held by one job",
    ]);
  });

  it("labels the task with the question, with the ask's own addressing stripped", () => {
    const plan = turnStatusPlan({
      askIdentity: { channel: "C1" },
      nowDetail: undefined,
      question: "@(U0BOT) why did the staging pool exhaust?",
      started: { workingTs: "1.2" },
      timeline: [],
    });

    expect(plan.task).toBe("answering: why did the staging pool exhaust?");
  });

  it("clamps a stage line longer than the card's own line cap", () => {
    const long = "x".repeat(LIVE_STATUS_CAP + 50);

    const plan = turnStatusPlan({
      askIdentity: { channel: "C1" },
      nowDetail: undefined,
      question: "why?",
      started: { workingTs: "1.2" },
      timeline: [{ kind: "stage", text: long, tsIso: "2026-08-29T09:00:00.000Z" }],
    });

    expect(plan.steps[1]!.title.length).toBe(LIVE_STATUS_CAP);
    expect(plan.steps[1]!.title.endsWith("…")).toBe(true);
  });
});

describe("statusDeclaration", () => {
  it("reads a status alone", () => {
    expect(unwrap(statusDeclaration({ values: { status: "reading the thread" } }))).toEqual({
      plan: undefined,
      status: "reading the thread",
      step: undefined,
    });
  });

  it("reads a plan one step per line, blank lines dropped", () => {
    expect(unwrap(statusDeclaration({ values: { plan: "Read the thread\n\n  Check GitHub  \nAnswer" } }))).toEqual({
      plan: ["Read the thread", "Check GitHub", "Answer"],
      status: undefined,
      step: undefined,
    });
  });

  it("refuses a push that declares neither", () => {
    expect(unwrapErr(statusDeclaration({ values: { status: "   " } }))).toEqual(["--status or --plan is required"]);
  });

  it("refuses a --step with no --status to file against it", () => {
    expect(unwrapErr(statusDeclaration({ values: { plan: "a\nb", step: "2" } }))).toEqual([
      "--step files a --status against a plan step, so it needs a --status",
    ]);
  });

  it("refuses a plan the card could not draw above the fold, naming the count", () => {
    expect(unwrapErr(statusDeclaration({ values: { plan: "1\n2\n3\n4\n5\n6\n7\n8" } }))).toEqual([
      "--plan holds 8 steps and the card draws at most 7 above the fold — merge steps until the plan reads at a glance",
    ]);
  });
});

describe("statusPushEvents", () => {
  const NOW = "2026-10-02T09:00:00.000Z";
  const PLANNED = { kind: "plan" as const, steps: ["a", "b", "c"], tsIso: "2026-10-02T08:50:00.000Z" };

  it("files a stage with its writer, and the plan first when one push declares both", () => {
    const events = statusPushEvents({
      declaration: { plan: ["a", "b"], status: "starting a", step: "1" },
      log: { timeline: [] },
      nowIso: NOW,
      worker: "session-1",
    });
    expect(unwrap(events)).toEqual([
      { kind: "plan", steps: ["a", "b"], tsIso: NOW },
      { kind: "stage", step: 1, text: "starting a", tsIso: NOW, worker: "session-1" },
    ]);
  });

  it("reads a --step against the plan already standing in the log", () => {
    const events = statusPushEvents({
      declaration: { plan: undefined, status: "on to c", step: "3" },
      log: { timeline: [PLANNED] },
      nowIso: NOW,
      worker: "session-1",
    });
    expect(unwrap(events)).toEqual([{ kind: "stage", step: 3, text: "on to c", tsIso: NOW, worker: "session-1" }]);
  });

  it("refuses a --step past the plan's end", () => {
    const events = statusPushEvents({
      declaration: { plan: undefined, status: "x", step: "4" },
      log: { timeline: [PLANNED] },
      nowIso: NOW,
      worker: "session-1",
    });
    expect(unwrapErr(events).code).toBe("PLAN_REFUSED");
  });

  it("refuses a --step when no plan was ever declared", () => {
    const events = statusPushEvents({
      declaration: { plan: undefined, status: "x", step: "1" },
      log: { timeline: [] },
      nowIso: NOW,
      worker: "session-1",
    });
    expect(unwrapErr(events).message).toContain("pass --plan first");
  });
});

describe("turn status usage", () => {
  it("prints usage and exits OK on --help, before any flag parsing", async () => {
    expect(await runTurnStatus(["node", "slopweaver", "turn", "status", "--help"])).toBe(0);
  });
});

describe("turn status refusals — before any effect", () => {
  it("refuses with a usage code when --brief is missing", async () => {
    expect(await runTurnStatus(["node", "slopweaver", "turn", "status", "--status", "reading"])).toBe(EXIT_USAGE);
  });

  it("refuses with a usage code when --status is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-status-"));
    fixtureDirs.push(dir);
    const briefPath = join(dir, "brief.json");
    writeFileSync(briefPath, JSON.stringify(briefWithStarted()), "utf8");

    expect(await runTurnStatus(["node", "slopweaver", "turn", "status", "--brief", briefPath])).toBe(EXIT_USAGE);
  });

  it("refuses an unrecognised --tier before ever reading the brief", async () => {
    expect(
      await runTurnStatus([
        "node",
        "slopweaver",
        "turn",
        "status",
        "--brief",
        "/does/not/exist.json",
        "--status",
        "reading",
        "--tier",
        "bogus",
      ]),
    ).toBe(EXIT_USAGE);
  });

  it("reports an error when the brief file cannot be read", async () => {
    expect(
      await runTurnStatus([
        "node",
        "slopweaver",
        "turn",
        "status",
        "--brief",
        "/does/not/exist.json",
        "--status",
        "reading",
      ]),
    ).toBe(EXIT_ERROR);
  });

  it("refuses a brief whose userId is not on the responder whitelist — same gate turn answer applies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-status-"));
    fixtureDirs.push(dir);
    const briefPath = join(dir, "brief.json");
    writeFileSync(briefPath, JSON.stringify(briefWithStarted()), "utf8");

    const code = await runTurnStatus([
      "node",
      "slopweaver",
      "turn",
      "status",
      "--brief",
      briefPath,
      "--status",
      "reading",
      "--home",
      dir,
    ]);

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("refuses when this ask has no capture-time checklist to advance — an admitted responder, past that gate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-status-"));
    fixtureDirs.push(dir);
    writeFileSync(stateHomePaths({ home: dir }).respondersJson, JSON.stringify(["U_ASKER"]), "utf8");
    const briefPath = join(dir, "brief.json");
    writeFileSync(briefPath, JSON.stringify(briefWithoutStarted()), "utf8");

    const code = await runTurnStatus([
      "node",
      "slopweaver",
      "turn",
      "status",
      "--brief",
      briefPath,
      "--status",
      "reading",
      "--home",
      dir,
    ]);

    expect(code).toBe(EXIT_ERROR);
  });

  it("admits a whitelisted userId with a started ref, and proceeds far enough to hit the next real gate — the missing token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-status-"));
    fixtureDirs.push(dir);
    writeFileSync(stateHomePaths({ home: dir }).respondersJson, JSON.stringify(["U_ASKER"]), "utf8");
    const briefPath = join(dir, "brief.json");
    writeFileSync(briefPath, JSON.stringify(briefWithStarted()), "utf8");

    const code = await runTurnStatus([
      "node",
      "slopweaver",
      "turn",
      "status",
      "--brief",
      briefPath,
      "--status",
      "reading",
      "--home",
      dir,
    ]);

    // Past the responder gate and the started-ref check now — the very next thing this verb needs is the
    // bot token, which this temp home also does not have. EXIT_ERROR here (not EXIT_EXPECTED_EMPTY or a
    // usage code) is what proves both prior gates were satisfied.
    expect(code).toBe(EXIT_ERROR);
  });

  it("refuses a missing token by saying what it likely means and which store read settles it", () => {
    expect(missingBotTokenRefusal({ home: "/h" })).toBe(
      "no Slack bot token: SLACK_BOT_TOKEN is unset and the secrets store under /h holds no slack-bot-token, " +
        "so Slack was never connected for this home or this is the wrong home — run " +
        "`slopweaver secrets status --home /h` to read what the store holds, then `slopweaver connect slack` " +
        "if the token is missing",
    );
  });
});

describe("turn status --dry-run — the behavioural probe this run adds a dry-run for", () => {
  it("exits OK and prints the plan without a bot token ever being asked to send anything", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-status-dry-run-"));
    fixtureDirs.push(dir);
    writeFileSync(stateHomePaths({ home: dir }).respondersJson, JSON.stringify(["U_ASKER"]), "utf8");
    const briefPath = join(dir, "brief.json");
    writeFileSync(briefPath, JSON.stringify(briefWithStarted()), "utf8");
    const tokenPath = secretFilePath({ home: dir, name: "slack-bot-token" });
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, "xoxb-test", "utf8");

    const code = await runTurnStatus([
      "node",
      "slopweaver",
      "turn",
      "status",
      "--brief",
      briefPath,
      "--status",
      "reading the corpus for prior decisions",
      "--tier",
      "fresh-visible-session",
      "--home",
      dir,
      "--session-url",
      "https://example.invalid/session",
      "--dry-run",
    ]);

    expect(code).toBe(EXIT_OK);
  });
});

describe("turn manifest — status", () => {
  it("declares status as external-write and door-routed, since it always edits the checklist through the door", () => {
    expect(turnManifest["status"]!.meta.effect).toBe("external-write");
    expect(turnManifest["status"]!.meta.doorRouted).toBe(true);
  });

  it("exposes the command the manifest lazily loads", () => {
    expect(turnStatusCommand).toBe(runTurnStatus);
  });
});

/**
 * The label the card stamps as its author. The owner read "the supervisor session (Claude Code, in-turn)" off
 * a live card that a dispatched worker had written — this verb resolved it from the process's
 * own host variable rather than from the dispatch record, while the ANSWER path already got it right.
 */
describe("the card names whoever actually wrote it", () => {
  const supervisor = { host: "claude-code", id: "session-1" } as const;

  it("names the dispatched worker and its workspace when the ask has one", () => {
    expect(
      answerProvenanceLabel({
        modelOverride: undefined,
        supervisor,
        worker: { host: "claude-code", workspaceRef: "workspace:556" },
      }),
    ).toBe("the dispatched worker in workspace:556 (Claude Code, in-turn)");
  });

  it("falls back to the supervisor label only when nothing was dispatched", () => {
    expect(answerProvenanceLabel({ modelOverride: undefined, supervisor, worker: undefined })).toBe(
      "the supervisor session (Claude Code, in-turn)",
    );
  });

  it("lets an explicit --model win over both", () => {
    expect(
      answerProvenanceLabel({
        modelOverride: "a human, by hand",
        supervisor,
        worker: { host: "claude-code", workspaceRef: "workspace:556" },
      }),
    ).toBe("a human, by hand");
  });
});
