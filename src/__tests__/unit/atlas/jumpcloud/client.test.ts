import { describe, expect, it } from "vitest";

import {
  bindPath,
  findJumpcloudSurface,
  type JumpcloudFetch,
  pathParameters,
  productionJumpcloudFetch,
  requestJumpcloud,
} from "../../../../atlas/jumpcloud/client.js";
import { JUMPCLOUD_SURFACES } from "../../../../atlas/jumpcloud/generated/surfaces.js";
import { admittedRegistryRow } from "../../../../atlas/jumpcloud/registryMatch.js";
import { admitJumpcloudPage } from "../../../../atlas/jumpcloud/responseRegistry.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A fetch seam that answers every call the same way, and records what it was asked for. */
function fakeFetch({
  status,
  text = "[]",
  headers = {},
  seen,
}: {
  status: number;
  text?: string;
  headers?: Readonly<Record<string, string>>;
  seen?: string[];
}): JumpcloudFetch {
  return async ({ url }) => {
    seen?.push(url);
    return { headers, status, text };
  };
}

const deps = ({ fetch }: { fetch: JumpcloudFetch }) => ({ apiKey: "k", fetch, orgId: null });

describe("a query parameter the provider takes repeated", () => {
  it("appends one pair per member rather than joining them, which is the spelling JumpCloud rejects", async () => {
    const seen: string[] = [];

    await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ seen, status: 200 }) }),
      input: { bindings: { system_id: "s1" }, query: { targets: ["user", "policy"] } },
      surface: "v2-graph-system-associations-list",
    });

    expect(new URL(seen[0]!).search).toBe("?targets=user&targets=policy");
  });

  it("leaves a single string value as one parameter, so no existing call changed shape", async () => {
    const seen: string[] = [];

    await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ seen, status: 200 }) }),
      input: { query: { limit: "50" } },
      surface: "v1-systems-list",
    });

    expect(new URL(seen[0]!).search).toBe("?limit=50");
  });
});

describe("pathParameters", () => {
  it("names every brace parameter in declaration order", () => {
    expect(pathParameters({ path: "/api/v2/providers/{provider_id}/policygrouptemplates/{id}" })).toEqual([
      "provider_id",
      "id",
    ]);
  });
});

describe("bindPath", () => {
  it("percent-encodes a bound value, so an id carrying a slash cannot invent a path segment", () => {
    expect(unwrap(bindPath({ bindings: { id: "a/b" }, path: "/api/systems/{id}" }))).toBe("/api/systems/a%2Fb");
  });

  it("names every parameter nothing bound", () => {
    expect(unwrapErr(bindPath({ bindings: {}, path: "/api/systems/{id}" }))).toEqual(["id"]);
  });
});

describe("findJumpcloudSurface", () => {
  it("resolves every registry row by its own name", () => {
    expect(JUMPCLOUD_SURFACES.length).toBeGreaterThan(0);
    const unresolved = JUMPCLOUD_SURFACES.filter((row) => {
      const found = findJumpcloudSurface({ surface: row.name });
      return found.isErr() || found.value !== row;
    });
    expect(unresolved.map((row) => row.name)).toStrictEqual([]);
  });

  it("refuses a name the closed registry does not hold with SURFACE_REFUSED, naming it", () => {
    const refused = unwrapErr(findJumpcloudSurface({ surface: "v2-not-a-thing" }));
    expect(refused.code).toBe("SURFACE_REFUSED");
    expect(refused.message).toContain("v2-not-a-thing is not a surface this atlas admits");
  });
});

describe("requestJumpcloud", () => {
  it("refuses a surface the closed registry does not admit, without making a request", async () => {
    const seen: string[] = [];
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ seen, status: 200 }) }),
      input: {},
      surface: "v2-not-a-thing",
    });
    expect(unwrapErr(result).code).toBe("SURFACE_REFUSED");
    expect(seen.length).toBe(0);
  });

  it("refuses an inventoried-and-refused row and quotes why, without making a request", async () => {
    const excluded = "v1-users-reactivate-get";
    expect(unwrap(findJumpcloudSurface({ surface: excluded })).coverage).toBe("excluded");
    const seen: string[] = [];
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ seen, status: 200 }) }),
      input: {},
      surface: excluded,
    });
    expect(unwrapErr(result).code).toBe("SURFACE_REFUSED");
    expect(seen.length).toBe(0);
  });

  it("refuses an unbound path rather than sending a literal brace to the provider", async () => {
    const seen: string[] = [];
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ seen, status: 200 }) }),
      input: {},
      surface: "v1-systems-get",
    });
    expect(unwrapErr(result).code).toBe("PATH_UNBOUND");
    expect(seen.length).toBe(0);
  });

  it("builds the URL from the registry's own origin and path, never from a caller's string", async () => {
    const seen: string[] = [];
    await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ seen, status: 200 }) }),
      input: { query: { limit: "100" } },
      surface: "v1-systems-list",
    });
    expect(seen[0]).toBe("https://console.jumpcloud.com/api/systems?limit=100");
  });

  it("refuses a redirect rather than following it to somewhere nothing checked", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 302 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("REDIRECT_REFUSED");
  });

  it("reads a 404 as this organisation holding no such route, not as a failed read", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 404 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("ROUTE_ABSENT");
  });

  it("reads a 403 as a permission boundary this credential does not cross", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 403 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("PERMISSION_REFUSED");
  });

  it("reads a 401 as the credential itself being rejected, which a later run CAN clear", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 401 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("CREDENTIAL_REJECTED");
  });

  it("hands a body that is not JSON on as text, and its boundary refuses it without quoting it", async () => {
    const html = "<html>Administrator Login</html>";
    const answered = unwrap(
      await requestJumpcloud({
        deps: deps({ fetch: fakeFetch({ status: 200, text: html }) }),
        input: {},
        surface: "v1-systems-list",
      }),
    );
    expect(answered.text).toBe(html);
    const error = unwrapErr(admitJumpcloudPage({ headers: answered.headers, surface: "v1-systems-list", text: html }));
    expect(error.code).toBe("OPERATION_UNUSABLE");
    // The body itself never reaches a message, because a message reaches a kind file.
    expect(error.message.includes("Administrator")).toBe(false);
    expect(error.message).toContain("32 byte(s)");
  });

  it("reads a 400 as the operation refusing the request this atlas built, not as a failed read", async () => {
    // MEASURED live: the graph-association endpoints answer 400 until a `targets` parameter names what the
    // association is to, and no later run clears that on its own.
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 400 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("OPERATION_UNUSABLE");
  });

  // 503 rather than the 501 this case used to send: 501 is the one 5xx a later run cannot clear, and it is
  // settled now — see the split below, and `isRetryableStatus`'s own measurement.
  it("retries a 5xx and reports it as a transport failure, because a later run genuinely could clear it", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 503 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("TRANSPORT_FAILED");
  });

  it("returns the bound path as the reproduction handle a stored record carries", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 200, text: "{}" }) }),
      input: { bindings: { id: "abc" } },
      surface: "v1-systems-get",
    });
    expect(unwrap(result).endpoint).toBe("/api/systems/abc");
  });
});

describe("admittedRegistryRow", () => {
  it("admits a URL the registry's own row would have built", () => {
    expect(admittedRegistryRow({ method: "GET", url: "https://console.jumpcloud.com/api/systems" })?.name).toBe(
      "v1-systems-list",
    );
  });

  it("admits a bound id as ONE path segment", () => {
    expect(admittedRegistryRow({ method: "GET", url: "https://console.jumpcloud.com/api/systems/abc123" })?.name).toBe(
      "v1-systems-get",
    );
  });

  it("refuses a path the registry does not hold, which is the whole point of checking the transport", () => {
    expect(admittedRegistryRow({ method: "GET", url: "https://console.jumpcloud.com/not-in-the-registry" })).toBe(null);
  });

  it("refuses an extra segment past a bound id, so one wildcard cannot swallow a path", () => {
    expect(admittedRegistryRow({ method: "GET", url: "https://console.jumpcloud.com/api/systems/abc/extra" })).toBe(
      null,
    );
  });

  it("refuses a method the matched row does not declare", () => {
    expect(admittedRegistryRow({ method: "POST", url: "https://console.jumpcloud.com/api/systems" })).toBe(null);
  });

  it("refuses an origin neither pinned host serves", () => {
    expect(admittedRegistryRow({ method: "GET", url: "https://evil.example.com/api/systems" })).toBe(null);
  });

  it("refuses an inventoried-and-excluded row, which has no callable variant at all", () => {
    expect(admittedRegistryRow({ method: "GET", url: "https://console.jumpcloud.com/api/users/reactivate/abc" })).toBe(
      null,
    );
  });

  it("refuses a string that is not a URL at all", () => {
    expect(admittedRegistryRow({ method: "GET", url: "not a url" })).toBe(null);
  });
});

describe("productionJumpcloudFetch", () => {
  it("refuses to SEND a request the registry does not admit, rather than trusting its caller", async () => {
    await expect(
      productionJumpcloudFetch()({
        body: null,
        headers: {},
        method: "POST",
        url: "https://console.jumpcloud.com/not-in-the-registry",
      }),
    ).rejects.toThrow("the closed surface registry does not admit");
  });
});

describe("the retryable/settled split across the 4xx range", () => {
  it("retries a 408 rather than settling it, because a request timeout is the provider saying ask again", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 408 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("TRANSPORT_FAILED");
  });

  it("retries a 425 for the same reason", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 425 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("TRANSPORT_FAILED");
  });

  it("settles a 422, which is the provider rejecting the request rather than asking for another", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 422 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("OPERATION_UNUSABLE");
  });

  it("SETTLES a 501, the one 5xx a later run cannot clear — it made a generation permanently unpublishable", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 501 }) }),
      input: {},
      surface: "v1-systems-list",
    });

    const error = unwrapErr(result);
    expect(error.code).toBe("NOT_IMPLEMENTED");
    expect(error.message).toContain("answered 501: the provider does not implement this operation at all");
  });

  it("still retries a 500, which the same live run proved transient under a concurrent walk", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 500 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("TRANSPORT_FAILED");
  });

  it("still retries a 502, so narrowing the range took exactly one status out of it", async () => {
    const result = await requestJumpcloud({
      deps: deps({ fetch: fakeFetch({ status: 502 }) }),
      input: {},
      surface: "v1-systems-list",
    });
    expect(unwrapErr(result).code).toBe("TRANSPORT_FAILED");
  });
});
