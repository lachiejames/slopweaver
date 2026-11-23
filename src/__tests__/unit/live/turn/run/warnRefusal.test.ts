import { describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";

import type { TurnCompletion } from "../../../../../live/turn/envelope.js";
import { MENTION } from "./fixtures.js";
import { driveRaw, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

/**
 * The other measured case, and the one that reads as the opposite of the five assertions in
 * `doorRefusal.test.ts`.
 *
 * Ask `C0SYN000001/1790048248.995219`: the door refused the send over ONE warn-tier finding —
 * a word rule, correctable in the answer's own bytes — and the turn ended anyway. The `failed` completion
 * superseded the ask's dispatch record, so `turn resume --dispatch` and `turn answer --dispatch` both
 * answered "no dispatch record found", and the failure card tagging the owner went up publicly for an answer
 * the worker was still holding. Nothing here had been lost, so nothing here should have been settled.
 */
describe("runTurn when the admit door refuses on WARN-tier findings alone", () => {
  const WARN_REFUSAL =
    "the admit door refused to post the turn's answer — VOICE_RULE_BROKEN: body.runs[0] matches the " +
    'configured word voice rule "genuinely" for the bot lane';

  it("returns the refusal rather than a completion, and folds no durable record at all", async () => {
    const completions: TurnCompletion[] = [];
    const refusal = unwrapErr(
      await driveRaw({
        complete: async ({ completion }) => {
          completions.push(completion);
        },
        mention: MENTION,
        poster: recordingPoster({ log: [], warnRefusal: WARN_REFUSAL }),
        query: fakeQuery({ phases: ["loaded", "ranked"] }),
      }),
    );

    expect(refusal.code).toBe("ANSWER_SEND_WARN_REFUSED");
    expect(refusal.message).toBe(WARN_REFUSAL);
    expect(completions).toEqual([]);
  });

  it("settles no indicator — no notice, no reaction, no cleared status, no finished checklist", async () => {
    const log: Recorded[] = [];
    await driveRaw({
      mention: MENTION,
      poster: recordingPoster({ log, warnRefusal: WARN_REFUSAL }),
      query: fakeQuery({ phases: ["loaded"] }),
    });

    // The witness the turn genuinely got as far as offering the answer, so the absences below are the code's
    // decision rather than a turn that never ran.
    expect(log.some((entry) => entry.kind === "post-answer")).toBe(true);
    expect(log.filter((entry) => ["delete-working", "end-status", "finalize"].includes(entry.kind))).toEqual([]);
    expect(log.filter((entry) => ["post-notice", "reap", "settle-reaction"].includes(entry.kind))).toEqual([]);
  });

  it("stops the status re-assert timer without writing to Slack, because the turn is not over", async () => {
    // The timer is not `unref`'d, so leaving it running re-raises the indicator for as long as this process
    // lives; clearing the indicator would instead tell the thread the bot stopped looking, which it has not.
    const log: Recorded[] = [];
    await driveRaw({
      mention: MENTION,
      poster: recordingPoster({ log, warnRefusal: WARN_REFUSAL }),
      query: fakeQuery({ phases: ["loaded"] }),
    });

    expect(log.filter((entry) => entry.kind === "stop-status-reasserting").length).toBe(1);
    expect(log.some((entry) => entry.kind === "end-status")).toBe(false);
  });
});
