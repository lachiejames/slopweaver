import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { heldRowOf } from "../../../../../../cli/commands/slack/releaseHeldRow.js";
import { rowMovedBeforeSend } from "../../../../../../cli/commands/slack/releaseRow.js";
import { unwrap } from "../../../../../../lib/result.js";
import type { ParkedSlackDraft, ParkedSlackDraftMedia } from "../../../../../../outbound/slack/draftRegister.js";
import { appendImageRecord } from "../../../../../../visualEvidence/store.js";
import { annotatedRecord, failedRecord, storeAnnotatedShot } from "../../../../../annotatedShotFixture.js";
import { heldRow, logOf } from "./fixtures.js";

describe("heldRowOf — a first message in a channel is not released without its receipt", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "release-first-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const LINKED = "the control is failing <https://app.vanta.com/c/1|control>";

  /** The row at the top level of #proj-iso, as a message rather than a finding, so only the first-message rule bites. */
  function channelRow({ media }: { media: readonly ParkedSlackDraftMedia[] }): ParkedSlackDraft {
    return { ...heldRow({ media, text: LINKED }), channel: "C0ISO", kind: "message" };
  }

  /** What `heldRowOf` refuses that row with, or `undefined` when it would release it. */
  function refusalOf({ row }: { row: ParkedSlackDraft }): string | undefined {
    const held = heldRowOf({ deps: { readDraftLog: () => logOf({ row }) }, draftId: row.id, home });
    return held.isErr() ? held.error.message : undefined;
  }

  it("refuses one with no screenshot, naming every missing piece and the re-cut", () => {
    expect(refusalOf({ row: channelRow({ media: [] }) })).toBe(
      "sd-1a2b3c4d is a first message in a channel and is missing screenshot, annotation, so it is not sent: the " +
        "owner sends such a card back unseen. Re-cut it with its proof (`slopweaver slack " +
        'draft record … --supersedes sd-1a2b3c4d`), or drop it (`slopweaver slack draft drop sd-1a2b3c4d --note "no ' +
        'proof"`). — nothing was sent.',
    );
  });

  it("releases one whose screenshot's record vouches for its box and for nothing covering it", () => {
    expect(refusalOf({ row: channelRow({ media: [storeAnnotatedShot({ home })] }) })).toBeUndefined();
  });

  it("refuses one whose screenshot carries no box, naming the record that clears it without a re-cut", () => {
    const bare = storeAnnotatedShot({
      home,
      records: ({ digest }) => [annotatedRecord({ digest, over: { annotations: undefined, obstruction: undefined } })],
    });
    expect(refusalOf({ row: channelRow({ media: [bare] }) })).toContain(
      "missing annotation, so it is not sent: the owner sends such a card back unseen. Record " +
        "the box already drawn into its screenshot (`slopweaver browser image-record` with `annotations` and " +
        '`obstruction: "none"`)',
    );
  });

  it("stops a release at the last-moment re-read once a later look records its screenshot obscured", () => {
    const row = channelRow({ media: [storeAnnotatedShot({ home })] });
    const deps = { doorEnv: () => ({}), readDraftLog: () => logOf({ row }) };
    expect(rowMovedBeforeSend({ deps, draft: row, home })).toBeUndefined();
    const covered = failedRecord({
      correction: "dismiss the cookie banner, then retake",
      digest: `sha256:${row.media![0]!.sha256}`,
      reason: "obscured",
    });
    unwrap(appendImageRecord({ home, record: covered }));
    const moved = rowMovedBeforeSend({ deps, draft: row, home });
    expect(moved!.message).toContain("sd-1a2b3c4d is a first message in a channel and is missing annotation");
  });

  it("owes nothing as a reply in a thread, or in a DM", () => {
    expect([
      refusalOf({ row: { ...channelRow({ media: [] }), shape: "thread", threadTs: "1789407961.767649" } }),
      refusalOf({ row: { ...channelRow({ media: [] }), channel: "D0DM" } }),
    ]).toEqual([undefined, undefined]);
  });
});
