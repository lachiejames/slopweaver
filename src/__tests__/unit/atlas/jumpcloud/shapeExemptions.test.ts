import { describe, expect, it } from "vitest";

import { isJumpcloudShapeExempt } from "../../../../atlas/jumpcloud/shapeExemptions.js";

describe("isJumpcloudShapeExempt", () => {
  it("forgives the forty-hex shape at a certificate identifier", () => {
    expect(isJumpcloudShapeExempt({ field: "sha1", shape: "JumpCloud API key" })).toBe(true);
  });

  it("forgives the build hash a path was measured carrying, and NOT an AWS key id beside it", () => {
    expect(isJumpcloudShapeExempt({ field: "path", shape: "JumpCloud API key" })).toBe(true);
    expect(isJumpcloudShapeExempt({ field: "path", shape: "AWS access key id" })).toBe(false);
  });

  it("forgives only the shape that was measured at a field, not every shape", () => {
    expect(isJumpcloudShapeExempt({ field: "sha1", shape: "AWS access key id" })).toBe(false);
    expect(isJumpcloudShapeExempt({ field: "bundle_version", shape: "PEM private key block" })).toBe(false);
  });

  it("forgives the build hash in a PUBLIC vendor download link, and only the forty-hex shape", () => {
    // MEASURED: `softwareApp/settings/*/downloadUrl` carries links such as
    // `ardownload2.adobe.com/pub/adobe/reader/mac/AcrobatDC/<hex>/…`, whose build hash is forty hex. A
    // signed token would most plausibly arrive as a JWT, which still refuses the whole generation here.
    expect(isJumpcloudShapeExempt({ field: "downloadUrl", shape: "JumpCloud API key" })).toBe(true);
    expect(isJumpcloudShapeExempt({ field: "downloadUrl", shape: "JSON Web Token" })).toBe(false);
    expect(isJumpcloudShapeExempt({ field: "downloadUrl", shape: "PEM private key block" })).toBe(false);
    expect(isJumpcloudShapeExempt({ field: "downloadUrl", shape: "AWS access key id" })).toBe(false);
  });

  it("forgives nothing at a field nobody named", () => {
    expect(isJumpcloudShapeExempt({ field: "notes", shape: "JumpCloud API key" })).toBe(false);
  });

  it("forgives nothing at a device-management policy value, which can BE a credential", () => {
    expect(isJumpcloudShapeExempt({ field: "value", shape: "JumpCloud API key" })).toBe(false);
    expect(isJumpcloudShapeExempt({ field: "value", shape: "AWS access key id" })).toBe(false);
  });

  it("forgives nothing when no field named the value — an object key, or the document root", () => {
    expect(isJumpcloudShapeExempt({ field: undefined, shape: "JumpCloud API key" })).toBe(false);
  });

  it("does not treat an inherited Object property name as an exempt field", () => {
    expect(isJumpcloudShapeExempt({ field: "constructor", shape: "JumpCloud API key" })).toBe(false);
    expect(isJumpcloudShapeExempt({ field: "toString", shape: "AWS access key id" })).toBe(false);
  });
});

describe("an Apple device identifier is not a key", () => {
  // MEASURED: `GET /api/v2/applemdms/{id}/devices` fires on `udid`, and an Apple UDID on older
  // hardware is exactly forty hex characters. One row in 100 kept the whole generation refused.
  const udid = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

  it("forgives the forty-hex shape at `udid`", () => {
    expect(isJumpcloudShapeExempt({ field: "udid", shape: "JumpCloud API key" })).toBe(true);
  });

  it("forgives nothing else there — an AWS key id under `udid` still refuses", () => {
    expect(isJumpcloudShapeExempt({ field: "udid", shape: "AWS access key id" })).toBe(false);
    expect(udid.length).toBe(40);
  });
});
