/**
 * `seatAsk`, the board ask a seat writes for the session it opens: the exact command each row runs with its claim
 * token, and each worklist kind's procedure placed directly above a command that runs LAST.
 */
import { describe, expect, it } from "vitest";

import { seatAsk } from "../../../../../../cli/commands/automation/seatAsk.js";
import {
  ALIGNMENT_BRIEFING_KIND,
  BUMP_FIX_KIND,
  CALL_ASSESSMENT_KIND,
  ERROR_TRACKING_BATCH_KIND,
  HYGIENE_SWEEP_KIND,
  INBOX_TRIAGE_KIND,
  LINEAR_BRIEFING_KIND,
  OWED_REPLY_KIND,
  RESYNC_KIND,
  THREAD_CHASE_KIND,
} from "../../../../../../live/automation/kinds.js";

describe("seatAsk", () => {
  it("spells the exact command each row runs, token included", () => {
    const ask = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: RESYNC_KIND,
          recipeId: "resync-atlas-trelica",
          slotIso: "2026-09-15T23:00:00.000Z",
        },
      ],
    });
    expect(ask).toContain("slopweaver automation run-due --recipe resync-atlas-trelica --claim-id token-0001");
  });

  it("points at the skill rather than restating what the session should do", () => {
    const ask = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: RESYNC_KIND,
          recipeId: "resync-atlas-trelica",
          slotIso: "2026-09-15T23:00:00.000Z",
        },
      ],
    });
    expect(ask).toContain("skills/automation/SKILL.md");
  });

  it("puts the bump-fix procedure directly above a bump-fix row's command, which it says runs LAST", () => {
    const ask = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: RESYNC_KIND,
          recipeId: "resync-atlas-trelica",
          slotIso: "2026-09-15T23:00:00.000Z",
        },
        {
          claimId: "token-0002",
          kind: BUMP_FIX_KIND,
          recipeId: "bump-fix-slopweaver",
          slotIso: "2026-09-15T23:00:00.000Z",
        },
      ],
    });
    const lines = ask.split("\n");
    const command = lines.indexOf("  slopweaver automation run-due --recipe bump-fix-slopweaver --claim-id token-0002");
    expect(command).toBeGreaterThan(0);
    expect(lines[command - 1]).toBe(
      "  (bump-fix: follow skills/automation/reference/bump-fix.md — work the bump worklist to its end FIRST, " +
        "then run this command LAST to settle the firing)",
    );
  });

  // The claim order sorts `bump-fix-slopweaver` before `hygiene-sweep`, and "one row at a time, in this
  // order" would then settle the bump firing before the session's other row.
  it("lists a bump-fix row after every other row it was claimed beside", () => {
    const ask = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: BUMP_FIX_KIND,
          recipeId: "bump-fix-slopweaver",
          slotIso: "2026-09-26T22:15:00.000Z",
        },
        {
          claimId: "token-0002",
          kind: HYGIENE_SWEEP_KIND,
          recipeId: "hygiene-sweep",
          slotIso: "2026-09-26T21:15:00.000Z",
        },
      ],
    });
    expect(ask.split("\n").filter((line) => line.includes("automation run-due"))).toEqual([
      "  slopweaver automation run-due --recipe hygiene-sweep --claim-id token-0002",
      "  slopweaver automation run-due --recipe bump-fix-slopweaver --claim-id token-0001",
    ]);
  });

  it("puts the error-tracking-batch procedure above its command, and lists it after a non-worklist row", () => {
    const ask = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: ERROR_TRACKING_BATCH_KIND,
          recipeId: "error-tracking-batch-acme-admin",
          slotIso: "2026-10-04T23:00:00.000Z",
        },
        {
          claimId: "token-0002",
          kind: RESYNC_KIND,
          recipeId: "resync-atlas-trelica",
          slotIso: "2026-10-04T23:00:00.000Z",
        },
      ],
    });
    const lines = ask.split("\n");
    expect(lines.filter((line) => line.includes("automation run-due"))).toEqual([
      "  slopweaver automation run-due --recipe resync-atlas-trelica --claim-id token-0002",
      "  slopweaver automation run-due --recipe error-tracking-batch-acme-admin --claim-id token-0001",
    ]);
    const command = lines.indexOf(
      "  slopweaver automation run-due --recipe error-tracking-batch-acme-admin --claim-id token-0001",
    );
    expect(lines[command - 1]).toBe(
      "  (error-tracking-batch: follow skills/automation/reference/error-tracking-batch.md — raise the batch " +
        "FIRST, then run this command LAST to settle the firing)",
    );
  });

  it("puts the thread-chase procedure above its command, so the chases are parked before the firing settles", () => {
    const lines = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: THREAD_CHASE_KIND,
          recipeId: "thread-chase-daily",
          slotIso: "2026-10-04T23:30:00.000Z",
        },
      ],
    }).split("\n");
    const command = lines.indexOf("  slopweaver automation run-due --recipe thread-chase-daily --claim-id token-0001");
    expect(lines[command - 1]).toBe(
      "  (thread-chase: follow skills/automation/reference/thread-chase.md — park the chases and the finding " +
        "follow-ups (slack finding-followups --json) FIRST, then run this command LAST to settle the firing)",
    );
  });

  it("puts the owed-reply procedure above its command, so the replies are parked before the firing settles", () => {
    const lines = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: OWED_REPLY_KIND,
          recipeId: "slack-owed-daily",
          slotIso: "2026-10-04T22:55:00.000Z",
        },
      ],
    }).split("\n");
    const command = lines.indexOf("  slopweaver automation run-due --recipe slack-owed-daily --claim-id token-0001");
    expect(lines[command - 1]).toBe(
      "  (owed-reply: follow skills/automation/reference/owed-reply.md — park the replies FIRST, " +
        "then run this command LAST to settle the firing)",
    );
  });

  it("puts the call-assessment procedure above its command, so every due call is recorded before the firing settles", () => {
    const lines = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: CALL_ASSESSMENT_KIND,
          recipeId: "call-assessment-daily",
          slotIso: "2026-11-20T10:30:00.000Z",
        },
      ],
    }).split("\n");
    const command = lines.indexOf(
      "  slopweaver automation run-due --recipe call-assessment-daily --claim-id token-0001",
    );
    expect(lines[command - 1]).toBe(
      "  (call-assessment: follow skills/automation/reference/call-assessment.md — classify and record every due " +
        "call, then the day's slice of stored rows, FIRST, then run this command LAST to settle the firing)",
    );
  });

  it("puts the inbox-triage procedure above its command, so the inbox is carded before the firing settles", () => {
    const lines = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: INBOX_TRIAGE_KIND,
          recipeId: "inbox-triage-daily",
          slotIso: "2026-10-01T22:00:00.000Z",
        },
      ],
    }).split("\n");
    const command = lines.indexOf("  slopweaver automation run-due --recipe inbox-triage-daily --claim-id token-0001");
    expect(lines[command - 1]).toBe(
      "  (inbox-triage: follow skills/automation/reference/inbox-triage.md — card the inbox FIRST, " +
        "then run this command LAST to settle the firing)",
    );
  });

  it("puts the linear-briefing procedure above its command, so the briefing is carded before the firing settles", () => {
    const lines = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: LINEAR_BRIEFING_KIND,
          recipeId: "linear-briefing-daily",
          slotIso: "2026-10-26T06:30:00.000Z",
        },
      ],
    }).split("\n");
    const command = lines.indexOf(
      "  slopweaver automation run-due --recipe linear-briefing-daily --claim-id token-0001",
    );
    expect(lines[command - 1]).toBe(
      "  (linear-briefing: follow skills/automation/reference/linear-briefing.md — card the briefing " +
        "FIRST, then run this command LAST to settle the firing)",
    );
  });

  it("puts the alignment-briefing procedure above its command, so the page is carded before the firing settles", () => {
    const lines = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: ALIGNMENT_BRIEFING_KIND,
          recipeId: "alignment-briefing-weekday",
          slotIso: "2026-10-25T21:00:00.000Z",
        },
      ],
    }).split("\n");
    const command = lines.indexOf(
      "  slopweaver automation run-due --recipe alignment-briefing-weekday --claim-id token-0001",
    );
    expect(lines[command - 1]).toBe(
      "  (alignment-briefing: follow skills/automation/reference/alignment-briefing.md — publish the page and " +
        "card FIRST, then run this command LAST to settle the firing)",
    );
  });

  it("gives a resync row no bump-fix procedure", () => {
    const ask = seatAsk({
      seated: [
        {
          claimId: "token-0001",
          kind: RESYNC_KIND,
          recipeId: "resync-atlas-trelica",
          slotIso: "2026-09-15T23:00:00.000Z",
        },
      ],
    });
    expect(ask.includes("bump-fix.md")).toBe(false);
  });
});
