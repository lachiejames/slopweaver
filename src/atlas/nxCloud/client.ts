/**
 * The read-only HTTP client this atlas reaches Nx Cloud with, and the seam a test replaces.
 *
 * ## Everything it can do is a GET named in `inventory.ts`
 *
 * A caller passes a call id and the scope; the URL is built from the table. There is no argument here that
 * reaches a path the inventory does not list, and there is no method argument at all — Nx Cloud's own
 * mutations are React Router ACTIONS, which are POSTs to the same paths, so refusing to have a method
 * parameter refuses the whole write surface by construction rather than by discipline.
 *
 * ## The transport is injected, and that is what makes the sync testable
 *
 * {@link NxCloudTransport} is a plain function, not a mock: a unit test hands the sync a fake that answers
 * from a fixture, and the shipped path hands it {@link createFetchTransport}. `.claude/rules/testing.md`
 * bans `vi.fn`; a seam is the alternative it names.
 *
 * ## A non-200 is data, not a throw
 *
 * The interesting statuses here are 403 and 404, and both are FINDINGS: the workspace settings page 403s to
 * a member and the organisation settings path does not exist. So the transport returns the status rather
 * than raising on it, and the caller decides which are gaps and which are failures.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type NxCloudAtlasError, NxCloudAtlasErrors } from "./errors.js";
import { isNxCloudCallId, NX_CLOUD_ORIGIN, nxCloudCall, nxCloudPath } from "./inventory.js";

/** What one read returned, before anything decides what it means. */
export interface NxCloudResponse {
  readonly statusCode: number;
  /** The `content-type` header, lowercased, or `null` when the response carried none at all. */
  readonly contentType: string | null;
  readonly body: string;
  /** The URL actually requested, so a record can carry its own reproduction handle. */
  readonly url: string;
}

/** How this atlas talks to the network. Replaced wholesale in a test. */
export type NxCloudTransport = (input: {
  url: string;
  cookieHeader: string;
}) => Promise<Result<NxCloudResponse, NxCloudAtlasError>>;

/**
 * How long one read may take before it is abandoned.
 *
 * The heaviest call this atlas makes is a run-history page — one DEFERRED page, bounded by the platform's
 * page length rather than by the workspace's history; a minute is generous headroom for a cold server
 * rather than a tuned value.
 *
 * @internal
 */
export const NX_CLOUD_REQUEST_TIMEOUT_MS = 60_000;

/**
 * The shipped transport: one GET, carrying the owner's own session cookie.
 *
 * `redirect: "manual"` because a redirect to the sign-in page is a SIGNED-OUT session and following it
 * would return a 200 page of HTML that decodes as an empty record — the exact failure that looks like
 * success.
 *
 * @returns a transport that performs one read per call
 */
export function createFetchTransport(): NxCloudTransport {
  return async ({ url, cookieHeader }): Promise<Result<NxCloudResponse, NxCloudAtlasError>> => {
    try {
      const response = await fetch(url, {
        headers: { accept: "*/*", cookie: cookieHeader },
        redirect: "manual",
        signal: AbortSignal.timeout(NX_CLOUD_REQUEST_TIMEOUT_MS),
      });
      return ok({
        body: await response.text(),
        contentType: contentTypeOf({ header: response.headers.get("content-type") }),
        statusCode: response.status,
        url,
      });
    } catch (cause: unknown) {
      return err(
        NxCloudAtlasErrors.callFailed({
          call: url,
          detail: cause instanceof Error ? cause.message : String(cause),
          statusCode: null,
        }),
      );
    }
  };
}

/**
 * One response's content type, lowercased — or `null`, which is a different fact from an empty string.
 *
 * A response with no `content-type` at all is not a response whose type is "": the first is a server that
 * said nothing and the second cannot happen. Keeping them apart is what lets `sync.ts` report "neither JSON
 * nor a single-fetch payload" without inventing a type nobody sent.
 *
 * @param header the raw header value, or `null` when the response carried none
 * @returns the lowercased type, or `null`
 *
 * @internal
 */
export function contentTypeOf({ header }: { header: string | null }): string | null {
  return header === null ? null : header.toLowerCase();
}

/**
 * The absolute URL one inventory call resolves to.
 *
 * @param callId the call being made
 * @param orgId the organisation scope
 * @param workspaceId the workspace scope
 * @param origin the origin to address; omitted takes Nx Cloud's own
 * @returns the URL, or the reason this build has no such call
 */
export function nxCloudCallUrl({
  callId,
  orgId,
  workspaceId,
  origin = NX_CLOUD_ORIGIN,
}: {
  callId: string;
  orgId: string;
  workspaceId: string;
  origin?: string;
}): Result<string, NxCloudAtlasError> {
  if (!isNxCloudCallId(callId)) {
    return err(
      NxCloudAtlasErrors.payloadUnreadable({ call: callId, detail: "this build declares no call by that id" }),
    );
  }
  const call = nxCloudCall({ id: callId });
  const path = nxCloudPath({ orgId, template: call.pathTemplate, workspaceId });
  const query = new URLSearchParams(call.query).toString();
  return ok(query === "" ? `${origin}${path}` : `${origin}${path}?${query}`);
}

/**
 * Perform one inventory call.
 *
 * @param callId the call being made
 * @param orgId the organisation scope
 * @param workspaceId the workspace scope
 * @param cookieHeader the owner's own session header
 * @param transport how to reach the network
 * @param origin the origin to address; omitted takes Nx Cloud's own
 * @returns what came back, or why nothing did
 */
export async function performNxCloudCall({
  callId,
  orgId,
  workspaceId,
  cookieHeader,
  transport,
  origin,
}: {
  callId: string;
  orgId: string;
  workspaceId: string;
  cookieHeader: string;
  transport: NxCloudTransport;
  origin?: string;
}): Promise<Result<NxCloudResponse, NxCloudAtlasError>> {
  const url = nxCloudCallUrl({ callId, orgId, ...(origin === undefined ? {} : { origin }), workspaceId });
  if (url.isErr()) {
    return err(url.error);
  }
  return transport({ cookieHeader, url: url.value });
}
