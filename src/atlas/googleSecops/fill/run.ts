/**
 * Running the plan — every list in `plan.ts`, page by page, through one injected GET.
 *
 * The GET is a seam rather than an import so the whole walk is testable without a network: production passes
 * `secopsGet` bound to the resolved grant, a test passes a plain function answering canned bodies. Either
 * way every URL is built by `buildSecopsUrl`, so a read can only ever land on the instance's own host.
 *
 * One list failing never sinks the others. A 403 on one is the consenting account's IAM role speaking, and
 * the five lists it does allow are still worth publishing beside a cell that names the refusal.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { GoogleSecopsReadError } from "../../../live/googleSecops/errors.js";
import type { SecopsInstance } from "../../../live/googleSecops/instance.js";
import { buildSecopsUrl } from "../../../live/googleSecops/transport.js";
import type { GoogleSecopsAtlasKind } from "../model.js";
import { GOOGLE_SECOPS_FILL_CALLS, type SecopsFillCall, type SecopsFillFamily } from "./plan.js";
import type { SecopsProjectedItem, SecopsProjectedPage } from "./project.js";

/**
 * How many pages one list may follow before it reports itself truncated.
 *
 * Ten, as the Google Admin fill does, rather than a number derived from anything: no SecOps instance has
 * been measured yet. A run that hits it says so in the coverage cell rather than reporting a complete read.
 */
export const SECOPS_MAX_FILL_PAGES = 10;

/** Items asked for per page — the largest every one of the six lists accepts (featured dashboards cap at 100). */
const PAGE_SIZE = "100";

/** The one network call a run makes, injected. */
export type SecopsGet = (input: { url: URL }) => Promise<Result<unknown, GoogleSecopsReadError>>;

/** Which list an outcome belongs to. */
interface SecopsCallIdentity {
  readonly id: string;
  readonly rpc: string;
  readonly kind: GoogleSecopsAtlasKind;
  readonly family: SecopsFillFamily;
}

/** A list that answered. */
export interface SecopsCallAnswered extends SecopsCallIdentity {
  readonly items: readonly SecopsProjectedItem[];
  /** Whether the read stopped at {@link SECOPS_MAX_FILL_PAGES} rather than at the end of the list. */
  readonly truncated: boolean;
}

/** A list that did not. `status` is Google's HTTP status, or `null` when the failure was never an answer. */
export interface SecopsCallFailed extends SecopsCallIdentity {
  readonly status: number | null;
  readonly message: string;
}

/** Everything one run brought back — what `sync.ts` publishes from. */
export interface GoogleSecopsFillObservation {
  readonly filledAtIso: string;
  readonly answered: readonly SecopsCallAnswered[];
  readonly failed: readonly SecopsCallFailed[];
}

/** Why one list stopped. */
interface SecopsReadStop {
  readonly status: number | null;
  readonly message: string;
}

/**
 * Read and project one page of one list.
 *
 * @param call the planned list
 * @param instance the configured instance every URL is built under
 * @param get the injected GET
 * @param pageToken where this page starts, or `null` for the first
 * @returns the projected page, or why it stopped
 */
async function readPage({
  call,
  instance,
  get,
  pageToken,
}: {
  call: SecopsFillCall;
  instance: SecopsInstance;
  get: SecopsGet;
  pageToken: string | null;
}): Promise<Result<SecopsProjectedPage, SecopsReadStop>> {
  const query: Record<string, string> = { pageSize: PAGE_SIZE };
  if (pageToken !== null) {
    query["pageToken"] = pageToken;
  }
  const url = buildSecopsUrl({ apiVersion: "v1", instance, query, relativePath: call.relativePath });
  if (url.isErr()) {
    return err({ message: url.error.message, status: null });
  }
  const body = await get({ url: url.value });
  if (body.isErr()) {
    return err({
      message: body.error.message,
      status: body.error.code === "TRANSPORT_FAILED" ? body.error.status : null,
    });
  }
  return call.page({ body: body.value }).mapErr((error) => ({ message: error.message, status: null }));
}

/**
 * Follow one list to its last page or to the page bound, whichever comes first.
 *
 * @param call the planned list
 * @param instance the configured instance every URL is built under
 * @param get the injected GET
 * @returns every projected item and whether the bound cut it short, or why it stopped
 */
async function readCall({
  call,
  instance,
  get,
}: {
  call: SecopsFillCall;
  instance: SecopsInstance;
  get: SecopsGet;
}): Promise<Result<{ items: readonly SecopsProjectedItem[]; truncated: boolean }, SecopsReadStop>> {
  const items: SecopsProjectedItem[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < SECOPS_MAX_FILL_PAGES; page += 1) {
    const projected = await readPage({ call, get, instance, pageToken });
    if (projected.isErr()) {
      return err(projected.error);
    }
    items.push(...projected.value.items);
    pageToken = projected.value.nextPageToken;
    if (pageToken === null) {
      return ok({ items, truncated: false });
    }
  }
  return ok({ items, truncated: true });
}

/**
 * Call every planned list and report what each one did.
 *
 * @param instance the configured instance
 * @param get the injected GET — `secopsGet` bound to the grant in production
 * @param at this run's ISO timestamp
 * @returns the observation, one outcome per planned list
 */
export async function runGoogleSecopsFill({
  instance,
  get,
  at,
}: {
  instance: SecopsInstance;
  get: SecopsGet;
  at: string;
}): Promise<GoogleSecopsFillObservation> {
  const answered: SecopsCallAnswered[] = [];
  const failed: SecopsCallFailed[] = [];
  for (const call of GOOGLE_SECOPS_FILL_CALLS) {
    const identity = { family: call.family, id: call.id, kind: call.kind, rpc: call.rpc };
    const read = await readCall({ call, get, instance });
    if (read.isErr()) {
      failed.push({ ...identity, message: read.error.message, status: read.error.status });
      continue;
    }
    answered.push({ ...identity, items: read.value.items, truncated: read.value.truncated });
  }
  return { answered, failed, filledAtIso: at };
}
