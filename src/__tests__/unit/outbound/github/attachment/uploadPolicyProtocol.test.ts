/*
 * The upload-policy protocol: the policy request's fields, the five values a 201 policy body hands the next two
 * calls, how a refusal reads, the bucket's field order, and the path and headers the pipeline sends.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  bucketFieldOrder,
  classifyAttachment,
  GITHUB_XHR_HEADERS,
  parseUploadPolicy,
  policyFormFields,
  policyRefusalDetail,
  UPLOAD_POLICY_PATH,
} from "../../../../../outbound/github/attachment.js";

/** A real 201 policy body, field-for-field as GitHub answers, with the signature values replaced. */
const POLICY_BODY = JSON.stringify({
  asset: {
    content_type: "image/png",
    href: "https://github.com/user-attachments/assets/00000000-0000-4000-8000-000000000a01",
    id: 640337358,
    name: "shot.png",
    original_name: "shot.png",
    size: 110,
  },
  asset_upload_authenticity_token: "finalize-token",
  asset_upload_url: "/upload/assets/640337358",
  form: {
    "Cache-Control": "max-age=2592000",
    "Content-Type": "image/png",
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": "cred",
    "X-Amz-Date": "20260824T000000Z",
    "X-Amz-Signature": "sig",
    acl: "private",
    key: "275964442/640337358.png",
    policy: "base64policy",
    "x-amz-meta-Surrogate-Control": "max-age=31557600",
  },
  header: {},
  same_origin: false,
  upload_url: "https://github-production-user-asset-6210df.s3.amazonaws.com",
});

describe("parseUploadPolicy", () => {
  it("reads all five values the remaining two calls need", () => {
    const result = parseUploadPolicy({ body: POLICY_BODY });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).uploadUrl).toBe("https://github-production-user-asset-6210df.s3.amazonaws.com");
    expect(unwrap(result).assetId).toBe(640337358);
    expect(unwrap(result).assetUploadUrl).toBe("/upload/assets/640337358");
    expect(unwrap(result).assetUploadAuthenticityToken).toBe("finalize-token");
    expect(unwrap(result).assetHref).toBe(
      "https://github.com/user-attachments/assets/00000000-0000-4000-8000-000000000a01",
    );
  });

  it("reads GitHub's own sanitised asset name back instead of computing one", () => {
    const withRawName = JSON.stringify({
      asset: {
        href: "https://github.com/user-attachments/assets/uuid",
        id: 640341941,
        name: "fastify-express-side-by-side.1.mp4",
        original_name: "fastify-express-side-by-side (1).mp4",
      },
      asset_upload_authenticity_token: "t",
      asset_upload_url: "/upload/assets/640341941",
      form: {},
      upload_url: "https://bucket.example",
    });
    const result = parseUploadPolicy({ body: withRawName });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).assetName).toBe("fastify-express-side-by-side.1.mp4");
  });

  it("keeps the presigned form fields in the order GitHub sent them", () => {
    const result = parseUploadPolicy({ body: POLICY_BODY });
    expect(Object.keys(unwrap(result).form)).toEqual([
      "Cache-Control",
      "Content-Type",
      "X-Amz-Algorithm",
      "X-Amz-Credential",
      "X-Amz-Date",
      "X-Amz-Signature",
      "acl",
      "key",
      "policy",
      "x-amz-meta-Surrogate-Control",
    ]);
  });

  it("refuses a 201 that omits the finalize token rather than defaulting it to empty", () => {
    const parsed: Record<string, unknown> = JSON.parse(POLICY_BODY);
    delete parsed["asset_upload_authenticity_token"];
    const result = parseUploadPolicy({ body: JSON.stringify(parsed) });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("asset_upload_authenticity_token");
  });

  it("names every missing field at once", () => {
    const result = parseUploadPolicy({ body: "{}" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("upload_url");
    expect(unwrapErr(result).message).toContain("asset.href");
    expect(unwrapErr(result).message).toContain("asset.id");
  });

  it("refuses an unparseable body", () => {
    const result = parseUploadPolicy({ body: "<html>oops</html>" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("POLICY_REFUSED");
  });
});

describe("policyRefusalDetail", () => {
  it("reads the video refusal shape, which carries only field and message", () => {
    const body = JSON.stringify({
      errors: [
        {
          field: "size",
          message:
            'This video is too big. <span class="drag-and-drop-error-info">\n<span class="btn-link">Try again</span> with a file size less than 100MB.\n</span>\n',
        },
      ],
    });
    expect(policyRefusalDetail({ body })).toBe("This video is too big. Try again with a file size less than 100MB.");
  });

  it("reads the image refusal shape, which also carries resource and code", () => {
    const body = JSON.stringify({
      errors: [
        {
          code: "custom",
          field: "size",
          message:
            "size Yowza that's a big file. <span class='drag-and-drop-error-info'> <span class='btn-link'>Try again</span> with a file size less than 10MB.</span>",
          resource: "UserAsset",
        },
      ],
    });
    expect(policyRefusalDetail({ body })).toBe(
      "size Yowza that's a big file. Try again with a file size less than 10MB.",
    );
  });

  it("passes an unrecognised body through as readable text rather than swallowing it", () => {
    expect(policyRefusalDetail({ body: "<h1>Rate limited</h1>" })).toBe("Rate limited");
  });

  it("joins several refusals into one line", () => {
    const body = JSON.stringify({ errors: [{ message: "first" }, { message: "second" }] });
    expect(policyRefusalDetail({ body })).toBe("first; second");
  });
});

describe("policyFormFields", () => {
  it("sends the five policy fields in GitHub's own order", () => {
    const classified = unwrap(classifyAttachment({ byteLength: 110, fileName: "shot.png" }));
    const fields = policyFormFields({
      classified,
      context: { authenticityToken: "tok", repositoryId: "42" },
    });
    expect(fields.map(([name]) => name)).toEqual([
      "name",
      "size",
      "content_type",
      "authenticity_token",
      "repository_id",
    ]);
    expect(fields.map(([, value]) => value)).toEqual(["shot.png", "110", "image/png", "tok", "42"]);
  });

  it("sends the raw name with its spaces and parentheses, exactly as the browser does", () => {
    const classified = unwrap(classifyAttachment({ byteLength: 1185581, fileName: "side-by-side (1).mp4" }));
    const fields = policyFormFields({ classified, context: { authenticityToken: "t", repositoryId: "1" } });
    expect(fields[0]).toEqual(["name", "side-by-side (1).mp4"]);
  });
});

describe("bucketFieldOrder", () => {
  it("appends the file LAST, after every signature field", () => {
    const policy = unwrap(parseUploadPolicy({ body: POLICY_BODY }));
    const order = bucketFieldOrder({ form: policy.form });
    expect(order[order.length - 1]).toBe("file");
    expect(order.indexOf("X-Amz-Signature")).toBeLessThan(order.indexOf("file"));
    expect(order.indexOf("policy")).toBeLessThan(order.indexOf("file"));
  });
});

describe("protocol constants", () => {
  it("names the policy path the whole pipeline hangs off", () => {
    expect(UPLOAD_POLICY_PATH).toBe("/upload/policies/assets");
  });

  it("sends the two headers github.com actually requires", () => {
    expect(GITHUB_XHR_HEADERS["accept"]).toBe("application/json");
    expect(GITHUB_XHR_HEADERS["x-requested-with"]).toBe("XMLHttpRequest");
  });
});
