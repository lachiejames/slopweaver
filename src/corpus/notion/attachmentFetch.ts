/**
 * The one transport that reads an attachment's BYTES, and the ceiling that decides whether it may.
 *
 * This is the first place in the corpus that stores a provider's file bytes at all. Both connectors that met
 * attachments before this kept them ref-only and said so in their own headers — `notion/project.ts`'s "File
 * and image mentions are kept as reference text only, never bytes", and the same choice in `linear/curated.ts`.
 * That convention is being changed HERE, deliberately and for Notion only, on the owner's ruling: for
 * 99.999% of pages the owner wants the full page including the attachments on it, with a limit — a page
 * holding a file the size of a terabyte is not downloaded, because there is no terabyte of space to give.
 *
 * ## Three properties this seam holds, each because of something measured
 *
 * **The url comes from the live read, never from disk.** `curated.ts#stableFileUrl` keeps only an
 * author-provided url and never Notion's own signed one, because that one expires. So bronze holds no
 * fetchable pointer to an attachment, and a caller that tried to plan fetches from stored references would
 * be planning against names. {@link classifyAttachment} is what a live `src` goes through first.
 *
 * **An author's link to another site is not fetched.** The measured corpus holds far more third-party urls
 * (a video host, a course platform, a social site) than Notion-hosted ones, because those are exactly the
 * ones the stable-url rule keeps. Downloading them would be egress to strangers rather than the attachments
 * the owner asked for, so `external` never reaches this module.
 *
 * **The ceiling is enforced on the size a ONE-KILOBYTE probe reports, before the file is read.** A fetch that
 * must read a file to discover it is too big has already paid for it. A probe that reports no total is
 * therefore its own outcome rather than an optimistic attempt — see {@link ceilingVerdict}.
 *
 * That probe is a ranged GET rather than a HEAD, and that is measured rather than stylistic: **HEAD on one of
 * these signed urls returns 403.** The signature covers GET, so a HEAD falls outside it and object storage
 * refuses. The same url answers `Range: bytes=0-1023` with a 206 and the full size in `Content-Range`. An
 * earlier draft of this module used HEAD and would have found every attachment in the workspace unfetchable.
 */
import { safeProviderCall } from "../../lib/providerCall.js";
import {
  type AttachmentOutcome,
  type AttachmentRefusal,
  ceilingVerdict,
  totalFromContentRange,
} from "./attachments.js";

/** How many bytes the sizing probe asks for. One kilobyte costs nothing and always yields a `Content-Range`. */
const PROBE_BYTES = 1024;

/*
 * A header the object store did not send is carried forward as ABSENT rather than substituted, and the two
 * house rules that govern that shape disagree about every operator spelling it: `no-silent-fallback` bans
 * the `??`, and oxlint's `prefer-nullish-coalescing` rewrites `h === null ? undefined : h` straight back
 * into one, since the two branches read the same binding. A named function whose body is an `if` is what
 * both accept — the same resolution `src/lib/absent.ts` reached for its own reads.
 */

/** The `Content-Type` the transport reported, with a header it did not send named absent rather than guessed. */
function reportedContentType({ header }: { header: string | null }): string | undefined {
  if (header === null) {
    return undefined;
  }
  return header;
}

/**
 * The transport, injected.
 *
 * A plain function rather than a client, so the unit tests supply one and never reach for a mock, and so the
 * signed-url host — which is object storage rather than the Notion API — is never given an SDK that would
 * pace it against the wrong limit.
 */
export type AttachmentTransport = (args: { url: string; rangeBytes: number | undefined }) => Promise<{
  ok: boolean;
  status: number;
  contentRange: string | null;
  contentType: string | null;
  /** Present only on a full read; the sizing probe never asks for one. */
  body?: Buffer;
}>;

/**
 * Ask how big an attachment is, without fetching it.
 *
 * Used both by the crawl, to apply the ceiling before spending anything, and by the size survey that SET the
 * ceiling — the number is not allowed to be a guess, so it comes from this same call over real files.
 *
 * @param url a signed url taken from the block read currently in hand, before its `expiry_time`
 * @param ceilingBytes the per-file ceiling this run operates under
 * @param transport the injected HTTP seam
 * @param scopeId the provider-door scope this call is accounted to
 * @returns `undefined` when the file is within the ceiling and may be fetched, else the outcome to record
 */
export async function measureAttachment({
  url,
  ceilingBytes,
  transport,
  scopeId,
}: {
  url: string;
  ceilingBytes: number;
  transport: AttachmentTransport;
  scopeId: string;
}): Promise<AttachmentRefusal | undefined> {
  const called = await safeProviderCall({
    execute: () => transport({ rangeBytes: PROBE_BYTES, url }),
    operation: "notion.files.probe",
    provider: "notion",
    retryMode: "transient",
    scopeId,
  });
  if (called.isErr()) {
    return { kind: "failed", reason: called.error.message };
  }
  if (!called.value.ok) {
    return { kind: "failed", reason: `ranged probe returned ${String(called.value.status)}` };
  }
  return ceilingVerdict({ ceilingBytes, declaredBytes: totalFromContentRange({ header: called.value.contentRange }) });
}

/**
 * Fetch an attachment's bytes and put them in the store, once the ceiling has cleared it.
 *
 * Content-addressed by SHA-256, so the same file attached to five pages is stored once and each page's record
 * points at the one copy. The digest is also what a record carries instead of the url: a signed url expires
 * within the hour and would be a dead pointer by the time anyone read it.
 *
 * The ceiling is re-checked against what actually arrived, not only against what the probe promised. A server
 * that under-reports its own `Content-Range` would otherwise walk straight past the bound, and the whole
 * point of the bound is that this machine cannot be asked to hold what it has no room for.
 *
 * @param url the signed url, still inside its expiry
 * @param ceilingBytes the per-file ceiling this run operates under
 * @param transport the injected HTTP seam
 * @param scopeId the provider-door scope this call is accounted to
 * @param store where the bytes go, injected so this module owns no filesystem policy
 * @returns what happened, including the digest when bytes landed
 */
export async function fetchAttachment({
  url,
  ceilingBytes,
  transport,
  scopeId,
  store,
}: {
  url: string;
  ceilingBytes: number;
  transport: AttachmentTransport;
  scopeId: string;
  store: (args: { bytes: Buffer; contentType: string | undefined }) => { digest: string };
}): Promise<AttachmentOutcome & { digest?: string }> {
  const downloaded = await downloadAttachment({ ceilingBytes, scopeId, transport, url });
  if (downloaded.kind !== "fetched") {
    return downloaded;
  }
  const { body, ...outcome } = downloaded;
  const stored = store({ bytes: body, contentType: downloaded.contentType });
  return { ...outcome, digest: stored.digest };
}

/**
 * What a download attempt concluded, carrying the bytes when any moved.
 *
 * {@link AttachmentOutcome} with the body added to its one success arm, rather than a parallel union, so a
 * new refusal kind reaches both callers by construction.
 */
export type DownloadedAttachment =
  | (Extract<AttachmentOutcome, { kind: "fetched" }> & { readonly body: Buffer })
  | Exclude<AttachmentOutcome, { kind: "fetched" }>;

/**
 * Measure an attachment, fetch it when the ceiling clears it, and hand back the bytes.
 *
 * The half of {@link fetchAttachment} that has nothing to do with a corpus store. `slopweaver notion read
 * --pdf` needs every step here and none of the storing, and a second copy of this in the live lane would be
 * a second copy of the three measurements in this module's header — including that HEAD returns 403 on
 * these urls, which is exactly the kind of fact a fresh implementation rediscovers the hard way.
 *
 * @param url the signed url, still inside its expiry
 * @param ceilingBytes the per-file ceiling this caller operates under
 * @param transport the injected HTTP seam
 * @param scopeId the provider-door scope this call is accounted to
 * @returns the bytes and what arrived with them, or why nothing did
 */
export async function downloadAttachment({
  url,
  ceilingBytes,
  transport,
  scopeId,
}: {
  url: string;
  ceilingBytes: number;
  transport: AttachmentTransport;
  scopeId: string;
}): Promise<DownloadedAttachment> {
  const refused = await measureAttachment({ ceilingBytes, scopeId, transport, url });
  if (refused !== undefined) {
    return refused;
  }
  const called = await safeProviderCall({
    execute: () => transport({ rangeBytes: undefined, url }),
    operation: "notion.files.download",
    provider: "notion",
    retryMode: "transient",
    scopeId,
  });
  if (called.isErr()) {
    return { kind: "failed", reason: called.error.message };
  }
  const body = called.value.body;
  if (!called.value.ok || body === undefined) {
    return { kind: "failed", reason: `download returned ${String(called.value.status)}` };
  }
  if (body.byteLength > ceilingBytes) {
    return { bytes: body.byteLength, kind: "too-large" };
  }
  return {
    body,
    bytes: body.byteLength,
    contentType: reportedContentType({ header: called.value.contentType }),
    kind: "fetched",
  };
}
