import { describe, expect, it } from "vitest";

import { foldActivity, RESUME_MS, RESUME_SOUND_QUIET_MS, type VoiceActivity } from "../../../lib/voiceActivity";
import { RESUME_RETRIES } from "../../../lib/voiceResumeFold";
import { dueAt, SPOKEN_RMS, sounded, steered } from "./resumeHarness";

describe("resumeDueOf", () => {
  // A resume refused as "someone is talking" is tried again, rather than the silence staying spent after one refusal.
  describe("a resume the server refused because someone was talking", () => {
    const firstAt = 2_000 + RESUME_MS;
    /** The silence resumed at `atMs` as post number `post` and refused as transient a moment later. */
    const refusedAt = ({
      activity,
      atMs,
      post,
    }: {
      activity: VoiceActivity;
      atMs: number;
      post: number;
    }): VoiceActivity => {
      const resumed = foldActivity({ activity, input: { kind: "resumed", post }, nowMs: atMs });
      return foldActivity({ activity: resumed, input: { kind: "resume-refused-transient", post }, nowMs: atMs + 100 });
    };
    const refused = refusedAt({ activity: steered, atMs: firstAt, post: 1 });

    it("is due again a quiet after the refusal, not a millisecond sooner", () => {
      expect([
        dueAt({ activity: refused, nowMs: firstAt + 100 + RESUME_SOUND_QUIET_MS - 1 }),
        dueAt({ activity: refused, nowMs: firstAt + 100 + RESUME_SOUND_QUIET_MS }),
      ]).toEqual([false, true]);
    });

    it(`is tried ${String(RESUME_RETRIES)} more times, then the silence stays spent`, () => {
      const second = refusedAt({ activity: refused, atMs: firstAt + 2_100, post: 2 });
      const third = refusedAt({ activity: second, atMs: firstAt + 4_200, post: 3 });
      expect([
        RESUME_RETRIES,
        dueAt({ activity: second, nowMs: firstAt + 4_200 }),
        third.resumeAttempts,
        dueAt({ activity: third, nowMs: firstAt + 60_000 }),
      ]).toEqual([2, true, 3, false]);
    });

    it("keeps the retry owed, and its count, across a late fragment with no sound from the owner since", () => {
      const late = foldActivity({
        activity: refused,
        input: { kind: "heard", text: " channel." },
        nowMs: firstAt + 700,
      });
      expect([
        late.resumeAttempts,
        dueAt({ activity: late, nowMs: firstAt + 700 + RESUME_SOUND_QUIET_MS - 1 }),
        dueAt({ activity: late, nowMs: firstAt + 700 + RESUME_SOUND_QUIET_MS }),
      ]).toEqual([1, false, true]);
    });

    it("starts a fresh count for new words after new sound from the owner", () => {
      const spoke = sounded({
        activity: refused,
        micLevel: 0.5,
        micRms: SPOKEN_RMS,
        nowMs: firstAt + 1_000,
        outputLevel: 0,
      });
      const again = foldActivity({ activity: spoke, input: { kind: "heard", text: " go on" }, nowMs: firstAt + 1_200 });
      expect([
        again.resumeAttempts,
        again.resumeRetryMs,
        dueAt({ activity: again, nowMs: firstAt + 1_200 + RESUME_MS }),
      ]).toEqual([0, undefined, true]);
    });

    it("is never retried once the resume was taken", () => {
      const taken = foldActivity({ activity: steered, input: { kind: "resumed", post: 1 }, nowMs: firstAt });
      expect([taken.resumeRetryMs, dueAt({ activity: taken, nowMs: firstAt + 60_000 })]).toEqual([undefined, false]);
    });

    // The page posts again before an older post's answer is back.
    it("is not re-armed by an older post's refusal landing after a newer silence's post was taken", () => {
      const first = foldActivity({ activity: steered, input: { kind: "resumed", post: 1 }, nowMs: firstAt });
      const spoke = sounded({
        activity: first,
        micLevel: 0.5,
        micRms: SPOKEN_RMS,
        nowMs: firstAt + 1_000,
        outputLevel: 0,
      });
      const again = foldActivity({ activity: spoke, input: { kind: "heard", text: " go on" }, nowMs: firstAt + 1_200 });
      const secondAt = firstAt + 1_200 + RESUME_MS;
      const second = foldActivity({ activity: again, input: { kind: "resumed", post: 2 }, nowMs: secondAt });
      const stale = foldActivity({
        activity: second,
        input: { kind: "resume-refused-transient", post: 1 },
        nowMs: secondAt + 100,
      });
      expect([
        dueAt({ activity: second, nowMs: secondAt + 60_000 }),
        stale.resumeRetryMs,
        dueAt({ activity: stale, nowMs: secondAt + 60_000 }),
      ]).toEqual([false, undefined, false]);
    });

    it("keeps a new silence's full five seconds when an older post's refusal lands inside it", () => {
      const first = foldActivity({ activity: steered, input: { kind: "resumed", post: 1 }, nowMs: firstAt });
      const spoke = sounded({
        activity: first,
        micLevel: 0.5,
        micRms: SPOKEN_RMS,
        nowMs: firstAt + 1_000,
        outputLevel: 0,
      });
      const heardAt = firstAt + 1_200;
      const again = foldActivity({ activity: spoke, input: { kind: "heard", text: " go on" }, nowMs: heardAt });
      const stale = foldActivity({
        activity: again,
        input: { kind: "resume-refused-transient", post: 1 },
        nowMs: heardAt + 100,
      });
      expect([
        stale.resumeRetryMs,
        dueAt({ activity: stale, nowMs: heardAt + 100 + RESUME_SOUND_QUIET_MS }),
        dueAt({ activity: stale, nowMs: heardAt + RESUME_MS }),
      ]).toEqual([undefined, false, true]);
    });
  });
});
