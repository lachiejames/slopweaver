import { describe, expect, it } from "vitest";

import { CrowdstrikeAtlasErrors, crowdstrikeAtlasErrorLines } from "../../../../atlas/crowdstrike/atlasErrors.js";

describe("CrowdstrikeAtlasErrors — the credential refusals", () => {
  it("refuses an empty host", () => {
    expect(CrowdstrikeAtlasErrors.hostEmpty()).toEqual({
      code: "HOST_EMPTY",
      message: "the CrowdStrike API host is empty",
    });
  });

  it("quotes an unparseable host in the sentence only, never in a field of its own", () => {
    const error = CrowdstrikeAtlasErrors.hostNotUrl({ host: "a b" });
    expect(error.code).toBe("HOST_NOT_URL");
    expect(crowdstrikeAtlasErrorLines({ error })).toEqual(["the CrowdStrike API host is not a URL: a b"]);
    expect(Object.keys(error).toSorted()).toEqual(["code", "message"]);
  });

  it("names the scheme a non-https host used", () => {
    const error = CrowdstrikeAtlasErrors.hostNotHttps({ protocol: "http" });
    expect(error.code).toBe("HOST_NOT_HTTPS");
    expect(crowdstrikeAtlasErrorLines({ error })).toEqual(["the CrowdStrike API host must be https, not http"]);
  });

  it("names the environment variables a half-set environment is missing", () => {
    const error = CrowdstrikeAtlasErrors.envPartial({ missing: ["CROWDSTRIKE_API_HOST", "CROWDSTRIKE_CLIENT_SECRET"] });
    expect(error.code).toBe("ENV_PARTIAL");
    expect(crowdstrikeAtlasErrorLines({ error })).toEqual([
      "CrowdStrike credentials are partly set in the environment; missing: CROWDSTRIKE_API_HOST, CROWDSTRIKE_CLIENT_SECRET",
    ]);
  });

  it("names all three secret-store names in order when nothing is configured", () => {
    const error = CrowdstrikeAtlasErrors.credentialsAbsent({ secretNames: ["h", "i", "s"] });
    expect(error.code).toBe("CREDENTIALS_ABSENT");
    expect(crowdstrikeAtlasErrorLines({ error })).toEqual([
      "CrowdStrike credentials are not configured: h, i and s are all required. Set each with: slopweaver secrets set <name>",
    ]);
  });

  it("keeps only each absent entry's name, never its path or label", () => {
    // The same shape `credentialFiles.ts` passes: a name beside the path and label that must not travel.
    const entry = { label: "secrets/x", name: "x", path: "/h/secrets/x" };
    const error = CrowdstrikeAtlasErrors.storePartial({ absent: [entry] });
    expect(error.code).toBe("STORE_PARTIAL");
    expect(crowdstrikeAtlasErrorLines({ error })).toEqual([
      "the secrets store holds only part of the CrowdStrike credential; missing: x",
    ]);
    expect(Object.keys(error).toSorted()).toEqual(["code", "message", "missing"]);
    expect(JSON.stringify(error)).not.toContain("/h/secrets/x");
  });
});

describe("CrowdstrikeAtlasErrors — the sitemap, walk and identity refusals", () => {
  it("names the kind and the field a record carried no id in", () => {
    const error = CrowdstrikeAtlasErrors.providerIdAbsent({ field: "device_id", kind: "host" });
    expect(error.code).toBe("PROVIDER_ID_ABSENT");
    expect(crowdstrikeAtlasErrorLines({ error })).toEqual([
      "a host record carried no device_id, so it cannot be given a stable identity",
    ]);
  });

  it("quotes an origin that is not a URL", () => {
    const error = CrowdstrikeAtlasErrors.sitemapOriginInvalid({ origin: "not a url" });
    expect(error.code).toBe("SITEMAP_ORIGIN_INVALID");
    expect(crowdstrikeAtlasErrorLines({ error })).toEqual(["sitemap origin is not a URL: not a url"]);
  });

  it("refuses a sitemap with no href and a walk with no routes", () => {
    expect(CrowdstrikeAtlasErrors.sitemapWithoutHref()).toEqual({
      code: "SITEMAP_WITHOUT_HREF",
      message:
        "the Falcon sitemap declared no href at all — the document shape has changed, and walking zero pages would report full coverage over nothing",
    });
    expect(CrowdstrikeAtlasErrors.routesUndeclared()).toEqual({
      code: "ROUTES_UNDECLARED",
      message: "the Falcon sitemap declared no routes, so a walk would report full coverage over nothing",
    });
  });
});

describe("CrowdstrikeAtlasErrors — the publish refusals keep one line per problem", () => {
  it("prints every walk problem on its own line, then the unpublished line", () => {
    const error = CrowdstrikeAtlasErrors.walkUnpublishable({ problems: ["p1", "p2"] });
    expect(error.code).toBe("WALK_UNPUBLISHABLE");
    expect(crowdstrikeAtlasErrorLines({ error })).toEqual([
      "p1",
      "p2",
      "nothing was written — this walk is not published",
    ]);
    expect(error.message).toBe("p1; p2; nothing was written — this walk is not published");
  });

  it("prints only the unpublished line when the walk carried no problem", () => {
    const error = CrowdstrikeAtlasErrors.walkUnpublishable({ problems: [] });
    expect(crowdstrikeAtlasErrorLines({ error })).toEqual(["nothing was written — this walk is not published"]);
  });

  it("prints every generation problem on its own line, then the unpublished line", () => {
    const error = CrowdstrikeAtlasErrors.generationUnpublishable({ problems: ["host: a", "detection: b"] });
    expect(error.code).toBe("GENERATION_UNPUBLISHABLE");
    expect(crowdstrikeAtlasErrorLines({ error })).toEqual([
      "host: a",
      "detection: b",
      "nothing was written — this generation is not published",
    ]);
  });
});
