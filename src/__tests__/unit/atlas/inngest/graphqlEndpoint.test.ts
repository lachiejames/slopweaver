/**
 * `probeInngestGraphql` over a fake probe transport: any HTTP status counts as reachable (the status is an
 * observation, not a success gate), a transport failure is an `ok` result reading unreachable with the joined
 * lines, and the endpoint and repro constants are the measured ones.
 */
import { describe, expect, it } from "vitest";

import {
  INNGEST_GRAPHQL_INTROSPECTION_REPRO,
  INNGEST_GRAPHQL_URL,
  probeInngestGraphql,
} from "../../../../atlas/inngest/graphqlEndpoint.js";
import type { InngestProbeTransport } from "../../../../atlas/inngest/transport.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

/**
 * A transport answering every address with one status and recording each address asked.
 *
 * @returns the seam and the addresses it was asked
 */
function answering({ status }: { status: number }): {
  readonly transport: InngestProbeTransport;
  readonly urls: string[];
} {
  const urls: string[] = [];
  return {
    transport: async ({ url }) => {
      urls.push(url);
      return ok({ location: null, status });
    },
    urls,
  };
}

describe("probeInngestGraphql", () => {
  it("the endpoint is the dashboard client's GraphQL address", () => {
    expect(INNGEST_GRAPHQL_URL).toBe("https://api.inngest.com/gql");
  });

  it("the repro is the introspection POST against that address", () => {
    expect(INNGEST_GRAPHQL_INTROSPECTION_REPRO).toBe(
      `curl -s https://api.inngest.com/gql -H 'content-type: application/json' -d '{"query":"query { __schema { types { name } } }"}'`,
    );
  });

  it("asks the GraphQL address once and reads a 400 as reachable", async () => {
    const fake = answering({ status: 400 });
    const result = await probeInngestGraphql({ probeTransport: fake.transport });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      note: "GET https://api.inngest.com/gql answered 400 to a request carrying no document",
      reachable: true,
    });
    expect(fake.urls).toEqual(["https://api.inngest.com/gql"]);
  });

  it("reads a 500 as reachable too, because any answer establishes the endpoint", async () => {
    const fake = answering({ status: 500 });
    const result = await probeInngestGraphql({ probeTransport: fake.transport });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      note: "GET https://api.inngest.com/gql answered 500 to a request carrying no document",
      reachable: true,
    });
  });

  it("a transport failure is an ok result reading unreachable, carrying the joined lines", async () => {
    const transport: InngestProbeTransport = async () => err(["first", "second"]);
    const result = await probeInngestGraphql({ probeTransport: transport });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({ note: "first; second", reachable: false });
  });
});
