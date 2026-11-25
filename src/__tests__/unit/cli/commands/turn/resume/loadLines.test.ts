/**
 * `slopweaver turn resume --dispatch` (LOAD mode) — the lines `freshResumeLines` prints a fresh visible session:
 * owner directives and standing rules, the unprompted and stood-down openers, the posted-plan follow-up, the
 * deliverable and scope discipline, the user-facing impact block and the trusted-tier tag decision tree.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { freshResumeLines } from "../../../../../../cli/commands/turn/resumeLines.js";
import type { FreshDispatchRecord } from "../../../../../../live/turn/dispatch.js";
import { userFacingImpactPreflightLines } from "../../../../../../live/turn/userFacingImpactGuidance.js";
import { visualEvidencePreflightLines } from "../../../../../../live/turn/visualEvidenceGuidance.js";
import { removeFixtureDirs } from "../dispatch/harness.js";
import { ASK_IDENTITY, DECISION, DISPATCH_ID, RESUME_CARD, ROUTING_INPUT } from "./fixtures.js";
import { dispatchedFixture } from "./harness.js";

afterEach(removeFixtureDirs);

describe("turn resume --dispatch (LOAD mode)", () => {
  it("carries frozen current-owner rulings into a fresh visible session without printing their text", () => {
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath: "/tmp/brief.json",
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
    const directive = {
      id: "verified-fallback",
      source: { contentHash: `sha256:${"1".repeat(64)}`, file: "fallback.md", modified: null },
      text: "use the direct fallback",
    };
    const text = freshResumeLines({
      askedBy: "U_COLLEAGUE",
      card: RESUME_CARD,
      briefPath: record.briefPath,
      dispatchId: DISPATCH_ID,
      home: "/tmp/empty-home",
      ownerUserId: "U_OWNER",
      surface: "channel",
      ownerDirectives: [directive],
      profile: undefined,
      question: "the normal finalizer broke again",
      record,
    }).join("\n");

    expect(text).toContain("CURRENT OWNER DIRECTIVES: 1 loaded.");
    expect(text).toContain("routingInput.ownerDirectives");
    expect(text).not.toContain(directive.text);
  });

  it("prints the standing owner rule to a dispatched worker carrying no profile and no directive", () => {
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath: "/tmp/brief.json",
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
      briefPath: record.briefPath,
      dispatchId: DISPATCH_ID,
      home: "/tmp/empty-home",
      ownerUserId: "U_OWNER",
      surface: "channel",
      ownerDirectives: undefined,
      profile: undefined,
      question: "who has been slowest to close out their assigned tickets?",
      record,
    }).join("\n");

    expect(text).toContain("CURRENT OWNER DIRECTIVES: none loaded.");
    expect(text).toContain("WHAT MAY BE ASKED — the standing owner rule, and it never loads conditionally:");
    expect(text).toContain("Tact is the ASKER's onus, never yours.");
    expect(text).toContain("It removes a refusal, never a standard.");
    expect(text).toContain("WHAT THE REPLY MAY SHARE — standing owner rulings, and it never loads");
    expect(text).toContain("--need risky-approval");
    expect(text.indexOf("WHAT HAPPENS TO THIS ASK")).toBeLessThan(text.indexOf("WHAT THE REPLY MAY SHARE"));
    expect(text).not.toContain("UNPROMPTED");
  });

  it("tells a worker `witness help` dispatched that nobody tagged it, straight under the question", () => {
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath: "/tmp/brief.json",
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
      briefPath: record.briefPath,
      card: RESUME_CARD,
      dispatchId: DISPATCH_ID,
      home: "/tmp/empty-home",
      ownerDirectives: undefined,
      ownerUserId: "U_OWNER",
      profile: undefined,
      question: "anything I can do to assist?",
      record,
      surface: "channel",
      unprompted: true,
    });

    expect(lines.slice(0, 2)).toEqual([
      "QUESTION: anything I can do to assist?",
      "UNPROMPTED — nobody tagged this bot in this message. `witness help` opened it as an ask because the thread,",
    ]);
    expect(lines.join("\n")).toContain("A status question asked of someone else IS answerable.");
    expect(lines.join("\n")).not.toContain("STOOD DOWN");

    const stoodDown = freshResumeLines({
      askedBy: "U_COLLEAGUE",
      briefPath: record.briefPath,
      card: RESUME_CARD,
      dispatchId: DISPATCH_ID,
      home: "/tmp/empty-home",
      ownerDirectives: undefined,
      ownerUserId: "U_OWNER",
      profile: undefined,
      question: "fyi it's Melbourne now",
      record,
      stoodDown: true,
      surface: "channel",
    });

    expect(stoodDown.slice(0, 2)).toEqual([
      "QUESTION: fyi it's Melbourne now",
      "STOOD DOWN — earlier in this thread somebody told the bot it was in the way, and it stood down: it reacted,",
    ]);
  });

  it("tells a worker whose plan is already posted that its next answer is the FINAL one, not another plan", () => {
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath: "/tmp/brief.json",
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
    const linesWith = ({ posted }: { posted: boolean }): string =>
      freshResumeLines({
        askedBy: "U_COLLEAGUE",
        briefPath: record.briefPath,
        card: RESUME_CARD,
        dispatchId: DISPATCH_ID,
        ...(posted
          ? {
              firstAnswer: {
                ...ASK_IDENTITY,
                answerDigest: "digest-of-the-plan",
                answerTs: "1790926498.645000",
                kind: "first-answered" as const,
                leaseExpiresAt: "2026-10-02T09:34:58.645Z",
                owes: "pull-requests" as const,
                tsIso: "2026-10-02T07:34:58.645Z",
                what: "open the two pull requests the plan names",
              },
            }
          : {}),
        home: "/tmp/empty-home",
        ownerDirectives: undefined,
        ownerUserId: "U_OWNER",
        profile: undefined,
        question: "raise PRs for both monitors",
        record,
        surface: "channel",
      }).join("\n");

    const after = linesWith({ posted: true });
    const before = linesWith({ posted: false });

    expect(after).toContain("FIRST ANSWER ALREADY POSTED at 2026-10-02T07:34:58.645Z (Slack ts 1790926498.645000)");
    expect(after).toContain("You still owe: open the two pull requests the plan names (pull-requests).");
    expect(after).not.toContain("ANSWER FIRST, THEN TOOLING");
    expect(before).toContain("ANSWER FIRST, THEN TOOLING");
    expect(before).not.toContain("FIRST ANSWER ALREADY POSTED");
  });

  it("names vulnerability-fix-pr in the dispatch brief for a 'raise PRs for these criticals' ask — regression for the retrofit", () => {
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath: "/tmp/brief.json",
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
      briefPath: record.briefPath,
      dispatchId: DISPATCH_ID,
      home: "/tmp/empty-home",
      ownerUserId: "U_OWNER",
      surface: "channel",
      ownerDirectives: undefined,
      profile: undefined,
      question: "raise PRs for these criticals",
      record,
    }).join("\n");

    expect(text).toContain(".agents/skills/vulnerability-fix-pr/SKILL.md");
  });

  it("leads the worker's brief with the core deliverable, ABOVE the decision — the over-scope fix", () => {
    // Order is the fix, not the words: a worker that reads its scope discipline after the decision has
    // already picked up whatever the decision implied. So this asserts the position, not just presence.
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath: "/tmp/brief.json",
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
      briefPath: record.briefPath,
      dispatchId: DISPATCH_ID,
      home: "/tmp/empty-home",
      ownerUserId: "U_OWNER",
      surface: "channel",
      ownerDirectives: undefined,
      profile: undefined,
      question: "deploy those two monitors locally, backtest 7 days and send screenshots",
      record,
    });
    const text = lines.join("\n");

    expect(lines[1]).toBe("CORE DELIVERABLE FIRST — deliver what was literally asked, then stop widening:");
    expect(text).toContain("the send door REFUSES an answer that omits them");
    expect(text).toContain("Do NOT self-assign scope");
    expect(text).toContain("Rigour is unchanged");
  });

  it("still prints the standing scope discipline for an ask that names no artifact class", () => {
    const record: FreshDispatchRecord = {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath: "/tmp/brief.json",
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
      briefPath: record.briefPath,
      dispatchId: DISPATCH_ID,
      home: "/tmp/empty-home",
      ownerUserId: "U_OWNER",
      surface: "channel",
      ownerDirectives: undefined,
      profile: undefined,
      question: "what are my open PRs?",
      record,
    }).join("\n");

    expect(text).toContain("CORE DELIVERABLE FIRST");
    expect(text).not.toContain("the send door REFUSES an answer that omits them");
  });

  const impactLinesFor = ({ question }: { question: string }): readonly string[] =>
    freshResumeLines({
      askedBy: "U_OWNER",
      card: RESUME_CARD,
      briefPath: "/tmp/brief.json",
      dispatchId: DISPATCH_ID,
      home: "/tmp/empty-home",
      ownerUserId: "U_OWNER",
      surface: "channel",
      ownerDirectives: undefined,
      profile: undefined,
      question,
      record: {
        ...ASK_IDENTITY,
        askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
        briefPath: "/tmp/brief.json",
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
      },
    });

  it("prints the user-facing impact block, whole, right after the visual-evidence default for an impact ask", () => {
    const question = "make the setup remember this, since the Acme team will ask for user-facing impact a lot";
    const lines = impactLinesFor({ question });
    const block = userFacingImpactPreflightLines({ question });
    const start = lines.findIndex((line) => line === block[0]);

    expect(lines.slice(start, start + block.length)).toEqual(block);
    expect(lines[start - 1]).toBe(visualEvidencePreflightLines().at(-1));
  });

  it("prints no user-facing impact block for any other ask", () => {
    expect(impactLinesFor({ question: "what are my open PRs?" }).join("\n")).not.toContain("USER-FACING IMPACT");
  });

  it("prints the tag decision tree with the asker's trusted-tier standing read live from the home", () => {
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
    const render = ({ askedBy }: { askedBy: string }): string =>
      freshResumeLines({
        askedBy,
        briefPath,
        card: RESUME_CARD,
        dispatchId: DISPATCH_ID,
        home,
        ownerDirectives: undefined,
        ownerUserId: "U_OWNER",
        profile: undefined,
        question: "what are my open PRs?",
        record,
        surface: "channel",
      }).join("\n");

    expect(render({ askedBy: "U_COLLEAGUE" })).toContain(
      "  (c) No ruling covers it? This asker is NOT on the trusted tier (no trusted-askers.json under " +
        "$SLOPWEAVER_HOME — nobody is on the tier yet), so go to (d).",
    );
    writeFileSync(join(home, "trusted-askers.json"), JSON.stringify(["U_COLLEAGUE"]));
    expect(render({ askedBy: "U_COLLEAGUE" })).toContain(
      "  (c) No ruling covers it? This asker IS on the trusted tier, so investigate.",
    );
    expect(render({ askedBy: "U_STRANGER" })).toContain(
      "  (c) No ruling covers it? This asker is NOT on the trusted tier (`U_STRANGER` is not on " +
        "trusted-askers.json), so go to (d).",
    );
  });
});
