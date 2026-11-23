/**
 * The door's own Microsoft Graph client — deadline and authentication included, built by `graphClientOverWire` —
 * whose wire is a plain hand-written terminal middleware instead of the network: every request the client builds
 * is recorded, and the response is the one the test scripted. Shared by the `api` and `apiWrite` tests so each
 * asserts the exact method, URL, headers and body the door sent.
 */
import {
  type GraphContext as Context,
  type GraphClient,
  graphClientOverWire,
  type GraphMiddleware as Middleware,
} from "../../../../live/outlook/client.js";

/** The bearer the fake client sends; nothing checks it, and it is no credential. */
const FAKE_ACCESS_TOKEN = "fake-access-token";

/** One request as the terminal middleware saw it, after the SDK had built it. */
interface RecordedGraphRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

/** What the fake answers every request with. */
interface ScriptedGraphAnswer {
  readonly status: number;
  /** The JSON document to send, or `undefined` for an empty body. */
  readonly json: unknown;
}

/** The client, and every request it was asked to send, in order. */
export interface FakeGraph {
  readonly client: GraphClient;
  readonly seen: RecordedGraphRequest[];
}

/** The headers the SDK put on the request, flattened to a plain record with lower-cased names. */
function flatHeaders({ context }: { context: Context }): Readonly<Record<string, string>> {
  const raw = context.options?.headers;
  if (raw === undefined) {
    return {};
  }
  // `Headers` accepts every `HeadersInit` shape and lower-cases each name itself.
  return Object.fromEntries(new Headers(raw).entries());
}

/**
 * Build a Graph client that answers each request with the next scripted answer (the last one repeats).
 *
 * @param answers the responses to give, in order
 * @returns the SDK client and the requests it sent
 */
export function fakeGraph({ answers }: { answers: readonly ScriptedGraphAnswer[] }): FakeGraph {
  const seen: RecordedGraphRequest[] = [];
  const terminal: Middleware = {
    execute: async (context) => {
      seen.push({
        body: context.options?.body,
        headers: flatHeaders({ context }),
        method: context.options?.method,
        url: typeof context.request === "string" ? context.request : context.request.url,
      });
      const answer = answers[Math.min(seen.length, answers.length) - 1]!;
      if (answer.json === undefined) {
        context.response = new Response(null, { status: answer.status });
        return;
      }
      context.response = new Response(JSON.stringify(answer.json), {
        headers: { "content-type": "application/json" },
        status: answer.status,
      });
    },
  };
  return { client: graphClientOverWire({ accessToken: FAKE_ACCESS_TOKEN, wire: terminal }), seen };
}
