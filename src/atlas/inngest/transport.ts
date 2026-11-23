/**
 * The one module here that touches the network, and the two seams everything above it is written against.
 *
 * ## Two transports, because this atlas asks the network two different questions
 *
 * {@link InngestDocumentTransport} asks for a document's BYTES — the REST catalogue, the dashboard's own
 * client bundle. {@link InngestProbeTransport} asks only what an address ANSWERS, following nothing, because
 * the whole point of a probe is the status line and the redirect target rather than the body. Folding them
 * into one would make every probe download a page it never reads, and would lose the `location` header the
 * dashboard's sign-in redirect is identified by.
 *
 * Both are plain functions passed in, never mocks: a test supplies a deterministic fake and the real
 * implementations here do nothing but fetch.
 *
 * ## Reaching these documents is not reaching the account
 *
 * `api-docs.inngest.com` and the bundle `app.inngest.com` serves a signed-out visitor are PUBLIC. They take
 * no credential, return nothing about this installation, and are the same bytes any reader is served — so
 * this surface describes the PRODUCT rather than the account, which is exactly what `model.ts`'s
 * `compiled-published-catalogue` visibility scope says and why a coverage cell filled from it must never be
 * read as a claim about what this account holds.
 *
 * Every probe is a GET and nothing here sends another method. An anonymous `DELETE` sent to find out whether
 * a route exists is a write attempt whatever it returns, so a mutating operation is recorded
 * `unprobeable-mutating` rather than requested.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { InngestAtlasErrors, inngestAtlasErrorLines } from "./errors.js";

/** How one document's bytes are obtained. */
export type InngestDocumentTransport = (input: { url: string }) => Promise<Result<string>>;

/** What one unauthenticated GET answered, with nothing followed. */
export interface InngestProbeAnswer {
  /**
   * The `location` header exactly as sent, or `null` when the answer carried none.
   *
   * Nullable rather than an empty string, because "this answer redirected nowhere" and "this answer
   * redirected to the empty address" are different facts and only one of them ever happens.
   */
  readonly location: string | null;
  readonly status: number;
}

/** How one address's answer is obtained. */
export type InngestProbeTransport = (input: { url: string }) => Promise<Result<InngestProbeAnswer>>;

/**
 * Fetch one document over HTTP.
 *
 * @param url the address to fetch, which callers build from a pinned origin and never from user input
 * @returns the response body as UTF-8, or why it could not be fetched
 */
export async function httpDocumentTransport({ url }: { url: string }): Promise<Result<string>> {
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      return err(
        inngestAtlasErrorLines({ error: InngestAtlasErrors.documentRefused({ status: response.status, url }) }),
      );
    }
    return ok(await response.text());
  } catch (cause) {
    return err(inngestAtlasErrorLines({ error: InngestAtlasErrors.documentUnfetched({ cause, url }) }));
  }
}

/**
 * Ask one address what it answers, following nothing and reading no body.
 *
 * A non-2xx is a RESULT here rather than an error — a 401 and a 404 are the two answers the whole probe
 * exists to tell apart, so treating either as a failure would discard the finding.
 *
 * @param url the address to probe
 * @returns the status and any `location` header, or why the request could not be made at all
 */
export async function httpProbeTransport({ url }: { url: string }): Promise<Result<InngestProbeAnswer>> {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return ok({ location: response.headers.get("location"), status: response.status });
  } catch (cause) {
    return err(inngestAtlasErrorLines({ error: InngestAtlasErrors.probeFailed({ cause, url }) }));
  }
}
