import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { ok } from "../../../../../../lib/result.js";
import type { ParkedPriorAsk } from "../../../../../../outbound/slack/draftRegister.js";
import { harness, RELEASE_SELF, removeFixtureDirs } from "./harness.js";
import { homeWithShot, logOf, ONE_CARD, parkedRow, postedPayload, releaseArgv } from "./release.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite --as me --draft --approve — releasing a parked draft", () => {
  // Every row here is a top-level message into channel C1, so each test releases from a home that holds its picture.
  let shot: ReturnType<typeof homeWithShot>;
  beforeEach(() => {
    shot = homeWithShot();
  });

  describe("a re-ask row re-reads its earlier ask (a read before every send cancels a re-ask)", () => {
    const PERMALINK = "https://acme.slack.com/archives/C1/p1790000000000100";
    const OURS = { text: "is the spend expected?", ts: "1790000000.000100", userId: RELEASE_SELF };
    const FIRST = { text: "yes, the batch job", ts: "1790000100.000100", userId: "U0JONAH" };
    const PRIOR: ParkedPriorAsk = {
      answerCount: 1,
      answers: [FIRST],
      changed: "spend tripled",
      kind: "prior",
      ours: OURS,
      permalink: PERMALINK,
      proof: [{ bytes: 12, name: "spend.png", sha256: "c".repeat(64) }],
      readThroughTs: FIRST.ts,
    };

    it("sends when nobody answered since the recording, the proof bound into the approved digest", async () => {
      const row = parkedRow({
        form: ONE_CARD,
        media: shot.media,
        payload: await postedPayload({ form: ONE_CARD }),
        priorAsk: PRIOR,
      });
      const h = harness({
        draftLog: logOf({ row }),
        priorRead: ok({ addressedTs: OURS.ts, channelTopLevel: [], messages: [OURS, FIRST] }),
      });

      const code = await runSlackWrite({
        argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
        deps: h.deps,
        verb: "post",
      });

      expect(code).toBe(EXIT_OK);
      expect(h.sends.length).toBe(1);
    });

    it("REFUSES when somebody answered after the recording read it, holds the row thread-moved, and sends nothing", async () => {
      const row = parkedRow({
        form: ONE_CARD,
        media: shot.media,
        payload: await postedPayload({ form: ONE_CARD }),
        priorAsk: PRIOR,
      });
      const later = { text: "answered again: still expected", ts: "1790000200.000100", userId: "U0JONAH" };
      const h = harness({
        draftLog: logOf({ row }),
        priorRead: ok({ addressedTs: OURS.ts, channelTopLevel: [], messages: [OURS, FIRST, later] }),
      });

      const code = await runSlackWrite({
        argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
        deps: h.deps,
        verb: "post",
      });

      expect(code).toBe(EXIT_USAGE);
      expect(h.sends).toEqual([]);
      expect(h.draftEvents).toEqual([expect.objectContaining({ id: row.id, kind: "held", reason: "thread-moved" })]);
    });

    it("REFUSES when the answer since the recording was posted at the top of the channel", async () => {
      const row = parkedRow({
        form: ONE_CARD,
        media: shot.media,
        payload: await postedPayload({ form: ONE_CARD }),
        priorAsk: PRIOR,
      });
      const topLevel = { text: "yep, that's the batch job", ts: "1790000200.000100", userId: "U0ADA" };
      const h = harness({
        draftLog: logOf({ row }),
        priorRead: ok({ addressedTs: OURS.ts, channelTopLevel: [topLevel], messages: [OURS, FIRST] }),
      });

      const code = await runSlackWrite({
        argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
        deps: h.deps,
        verb: "post",
      });

      expect(code).toBe(EXIT_USAGE);
      expect(h.sends).toEqual([]);
      expect(h.draftEvents).toEqual([expect.objectContaining({ id: row.id, kind: "held", reason: "thread-moved" })]);
    });

    it("REFUSES when the earlier ask cannot be read, failing closed", async () => {
      const row = parkedRow({
        form: ONE_CARD,
        media: shot.media,
        payload: await postedPayload({ form: ONE_CARD }),
        priorAsk: PRIOR,
      });
      const h = harness({ draftLog: logOf({ row }) });

      const code = await runSlackWrite({
        argv: releaseArgv({ approve: row.digest, home: shot.home, id: row.id }),
        deps: h.deps,
        verb: "post",
      });

      expect(code).toBe(EXIT_USAGE);
      expect(h.sends).toEqual([]);
    });

    it("reads nothing for a row that declared none, or the thanks in place of one", async () => {
      const none = parkedRow({
        form: ONE_CARD,
        media: shot.media,
        payload: await postedPayload({ form: ONE_CARD }),
        priorAsk: { kind: "none" },
      });
      const prior = parkedRow({
        form: ONE_CARD,
        id: "sd-2b3c4d5e",
        media: shot.media,
        payload: await postedPayload({ form: ONE_CARD }),
        priorAsk: PRIOR,
      });
      // The default read is unreadable, so a lane that read the earlier ask would refuse.
      const declaredNone = harness({ draftLog: logOf({ row: none }) });
      const thanks = harness({ draftLog: logOf({ row: prior }) });

      const sentNone = await runSlackWrite({
        argv: releaseArgv({ approve: none.digest, home: shot.home, id: none.id }),
        deps: declaredNone.deps,
        verb: "post",
      });
      const sentThanks = await runSlackWrite({
        argv: releaseArgv({
          approve: prior.digest,
          extra: ["--thanks-instead", "Thanks for the review."],
          home: shot.home,
          id: prior.id,
        }),
        deps: thanks.deps,
        verb: "post",
      });

      expect([sentNone, sentThanks]).toEqual([EXIT_OK, EXIT_OK]);
      expect([declaredNone.sends.length, thanks.sends.length]).toEqual([1, 1]);
    });
  });
});
