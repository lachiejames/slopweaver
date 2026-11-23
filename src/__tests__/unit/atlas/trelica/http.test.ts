/**
 * The tenant HTTP boundary's three factories over a scripted requester standing in for `fetch`: the generic
 * transport forwards the whole request and labels it by method, the page fetcher reads only a 200 and calls
 * anything else a lost session, and the document fetcher reads the published path, parses a 200's JSON and
 * names the status or the parse failure in a typed refusal. A transport failure passes through as itself.
 */
import { describe, expect, it } from "vitest";

import { TrelicaAtlasErrors } from "../../../../atlas/trelica/errors.js";
import {
  TRELICA_REQUEST_TIMEOUT_MS,
  type TrelicaRequest,
  trelicaDocumentFetcher,
  trelicaHttp,
  trelicaPageFetcher,
} from "../../../../atlas/trelica/http.js";
import { trelicaPublishedDocumentPath } from "../../../../atlas/trelica/publishedSpec.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const ORIGIN = "https://acme.trelica.com";

/** A requester answering every request with one scripted result, recording each request it was sent. */
function scripted({ answer }: { answer: Awaited<ReturnType<TrelicaRequest>> }): {
  requester: TrelicaRequest;
  sent: Parameters<TrelicaRequest>[0][];
} {
  const sent: Parameters<TrelicaRequest>[0][] = [];
  const requester: TrelicaRequest = async (input) => {
    sent.push(input);
    return answer;
  };
  return { requester, sent };
}

/** A requester answering with one HTTP status and body. */
function answering({ statusCode, text }: { statusCode: number; text: string }): ReturnType<typeof scripted> {
  return scripted({ answer: ok({ statusCode, text }) });
}

describe("TRELICA_REQUEST_TIMEOUT_MS", () => {
  it("is thirty seconds", () => {
    expect(TRELICA_REQUEST_TIMEOUT_MS).toBe(30_000);
  });
});

describe("trelicaHttp", () => {
  it("forwards the whole request, labels it by its method, and returns the requester's answer as itself", async () => {
    const answer = ok({ statusCode: 200, text: '{"items":[]}' });
    const { requester, sent } = scripted({ answer });

    const result = await trelicaHttp({ requester })({
      body: '{"page":1}',
      headers: { "content-type": "application/json", cookie: "session=abc" },
      method: "POST",
      url: `${ORIGIN}/api/apps`,
    });

    expect(sent).toStrictEqual([
      {
        body: '{"page":1}',
        headers: { "content-type": "application/json", cookie: "session=abc" },
        label: "POST",
        method: "POST",
        url: `${ORIGIN}/api/apps`,
      },
    ]);
    expect(result).toBe(answer);
  });
});

describe("trelicaPageFetcher", () => {
  it("sends a cookie-bearing HTML GET for the path and returns a 200's body", async () => {
    const { requester, sent } = answering({ statusCode: 200, text: "<html>token</html>" });

    const result = await trelicaPageFetcher({ requester, tenantOrigin: ORIGIN })({
      cookie: "session=abc",
      path: "/apps",
    });

    expect(sent).toStrictEqual([
      {
        body: undefined,
        headers: { accept: "text/html", cookie: "session=abc" },
        label: "page:/apps",
        method: "GET",
        url: `${ORIGIN}/apps`,
      },
    ]);
    expect(unwrap(result)).toBe("<html>token</html>");
  });

  it("maps a 302 redirect and a 500 alike to SESSION_LOST for the tenant origin", async () => {
    const redirected = await trelicaPageFetcher({
      requester: answering({ statusCode: 302, text: "" }).requester,
      tenantOrigin: ORIGIN,
    })({ cookie: "session=gone", path: "/apps" });
    const failed = await trelicaPageFetcher({
      requester: answering({ statusCode: 500, text: "oops" }).requester,
      tenantOrigin: ORIGIN,
    })({ cookie: "session=abc", path: "/apps" });

    const expected = {
      code: "SESSION_LOST",
      message:
        "the signed-in session for https://acme.trelica.com is gone — open it in Chrome and sign in, then run this again",
      origin: ORIGIN,
    };
    expect(unwrapErr(redirected)).toEqual(expected);
    expect(unwrapErr(failed)).toEqual(expected);
    expect(expected).toEqual(TrelicaAtlasErrors.sessionLost({ origin: ORIGIN }));
  });

  it("passes a transport failure through as the same error", async () => {
    const failure = TrelicaAtlasErrors.transportFailed({ callId: "page:/apps", cause: "connect ECONNREFUSED" });
    const { requester } = scripted({ answer: err(failure) });

    const result = await trelicaPageFetcher({ requester, tenantOrigin: ORIGIN })({
      cookie: "session=abc",
      path: "/apps",
    });

    expect(unwrapErr(result)).toBe(failure);
  });
});

describe("trelicaDocumentFetcher", () => {
  it("sends a cookie-bearing JSON GET for the published path and parses a 200's document whole", async () => {
    const { requester, sent } = answering({
      statusCode: 200,
      text: '{"info":{"title":"Apps","version":"v1"},"paths":{"/api/apps/v1":{"get":{"operationId":"listApps","responses":{}}}}}',
    });

    const result = await trelicaDocumentFetcher({ cookie: "session=abc", requester, tenantOrigin: ORIGIN })({
      document: "apps",
    });

    expect(sent).toStrictEqual([
      {
        body: undefined,
        headers: { accept: "application/json", cookie: "session=abc" },
        label: "document:apps",
        method: "GET",
        url: `${ORIGIN}/api/apps/docs/v1/swagger.json`,
      },
    ]);
    expect(unwrap(result)).toEqual({
      info: { title: "Apps", version: "v1" },
      paths: { "/api/apps/v1": { get: { operationId: "listApps", responses: {} } } },
    });
  });

  it("refuses a non-200 as DOCUMENT_UNREADABLE naming the status and path, while a 200 beside it parses", async () => {
    const refused = await trelicaDocumentFetcher({
      cookie: "session=abc",
      requester: answering({ statusCode: 201, text: "{}" }).requester,
      tenantOrigin: ORIGIN,
    })({ document: "people" });
    const accepted = await trelicaDocumentFetcher({
      cookie: "session=abc",
      requester: answering({ statusCode: 200, text: '{"info":{"title":"People","version":"v1"},"paths":{}}' })
        .requester,
      tenantOrigin: ORIGIN,
    })({ document: "people" });

    const error = unwrapErr(refused);
    expect(error.code).toBe("DOCUMENT_UNREADABLE");
    expect(error.message).toBe(
      "the people API document could not be read: the tenant answered HTTP 201 for /api/people/docs/v1/swagger.json",
    );
    expect(error).toEqual(
      TrelicaAtlasErrors.documentUnreadable({
        detail: "the tenant answered HTTP 201 for /api/people/docs/v1/swagger.json",
        document: "people",
      }),
    );
    expect(unwrap(accepted)).toEqual({ info: { title: "People", version: "v1" }, paths: {} });
  });

  it("refuses a 200 whose document drifted as DOCUMENT_UNREADABLE naming the key, never the body", async () => {
    const result = await trelicaDocumentFetcher({
      cookie: "session=abc",
      requester: answering({
        statusCode: 200,
        text: '{"info":{"title":"People","version":"v1"},"paths":{},"webhooks":{"S3cr3t":{}}}',
      }).requester,
      tenantOrigin: ORIGIN,
    })({ document: "people" });

    const error = unwrapErr(result);
    expect(error).toEqual(
      TrelicaAtlasErrors.documentUnreadable({
        detail:
          'GET /api/<document>/docs/v1/swagger.json answered a shape this version does not read — refused, not guessed: new field "webhooks"',
        document: "people",
      }),
    );
    expect(JSON.stringify(error)).not.toContain("S3cr3t");
  });

  it("refuses a 200 whose body is not JSON as DOCUMENT_UNREADABLE, never quoting the body", async () => {
    const result = await trelicaDocumentFetcher({
      cookie: "session=abc",
      requester: answering({ statusCode: 200, text: "S3cr3t!" }).requester,
      tenantOrigin: ORIGIN,
    })({ document: "flow" });

    const error = unwrapErr(result);
    expect(error.code).toBe("DOCUMENT_UNREADABLE");
    expect(error).toEqual(
      TrelicaAtlasErrors.documentUnreadable({
        detail: `${trelicaPublishedDocumentPath({ document: "flow" })} answered a body that is not JSON`,
        document: "flow",
      }),
    );
    expect(JSON.stringify(error)).not.toContain("S3cr3t");
  });

  it("passes a transport failure through as the same error", async () => {
    const failure = TrelicaAtlasErrors.transportFailed({ callId: "document:auth", cause: "connect ECONNREFUSED" });
    const { requester } = scripted({ answer: err(failure) });

    const result = await trelicaDocumentFetcher({ cookie: "session=abc", requester, tenantOrigin: ORIGIN })({
      document: "auth",
    });

    expect(unwrapErr(result)).toBe(failure);
  });
});
