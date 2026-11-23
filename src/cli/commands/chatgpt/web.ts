/**
 * The `chatgpt` noun's one production edge to the chatgpt.com web backend: a plain `fetch` GET with the owner's pasted
 * session, shared by every verb that reads the account (`conversation`, `list`).
 *
 * It is a plain `fetch` because the ChatGPT web backend has no official SDK — the `openai` package speaks the platform
 * API, which cannot read a chatgpt.com conversation or list an account's history at all (docs/provider-sdks.md asks a
 * raw-fetch site to say so here). That backend is PRIVATE and undocumented: it can change shape or close without
 * notice, which is why every endpoint is read through a strict boundary and a change of shape stops the read.
 *
 * Every request is a GET to a path this noun built in code — never one taken from a response — and a redirect is
 * answered as itself rather than followed.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ChatgptError, ChatgptErrors } from "./errors.js";
import type { ChatgptSessionHeaders } from "./paste.js";

/** Where every path this noun builds is sent. */
export const CHATGPT_ORIGIN = "https://chatgpt.com";

/** The edge every `chatgpt` web read goes through. */
export interface ChatgptWebDeps {
  /** One GET of a path under chatgpt.com with the stored session's headers, answered as the body's text. */
  readonly fetchText: (args: { headers: ChatgptSessionHeaders; path: string }) => Promise<Result<string, ChatgptError>>;
}

/**
 * The request every `chatgpt` web GET is sent with. Pure.
 *
 * `redirect: "manual"` is what keeps the read on the path this noun built: fetch's default FOLLOWS a 3xx, so the
 * server would choose the final URL and the session would ride along. A 3xx is answered as itself instead, and is
 * refused as `HTTP_REFUSED` like any other non-2xx.
 *
 * @param headers the stored session's five headers
 * @returns the fetch options
 */
export function chatgptRequestInit({ headers }: { headers: ChatgptSessionHeaders }): RequestInit {
  return { headers: { accept: "application/json", ...headers }, method: "GET", redirect: "manual" };
}

/**
 * A transport failure's text with every session header value withheld. Pure.
 *
 * undici quotes a header VALUE it will not send (`Headers.append: "<value>" is an invalid header value`), so a
 * stored cookie carrying one stray control character would otherwise reach stderr through `TRANSPORT_FAILED`.
 *
 * @param text the thrown error's message
 * @param headers the stored session's five headers
 * @returns the text with each non-empty header value replaced
 */
export function withholdHeaderValues({ text, headers }: { text: string; headers: ChatgptSessionHeaders }): string {
  // One pass, longest value first, so a short value never matches inside a longer one or inside the placeholder.
  const values = Object.values(headers)
    .filter((value) => value.length > 0)
    .toSorted((a, b) => b.length - a.length)
    .map((value) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (values.length === 0) {
    return text;
  }
  return text.replaceAll(new RegExp(values.join("|"), "g"), "<header value withheld>");
}

/**
 * A strict endpoint boundary's refusal as this noun's own error, carrying the boundary's message. Pure.
 *
 * @param path the path whose body the boundary refused
 * @param error the boundary's refusal
 * @returns `NOT_JSON` for a body declared JSON that does not parse, else `PAGE_MALFORMED`
 */
export function boundaryRefusal({
  path,
  error,
}: {
  path: string;
  error: { readonly code: string; readonly message: string };
}): ChatgptError {
  if (error.code === "BOUNDARY_NOT_JSON") {
    return ChatgptErrors.notJson({ contentType: "a body declared JSON that does not parse", path });
  }
  return ChatgptErrors.pageMalformed({ path, problems: [error.message] });
}

/**
 * Whether a 2xx answer's content-type is JSON, and the refusal when it is not — a Cloudflare challenge is served as
 * HTML. Pure.
 *
 * The server chose the content-type text, so it is withheld exactly like a thrown message before it reaches an error:
 * a response may echo a header value back.
 *
 * @param contentType the response's content-type header, `null` when it sent none
 * @param headers the stored session's five headers, withheld from the refusal
 * @param path the path asked, named in the refusal
 * @returns the `NOT_JSON` refusal, or `undefined` when the body is JSON
 */
export function contentTypeRefusal({
  contentType,
  headers,
  path,
}: {
  contentType: string | null;
  headers: ChatgptSessionHeaders;
  path: string;
}): ChatgptError | undefined {
  if (contentType === null) {
    return ChatgptErrors.notJson({ contentType: "no content-type", path });
  }
  if (contentType.includes("application/json")) {
    return undefined;
  }
  return ChatgptErrors.notJson({ contentType: withholdHeaderValues({ headers, text: contentType }), path });
}

/**
 * The production GET: the stored session's five headers, JSON asked for, and anything not served as JSON — a
 * Cloudflare challenge — refused as such. The body goes back as text: each caller parses it through its endpoint's
 * strict boundary, never here.
 *
 * @returns the edge
 */
export function productionChatgptWebDeps(): ChatgptWebDeps {
  return {
    fetchText: async ({ headers, path }) => {
      let response: Response;
      try {
        response = await fetch(`${CHATGPT_ORIGIN}${path}`, chatgptRequestInit({ headers }));
      } catch (error: unknown) {
        const text = error instanceof Error ? error.message : String(error);
        return err(ChatgptErrors.transportFailed({ cause: new Error(withholdHeaderValues({ headers, text })), path }));
      }
      if (!response.ok) {
        return err(ChatgptErrors.httpRefused({ path, status: response.status }));
      }
      const refusal = contentTypeRefusal({ contentType: response.headers.get("content-type"), headers, path });
      if (refusal !== undefined) {
        return err(refusal);
      }
      try {
        return ok(await response.text());
      } catch (error: unknown) {
        const text = error instanceof Error ? error.message : String(error);
        return err(ChatgptErrors.transportFailed({ cause: new Error(withholdHeaderValues({ headers, text })), path }));
      }
    },
  };
}
