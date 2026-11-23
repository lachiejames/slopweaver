/**
 * briefReRoute — the third half of the fix: re-routing an ask the sweep called over must REUSE
 * the card already standing in the thread, and must not need the question typed back in.
 *
 * The sweep's never-dispatched line prints a `turn brief` command with no `--turn-id`/`--working-ts` (the
 * capture-time card is recovered from the ledger) and, when the ledger recorded it, no need to re-read Slack
 * for the question either. These cases run the REAL verb over that exact command shape, so the line the
 * sweep prints is proven runnable rather than asserted to be.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTurnBrief } from "../../../../../cli/commands/turn/brief.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { AppendableAskLifecycleEvent, CapturedEvent } from "../../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent } from "../../../../../live/ask/store.js";
import { defaultBriefPath } from "../../../../../live/turn/briefStore.js";
import { reRouteCommand } from "../../../../../live/turn/unroutedReport.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const ASK = { channel: "C0SYN000001", messageTs: "1789348656.323469", threadTs: "1789348656.323469" } as const;
const ASKER = "U0SYN000001";
const QUESTION = "@(U0SYN000005) give me a ranked list of ISO tasks we can take on today";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function homeAdmittingAsker(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-brief-reroute-"));
  fixtureDirs.push(home);
  writeFileSync(stateHomePaths({ home }).respondersJson, JSON.stringify([ASKER]), "utf8");
  return home;
}

/**
 * Write the exact ledger the incident left behind: captured with its question, carded, then finalised by
 * the sweep as never-dispatched 33 minutes later.
 */
function incidentLedger({ home, withText }: { home: string; withText: boolean }): void {
  const captured: CapturedEvent = {
    ...ASK,
    kind: "captured",
    surface: "channel",
    tsIso: "2026-09-14T02:12:10.938Z",
    userId: ASKER,
    ...(withText ? { text: QUESTION } : {}),
  };
  const events: readonly AppendableAskLifecycleEvent[] = [
    captured,
    {
      ...ASK,
      kind: "checklist-posted",
      tsIso: "2026-09-14T02:12:19.348Z",
      turnId: "turn-1789351938440",
      workingTs: "1789351938.864729",
    },
    { ...ASK, kind: "dispatch-failed", reason: "no session ever picked this up", tsIso: "2026-09-14T02:45:27.414Z" },
  ];
  for (const event of events) {
    appendAskLifecycleEvent({ event, home });
  }
}

/**
 * The argv the sweep's own printed command becomes — the flags read back off {@link reRouteCommand} itself,
 * so a change to what the sweep prints fails HERE rather than shipping a line nobody can run. The quoted
 * `--text` is re-attached as one argv word (a shell would do that; `runTurnBrief` takes argv directly), and
 * `--host`/`--home` are appended because a fixture cannot use the operator's own.
 */
function reRouteArgv({ home }: { home: string }): readonly string[] {
  const command = reRouteCommand({ subject: { ask: ASK, surface: "channel", text: QUESTION, userId: ASKER } });
  const withoutText = command.replace("slopweaver turn brief ", "").replace(` --text '${QUESTION}'`, "");
  return [
    "node",
    "slopweaver",
    "turn",
    "brief",
    ...withoutText.split(" "),
    "--text",
    QUESTION,
    "--host",
    "claude-code",
    "--home",
    home,
  ];
}

function briefAt({ home }: { home: string }): { readonly question: string; readonly started?: unknown } {
  return JSON.parse(readFileSync(defaultBriefPath({ askIdentity: ASK, home }), "utf8"));
}

describe("re-routing an ask the sweep called over", () => {
  it("reuses the capture-time card, so the re-route never posts a second one", async () => {
    const home = homeAdmittingAsker();
    incidentLedger({ home, withText: true });

    expect(await runTurnBrief([...reRouteArgv({ home })])).toBe(0);
    expect(briefAt({ home }).started).toEqual({ turnId: "turn-1789351938440", workingTs: "1789351938.864729" });
  });

  it("recovers the question from the ledger when the command carries no --text at all", async () => {
    const home = homeAdmittingAsker();
    incidentLedger({ home, withText: true });
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      ASK.channel,
      "--message-ts",
      ASK.messageTs,
      "--thread-ts",
      ASK.threadTs,
      "--user",
      ASKER,
      "--surface",
      "channel",
      "--mode",
      "continuous-drain",
      "--host",
      "claude-code",
      "--home",
      home,
    ];

    expect(await runTurnBrief(argv)).toBe(0);
    const brief = briefAt({ home });
    expect(brief.question).toBe(QUESTION);
    expect(brief.started).toEqual({ turnId: "turn-1789351938440", workingTs: "1789351938.864729" });
  });

  it("prefers an explicit --text over the ledger's copy, for a message that was edited and re-briefed", async () => {
    const home = homeAdmittingAsker();
    incidentLedger({ home, withText: true });
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      ASK.channel,
      "--message-ts",
      ASK.messageTs,
      "--thread-ts",
      ASK.threadTs,
      "--user",
      ASKER,
      "--text",
      "@(U0SYN000005) actually just the top three",
      "--host",
      "claude-code",
      "--home",
      home,
    ];

    expect(await runTurnBrief(argv)).toBe(0);
    expect(briefAt({ home }).question).toBe("@(U0SYN000005) actually just the top three");
  });

  it("refuses as usage when neither the flag nor the ledger carries the question", async () => {
    const home = homeAdmittingAsker();
    incidentLedger({ home, withText: false });
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      ASK.channel,
      "--message-ts",
      ASK.messageTs,
      "--thread-ts",
      ASK.threadTs,
      "--user",
      ASKER,
      "--host",
      "claude-code",
      "--home",
      home,
    ];

    expect(await runTurnBrief(argv)).toBe(EXIT_USAGE);
  });
});
