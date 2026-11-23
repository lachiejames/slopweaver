/**
 * One Vanta Manage API surface, walked: the page request, the per-page token, and the lister `client.ts`
 * builds every collection read from.
 *
 * Split out of `client.ts` along the seam between walking ONE surface and assembling the closed client from
 * many, so the walk's own guards — which failure a caller is told about, and which it is not — are reachable
 * by a unit test directly rather than only through a whole client.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { VantaHttpErrors, type VantaTransportFailure, vantaTransportFailureLines } from "./httpErrors.js";
import type { VantaManageEndpoint } from "./inventory.js";
import { type VantaTokenProvider, withUnauthorizedNote } from "./oauth.js";
import type { VantaPageBoundary } from "./pageBoundary.js";
import { readVantaPagesSequentially, type VantaPage } from "./pagination.js";
import { type VantaSurfaceError, VantaSurfaceErrors } from "./surfaceErrors.js";
import { redactTokensInErrors } from "./tokenRedaction.js";
import type { VantaTransport } from "./transport.js";

/** Requested on every page — the documented maximum, to minimise the number of pages walked. */
const PAGE_SIZE = 100;

/**
 * Build the query string for one page request, from a surface's fixed params plus the cursor.
 *
 * @param cursor the cursor to continue from, or `null` for the first page
 * @returns the path and query the transport is asked for
 */
export function pageQuery({ endpoint, cursor }: { endpoint: VantaManageEndpoint; cursor: string | null }): string {
  const params = new URLSearchParams({ pageSize: String(PAGE_SIZE), ...endpoint.fixedQuery });
  if (cursor !== null) {
    params.set("pageCursor", cursor);
  }
  return `${endpoint.path}?${params.toString()}`;
}

/**
 * Fetch and parse one page of one surface, given an already-resolved token.
 *
 * @param surface the surface name, resolved to its endpoint via `inventory.ts`
 * @param endpoint the surface's endpoint
 * @param cursor the cursor to continue from, or `null` for the first page
 * @param token the bearer token to send, already resolved by the caller
 * @param transport the bound Vanta transport
 * @param pageBoundary the endpoint's declared read, refusing any drift in the page by name
 * @returns the page, or why it could not be fetched or parsed — still typed, a 401 already carrying the
 *   one-token-per-app note
 */
export async function fetchVantaPage<TItem>({
  surface,
  endpoint,
  cursor,
  token,
  transport,
  pageBoundary,
}: {
  surface: string;
  endpoint: VantaManageEndpoint;
  cursor: string | null;
  token: string;
  transport: VantaTransport;
  pageBoundary: VantaPageBoundary<TItem>;
}): Promise<Result<VantaPage<TItem>, VantaTransportFailure>> {
  const response = await transport.request({
    headers: { authorization: `Bearer ${token}` },
    method: endpoint.method,
    path: pageQuery({ cursor, endpoint }),
  });
  if (response.isErr()) {
    return err(withUnauthorizedNote({ error: response.error }));
  }
  const page = pageBoundary.readPage({ text: response.value.body });
  if (page.isErr()) {
    return err(VantaHttpErrors.pageUnreadable({ boundaryError: page.error, surface }));
  }
  return ok(page.value);
}

/**
 * Resolve this page's token, recording it into `usedTokens` before fetching — every token a walk ever
 * presents has to be known to `tokenRedaction.ts` once the walk ends, including one an earlier page
 * used before a mid-walk refresh replaced it.
 */
async function fetchVantaPageRecordingToken<TItem>({
  surface,
  endpoint,
  cursor,
  tokenProvider,
  transport,
  pageBoundary,
  usedTokens,
  onRequestSent,
  onTokenRefused,
}: {
  surface: string;
  endpoint: VantaManageEndpoint;
  cursor: string | null;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
  pageBoundary: VantaPageBoundary<TItem>;
  usedTokens: Set<string>;
  /** Called once a request is actually about to go out, so a caller can tell a provider's answer from a failure to ask. */
  onRequestSent?: () => void;
  /** Called when this page's token could not be had, so no request went out for it. */
  onTokenRefused?: () => void;
}): Promise<Result<VantaPage<TItem>, VantaTransportFailure>> {
  const token = await tokenProvider.getToken();
  if (token.isErr()) {
    onTokenRefused?.();
    return err(token.error);
  }
  usedTokens.add(token.value);
  onRequestSent?.();
  return fetchVantaPage({ cursor, endpoint, pageBoundary, surface, token: token.value, transport });
}

/** What a walk tells its caller about a failure the provider answered. */
export interface VantaSurfaceRefusal {
  readonly failure: VantaTransportFailure;
  readonly requestsSent: number;
  /** Every token the walk presented, so a caller can redact a path exactly as the transport did. */
  readonly usedTokens: ReadonlySet<string>;
}

/**
 * One surface's `list*` method: the walk, with every token it used redacted from any refusal.
 *
 * `onRefusal` sees the walk's TYPED failure, how many requests went out and every token the walk presented
 * (to redact a path as the transport did), and ONLY when the failure came
 * from a request that went out. A token acquisition that fails — on the first page or on a later one, after
 * other requests were sent — returns before `transport.request` is called for that page, so its failure is
 * not the provider answering, and a caller told about it could not tell a refusal from a failure to ask. The
 * failure the CALLER gets back is still graded over the redacted lines; this is a second look, never a
 * second copy.
 *
 * The failure comes back GRADED: this is the last point holding both the walk's typed failure and its final
 * redacted lines, so it is where {@link VantaSurfaceErrors.fromTransportFailure} reads the code.
 *
 * @param providerId the stable id of one item, so the walk refuses a duplicate rather than deduplicating it
 * @param onRefusal a second look at a failure the provider answered with, never at a failure to ask
 * @returns the walk, as a function a client method can be
 */
export function singleSurfaceLister<TItem>({
  surface,
  endpoint,
  tokenProvider,
  transport,
  pageBoundary,
  providerId,
  onRefusal,
}: {
  surface: string;
  endpoint: VantaManageEndpoint;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
  pageBoundary: VantaPageBoundary<TItem>;
  providerId: (item: TItem) => string;
  onRefusal?: (refusal: VantaSurfaceRefusal) => void;
}): () => Promise<Result<readonly TItem[], VantaSurfaceError>> {
  return async () => {
    const usedTokens = new Set<string>();
    // Collected rather than assigned to a boolean: the compiler cannot see that a callback ran, and narrows
    // a `let` the callback is the only writer of to its initial value.
    const sent: true[] = [];
    const tokenRefused: true[] = [];
    const result = await readVantaPagesSequentially({
      fetchPage: ({ cursor }) =>
        fetchVantaPageRecordingToken({
          cursor,
          endpoint,
          onRequestSent: () => {
            sent.push(true);
          },
          onTokenRefused: () => {
            tokenRefused.push(true);
          },
          pageBoundary,
          surface,
          tokenProvider,
          transport,
          usedTokens,
        }),
      providerId,
    });
    if (result.isOk()) {
      return ok(result.value);
    }
    // A token failure ends the walk, so when one happened it IS the failure being returned.
    if (sent.length > 0 && tokenRefused.length === 0) {
      onRefusal?.({ failure: result.error, requestsSent: sent.length, usedTokens });
    }
    return err(
      VantaSurfaceErrors.fromTransportFailure({
        failure: result.error,
        reasons: redactTokensInErrors({ errors: vantaTransportFailureLines({ error: result.error }), usedTokens }),
      }),
    );
  };
}
