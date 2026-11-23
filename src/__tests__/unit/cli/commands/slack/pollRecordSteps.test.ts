/*
 * `slack poll`'s two local-record steps, driven against a real throwaway store: the claim taken before Slack is
 * asked anything, and the lookup the results read starts from.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildPollPlan, type PollResultsOptions, parsePollForm } from "../../../../../cli/commands/slack/pollCore.js";
import { pollRecordFor } from "../../../../../cli/commands/slack/pollDoor.js";
import { claimOrRefuse, locateRecord } from "../../../../../cli/commands/slack/pollRecordSteps.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { confirmPollRecord, readPollRecord } from "../../../../../outbound/slack/pollStore.js";

const NOW = "2026-11-06T00:00:00.000Z";
const CHANNEL = "C0FIXTURE";
const TS = "1762387200.000100";
const FORM = JSON.stringify({
  kind: "poll",
  options: ["Waiting on someone", "Fighting CI"],
  question: "Where did the time go?",
  why: "Finding the friction.",
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-poll-record-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A plan built from the standard form, posted into the fixture channel. */
function planOf() {
  return buildPollPlan({
    artifact: unwrap(parsePollForm({ json: FORM })),
    chrome: {
      authorEmoji: ":robot_face:",
      authorLabel: "test-bot",
      bannerColor: "#8B5CF6",
      detailLabel: "*Details*",
      metadataEventType: "unused_card_v1",
    },
    metadataEventType: "slopweaver_poll_v1",
    options: { channel: CHANNEL, dryRun: false, formSource: FORM, home, json: false, mode: "post" },
    pings: [],
    surface: "shared-channel",
  });
}

/** A results invocation against the fixture message, optionally carrying the repair locator. */
function resultsOptions({ pollId }: { pollId?: string }): PollResultsOptions {
  return { channel: CHANNEL, home, json: false, mode: "results", pollId, ts: TS };
}

describe("claimOrRefuse", () => {
  it("claims a fresh poll and persists exactly the record the plan describes", () => {
    const plan = planOf();
    expect(claimOrRefuse({ home, nowIso: NOW, plan })).toBe(EXIT_OK);
    expect(readPollRecord({ home, pollId: plan.pollId })).toEqual({
      kind: "found",
      record: pollRecordFor({ nowIso: NOW, plan }),
    });
  });

  it("refuses as an error when a prior claim never confirmed a post", () => {
    const plan = planOf();
    claimOrRefuse({ home, nowIso: NOW, plan });
    expect(claimOrRefuse({ home, nowIso: NOW, plan })).toBe(EXIT_ERROR);
  });

  it("refuses as expected-empty when the poll was already posted", () => {
    const plan = planOf();
    claimOrRefuse({ home, nowIso: NOW, plan });
    confirmPollRecord({ home, nowIso: NOW, pollId: plan.pollId, ts: TS });
    expect(claimOrRefuse({ home, nowIso: NOW, plan })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("refuses as an error when the store cannot be written, recording nothing", () => {
    const plan = planOf();
    writeFileSync(join(home, "ledgers"), "a file where the ledgers directory belongs");
    expect(claimOrRefuse({ home, nowIso: NOW, plan })).toBe(EXIT_ERROR);
    expect(readPollRecord({ home, pollId: plan.pollId }).kind).toBe("unreadable");
  });
});

describe("locateRecord", () => {
  it("finds a confirmed poll by its channel and ts", () => {
    const plan = planOf();
    claimOrRefuse({ home, nowIso: NOW, plan });
    confirmPollRecord({ home, nowIso: NOW, pollId: plan.pollId, ts: TS });
    const located = locateRecord({ options: resultsOptions({}) });
    expect(located.record!.pollId).toBe(plan.pollId);
    expect(located.unreadable).toEqual([]);
  });

  it("cannot find an unconfirmed poll by message, but finds it by the repair locator", () => {
    const plan = planOf();
    claimOrRefuse({ home, nowIso: NOW, plan });
    expect(locateRecord({ options: resultsOptions({}) })).toEqual({ record: undefined, unreadable: [] });
    const located = locateRecord({ options: resultsOptions({ pollId: plan.pollId }) });
    expect(located.record!.pollId).toBe(plan.pollId);
    expect(located.record!.ts).toBeUndefined();
    expect(located.unreadable).toEqual([]);
  });

  it("answers an absent repair locator with no record and nothing unreadable", () => {
    expect(locateRecord({ options: resultsOptions({ pollId: "0123abcd" }) })).toEqual({
      record: undefined,
      unreadable: [],
    });
  });

  it("reports a corrupt record under the repair locator rather than calling it absent", () => {
    const dir = join(home, "ledgers", "slack-polls");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "0123abcd.json"), "{ not json");
    const located = locateRecord({ options: resultsOptions({ pollId: "0123abcd" }) });
    expect(located.record).toBeUndefined();
    expect(located.unreadable.length).toBe(1);
    expect(located.unreadable[0]).toContain("0123abcd: not valid JSON");
  });
});
