/**
 * The viewer's half of "is there a newer version of this page": the page-version route's answer read strictly, and
 * whether the version it names is one the owner is not looking at. Pure, and free of server modules and of Zod,
 * because the viewer's client component imports it (`../components/console/NewerVersion.tsx`).
 */
import { isBag, str } from "./bag";

/** A version digest, as `./pageVersion.ts` computes it. */
const VERSION = /^[0-9a-f]{64}$/u;

/** What the route answered: the page's current version, or nothing this page can rely on. */
export type PageVersionReply = { readonly kind: "version"; readonly version: string } | { readonly kind: "none" };

/**
 * The route's JSON body, read strictly: only exactly `{ kind: "version", version: <digest> }` is a version; a page
 * that is gone, a store that could not say, an extra member and anything malformed all read as none, so the viewer
 * never claims a newer one.
 *
 * @param value the parsed body
 * @returns the version, or none
 */
export function pageVersionReplyOf({ value }: { value: unknown }): PageVersionReply {
  if (!isBag(value) || Object.keys(value).length !== 2) {
    return { kind: "none" };
  }
  const version = str({ bag: value, key: "version" });
  if (str({ bag: value, key: "kind" }) !== "version" || version === undefined || !VERSION.test(version)) {
    return { kind: "none" };
  }
  return { kind: "version", version };
}

/** The attribute marking the viewer's own frame, the one window whose version report the viewer takes. */
export const VIEWER_FRAME = "data-sw-viewer-frame";

/** The `kind` a served document's version report carries (`./pageVersionReport.ts`). */
export const PAGE_VERSION_REPORT = "sw-page-version";

/** The `kind` the viewer posts to its frame to have the document report again. */
export const PAGE_VERSION_ASK = "sw-page-version-ask";

/**
 * A message from the viewer's frame, read strictly: only exactly `{ kind, slug, version }` naming this page is the
 * version the frame shows; a report for another page the frame went on to, and anything malformed, is none.
 *
 * @param value the message's data
 * @param slug the page the viewer is showing
 * @returns the version the frame shows, or none
 */
export function frameVersionReportOf({ value, slug }: { value: unknown; slug: string }): PageVersionReply {
  if (!isBag(value) || Object.keys(value).length !== 3) {
    return { kind: "none" };
  }
  const version = str({ bag: value, key: "version" });
  const named = str({ bag: value, key: "kind" }) === PAGE_VERSION_REPORT && str({ bag: value, key: "slug" }) === slug;
  if (!named || version === undefined || !VERSION.test(version)) {
    return { kind: "none" };
  }
  return { kind: "version", version };
}

/**
 * A message the viewer received, taken as its frame's version only when it came from the frame's own window AND is
 * exactly a report for this page. Any other window, a page's nested frame, a frame with no window yet (whose `null`
 * must never match a message whose source is `null` too) and every malformed body are none.
 *
 * @param source the message's `source`
 * @param frameWindow the viewer frame's `contentWindow`, `null` before it has one
 * @param value the message's data
 * @param slug the page the viewer is showing
 * @returns the version the frame shows, or none
 */
export function frameReportFrom({
  source,
  frameWindow,
  value,
  slug,
}: {
  source: unknown;
  frameWindow: unknown;
  value: unknown;
  slug: string;
}): PageVersionReply {
  if (frameWindow == null || source !== frameWindow) {
    return { kind: "none" };
  }
  return frameVersionReportOf({ slug, value });
}

/**
 * Whether a newer version is waiting: the store names a version, the viewer knows which one it loaded, and they
 * differ. A viewer that never learned its own version claims nothing, since "different" would then mean nothing.
 *
 * @param shown the version the viewer loaded, `undefined` when the store could not say at load
 * @param latest the route's latest answer
 * @returns true to offer the newer version
 */
export function newerVersionWaiting({
  shown,
  latest,
}: {
  shown: string | undefined;
  latest: PageVersionReply;
}): boolean {
  return shown !== undefined && latest.kind === "version" && latest.version !== shown;
}
