import { describe, expect, it } from "vitest";

import {
  buildCrowdstrikeUrl,
  type CrowdstrikeClientDeps,
  type CrowdstrikeFetch,
  requestCrowdstrike,
} from "../../../../atlas/crowdstrike/client.js";
import { findCrowdstrikeCall } from "../../../../atlas/crowdstrike/inventory.js";
import { createTokenProvider, type TokenMinter } from "../../../../atlas/crowdstrike/tokenProvider.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const HOST = "https://api.us-2.example.test";
const NOW = 1_800_000_000_000;

/** A minter that always succeeds with a long-lived token — a fake, not a mock. */
const minter: TokenMinter = async () => ok({ accessToken: "bearer-1", expiresAtMs: NOW + 1_799_000 });

/** Build deps over a scripted sequence of provider answers. */
function depsOver({ answers }: { answers: readonly { status: number; text: string }[] }): {
  deps: CrowdstrikeClientDeps;
  seen: () => readonly { url: string; method: string; hasAuth: boolean }[];
} {
  const calls: { url: string; method: string; hasAuth: boolean }[] = [];
  let index = 0;
  const fetchSeam: CrowdstrikeFetch = async ({ url, method, headers }) => {
    calls.push({ hasAuth: typeof headers["authorization"] === "string", method, url });
    const answer = answers[Math.min(index, answers.length - 1)]!;
    index += 1;
    return answer;
  };
  return {
    deps: {
      apiHost: HOST,
      fetch: fetchSeam,
      nowMs: () => NOW,
      tokens: createTokenProvider({
        credentials: { apiHost: HOST, clientId: "id", clientSecret: "secret" },
        mint: minter,
      }),
    },
    seen: () => calls,
  };
}

describe("buildCrowdstrikeUrl", () => {
  it("builds from the inventory row rather than from a caller-supplied path", () => {
    const call = findCrowdstrikeCall({ id: "hosts-visible-ids" });
    const url = buildCrowdstrikeUrl({ apiHost: HOST, call, query: { limit: "1" } });
    expect(url).toBe(`${HOST}/devices/queries/devices/v1?limit=1`);
  });
});

describe("requestCrowdstrike", () => {
  it("refuses a call id the inventory does not admit, without making a request", async () => {
    const { deps, seen } = depsOver({ answers: [{ status: 200, text: "{}" }] });
    const result = await requestCrowdstrike({ callId: "contain-host", deps, input: {} });
    expect(unwrapErr(result).message).toContain("no such call is admitted");
    expect(unwrapErr(result).code).toBe("UNUSABLE_RESPONSE");
    expect(seen().length).toBe(0);
  });

  it("sends a bearer and returns a 200 body", async () => {
    const { deps, seen } = depsOver({
      answers: [{ status: 200, text: JSON.stringify({ meta: { pagination: { total: 161 } }, resources: ["a"] }) }],
    });
    const response = unwrap(await requestCrowdstrike({ callId: "hosts-visible-ids", deps, input: {} }));
    expect(response.statusCode).toBe(200);
    expect(response.total).toBe(161);
    expect(seen()[0]!.hasAuth).toBe(true);
  });

  it("reads an after-cursor when the provider offers one", async () => {
    const { deps } = depsOver({
      answers: [{ status: 200, text: JSON.stringify({ meta: { pagination: { after: "cursor-2" } } }) }],
    });
    const response = unwrap(await requestCrowdstrike({ callId: "open-vulnerabilities", deps, input: {} }));
    expect(response.afterCursor).toBe("cursor-2");
  });

  it("turns Falcon's exact scope refusal into SCOPE_REFUSED naming the scope", async () => {
    const { deps } = depsOver({
      answers: [
        {
          status: 403,
          text: JSON.stringify({ errors: [{ code: 403, message: "access denied, scope not permitted" }] }),
        },
      ],
    });
    const error = unwrapErr(await requestCrowdstrike({ callId: "alert-ids", deps, input: {} }));
    expect(error.code).toBe("SCOPE_REFUSED");
    expect(error.message).toContain("lacks alerts:read");
  });

  it("does NOT treat any other 403 as a scope refusal", async () => {
    const { deps } = depsOver({
      answers: [{ status: 403, text: JSON.stringify({ errors: [{ code: 403, message: "forbidden by policy" }] }) }],
    });
    const error = unwrapErr(await requestCrowdstrike({ callId: "alert-ids", deps, input: {} }));
    expect(error.code).toBe("UNUSABLE_RESPONSE");
  });

  it("turns a 404 into ROUTE_ABSENT that states the ambiguity rather than guessing", async () => {
    const { deps } = depsOver({ answers: [{ status: 404, text: "{}" }] });
    const error = unwrapErr(await requestCrowdstrike({ callId: "hosts-visible-ids", deps, input: {} }));
    expect(error.code).toBe("ROUTE_ABSENT");
    expect(error.message).toContain("cannot distinguish those causes");
  });

  it("treats an authorised empty result as success, never as a failure", async () => {
    const { deps } = depsOver({
      answers: [{ status: 200, text: JSON.stringify({ meta: { pagination: { total: 0 } }, resources: [] }) }],
    });
    const response = unwrap(await requestCrowdstrike({ callId: "hosts-visible-ids", deps, input: {} }));
    expect(response.total).toBe(0);
  });

  it("re-mints once on a 401 and succeeds on the retry", async () => {
    const { deps, seen } = depsOver({
      answers: [
        { status: 401, text: "{}" },
        { status: 200, text: JSON.stringify({ resources: [] }) },
      ],
    });
    const response = unwrap(await requestCrowdstrike({ callId: "hosts-visible-ids", deps, input: {} }));
    expect(response.statusCode).toBe(200);
    expect(seen().length).toBe(2);
    expect(deps.tokens.mintCount()).toBe(2);
  });

  it("gives up after a SECOND 401, because a fresh bearer failing is a wrong credential", async () => {
    const { deps, seen } = depsOver({ answers: [{ status: 401, text: "{}" }] });
    const error = unwrapErr(await requestCrowdstrike({ callId: "hosts-visible-ids", deps, input: {} }));
    expect(error.code).toBe("AUTH_FAILED");
    expect(error.message).toContain("Verify the API host, client id and client secret");
    expect(seen().length).toBe(2);
  });

  it("turns a 429 into TRANSPORT_EXHAUSTED rather than an unusable response", async () => {
    const { deps } = depsOver({ answers: [{ status: 429, text: "{}" }] });
    expect(unwrapErr(await requestCrowdstrike({ callId: "hosts-visible-ids", deps, input: {} })).code).toBe(
      "TRANSPORT_EXHAUSTED",
    );
  });

  it("sends a JSON body only for an admitted POST that was given one", async () => {
    const { deps, seen } = depsOver({ answers: [{ status: 200, text: JSON.stringify({ resources: [] }) }] });
    await requestCrowdstrike({ callId: "host-login-history", deps, input: { body: { ids: ["aid-1"] } } });
    expect(seen()[0]!.method).toBe("POST");
    expect(seen()[0]!.url).toBe(`${HOST}/devices/combined/devices/login-history/v1`);
  });
});
