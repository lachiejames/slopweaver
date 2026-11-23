import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { HexFetchLike, HexSleepLike } from "../../../hex/client.js";
import { HexReadErrors } from "../../../hex/errors.js";
import { openHexClient } from "../../../hex/session.js";
import { defineBoundary } from "../../../lib/boundary.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One request the fake transport received. */
interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
}

/**
 * A transport that answers each request with the next scripted response and records what it was asked.
 *
 * @returns the seam and the list it records into
 */
function scriptedFetch({
  responses,
}: {
  responses: readonly { status: number; headers: Record<string, string>; body: string }[];
}): { readonly calls: FetchCall[]; readonly fetch: HexFetchLike } {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const response = responses[calls.length]!;
      calls.push({ headers: init.headers, method: init.method, url });
      return { headers: response.headers, status: response.status, text: async () => response.body };
    },
  };
}

/**
 * A wait seam that never waits and records every wait it was asked for.
 *
 * @returns the seam and the seconds it recorded
 */
function recordingSleep(): { readonly sleep: HexSleepLike; readonly waits: number[] } {
  const waits: number[] = [];
  return {
    sleep: async ({ seconds }) => {
      waits.push(seconds);
    },
    waits,
  };
}

const PROJECT = defineBoundary({
  endpoint: "GET /v1/projects/{projectId}",
  schema: z.strictObject({ id: z.string(), title: z.string() }),
});

describe("openHexClient", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hex-session-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses with TOKEN_MISSING when neither the env nor the home's secret file holds a token", () => {
    const transport = scriptedFetch({ responses: [] });
    const wait = recordingSleep();
    const opened = openHexClient({ env: {}, fetch: transport.fetch, home, sleep: wait.sleep });
    expect(opened.isErr()).toBe(true);
    expect(unwrapErr(opened)).toEqual(HexReadErrors.tokenMissing());
    expect(unwrapErr(opened).code).toBe("TOKEN_MISSING");
    expect(transport.calls).toEqual([]);
    expect(wait.waits).toEqual([]);
  });

  it("builds the client on the injected transport, sending the env token as a bearer to the pinned origin", async () => {
    const transport = scriptedFetch({
      responses: [{ body: '{"id":"proj-alpha","title":"Bravo"}', headers: {}, status: 200 }],
    });
    const wait = recordingSleep();
    const opened = openHexClient({
      env: { HEX_API_TOKEN: "token-charlie" },
      fetch: transport.fetch,
      home,
      sleep: wait.sleep,
    });
    expect(opened.isOk()).toBe(true);
    const read = await unwrap(opened).get({ path: "/v1/projects/proj-alpha", boundary: PROJECT });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual({ id: "proj-alpha", title: "Bravo" });
    expect(transport.calls).toEqual([
      {
        headers: { Accept: "application/json", Authorization: "Bearer token-charlie" },
        method: "GET",
        url: "https://app.hex.tech/api/v1/projects/proj-alpha",
      },
    ]);
    expect(wait.waits).toEqual([]);
  });

  it("routes the client's one 429 retry through the injected wait seam", async () => {
    const transport = scriptedFetch({
      responses: [
        { body: "slow down", headers: { "retry-after": "5" }, status: 429 },
        { body: '{"id":"proj-delta","title":"Echo"}', headers: {}, status: 200 },
      ],
    });
    const wait = recordingSleep();
    const opened = openHexClient({
      env: { HEX_API_TOKEN: "token-foxtrot" },
      fetch: transport.fetch,
      home,
      sleep: wait.sleep,
    });
    expect(opened.isOk()).toBe(true);
    const read = await unwrap(opened).get({ path: "/v1/projects/proj-delta", boundary: PROJECT });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual({ id: "proj-delta", title: "Echo" });
    expect(wait.waits).toEqual([5]);
    expect(transport.calls.length).toBe(2);
  });
});
