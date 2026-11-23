/**
 * `slopweaver turn satisfied` — the terminal for an ask another turn's answer already covered.
 *
 * Every plan case is a real fold of real events, not a hand-built `AskLifecycle` literal: the fold is what
 * the verb actually reads, so a fixture built any other way could keep passing while the fold stopped
 * producing that shape. The verb cases take the temp-home paths that need neither a Slack token nor a
 * captured ask, for the reason `./ignore.test.ts` gives about the same seam.
 *
 * The anchor throughout is the MEASURED incident: `C0SYN000012`. Ask `1787540579.950269` had
 * its content answered at `1787558807.222889` by the turn for a different ask in the same thread, and every
 * terminal then available to it posted something.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseTurnSatisfiedArgs, runTurnSatisfied } from "../../../../../cli/commands/turn/satisfied.js";
import {
  satisfiedArgsFrom,
  satisfiedElsewherePlan,
  satisfiedReasonFor,
} from "../../../../../cli/commands/turn/satisfiedCore.js";
import { TURN_SATISFIED_FLAG_SPEC, TURN_SATISFIED_USAGE } from "../../../../../cli/commands/turn/satisfiedUsage.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { turnManifest } from "../../../../../cli/manifests/turn.js";
import { type AskLifecycle, foldAskLifecycle } from "../../../../../live/ask/lifecycle.js";
import type { AskLifecycleEvent } from "../../../../../live/ask/lifecycleEvents.js";
import type { PostedRef } from "../../../../../live/turn/runContract.js";

/** The incident ask's own identity, from the incident this verb was written for. */
const BASE = {
  channel: "C0SYN000012",
  messageTs: "1787540579.950269",
  threadTs: "1787539401.542749",
  tsIso: "2026-08-24T03:31:39.000Z",
} as const;

/** The message that already answered it — another ask's turn, in the same thread. */
const ANSWERED_BY = "1787558807.222889";

/** Its own working checklist, the card a `settle` arm has to reap before anything is written. */
const OWN_CARD: PostedRef = { channel: BASE.channel, ts: "1787540580.111119" };

const CAPTURED: AskLifecycleEvent = { ...BASE, kind: "captured", surface: "channel", userId: "U_OWNER" };

/** The folded entry for {@link BASE}, built from the events a real home would hold. */
function foldedAsk({ events }: { events: readonly AskLifecycleEvent[] }): AskLifecycle {
  return foldAskLifecycle({ events: [CAPTURED, ...events] }).get(JSON.stringify([BASE.channel, BASE.messageTs]))!;
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-satisfied-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("satisfiedReasonFor", () => {
  it("carries the pointer inside the clause, so a card left standing still names the answer", () => {
    expect(satisfiedReasonFor({ answeredByTs: ANSWERED_BY, reason: "answered above in this thread" })).toBe(
      "answered above in this thread (the answer is at ts 1787558807.222889)",
    );
  });
});

describe("satisfiedElsewherePlan", () => {
  it("reports nothing-raised for an ask the listener never captured", () => {
    const plan = satisfiedElsewherePlan({
      answeredByTs: ANSWERED_BY,
      cards: [],
      entry: undefined,
      reason: "covered above",
    });

    expect(plan.kind).toBe("nothing-raised");
  });

  it("writes nothing a second time, naming the ts the first pass recorded", () => {
    const settled: AskLifecycleEvent = {
      ...BASE,
      answeredByTs: ANSWERED_BY,
      kind: "satisfied-elsewhere",
      reason: "covered above",
      tsIso: "2026-08-24T08:58:40.000Z",
    };
    const plan = satisfiedElsewherePlan({
      answeredByTs: "1787999999.000000",
      cards: [],
      entry: foldedAsk({ events: [settled] }),
      reason: "covered above",
    });

    expect(plan.kind).toBe("already-satisfied");
    expect(plan.kind === "already-satisfied" ? plan.answeredByTs : "not that arm").toBe(ANSWERED_BY);
  });

  it("refuses a pointer naming the ask's OWN message — an ask cannot answer itself", () => {
    const plan = satisfiedElsewherePlan({
      answeredByTs: BASE.messageTs,
      cards: [],
      entry: foldedAsk({ events: [] }),
      reason: "covered above",
    });

    expect(plan.kind).toBe("not-an-answer");
    expect(plan.kind === "not-an-answer" ? plan.why : "not that arm").toContain("own message");
  });

  it("refuses a pointer naming a card this ask itself posted — the mistake that would pass review", () => {
    const plan = satisfiedElsewherePlan({
      answeredByTs: OWN_CARD.ts,
      cards: [OWN_CARD],
      entry: foldedAsk({ events: [] }),
      reason: "covered above",
    });

    expect(plan.kind).toBe("not-an-answer");
    expect(plan.kind === "not-an-answer" ? plan.why : "not that arm").toContain("a card this ask itself posted");
  });

  it("settles a captured ask against its own cards, carrying the fold's threadTs out with it", () => {
    const posted: AskLifecycleEvent = {
      ...BASE,
      kind: "checklist-posted",
      tsIso: "2026-08-24T03:31:40.000Z",
      turnId: "turn-1787540564944",
      workingTs: OWN_CARD.ts,
    };
    const plan = satisfiedElsewherePlan({
      answeredByTs: ANSWERED_BY,
      cards: [OWN_CARD],
      entry: foldedAsk({ events: [posted] }),
      reason: "answered above in this thread",
    });

    expect(plan.kind).toBe("settle");
    expect(plan.kind === "settle" ? plan.askIdentity.threadTs : "not that arm").toBe(BASE.threadTs);
    expect(plan.kind === "settle" ? plan.cards : []).toEqual([OWN_CARD]);
    expect(plan.kind === "settle" ? plan.turnId : "not that arm").toBe("turn-1787540564944");
    expect(plan.kind === "settle" ? plan.state.kind : "not that arm").toBe("satisfied");
    expect(plan.kind === "settle" ? plan.state.reason : "not that arm").toBe(
      "answered above in this thread (the answer is at ts 1787558807.222889)",
    );
  });

  it("mints a correlation id from the ask itself when no checklist was ever posted", () => {
    const plan = satisfiedElsewherePlan({
      answeredByTs: ANSWERED_BY,
      cards: [],
      entry: foldedAsk({ events: [] }),
      reason: "covered above",
    });

    expect(plan.kind === "settle" ? plan.turnId : "not that arm").toBe("satisfied-1787540579.950269");
  });
});

describe("parseTurnSatisfiedArgs", () => {
  it("does not mistake its own verb token for a stray argument", () => {
    const argv = ["node", "slopweaver", "turn", "satisfied", "--channel", "C1", "--message-ts", "1.1"];
    const parsed = parseTurnSatisfiedArgs({ rest: argv.slice(4) });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : ["not parsed"]).toEqual([]);
  });

  it("refuses an unknown flag by NAME, rather than on some other complaint", () => {
    const parsed = parseTurnSatisfiedArgs({ rest: ["--not-a-flag", "x"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed.isErr() ? parsed.error.join(" | ") : "parsed").toContain("--not-a-flag");
  });

  it("takes every flag the spec declares as a STRING, so none is swallowed as a boolean", () => {
    expect([...TURN_SATISFIED_FLAG_SPEC.string]).toEqual(["channel", "message-ts", "answered-by-ts", "reason", "home"]);
    expect([...TURN_SATISFIED_FLAG_SPEC.boolean]).toEqual([]);
  });
});

describe("satisfiedArgsFrom", () => {
  it("names EVERY absent flag in one pass, so an operator who forgot two is told about two", () => {
    const checked = satisfiedArgsFrom({
      answeredByTs: undefined,
      channel: BASE.channel,
      messageTs: BASE.messageTs,
      reason: undefined,
    });

    expect(checked.kind).toBe("missing");
    expect(checked.kind === "missing" ? checked.flags : ["not that arm"]).toEqual(["--answered-by-ts", "--reason"]);
  });

  it("carries all four through once every one of them is present", () => {
    const checked = satisfiedArgsFrom({
      answeredByTs: ANSWERED_BY,
      channel: BASE.channel,
      messageTs: BASE.messageTs,
      reason: "covered above",
    });

    expect(checked.kind).toBe("ready");
    expect(checked.kind === "ready" ? checked.answeredByTs : "not that arm").toBe(ANSWERED_BY);
    expect(checked.kind === "ready" ? checked.reason : "not that arm").toBe("covered above");
  });
});

describe("the satisfied verb's surface", () => {
  it("prints its own usage on --help and exits OK, touching nothing", async () => {
    await expect(runTurnSatisfied(["node", "slopweaver", "turn", "satisfied", "--help"])).resolves.toBe(EXIT_OK);
  });

  it("refuses with a usage code when every required flag is absent, before any effect", async () => {
    const home = tempHome();
    await expect(runTurnSatisfied(["node", "slopweaver", "turn", "satisfied", "--home", home])).resolves.toBe(
      EXIT_USAGE,
    );
  });

  it("refuses with a usage code when only SOME required flags are given", async () => {
    const home = tempHome();
    await expect(
      runTurnSatisfied([
        "node",
        "slopweaver",
        "turn",
        "satisfied",
        "--channel",
        BASE.channel,
        "--message-ts",
        BASE.messageTs,
        "--home",
        home,
      ]),
    ).resolves.toBe(EXIT_USAGE);
  });

  it("exits expected-empty over a home holding no capture for the ask, writing nothing", async () => {
    const home = tempHome();
    await expect(
      runTurnSatisfied([
        "node",
        "slopweaver",
        "turn",
        "satisfied",
        "--channel",
        BASE.channel,
        "--message-ts",
        BASE.messageTs,
        "--answered-by-ts",
        ANSWERED_BY,
        "--reason",
        "covered above",
        "--home",
        home,
      ]),
    ).resolves.toBe(EXIT_EXPECTED_EMPTY);
  });

  it("is declared in the turn manifest as a door-routed external write that creates no work item", () => {
    const entry = turnManifest["satisfied"]!;

    expect(entry.meta.effect).toBe("external-write");
    expect(entry.meta.doorRouted).toBe(true);
    expect(entry.meta.createsWorkItem).toBe(false);
    expect(entry.meta.usage).toBe(TURN_SATISFIED_USAGE);
  });
});
