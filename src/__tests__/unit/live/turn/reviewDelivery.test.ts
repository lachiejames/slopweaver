/**
 * The reviewer delivery witness, over a FIXTURE cmux inventory — rows shaped exactly as
 * `cmux/client.ts`'s parse produces them, one carrying the submitted field and one without it, because that
 * single difference is the whole incident: the stranded reviewer's row had neither
 * `latest_submitted_message` nor `latest_submitted_at`, and nothing asked.
 */
import { describe, expect, it } from "vitest";
import { CMUX_SUBMITTED_MESSAGE_MAX_CHARS } from "../../../../cmux/sendEvidence.js";
import { witnessFromScreen } from "../../../../cmux/witness.js";
import { type ReviewRecord, reviewerPickupPrompt } from "../../../../live/turn/review.js";
import {
  REVIEWER_UNSUBMITTED_AFTER_MS,
  reviewerDelivery,
  reviewerPickupResubmission,
  reviewerStrandedness,
  unsubmittedReviewerMinutes,
} from "../../../../live/turn/reviewDelivery.js";
import {
  type ReviewPollTruth,
  reviewPollClosure,
  reviewPollLines,
  reviewPollTruth,
} from "../../../../live/turn/reviewPoll.js";

const REVIEWER = {
  host: "claude-code" as const,
  surfaceId: "id-surface:987",
  surfaceRef: "surface:987",
  workspaceId: "id-workspace:987",
  workspaceRef: "workspace:987",
};

const RECORD: ReviewRecord = {
  answerDigest: `sha256:${"a".repeat(64)}`,
  answerPath: "/tmp/answer.json",
  authorSession: "author workspace workspace:1 (id-workspace:1)",
  carriedUnresolved: [],
  channel: "C1",
  messageTs: "1788325215.000100",
  packetPath: "/tmp/reviews/C1-1788325215.000100/packet.md",
  reviewer: REVIEWER,
  reviewerSession: "reviewer workspace workspace:987 (id-workspace:987)",
  round: 1,
  schemaVersion: 2,
  spawnedAt: "2026-09-02T05:00:00.000Z",
  threadTs: "1788325215.000100",
  verdictPath: "/tmp/reviews/C1-1788325215.000100/verdict.json",
};

const PICKUP = reviewerPickupPrompt({ packetPath: RECORD.packetPath, verdictPath: RECORD.verdictPath });

/** One inventory row, in the shape `parseWorkspaceSummary` produces — the two fields under test, and nothing else. */
function row({
  latestSubmittedAtIso,
  latestSubmittedMessage,
}: {
  latestSubmittedAtIso: string | undefined;
  latestSubmittedMessage: string | undefined;
}): { readonly latestSubmittedAtIso: string | undefined; readonly latestSubmittedMessage: string | undefined } {
  return { latestSubmittedAtIso, latestSubmittedMessage };
}

/** The row cmux showed for workspace:987 — a reviewer booted, and nothing ever submitted to it. */
const WITHOUT_SUBMITTED = row({ latestSubmittedAtIso: undefined, latestSubmittedMessage: undefined });

/** The same row for a healthy reviewer, truncated by cmux exactly as a real one is. */
const WITH_SUBMITTED = row({
  latestSubmittedAtIso: "2026-09-02T05:00:04.000Z",
  latestSubmittedMessage: `${PICKUP.slice(0, CMUX_SUBMITTED_MESSAGE_MAX_CHARS)}…`,
});

const ALIVE = { kind: "alive" as const, pid: 41, process: "2.1.241", workspaceId: REVIEWER.workspaceId };

/**
 * A composer rendering one long line the way Claude Code's actually does — hard-wrapped at the pane width
 * mid-token, with the continuation indented. Measured against v2.1.258.
 */
function composerScreen({ text, width = 70 }: { text: string; width?: number }): string {
  const rows: string[] = [];
  for (let at = 0; at < text.length; at += width) {
    rows.push(`${at === 0 ? "> " : "  "}${text.slice(at, at + width)}`);
  }
  return `╭────╮\n${rows.join("\n")}\n╰────╯\n  ? for shortcuts`;
}

describe("reviewerDelivery", () => {
  it("confirms delivery from a row cmux truncated, because the comparison is a prefix", () => {
    expect(reviewerDelivery({ pickup: PICKUP, workspace: WITH_SUBMITTED })).toStrictEqual({
      kind: "confirmed",
      submittedAtIso: "2026-09-02T05:00:04.000Z",
    });
  });

  it("reports `none` for the stranded row — neither field set", () => {
    expect(reviewerDelivery({ pickup: PICKUP, workspace: WITHOUT_SUBMITTED })).toStrictEqual({ kind: "none" });
  });

  it("reports `none` when the inventory names no such workspace at all", () => {
    expect(reviewerDelivery({ pickup: PICKUP, workspace: undefined })).toStrictEqual({ kind: "none" });
  });

  it("reports other traffic when something was submitted that is not this pickup", () => {
    const other = row({ latestSubmittedAtIso: "2026-09-02T05:09:00.000Z", latestSubmittedMessage: "ls -la" });
    expect(reviewerDelivery({ pickup: PICKUP, workspace: other })).toStrictEqual({
      kind: "other-traffic",
      submittedAtIso: "2026-09-02T05:09:00.000Z",
    });
  });

  it("reports other traffic from a bare timestamp with no message, rather than calling it stranded", () => {
    const timestampOnly = row({ latestSubmittedAtIso: "2026-09-02T05:09:00.000Z", latestSubmittedMessage: undefined });
    expect(reviewerDelivery({ pickup: PICKUP, workspace: timestampOnly }).kind).toBe("other-traffic");
  });
});

describe("unsubmittedReviewerMinutes", () => {
  const none = { kind: "none" as const };

  it("counts the whole minutes a reviewer with no delivery record has been sitting", () => {
    expect(
      unsubmittedReviewerMinutes({ delivery: none, nowIso: "2026-09-02T05:14:00.000Z", spawnedAt: RECORD.spawnedAt }),
    ).toBe(14);
  });

  it("says nothing inside the bound, so a reviewer that just booted is never reported", () => {
    expect(
      unsubmittedReviewerMinutes({ delivery: none, nowIso: "2026-09-02T05:00:30.000Z", spawnedAt: RECORD.spawnedAt }),
    ).toBeUndefined();
  });

  it("fires the moment the bound is reached, and not a tick before", () => {
    const spawned = Date.parse(RECORD.spawnedAt);
    const atBound = new Date(spawned + REVIEWER_UNSUBMITTED_AFTER_MS).toISOString();
    const justUnder = new Date(spawned + REVIEWER_UNSUBMITTED_AFTER_MS - 1).toISOString();
    expect(unsubmittedReviewerMinutes({ delivery: none, nowIso: atBound, spawnedAt: RECORD.spawnedAt })).toBe(5);
    expect(
      unsubmittedReviewerMinutes({ delivery: none, nowIso: justUnder, spawnedAt: RECORD.spawnedAt }),
    ).toBeUndefined();
  });

  it("says nothing about a delivery that was confirmed, however long ago it was spawned", () => {
    expect(
      unsubmittedReviewerMinutes({
        delivery: { kind: "confirmed", submittedAtIso: undefined },
        nowIso: "2026-09-02T09:00:00.000Z",
        spawnedAt: RECORD.spawnedAt,
      }),
    ).toBeUndefined();
  });

  it("says nothing when either instant is unreadable, rather than inventing a duration", () => {
    expect(
      unsubmittedReviewerMinutes({ delivery: none, nowIso: "not-a-time", spawnedAt: RECORD.spawnedAt }),
    ).toBeUndefined();
    expect(
      unsubmittedReviewerMinutes({ delivery: none, nowIso: "2026-09-02T05:14:00.000Z", spawnedAt: "whenever" }),
    ).toBeUndefined();
  });
});

describe("reviewPollTruth over the two inventory rows", () => {
  /** One poll of the stranded row at 14m, over whatever the reviewer's screen is rendering. */
  function polled({ screen }: { screen: string | undefined }): ReviewPollTruth {
    return reviewPollTruth({
      delivery: reviewerDelivery({ pickup: PICKUP, workspace: WITHOUT_SUBMITTED }),
      liveness: ALIVE,
      nowIso: "2026-09-02T05:14:00.000Z",
      record: RECORD,
      screen,
      verdictRead: { kind: "absent" },
    });
  }

  it("reports the stranded row as a DOUBT, not `still working` and not a never-started certainty", () => {
    expect(polled({ screen: undefined })).toStrictEqual({
      kind: "delivery-unwitnessed",
      reason: "the reviewer's screen could not be read, so nothing says what is in its input",
      waitedMinutes: 14,
      workspaceRef: "workspace:987",
    });
  });

  it("reports a pickup typed into an idle box as provably unsent, which is the arm the sweep acts on", () => {
    expect(polled({ screen: composerScreen({ text: PICKUP }) })).toStrictEqual({
      kind: "pickup-unsent",
      reason: "the pickup line is typed into an idle input box and cmux has no record of it ever being submitted",
      waitedMinutes: 14,
      workspaceRef: "workspace:987",
    });
  });

  // The defect, as a test: workspace:295 was read WORKING at 5m22s while the poll — holding this
  // same screen and discarding it — called it NEVER STARTED and prescribed `turn dispatch --sweep` over it.
  it("reports a reviewer whose screen shows a running turn as WORKING, missing delivery record and all", () => {
    expect(polled({ screen: `${composerScreen({ text: PICKUP })}\n  esc to interrupt` })).toStrictEqual({
      kind: "working",
      reconciledDoubt:
        "a turn is running or a message is queued on its screen — this reviewer is working, and its own input is not yours",
    });
  });

  it("reports a reviewer with a message queued behind its turn as WORKING too", () => {
    expect(polled({ screen: `${composerScreen({ text: PICKUP })}\n  Press up to edit queued messages` }).kind).toBe(
      "working",
    );
  });

  it("reports the SAME record as still working, with nothing to reconcile, once the row carries the submitted field", () => {
    const truth = reviewPollTruth({
      delivery: reviewerDelivery({ pickup: PICKUP, workspace: WITH_SUBMITTED }),
      liveness: ALIVE,
      nowIso: "2026-09-02T05:14:00.000Z",
      record: RECORD,
      screen: undefined,
      verdictRead: { kind: "absent" },
    });
    expect(truth).toStrictEqual({ kind: "working", reconciledDoubt: undefined });
  });

  it("still reports a dead reviewer as phantom, never as an unwitnessed delivery", () => {
    const truth = reviewPollTruth({
      delivery: reviewerDelivery({ pickup: PICKUP, workspace: WITHOUT_SUBMITTED }),
      liveness: {
        kind: "phantom",
        reason: "the workspace is gone",
        why: "workspace-gone",
        workspaceId: REVIEWER.workspaceId,
      },
      nowIso: "2026-09-02T05:14:00.000Z",
      record: RECORD,
      screen: undefined,
      verdictRead: { kind: "absent" },
    });
    expect(truth.kind).toBe("phantom");
  });
});

describe("reviewPollLines / reviewPollClosure for the two unwitnessed arms", () => {
  const unsent = {
    kind: "pickup-unsent" as const,
    reason: "the pickup line is typed into an idle input box and cmux has no record of it ever being submitted",
    waitedMinutes: 14,
    workspaceRef: "workspace:987",
  };
  const doubt = {
    kind: "delivery-unwitnessed" as const,
    reason: "the reviewer's screen could not be read, so nothing says what is in its input",
    waitedMinutes: 14,
    workspaceRef: "workspace:987",
  };

  it("names the workspace and the wait on the provable arm, and does not call the review done", () => {
    const printed = reviewPollLines({ truth: unsent });
    expect(printed.done).toBe(false);
    expect(printed.lines[0]).toBe(
      "reviewer pickup TYPED AND UNSENT: nothing has been submitted to workspace:987 in the 14m since it was " +
        "spawned, and the pickup line is typed into an idle input box and cmux has no record of it ever being submitted",
    );
    expect(printed.lines[1]).toContain("slopweaver turn dispatch --sweep");
  });

  // The remedy the finding asked for by name: look before you act, because absence is not proof.
  it("phrases the DOUBT as a confirmation step, never as a certainty and never as an unconditional re-submit", () => {
    const printed = reviewPollLines({ truth: doubt });
    expect(printed.done).toBe(false);
    expect(printed.lines[0]).toBe(
      "reviewer delivery UNWITNESSED: cmux holds no record of anything submitted to workspace:987 in the 14m " +
        "since it was spawned — the reviewer's screen could not be read, so nothing says what is in its input",
    );
    expect(printed.lines[1]).toBe(
      "no delivery record found is a DOUBT and never proof the reviewer never started: confirm with slopweaver " +
        "cmux read-screen --workspace workspace:987 before re-submitting",
    );
    expect(printed.lines[2]).toContain("a turn running on that screen means the reviewer is WORKING");
  });

  it("never tells a reader to type the line in by hand, on either arm", () => {
    for (const truth of [unsent, doubt]) {
      expect(reviewPollLines({ truth }).lines.join("\n")).toContain("Never type the line in by hand");
    }
  });

  it("says something different from the still-working line, which is the whole defect", () => {
    const working = reviewPollLines({ truth: { kind: "working", reconciledDoubt: undefined } }).lines[0];
    expect(reviewPollLines({ truth: unsent }).lines[0]).not.toBe(working);
    expect(reviewPollLines({ truth: doubt }).lines[0]).not.toBe(working);
  });

  it("carries the reconciliation on the working line when the screen settled a missing delivery record", () => {
    expect(reviewPollLines({ truth: { kind: "working", reconciledDoubt: "a turn is running" } }).lines[0]).toBe(
      "reviewer still working — no verdict yet; poll again. cmux holds no delivery record for its pickup, " +
        "which reconciles off the screen instead: a turn is running",
    );
  });

  it("refuses to close either, and says re-submitting is what the provable one wants", () => {
    expect(reviewPollClosure({ truth: unsent })).toStrictEqual({
      closeWorkspace: false,
      releaseLedger: false,
      reason:
        "the reviewer's pickup is sitting typed and unsent — it wants re-submitting rather than its workspace closing",
    });
    const held = reviewPollClosure({ truth: doubt });
    expect(held.closeWorkspace).toBe(false);
    expect(held.releaseLedger).toBe(false);
    expect(held.reason).toContain("a doubt and not proof it stopped");
  });
});

describe("reviewerStrandedness", () => {
  const idleWithPickup = `╭─────────╮\n│ > ${PICKUP}\n╰─────────╯\n  ? for shortcuts`;

  it("answers mid-turn BEFORE it looks for the pickup text, because a working session renders it too", () => {
    // The ordering IS the fix: `composerHoldsText` matches a transcript exactly as readily as an input box,
    // so asking it first would call every reviewer that is mid-turn on its own pickup `typed-unsent`.
    expect(
      reviewerStrandedness({
        delivery: { kind: "none" },
        host: "claude-code",
        pickup: PICKUP,
        screen: `${idleWithPickup}\n  esc to interrupt`,
      }).kind,
    ).toBe("mid-turn");
  });

  it("reads a Claude Code reviewer by its own markers, so a printed Codex status line is not a running turn", () => {
    expect(
      reviewerStrandedness({
        delivery: { kind: "none" },
        host: "claude-code",
        pickup: PICKUP,
        screen: `• Working (8s)\n${idleWithPickup}`,
      }).kind,
    ).toBe("typed-unsent");
  });

  it("answers undetermined when cmux's record says anything at all, whatever the screen shows", () => {
    expect(
      reviewerStrandedness({
        delivery: { kind: "confirmed", submittedAtIso: "2026-09-02T05:00:04.000Z" },
        host: "claude-code",
        pickup: PICKUP,
        screen: idleWithPickup,
      }),
    ).toStrictEqual({
      kind: "undetermined",
      reason: "cmux's delivery record for this workspace reads confirmed",
    });
  });

  it("answers typed-unsent only for an idle box holding the pickup", () => {
    expect(
      reviewerStrandedness({ delivery: { kind: "none" }, host: "claude-code", pickup: PICKUP, screen: idleWithPickup })
        .kind,
    ).toBe("typed-unsent");
  });

  // A reviewer inherits its worker's host, and the act typed-unsent licenses is an Enter into somebody else's
  // input — so a codex reviewer is judged by Codex's own composer, never by a screen in Claude Code's shape.
  it("refuses typed-unsent on a codex reviewer whose screen is not Codex's own composer at rest", () => {
    expect(
      reviewerStrandedness({ delivery: { kind: "none" }, host: "codex", pickup: PICKUP, screen: idleWithPickup }),
    ).toStrictEqual({
      kind: "undetermined",
      reason: "the screen does not show Codex's own composer at rest, so nothing says the pickup sits in its input",
    });
  });

  // Codex's measured at-rest layout (`fixtures/codexTui.ts`) with the pickup in the composer, on a terminal wide
  // enough to hold it on the `›` line. A wrapped composer was not measured, so it reads undetermined — never sent.
  it("answers typed-unsent for a codex reviewer whose own idle composer holds the pickup", () => {
    const codexComposer = [
      "• ok",
      "",
      `› ${PICKUP}`,
      " ",
      "  GPT-5.6-Sol default · ~/dev/personal/slopwea…  ⚠ 2 warnings · f2 to view",
    ].join("\n");
    expect(
      reviewerStrandedness({ delivery: { kind: "none" }, host: "codex", pickup: PICKUP, screen: codexComposer }).kind,
    ).toBe("typed-unsent");
  });

  // A narrow pane cuts the queue header with `…` while the pickup waits behind a live turn.
  it("answers mid-turn for a codex reviewer whose cut-off queue header holds the pickup", () => {
    const narrow = [
      "• Messages to be submitted after…",
      `  ↳ ${PICKUP}`,
      " ",
      "› Ask Codex to do anything",
      " ",
      "  GPT-5.6-Sol default · ~/repo",
    ].join("\n");
    expect(
      reviewerStrandedness({ delivery: { kind: "none" }, host: "codex", pickup: PICKUP, screen: narrow }).kind,
    ).toBe("mid-turn");
  });
});

describe("reviewerPickupResubmission", () => {
  const idleWithPickup = `╭─────────╮\n│ > ${PICKUP}\n╰─────────╯\n  ? for shortcuts`;
  const COMPOSER = composerScreen({ text: PICKUP });

  it("submits when the pickup is typed into an idle box and cmux recorded nothing", () => {
    expect(
      reviewerPickupResubmission({
        delivery: { kind: "none" },
        host: "claude-code",
        pickup: PICKUP,
        screen: idleWithPickup,
      }),
    ).toStrictEqual({
      kind: "submit",
      reason: "the pickup line is typed into an idle input box and cmux has no record of it ever being submitted",
    });
  });

  it("holds when cmux already recorded a delivery, whatever the screen shows", () => {
    const held = reviewerPickupResubmission({
      delivery: { kind: "confirmed", submittedAtIso: "2026-09-02T05:00:04.000Z" },
      host: "claude-code",
      pickup: PICKUP,
      screen: idleWithPickup,
    });
    expect(held).toStrictEqual({ kind: "hold", reason: "cmux's delivery record for this workspace reads confirmed" });
  });

  it("holds on an unreadable screen rather than pressing Enter on a guess", () => {
    expect(
      reviewerPickupResubmission({
        delivery: { kind: "none" },
        host: "claude-code",
        pickup: PICKUP,
        screen: undefined,
      }),
    ).toStrictEqual({
      kind: "hold",
      reason: "the reviewer's screen could not be read, so nothing says what is in its input",
    });
  });

  it("holds when the pickup is nowhere on the screen", () => {
    expect(
      reviewerPickupResubmission({
        delivery: { kind: "none" },
        host: "claude-code",
        pickup: PICKUP,
        screen: "> \n  ? for shortcuts",
      }),
    ).toStrictEqual({ kind: "hold", reason: "the pickup line is not visible on the reviewer's screen" });
  });

  it("holds while a turn is running, because that session owns its own input", () => {
    const busy = `${idleWithPickup}\n  esc to interrupt`;
    expect(
      reviewerPickupResubmission({ delivery: { kind: "none" }, host: "claude-code", pickup: PICKUP, screen: busy })
        .kind,
    ).toBe("hold");
  });

  it("holds while a message is queued behind a turn", () => {
    const queued = `${idleWithPickup}\n  Press up to edit queued messages`;
    expect(
      reviewerPickupResubmission({ delivery: { kind: "none" }, host: "claude-code", pickup: PICKUP, screen: queued }),
    ).toStrictEqual({
      kind: "hold",
      reason:
        "a turn is running or a message is queued on its screen — this reviewer is working, and its own input is not yours",
    });
  });

  it("matches a pickup the composer wrapped MID-TOKEN, which is how a real box renders it", () => {
    // Measured against Claude Code v2.1.258: the composer hard-wraps at the pane width with no
    // regard for word boundaries and indents the continuation, so `packet.md` renders as `packet.m` / `  d`.
    // An earlier version of this test wrapped at SPACES and passed while the shipped gate could never fire.
    expect(
      reviewerPickupResubmission({ delivery: { kind: "none" }, host: "claude-code", pickup: PICKUP, screen: COMPOSER })
        .kind,
    ).toBe("submit");
  });

  it("would not match that same wrapped screen under the delivery witness's own narrower comparison", () => {
    // The reason this module owns its comparison rather than reusing `witnessFromScreen`, asserted rather
    // than asserted-in-prose: that function collapses the wrap to one space and leaves `packet.m d`.
    expect(witnessFromScreen({ expected: PICKUP, screen: COMPOSER })).toBeUndefined();
  });

  it("holds when the screen shows a DIFFERENT long line wrapped the same way", () => {
    const other = composerScreen({ text: `${PICKUP.slice(0, 120)} and then something else entirely` });
    expect(
      reviewerPickupResubmission({ delivery: { kind: "none" }, host: "claude-code", pickup: PICKUP, screen: other })
        .kind,
    ).toBe("hold");
  });
});
