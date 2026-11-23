/**
 * The `fileUpload` payload parser — the half of the asset lane that decides whether Linear actually reserved
 * anything.
 *
 * `UploadPayload.uploadFile` is nullable, so a 200 carrying `success: true` and no `uploadFile` is a real
 * API shape rather than a hypothetical. Every case below names one such false success, because the
 * alternative to naming them is a caller holding an `undefined` asset URL and calling it an upload.
 *
 * Every edge is a plain value. No mocks.
 */
import { describe, expect, it } from "vitest";

import { LinearPayloadErrors } from "../../../../corpus/linear/errors.js";
import {
  ALLOWED_UPLOAD_TYPES_QUERY,
  allowedUploadTypesFrom,
  FILE_UPLOAD_MUTATION,
  reservationFrom,
} from "../../../../corpus/linear/writeAssets.js";
import { unwrap } from "../../../../lib/result.js";

function payload({ uploadFile }: { uploadFile: unknown }): unknown {
  return { fileUpload: { success: true, uploadFile } };
}

const NODE = {
  assetUrl: "https://uploads.linear.test/ws/asset/1",
  contentType: "image/png",
  filename: "probe.png",
  headers: [{ key: "Content-Type", value: "image/png" }],
  size: 165,
  uploadUrl: "https://bucket.linear.test/put?sig=1",
};

describe("the mutation this lane sends", () => {
  // The SDK's document reaches these through a `...UploadFile` spread, so the assertions name the FIELDS
  // rather than one line of selection text — they still fail on a document that cannot fill a reservation.
  it("asks for every field a PUT needs, so a reservation is usable without a second round trip", () => {
    expect(FILE_UPLOAD_MUTATION).toContain("uploadUrl");
    expect(FILE_UPLOAD_MUTATION).toContain("assetUrl");
    expect(FILE_UPLOAD_MUTATION).toContain("fragment UploadFileHeader on UploadFileHeader");
    expect(FILE_UPLOAD_MUTATION).toContain("key");
    expect(FILE_UPLOAD_MUTATION).toContain("value");
  });

  it("declares size as a required Int, which is what makes Linear the authority on the ceiling", () => {
    expect(FILE_UPLOAD_MUTATION).toContain("$size: Int!");
  });

  it("is the SDK's own document rather than one written here", () => {
    expect(FILE_UPLOAD_MUTATION).toContain("mutation fileUpload(");
    expect(FILE_UPLOAD_MUTATION).toContain("...UploadPayload");
  });
});

describe("parsing a reservation", () => {
  it("reads the slot, the asset and the headers Linear demands", () => {
    const reserved = unwrap(reservationFrom({ data: payload({ uploadFile: NODE }), field: "fileUpload" }));

    expect(reserved.uploadUrl).toBe("https://bucket.linear.test/put?sig=1");
    expect(reserved.assetUrl).toBe("https://uploads.linear.test/ws/asset/1");
    expect(reserved.contentType).toBe("image/png");
    expect(reserved.headers).toStrictEqual([{ key: "Content-Type", value: "image/png" }]);
  });

  it("names the false success where the payload reports success with no uploadFile", () => {
    const parsed = reservationFrom({ data: payload({ uploadFile: null }), field: "fileUpload" });

    expect(parsed._unsafeUnwrapErr()).toStrictEqual(LinearPayloadErrors.uploadNotReserved({ field: "fileUpload" }));
    expect(parsed._unsafeUnwrapErr().message).toBe(
      "fileUpload reported success with no uploadFile — nothing was reserved",
    );
  });

  it("names the missing payload where the mutation field is absent entirely", () => {
    const parsed = reservationFrom({ data: {}, field: "fileUpload" });

    expect(parsed._unsafeUnwrapErr()).toStrictEqual(LinearPayloadErrors.uploadNoPayload({ field: "fileUpload" }));
    expect(parsed._unsafeUnwrapErr().message).toBe("fileUpload returned no payload");
  });

  it("refuses a slot with no uploadUrl — an assetUrl alone is a promise with no way to keep it", () => {
    const parsed = reservationFrom({
      data: payload({ uploadFile: { assetUrl: NODE.assetUrl, contentType: "image/png" } }),
      field: "fileUpload",
    });

    expect(parsed._unsafeUnwrapErr().code).toBe("PAYLOAD_NODE_MISSING");
    expect(parsed._unsafeUnwrapErr().message).toBe(
      "fileUpload reserved a slot with no uploadUrl, assetUrl or contentType",
    );
  });

  it("carries NO headers rather than a broken one when a header entry is missing its value", () => {
    // A header sent with an undefined value fails the bucket's signature check, which reads as an auth
    // problem rather than as the malformed payload it is.
    const reserved = unwrap(
      reservationFrom({
        data: payload({ uploadFile: { ...NODE, headers: [{ key: "x-a" }, { key: "x-b", value: "ok" }] } }),
        field: "fileUpload",
      }),
    );

    expect(reserved.headers).toStrictEqual([{ key: "x-b", value: "ok" }]);
  });

  it("carries no headers when Linear sent none at all", () => {
    const reserved = unwrap(
      reservationFrom({ data: payload({ uploadFile: { ...NODE, headers: null } }), field: "fileUpload" }),
    );

    expect(reserved.headers).toStrictEqual([]);
  });
});

describe("the workspace's allowed content types", () => {
  it("reads the list the organization declares", () => {
    const types = allowedUploadTypesFrom({
      data: { organization: { allowedFileUploadContentTypes: ["image/png", "application/pdf"] } },
    });

    expect(types).toStrictEqual(["image/png", "application/pdf"]);
  });

  it("reports UNRESTRICTED as undefined, never as an empty list, when the field comes back null", () => {
    // MEASURED against the live workspace: `allowedFileUploadContentTypes` is null when no
    // restriction is configured. An empty array here would read as "no type is permitted" — the inversion.
    expect(allowedUploadTypesFrom({ data: { organization: { allowedFileUploadContentTypes: null } } })).toBe(undefined);
  });

  it("reports a missing organization as unrestricted too, rather than as a forbidding empty list", () => {
    expect(allowedUploadTypesFrom({ data: {} })).toBe(undefined);
  });

  it("keeps a genuinely EMPTY declared list apart from an absent one", () => {
    expect(allowedUploadTypesFrom({ data: { organization: { allowedFileUploadContentTypes: [] } } })).toStrictEqual([]);
  });

  it("drops a non-string entry rather than carrying it into a comparison", () => {
    expect(
      allowedUploadTypesFrom({ data: { organization: { allowedFileUploadContentTypes: ["image/png", 7] } } }),
    ).toStrictEqual(["image/png"]);
  });

  it("asks the organization, which is the only object that carries the answer", () => {
    expect(ALLOWED_UPLOAD_TYPES_QUERY).toContain("organization {");
    expect(ALLOWED_UPLOAD_TYPES_QUERY).toContain("allowedFileUploadContentTypes");
  });

  it("does NOT ask for authSettings, which is the whole reason this document is written by hand", () => {
    expect(ALLOWED_UPLOAD_TYPES_QUERY).not.toContain("authSettings");
  });
});
