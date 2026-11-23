/**
 * `parkedDraftDigest`, what the owner's approval is bound to: it moves when anything a reader would see moves, and never
 * moves an approval already given when a new field joins the hashed identity.
 */
import { describe, expect, it } from "vitest";

import { parkedDraftDigest } from "../../../../../outbound/slack/draftRegister.js";
import { draft, GOLDEN_CONTENT, GOLDEN_DIGEST, PAYLOAD, STILL, VIDEO } from "./fixtures.js";

describe("parkedDraftDigest — what the owner's approval is bound to", () => {
  it("moves when the destination changes, so an approved draft cannot be re-aimed", () => {
    expect(parkedDraftDigest({ draft: draft() })).not.toBe(
      parkedDraftDigest({ draft: draft({ over: { channel: "C0OTHER" } }) }),
    );
  });

  it("moves when a mention TARGET changes, even though the key a reader sees is the same", () => {
    const moved = draft({ over: { mentions: [{ key: "@ada-example", kind: "person", target: "U2" }] } });
    expect(parkedDraftDigest({ draft: draft() })).not.toBe(parkedDraftDigest({ draft: moved }));
  });

  it("moves when the payload's own text changes", () => {
    const edited = draft({ over: { payload: { ...PAYLOAD, text: "something else" } } });
    expect(parkedDraftDigest({ draft: draft() })).not.toBe(parkedDraftDigest({ draft: edited }));
  });

  it("does NOT move for the id, the instant, the advisory or the source form", () => {
    const same = draft({
      over: {
        advisory: ["a voice finding"],
        form: '{"kind":"one-card","lines":[{"runs":[]}]}',
        id: "sd-99999999",
        tsIso: "2026-09-24T12:00:00.000Z",
      },
    });
    expect(parkedDraftDigest({ draft: same })).toBe(parkedDraftDigest({ draft: draft() }));
  });
});

describe("parkedDraftDigest — media joins the bound identity without moving an old approval", () => {
  it("still digests a real pre-media row to the digest it was approved under", () => {
    expect(parkedDraftDigest({ draft: GOLDEN_CONTENT })).toBe(GOLDEN_DIGEST);
  });

  it("digests absent and empty media identically, and exactly as a row did before the field existed", () => {
    expect(parkedDraftDigest({ draft: { ...GOLDEN_CONTENT, media: undefined } })).toBe(GOLDEN_DIGEST);
    expect(parkedDraftDigest({ draft: { ...GOLDEN_CONTENT, media: [] } })).toBe(GOLDEN_DIGEST);
  });

  it("moves when one attachment is added, so the old approval cannot release the media-bearing row", () => {
    expect(parkedDraftDigest({ draft: { ...GOLDEN_CONTENT, media: [VIDEO] } })).not.toBe(GOLDEN_DIGEST);
  });

  it("moves for the attachment's name, byte count, hash and order, each on its own", () => {
    const base = parkedDraftDigest({ draft: { ...GOLDEN_CONTENT, media: [VIDEO, STILL] } });
    const variants = [
      [{ ...VIDEO, name: "other.mp4" }, STILL],
      [{ ...VIDEO, bytes: 2748 }, STILL],
      [{ ...VIDEO, sha256: "c".repeat(64) }, STILL],
      [STILL, VIDEO],
    ].map((media) => parkedDraftDigest({ draft: { ...GOLDEN_CONTENT, media } }));
    expect(variants.filter((digest) => digest === base)).toEqual([]);
    expect(new Set(variants).size).toBe(4);
  });
});

describe("parkedDraftDigest — a group DM stamp is bound, so it cannot be written onto a row afterwards", () => {
  it("leaves an unstamped row's digest exactly as it was approved before the stamp existed", () => {
    expect(parkedDraftDigest({ draft: { ...GOLDEN_CONTENT, groupDm: undefined } })).toBe(GOLDEN_DIGEST);
  });

  it("moves for the stamp, so a hand-written `groupDm` breaks the approval it would skip the proof under", () => {
    expect(parkedDraftDigest({ draft: { ...GOLDEN_CONTENT, groupDm: true } })).not.toBe(GOLDEN_DIGEST);
  });
});
