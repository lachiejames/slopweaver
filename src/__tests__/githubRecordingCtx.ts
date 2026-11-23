/**
 * The fake transport behind a write-lane test context: a plain `fetch` that records each request and answers it from a
 * responder the case supplies. No mock library, no network.
 *
 * The Octokit itself is built in each test file that uses this, never here: the `scheduler-bypass` gate sanctions an
 * SDK client only in a listed factory or a `*.test.ts` file, and a shared helper is neither.
 */

/** One request as the fake transport saw it. */
export interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** One answer the fake transport gives. */
export interface FakeAnswer {
  readonly status: number;
  readonly data: unknown;
}

/** Each context's own rate-limit scope, so one case's write is never paced behind another's. */
let scopeCount = 0;

/**
 * A fresh rate-limit scope id for one test context.
 *
 * @returns an id no other context in this process holds
 */
export function recordingScopeId(): string {
  scopeCount += 1;
  return `recording-ctx-${String(scopeCount)}`;
}

/**
 * A `fetch` that records every request and answers each from `respond`.
 *
 * @param sent the list each request is appended to, in order
 * @param respond the answer for one recorded request
 * @returns the transport an Octokit's `request.fetch` takes
 */
export function recordingFetch({
  sent,
  respond,
}: {
  sent: SentRequest[];
  respond: (request: SentRequest) => FakeAnswer;
}): typeof globalThis.fetch {
  return async (url, init) => {
    const body = init?.body;
    const request: SentRequest = {
      // Octokit sends a body-less PUT with an empty string, which is no JSON document.
      body: typeof body === "string" && body !== "" ? JSON.parse(body) : undefined,
      method: String(init?.method),
      url: url instanceof Request ? url.url : url.toString(),
    };
    sent.push(request);
    const answer = respond(request);
    const text = answer.status === 204 ? null : JSON.stringify(answer.data);
    return new Response(text, { headers: { "content-type": "application/json" }, status: answer.status });
  };
}

/**
 * A responder giving every request the same answer.
 *
 * @returns the responder
 */
export function always({ status, data }: FakeAnswer): (request: SentRequest) => FakeAnswer {
  return () => ({ data, status });
}
