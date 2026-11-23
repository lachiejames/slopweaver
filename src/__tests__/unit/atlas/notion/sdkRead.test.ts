import { describe, expect, it } from "vitest";

import { NOTION_API_BASE_PATH, NOTION_SDK_PACKAGE, readNotionSdkSurface } from "../../../../atlas/notion/sdkRead.js";
import { unwrap } from "../../../../lib/result.js";

describe("readNotionSdkSurface", () => {
  it("reads the installed client's own generated modules", () => {
    expect(unwrap(readNotionSdkSurface()).endpoints.length).toBeGreaterThan(0);
  });

  it("names the version that declared them, so the surface is version-scoped", () => {
    expect(unwrap(readNotionSdkSurface()).version.length).toBeGreaterThan(0);
  });

  it("gives every endpoint a module it was declared in", () => {
    const surface = unwrap(readNotionSdkSurface());
    expect(surface.endpoints.filter((endpoint) => endpoint.module.length === 0)).toEqual([]);
  });

  it("gives every endpoint an upper-cased HTTP method", () => {
    const surface = unwrap(readNotionSdkSurface());
    expect(surface.endpoints.filter((endpoint) => endpoint.httpMethod !== endpoint.httpMethod.toUpperCase())).toEqual(
      [],
    );
  });

  it("reads a path template for every endpoint the installed package declares", () => {
    const surface = unwrap(readNotionSdkSurface());
    expect(surface.endpoints.filter((endpoint) => endpoint.pathTemplate === null)).toEqual([]);
  });

  it("lists the modules it drew the denominator from", () => {
    expect(unwrap(readNotionSdkSurface()).modules).toContain("users");
  });

  it("finds the endpoint that lists users, which is the one every Notion integration can call", () => {
    const surface = unwrap(readNotionSdkSurface());
    expect(
      surface.endpoints.some((endpoint) => endpoint.pathTemplate === "users" && endpoint.httpMethod === "GET"),
    ).toBe(true);
  });

  it("names the package it read, so an error can point somewhere", () => {
    expect(NOTION_SDK_PACKAGE).toBe("@notionhq/client");
  });

  it("addresses declared paths beneath the API's own version root", () => {
    expect(NOTION_API_BASE_PATH).toBe("v1");
  });
});
