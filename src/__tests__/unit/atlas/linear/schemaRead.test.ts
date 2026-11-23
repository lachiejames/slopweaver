/*
 * The Linear schema read, driven through a plain fake transport: a whole read, a batch that dropped an
 * alias, a census that moved while the walk ran, and a transport that threw.
 */
import { describe, expect, it } from "vitest";

import { type IntrospectedType, TYPE_NAME_QUERY } from "../../../../atlas/linear/introspection.js";
import { readSchema } from "../../../../atlas/linear/schemaRead.js";
import type { LinearRequest } from "../../../../corpus/linear/transport.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A two-type census whose query root declares `rootFields` fields. */
function census({ rootFields }: { rootFields: readonly string[] }): unknown {
  return {
    __schema: {
      mutationType: null,
      queryType: { fields: rootFields.map((name) => ({ name })) },
      subscriptionType: null,
      types: [
        { kind: "OBJECT", name: "Query" },
        { kind: "OBJECT", name: "Issue" },
      ],
    },
  };
}

const QUERY_TYPE: IntrospectedType = {
  description: null,
  enumValues: null,
  fields: [
    {
      args: [],
      deprecationReason: null,
      description: null,
      isDeprecated: false,
      name: "issue",
      type: { kind: "OBJECT", name: "Issue" },
    },
  ],
  inputFields: null,
  kind: "OBJECT",
  name: "Query",
};

const ISSUE_TYPE: IntrospectedType = {
  description: null,
  enumValues: null,
  fields: [],
  inputFields: null,
  kind: "OBJECT",
  name: "Issue",
};

/** A fake transport answering each request with the next scripted answer, rejecting on an `Error`. */
function scripted({ answers }: { answers: readonly unknown[] }): { request: LinearRequest; queries: string[] } {
  const queries: string[] = [];
  const request: LinearRequest = ({ query }) => {
    queries.push(query);
    const answer = answers[queries.length - 1];
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { queries, request };
}

describe("readSchema", () => {
  it("reads the census, every type in one batch, then the census again, and fingerprints what it read", async () => {
    const { queries, request } = scripted({
      answers: [
        census({ rootFields: ["issue"] }),
        { t0: QUERY_TYPE, t1: ISSUE_TYPE },
        census({ rootFields: ["issue"] }),
      ],
    });
    const read = unwrap(await readSchema({ request }));
    expect(read.batches).toBe(1);
    expect(read.types.map((type) => type.name)).toEqual(["Query", "Issue"]);
    expect(read.fingerprint).toBe("types=2;OBJECT=2;Mutation=0,Query=1,Subscription=0");
    expect(queries[0]).toBe(TYPE_NAME_QUERY);
    expect(queries[1]).toContain('t1: __type(name: "Issue")');
    expect(queries[2]).toBe(TYPE_NAME_QUERY);
  });

  it("refuses the whole read when a batch did not return every alias it asked for", async () => {
    const { queries, request } = scripted({ answers: [census({ rootFields: ["issue"] }), { t0: QUERY_TYPE }] });
    const failure = unwrapErr(await readSchema({ request }));
    expect(failure.code).toBe("SCHEMA_MALFORMED");
    expect(failure).toEqual(
      expect.objectContaining({
        issues: [
          "a batch asked for 2 type(s) and 1 did not come back: Issue",
          "refusing rather than publishing a schema that is quietly missing types",
        ],
      }),
    );
    expect(queries).toHaveLength(2);
  });

  it("refuses a generation whose census moved between the first read and the re-read", async () => {
    const { request } = scripted({
      answers: [
        census({ rootFields: ["issue"] }),
        { t0: QUERY_TYPE, t1: ISSUE_TYPE },
        census({ rootFields: ["issue", "brandNew"] }),
      ],
    });
    const failure = unwrapErr(await readSchema({ request }));
    expect(failure).toEqual(
      expect.objectContaining({
        code: "SCHEMA_MALFORMED",
        issues: [
          "the schema census moved while it was being read: types=2;OBJECT=2;roots:mutationType=0,queryType=1,subscriptionType=0 became types=2;OBJECT=2;roots:mutationType=0,queryType=2,subscriptionType=0",
          "refusing rather than publishing a generation that is half one schema and half another",
        ],
      }),
    );
  });

  it("reports a transport that threw as an unreadable schema, carrying its message", async () => {
    const { request } = scripted({ answers: [new Error("linear answered 503")] });
    const failure = unwrapErr(await readSchema({ request }));
    expect(failure.code).toBe("SCHEMA_UNREADABLE");
    expect(failure.message).toBe("linear answered 503");
  });
});
