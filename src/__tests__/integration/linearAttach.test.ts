/**
 * INTEGRATION test: the Linear ASSET upload — `mutation.fileUpload` and the presigned PUT it hands back —
 * against the REAL Linear API and its REAL storage bucket, recorded + replayed via a Polly cassette.
 *
 * This is the cassette that answers the question the whole capability turned on: **does putting an image in
 * a Linear comment need the owner's own Chrome, the way `github attach` does?** MEASURED, no. The
 * two calls below are made with the same API key every other verb on this noun uses; there is no cookie, no
 * scraped page token and no browser anywhere in this file, and that absence is the finding rather than an
 * omission. `../../outbound/github/attachClient.ts` is what the alternative looks like.
 *
 * Recording this UPLOADS A REAL FILE to the real workspace's asset storage. It is a 95 KB generated PNG-shaped
 * fixture and it is not attached to any issue. Unlike every other write cassette here it leaves something
 * behind, and that is stated rather than discovered: `mutation.fileUploadDangerouslyDelete` exists in the
 * schema, no verb calls it, and whether a personal API key may call it is UNTESTED — a mutation Linear itself
 * names "dangerously" is not one to probe against the real workspace to tidy up a fixture.
 *
 * ## The sequence, and why each step is here
 *
 *   read the workspace's allowed content types → reserve a slot → PUT the bytes
 *
 * The first call is the test's own guard against a table going stale: `../../outbound/linear/attachment.ts`
 * carries the content types this DOOR is willing to send, which is a narrower set than the workspace
 * permits, and the assertion below is that it really is a subset. A divergence fails here rather than on a
 * real send.
 *
 * The PUT is the point. A reservation's `assetUrl` is a live, addressable URL the moment Linear mints it and
 * it 404s until the bytes land, so a test that stopped at the reservation would prove nothing a caller could
 * embed. `putReservedAsset` returns a `StoredAsset` only on a 2xx, and this is where that runs against the
 * bucket's real signature check rather than against a fake that always says 200.
 *
 * ## What may be asserted, and what may not
 *
 * Same constraint as every cassette here: the redactor blanks every non-allowlisted string. A presigned
 * upload URL is a signature, so it is redacted like any other opaque value and no assertion may read it —
 * what survives is the SHAPE (a reservation carries an upload URL, an asset URL and its headers) and the
 * bucket's own verdict, which is a status code rather than a string.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… \
 *     SLOPWEAVER_RECORD_LINEAR_TOKEN=lin_api_… yarn test:integration         # (re)record — UPLOADS FOR REAL
 */
import { describe, expect, it } from "vitest";

import { makeLinearAssetWriteApi } from "../../corpus/linear/writeAssets.js";
import { unwrap } from "../../lib/result.js";
import { productionAssetPutFetch, putReservedAsset } from "../../outbound/linear/assetUpload.js";
import { classifyLinearAttachment, typesTheWorkspaceForbids } from "../../outbound/linear/attachment.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../linearWritePrivacyFixture.js";
import { renderedPng } from "../pngFixture.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function linearToken(): string {
  if (!RECORD) {
    return "lin_api_replay-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_LINEAR_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TOKEN to record the Linear attach cassette");
  }
  return token;
}

/** A literal name, so record and replay send byte-identical outbound variables. */
const FILE_NAME = "slopweaver-integration-probe.png";

describe("linear attach (integration — real Linear via Polly cassette)", () => {
  it("reserves a slot with an API key alone and lands the bytes in Linear's own storage", async () => {
    const api = makeLinearAssetWriteApi({
      privacy: NO_TERMS_LINEAR_PRIVACY,
      scheduler: (task) => task(),
      token: linearToken(),
    });
    // A deterministic PNG-shaped fixture rather than a file on disk: record and replay must send a
    // byte-identical body, and `renderedPng` is the one buffer in this repo that is already both.
    const bytes = renderedPng();
    const classified = unwrap(classifyLinearAttachment({ byteLength: bytes.length, fileName: FILE_NAME }));

    const allowed = await api.readAllowedUploadTypes();
    expect(allowed.isOk()).toBe(true);
    const restriction = unwrap(allowed);
    // Linear answers a workspace that configures NO restriction with a null field rather than an empty
    // list, and the recording was made under no restriction. The distinction is the whole reason the read exists — an
    // empty list would mean no type may be uploaded at all, which is the opposite conclusion.
    expect(restriction).toBe(undefined);
    // Nothing the door would send is refused. Against THIS recording that answer is reached by the
    // no-restriction arm, so the case that can actually fail — a workspace declaring a list without one of
    // these types — is driven in `unit/outbound/linear/linearAttachment.test.ts`, where both arms are
    // reachable. Stating that here is the point: this line alone is not evidence the check can fire.
    expect(typesTheWorkspaceForbids({ restriction })).toStrictEqual([]);

    const reserved = await api.reserveUpload({
      byteLength: classified.byteLength,
      contentType: classified.contentType,
      fileName: classified.fileName,
    });
    expect(reserved.isOk()).toBe(true);
    const reservation = unwrap(reserved);
    // The shape, not the values: a presigned URL is a signature and is redacted, so what is assertable is
    // that Linear handed back all three things a PUT needs.
    expect(reservation.uploadUrl.length > 0).toBe(true);
    expect(reservation.assetUrl.length > 0).toBe(true);
    expect(reservation.contentType).toBe("image/png");
    expect(reservation.headers.length > 0).toBe(true);

    const stored = await putReservedAsset({
      bytes,
      classified,
      fetchImpl: productionAssetPutFetch(),
      privacy: NO_TERMS_LINEAR_PRIVACY,
      reservation,
    });
    // THE assertion this cassette exists for: the bucket accepted the signed PUT, so the asset URL Linear
    // minted now has bytes behind it. Anything other than a 2xx yields an error here, never an asset.
    expect(stored.isOk()).toBe(true);
    expect(unwrap(stored).assetUrl).toBe(reservation.assetUrl);
    expect(unwrap(stored).byteLength).toBe(bytes.length);
    expect(unwrap(stored).fileName).toBe(FILE_NAME);
  });
});
