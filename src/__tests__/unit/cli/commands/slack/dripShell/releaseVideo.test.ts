import { rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { slackDraftMediaPath } from "../../../../../../admit/slackDraftMediaStore.js";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { ParkedSlackDraft } from "../../../../../../outbound/slack/draftRegister.js";
import { harness, removeFixtureDirs } from "./harness.js";
import { CLIP, homeWithClip, logOf, ONE_CARD, parkedRow, postedPayload, releaseArgv } from "./release.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite --as me --draft --approve — a draft carrying a video", () => {
  it("sends the STORED bytes it verified, under the recorded name, reopening no path", async () => {
    const { home, media } = homeWithClip();
    const row = parkedRow({ form: ONE_CARD, media, payload: await postedPayload({ form: ONE_CARD }) });
    const h = harness({ draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.filenames)).toEqual([["walkthrough.mp4", "control.png"]]);
    expect(Buffer.from(h.uploaded[0]![0]!.bytes).equals(CLIP)).toBe(true);
    // The harness's own path reader was never asked: the attachment came through the release's scoped seam.
    expect(h.mediaReads).toEqual([]);
    expect(h.draftEvents.map((event) => event.kind)).toEqual(["released"]);
  });

  it("refuses the digest approved BEFORE the video was added, and sends nothing", async () => {
    const { home, media } = homeWithClip();
    const payload = await postedPayload({ form: ONE_CARD });
    const textOnly = parkedRow({ form: ONE_CARD, payload });
    const row = parkedRow({ form: ONE_CARD, media, payload });
    const h = harness({ draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: textOnly.digest, home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(textOnly.digest).not.toBe(row.digest);
    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("refuses a row whose media was added under the text-only digest — the recomputed digest binds it", async () => {
    const { home, media } = homeWithClip();
    const textOnly = parkedRow({ form: ONE_CARD, payload: await postedPayload({ form: ONE_CARD }) });
    const tampered: ParkedSlackDraft = { ...textOnly, media };
    const h = harness({ draftLog: logOf({ row: tampered }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: textOnly.digest, home, id: tampered.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
  });

  it("refuses when the stored blob is gone or changed, before anything is prepared or sent", async () => {
    const gone = homeWithClip();
    const changed = homeWithClip();
    rmSync(slackDraftMediaPath({ home: gone.home, sha256: gone.media[0]!.sha256 }));
    writeFileSync(slackDraftMediaPath({ home: changed.home, sha256: changed.media[0]!.sha256 }), "swapped");
    const payload = await postedPayload({ form: ONE_CARD });
    const codes: number[] = [];
    const sent: number[] = [];
    for (const { home, media } of [gone, changed]) {
      const row = parkedRow({ form: ONE_CARD, media, payload });
      const h = harness({ draftLog: logOf({ row }) });
      codes.push(
        await runSlackWrite({
          argv: releaseArgv({ approve: row.digest, home, id: row.id }),
          deps: h.deps,
          verb: "post",
        }),
      );
      sent.push(h.sends.length);
    }

    expect(codes).toEqual([EXIT_USAGE, EXIT_USAGE]);
    expect(sent).toEqual([0, 0]);
  });

  it("verifies and names each attachment under --dry-run, sending nothing and leaving the row held", async () => {
    const { home, media } = homeWithClip();
    const row = parkedRow({ form: ONE_CARD, media, payload: await postedPayload({ form: ONE_CARD }) });
    const h = harness({ draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, extra: ["--dry-run"], home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
    expect(h.out).toContain(
      `attachment verified: walkthrough.mp4 · ${String(CLIP.length)} bytes · sha256 ${media[0]!.sha256}`,
    );
    expect(h.out).toContain(
      "media: 2 file(s) — walkthrough.mp4, control.png — attached UNDER message 1/1, the last one",
    );
  });

  it("still refuses --media beside --draft: a release's attachments come only from the row", async () => {
    const { home, media } = homeWithClip();
    const row = parkedRow({ form: ONE_CARD, media, payload: await postedPayload({ form: ONE_CARD }) });
    const h = harness({ draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, extra: ["--media", "other.mp4"], home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
    expect(h.mediaReads).toEqual([]);
  });
});
