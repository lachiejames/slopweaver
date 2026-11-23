/**
 * `slopweaver notion page` — the perform step of each body lane: create writes the page, update replaces its
 * content, archive moves it to the trash. Each runs INSIDE the door, handed to `routeThroughDoor` by
 * `./pageRun.ts`, so nothing here is reached before admission; the move lane's own perform step lives in
 * `./moveRun.ts`.
 */
import type { NotionApiError } from "../../../corpus/notion/writeErrors.js";
import { withMediaMarkers } from "../../../outbound/notion/mediaPlaceholder.js";
import {
  confirmPage,
  confirmPageUpdate,
  type PageImageRecord,
  reserveIntent,
} from "../../../outbound/notion/pageLedger.js";
import { releaseIntentReservation } from "../../../outbound/notion/reservationRelease.js";
import { refusedBeforeNotionWire } from "../../../outbound/notion/sendFailure.js";
import { type AttachReport, attachMedia, attachReportLines } from "./mediaAttach.js";
import type { NotionPageOutcome } from "./pageCore.js";
import { canonicalOf, type WriteContext } from "./writeContext.js";

/**
 * The bytes actually sent to Notion: every `file:` placeholder replaced by its marker paragraph, in place.
 *
 * The substitution happens HERE rather than at parse time so the intent digest, the dry-run preview and the
 * lint all still see the document the operator wrote. What Notion receives is a mechanical rewrite of it.
 */
function publishedBody({ ctx }: { ctx: WriteContext }): string {
  return withMediaMarkers({ markdown: ctx.body }).markdown;
}

/** Run the image pass over a just-written page and report it, whatever it did. */
async function attachAndReport({ ctx, pageId }: { ctx: WriteContext; pageId: string }): Promise<AttachReport> {
  const attached = await attachMedia({
    api: ctx.mediaApi,
    baseDir: ctx.mediaBase,
    markdown: ctx.body,
    pageId,
    readMedia: ctx.deps.readMedia,
  });
  for (const line of attachReportLines({ report: attached })) {
    (attached.failures.length > 0 ? ctx.deps.err : ctx.deps.out)(line);
  }
  return attached;
}

/**
 * What a failed mutation came to: `failed` when the write transport refused it before the wire, so nothing was
 * sent, and `indeterminate` for everything else — a timeout or a lost response may well have landed.
 *
 * @param error the failure the seam returned
 * @returns the outcome naming the failure
 */
export function mutationFailure({ error }: { error: NotionApiError }): NotionPageOutcome {
  return refusedBeforeNotionWire({ error })
    ? { kind: "failed", reason: error.message }
    : { kind: "indeterminate", reason: error.message };
}

/** The ledger shape of what one attach pass placed. */
function imageRecords({ pass }: { pass: AttachReport }): readonly PageImageRecord[] {
  return pass.attached.map((image) => ({
    blockId: image.blockId,
    fileUploadId: image.fileUploadId,
    placeholderId: image.placeholderId,
    source: image.source,
  }));
}

/**
 * Create the page from markdown, then read it back before claiming anything.
 *
 * @returns the create outcome: duplicate, indeterminate, unconfirmed, partial or created
 */
export async function performCreate({ ctx }: { ctx: WriteContext }): Promise<NotionPageOutcome> {
  const claim = reserveIntent({ home: ctx.home, intent: ctx.intent, nowIso: ctx.deps.nowIso() });
  if (claim.kind === "taken") {
    return { kind: "duplicate", reservedIso: claim.record.reservedIso, url: claim.record.url };
  }
  const created = await ctx.api.createPage({
    icon: ctx.args.icon,
    markdown: publishedBody({ ctx }),
    parentPageId: ctx.destination,
    // `title!` is honest rather than defensive: `parseNotionPageArgs` REFUSES a create without a title, so
    // a fallback here would publish an untitled page on a parser regression instead of failing loudly.
    title: ctx.args.title!,
  });
  if (created.isErr()) {
    // Notion assigns the page id, so there is no address to ask about. Unless the transport refused it before the
    // wire the outcome genuinely is unknown, and saying "failed" would invite a retry that publishes a second page.
    // A refused create sent nothing, so THIS invocation's reservation is released and the reworded retry is fresh.
    if (refusedBeforeNotionWire({ error: created.error })) {
      releaseIntentReservation({ home: ctx.home, intent: ctx.intent, reservedIso: claim.reservedIso });
    }
    return mutationFailure({ error: created.error });
  }
  const page = created.value;
  // The image pass runs BEFORE the read-back, so the digest describes the finished page. Taking it first
  // would record a hash of the marker version and make the very next update refuse as "changed since".
  const attached = await attachAndReport({ ctx, pageId: page.id });
  const canonical = await canonicalOf({ ctx: { ...ctx, destination: page.id } });
  if ("reason" in canonical) {
    return { kind: "unconfirmed", pageId: page.id, reason: canonical.reason, url: page.url };
  }
  confirmPage({
    canonical: canonical.hash,
    home: ctx.home,
    images: imageRecords({ pass: attached }),
    intent: ctx.intent,
    nowIso: ctx.deps.nowIso(),
    pageId: page.id,
    url: page.url,
  });
  return attached.failures.length > 0
    ? { kind: "partial", pageId: page.id, reasons: attached.failures, url: page.url }
    : { kind: "created", pageId: page.id, url: page.url };
}

/**
 * Replace the page's whole content in place, keeping its id and URL.
 *
 * @returns the update outcome: indeterminate, unconfirmed, partial, unchanged or updated
 */
export async function performUpdate({
  ctx,
  priorCanonical,
}: {
  ctx: WriteContext;
  priorCanonical: string | undefined;
}): Promise<NotionPageOutcome> {
  const replaced = await ctx.api.replaceMarkdown({ markdown: publishedBody({ ctx }), pageId: ctx.destination });
  if (replaced.isErr()) {
    return mutationFailure({ error: replaced.error });
  }
  if (ctx.args.title !== undefined || ctx.args.icon !== undefined) {
    const header = await ctx.api.updatePageHeader({
      icon: ctx.args.icon,
      pageId: ctx.destination,
      title: ctx.args.title,
    });
    if (header.isErr()) {
      return {
        kind: "unconfirmed",
        pageId: ctx.destination,
        reason: `the body was written but the title/icon update failed: ${header.error.message}`,
        url: "",
      };
    }
  }
  // An update REPLACED every block, so every image the page had is gone and every placeholder is a marker
  // again. The pass therefore re-uploads from the local files — see `PageImageRecord` for why re-referencing
  // the previous upload was rejected.
  const attached = await attachAndReport({ ctx, pageId: ctx.destination });
  const page = await ctx.api.retrievePage({ pageId: ctx.destination });
  const canonical = await canonicalOf({ ctx });
  if (page.isErr() || page.value === undefined || "reason" in canonical) {
    return {
      kind: "unconfirmed",
      pageId: ctx.destination,
      reason: "reason" in canonical ? canonical.reason : "the page could not be read back after the update",
      url: page.isOk() ? page.value?.url : undefined,
    };
  }
  confirmPageUpdate({
    canonical: canonical.hash,
    home: ctx.home,
    images: imageRecords({ pass: attached }),
    nowIso: ctx.deps.nowIso(),
    pageId: ctx.destination,
  });
  if (attached.failures.length > 0) {
    return { kind: "partial", pageId: ctx.destination, reasons: attached.failures, url: page.value.url };
  }
  return canonical.hash === priorCanonical
    ? { kind: "unchanged", pageId: ctx.destination, url: page.value.url }
    : { kind: "updated", pageId: ctx.destination, url: page.value.url };
}

/**
 * Move the page to Notion's trash, reading it back first so the report can name what went.
 *
 * @returns the archive outcome: archived, or failed with the reason
 */
export async function performArchive({ ctx }: { ctx: WriteContext }): Promise<NotionPageOutcome> {
  const page = await ctx.api.retrievePage({ pageId: ctx.destination });
  if (page.isErr() || page.value === undefined) {
    return { kind: "failed", reason: `page ${ctx.destination} could not be read, so it was not archived` };
  }
  const archived = await ctx.api.archivePage({ pageId: ctx.destination });
  if (archived.isErr()) {
    return { kind: "failed", reason: archived.error.message };
  }
  return { kind: "archived", pageId: ctx.destination, url: page.value.url };
}
