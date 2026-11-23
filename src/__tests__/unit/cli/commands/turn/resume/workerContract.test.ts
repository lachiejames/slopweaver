/**
 * `freshResumeLines` — the worker contract a dispatched session is handed: the validate, review, poll, post or
 * fail chain, the card's ticker and stages as steps 0a and 0b, and the provenance label the door will check.
 */
import { afterEach, describe, expect, it } from "vitest";

import { freshResumeLines } from "../../../../../../cli/commands/turn/resumeLines.js";
import { ORPHAN_SILENCE_MS } from "../../../../../../cli/commands/turn/tickerOwner.js";
import { bundledLauncherPath } from "../../../../../../lib/pluginRoot.js";
import type { FreshDispatchRecord } from "../../../../../../live/turn/dispatch.js";
import { BODY_MAX_BLOCKS } from "../../../../../../outbound/assistant/contentLimits.js";
import { removeFixtureDirs } from "../dispatch/harness.js";
import { ASK_IDENTITY, DECISION, DISPATCH_ID, RESUME_CARD, ROUTING_INPUT } from "./fixtures.js";
import { dispatchedFixture } from "./harness.js";

afterEach(removeFixtureDirs);

describe("freshResumeLines — the worker contract", () => {
  it("hands the worker the whole chain it owns: validate, review, poll, post, or report failure", () => {
    const { briefPath, home } = dispatchedFixture();
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath,
      decision: DECISION,
      dispatchId: DISPATCH_ID,
      execution: ROUTING_INPUT.execution,
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      schemaVersion: 3,
      session: {
        host: "claude-code",
        surfaceId: "id-surface:1",
        surfaceRef: "surface:1",
        workspaceId: "id-workspace:1",
        workspaceRef: "workspace:1",
      },
    };
    const text = freshResumeLines({
      askedBy: "U_COLLEAGUE",
      card: RESUME_CARD,
      briefPath,
      dispatchId: DISPATCH_ID,
      home,
      ownerUserId: "U_OWNER",
      surface: "channel",
      ownerDirectives: undefined,
      profile: undefined,
      question: "what are my open PRs?",
      record,
    }).join("\n");
    expect(text).toContain(
      `1. Write the answer JSON at an absolute path — inside the OUTBOUND SIZE CAPS above, body at most ${String(BODY_MAX_BLOCKS)} blocks — and validate it: slopweaver turn resume --dispatch ${DISPATCH_ID} --answer <absolute-path> --home ${home}`,
    );
    expect(text).toContain("OUTBOUND SIZE CAPS");
    expect(text).toContain(
      `2. Run the BEFORE REVIEW ROUND 1 checks the validate prints, then get it reviewed by an independent reviewer: slopweaver turn review --dispatch ${DISPATCH_ID} --answer <absolute-path> --read-through <the newest human ts you read in the thread> --home ${home}`,
    );
    expect(text).toContain(
      `3. Wait for the verdict, bounded: slopweaver turn review --dispatch ${DISPATCH_ID} --poll --wait --timeout-seconds 1200 --home ${home} — ONE call, run in the background`,
    );
    expect(text).toContain(
      `4. Post it yourself through the door: slopweaver turn answer --dispatch ${DISPATCH_ID} --verdict <the verdict path --poll printed> --home ${home}`,
    );
    expect(text).toContain(
      `slopweaver turn resume --dispatch ${DISPATCH_ID} --failed "<why, in one line>" --home ${home}`,
    );
    expect(text).toContain("You own this ask to its terminal outcome — nobody else posts for you.");
  });

  it("makes keeping the thread's card honest step 0, with the worker's own tier and this brief's path", () => {
    const { briefPath, home } = dispatchedFixture();
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath,
      decision: DECISION,
      dispatchId: DISPATCH_ID,
      execution: ROUTING_INPUT.execution,
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      schemaVersion: 3,
      session: {
        host: "claude-code",
        surfaceId: "id-surface:1",
        surfaceRef: "surface:1",
        workspaceId: "id-workspace:1",
        workspaceRef: "workspace:1",
      },
    };

    const text = freshResumeLines({
      askedBy: "U_COLLEAGUE",
      card: RESUME_CARD,
      briefPath,
      dispatchId: DISPATCH_ID,
      home,
      ownerDirectives: undefined,
      ownerUserId: "U_OWNER",
      profile: undefined,
      question: "what are my open PRs?",
      record,
      surface: "channel",
    }).join("\n");

    expect(text).toContain(
      `0b. Keep the thread's card honest, from now until you post — every few minutes and at every change of activity: slopweaver turn status --brief ${briefPath} --status "<what you are doing right now>" --tier fresh-visible-session --home ${home}`,
    );
  });

  // The ticker is the half that does not depend on the worker remembering anything, so it is step 0a and the
  // stages are 0b. `turn watch` once appeared NOWHERE in these printed lines — it lived only in
  // the loop supervisor's own skill docs, and a worker reading its own brief had no way to learn it existed.
  it("names the turn watch ticker as step 0a, ahead of the stages, with this brief and home on it", () => {
    const { briefPath, home } = dispatchedFixture();
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath,
      decision: DECISION,
      dispatchId: DISPATCH_ID,
      execution: ROUTING_INPUT.execution,
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      schemaVersion: 3,
      session: {
        host: "claude-code",
        surfaceId: "id-surface:1",
        surfaceRef: "surface:1",
        workspaceId: "id-workspace:1",
        workspaceRef: "workspace:1",
      },
    };

    const lines = freshResumeLines({
      askedBy: "U_COLLEAGUE",
      card: RESUME_CARD,
      briefPath,
      dispatchId: DISPATCH_ID,
      home,
      ownerDirectives: undefined,
      ownerUserId: "U_OWNER",
      profile: undefined,
      question: "what are my open PRs?",
      record,
      surface: "channel",
    });

    const ticker = lines.findIndex((line) => line.includes("0a. Start the card's clock"));
    const stages = lines.findIndex((line) => line.includes("0b. Keep the thread"));
    // The launcher is the RESOLVED absolute path of this checkout's own `bin/slopweaver`. Finding 688: it
    // used to be the literal `${CLAUDE_PLUGIN_ROOT}/bin/slopweaver`, which the harness substitutes when it
    // reads a `SKILL.md` and a worker's shell leaves empty — so the pasted line ran `/bin/slopweaver` and
    // the trailing `&` reported exit 0 over the failure. Resolved from the test's own module URL, which
    // sits in the same tree, so this is the path the verb prints rather than a restatement of it.
    const launcher = bundledLauncherPath({ importMetaUrl: import.meta.url });
    expect(lines[ticker]).toBe(
      "  0a. Start the card's clock ONCE, right now, backgrounded with a bare & — never nohup, never setsid, " +
        `never disown, which buy nothing: "${launcher}" turn watch --brief ${briefPath} --home ${home} &`,
    );
    expect(lines[ticker]!.includes("CLAUDE_PLUGIN_ROOT")).toBe(false);
    // The line under 0a tells the worker the ticker is NOT its child and reaps itself, so it does not go
    // looking for a process to stop. Measured: a bare `&` job has ppid 1 before the call
    // returns, so the old wording promised a lifetime nothing delivered.
    expect(lines[ticker + 1]).toBe(
      "      It is NOT a child of this session — measured, a backgrounded job is reparented to pid 1 before " +
        `the call returns — so it reaps itself once you are orphaned AND have gone ${String(Math.round(ORPHAN_SILENCE_MS / 60_000))} minutes with no tool call — never while the turn is blocked on the owner. Nothing for you to stop.`,
    );
    expect(stages).toBe(ticker + 2);
  });

  it("states the exact provenance label the door will check, from THIS dispatch's own workspace", () => {
    const { briefPath, home } = dispatchedFixture();
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath,
      decision: DECISION,
      dispatchId: DISPATCH_ID,
      execution: ROUTING_INPUT.execution,
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      schemaVersion: 3,
      session: {
        host: "claude-code",
        sessionName: "ask-C1-1785000000.000100",
        surfaceId: "id-surface:1",
        surfaceRef: "surface:1",
        workspaceId: "id-workspace:1",
        workspaceRef: "workspace:218",
      },
    };

    const text = freshResumeLines({
      askedBy: "U_COLLEAGUE",
      card: RESUME_CARD,
      briefPath,
      dispatchId: DISPATCH_ID,
      home,
      ownerUserId: "U_OWNER",
      surface: "channel",
      ownerDirectives: undefined,
      profile: undefined,
      question: "what are my open PRs?",
      record,
    }).join("\n");

    expect(text).toContain(
      'PROVENANCE: your answer\'s grounding.provenance.model must read exactly "the dispatched worker in workspace:218 (Claude Code, in-turn)"',
    );
  });
});
