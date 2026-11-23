/**
 * Driving ONE planned Admin API call through the bound grant, paged and bounded.
 *
 * `plan.ts` decided what may be called and `records.ts` decides what a response means. What is here is the
 * narrow effectful middle — build the URL, ask, follow the page token, stop.
 *
 * ## Why there is one seam and not forty
 *
 * The forty planned methods differ in base URL, path and payload field, and in nothing else this file
 * cares about. All are GETs, all page by `pageToken`, and all are authorised the same way. So the seam
 * takes the plan's own row rather than naming a method, which is what keeps a regenerated registry from
 * needing a code change here at all.
 *
 * ## The page bound, and why `truncated` is reported rather than raised
 *
 * A fill that walked an unbounded collection would make one directory read as long as the directory, and
 * an atlas exists to describe a surface rather than to mirror it. So it stops at
 * {@link MAX_FILL_PAGES} and says it stopped. Google's own default page size applies, deliberately
 * unset — the eleven documents spell the size parameter three ways (`maxResults`, `pageSize`, `pageToken`
 * siblings), and choosing one per document would be a hand-kept mapping of exactly the kind
 * `generated/surfaces.ts` exists to avoid.
 */
import type { GoogleAdminFilledRecord } from "../../atlas/googleAdmin/adminApi/observation.js";
import type { GoogleAdminPlannedCall } from "../../atlas/googleAdmin/adminApi/plan.js";
import {
  type GoogleAdminPayloadShape,
  googleAdminNextPageToken,
  googleAdminProjectRecords,
} from "../../atlas/googleAdmin/adminApi/records.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";

/**
 * How many pages one planned call may follow before it reports itself truncated.
 *
 * Ten rather than a number derived from anything: nothing here has measured a real Workspace directory, so
 * a computed-looking bound would be false precision. It is a stop, and the honest part is that a run which
 * hits it says so in the coverage cell rather than reporting a complete read.
 * @internal
 */
export const MAX_FILL_PAGES = 10;

/** What one planned call brought back. */
export interface GoogleAdminReadResult {
  readonly records: readonly GoogleAdminFilledRecord[];
  /** Whether the read stopped at {@link MAX_FILL_PAGES} rather than at the end of the collection. */
  readonly truncated: boolean;
  /** What the payload field held — `records.ts` decides, and two planned methods are aggregates. */
  readonly shape: GoogleAdminPayloadShape;
}

/** Why one planned call did not answer. */
export interface GoogleAdminReadFailure {
  /** Google's own HTTP status, or 0 when the call never reached it. */
  readonly status: number;
  readonly message: string;
}

/**
 * The one call this reader makes on its client: a GET of an absolute URL, answered with a parsed body.
 *
 * The client parameter is typed as this narrow surface rather than as `OAuth2Client`, which satisfies it
 * unchanged, so a test can stand in for the Admin API without minting a grant. The call itself still sits
 * inside the paced provider door.
 * @internal
 */
export type GoogleAdminRequest = (input: { readonly method: "GET"; readonly url: string }) => Promise<{
  readonly data: unknown;
}>;

/** The HTTP status a thrown transport error carried, when it carried one. */
function statusOf({ error }: { error: unknown }): number {
  if (typeof error !== "object" || error === null) {
    return 0;
  }
  const status: unknown = (error as { status?: unknown }).status;
  if (typeof status === "number") {
    return status;
  }
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : 0;
}

/**
 * Follow one planned call to the end of its collection or to the page bound, whichever comes first.
 *
 * @param client the OAuth client from a resolved grant
 * @param call the planned call, already carrying a resolved path
 * @param scopeId the shared rate scope, already hashed from the bound credential
 * @returns every record it read, or the status and message Google refused with
 */
export async function readGoogleAdminCollection({
  client,
  call,
  scopeId,
}: {
  client: { readonly request: GoogleAdminRequest };
  call: GoogleAdminPlannedCall;
  scopeId: string;
}): Promise<Result<GoogleAdminReadResult, GoogleAdminReadFailure>> {
  const collected: GoogleAdminFilledRecord[] = [];
  let pageToken: string | null = null;
  let shape: GoogleAdminPayloadShape = "absent";
  for (let page = 0; page < MAX_FILL_PAGES; page += 1) {
    const url = new URL(call.path, call.baseUrl);
    for (const [name, value] of Object.entries(call.query)) {
      url.searchParams.set(name, value);
    }
    if (pageToken !== null) {
      url.searchParams.set("pageToken", pageToken);
    }
    const answered = await safeProviderCall({
      execute: () => client.request({ method: "GET", url: url.toString() }),
      operation: "google-admin.api.read",
      provider: "google-admin",
      retryMode: "transient",
      scopeId,
    });
    if (answered.isErr()) {
      return err({ message: answered.error.message, status: statusOf({ error: answered.error.cause }) });
    }
    const projected = googleAdminProjectRecords({ body: answered.value.data, collectionField: call.collectionField });
    // The FIRST page decides the shape. A later page cannot disagree without the collection having changed
    // type mid-read, and taking the last page's answer would let an empty final page report `absent` over a
    // collection that had already yielded records.
    if (page === 0) {
      shape = projected.shape;
    }
    collected.push(...projected.records);
    pageToken = googleAdminNextPageToken({ body: answered.value.data });
    if (pageToken === null) {
      return ok({ records: collected, shape, truncated: false });
    }
  }
  return ok({ records: collected, shape, truncated: true });
}
