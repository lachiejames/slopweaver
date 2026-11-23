/**
 * What a card's picture or briefing opens as: a modal over the page the owner is on, never a navigation away from it.
 *
 * A navigation to a separate viewer page reloads the whole Queue on Back, so the preview pops up as a modal on top of
 * the page, as Slack does, for viewing an image or a briefing: the background darkens fifty percent and the modal is
 * eighty percent of the width and height.
 *
 * So a plain click on a picture, an attached HTML briefing or a local page opens `../components/console/PreviewModal.tsx`
 * and the page under it — its scroll, its open card — is never left. A modified click (Command, Control, Shift, Alt, a
 * middle button) keeps the link's own behaviour, a new tab, which is the rule for a citation the owner chooses to keep.
 *
 * Pure: strings and flags in, a decision out. Whether a page may be framed at all is `./inAppView.ts`'s judgement,
 * reused rather than restated.
 */
import { frameSandbox, viewedDocument } from "./inAppView";
import { isPageSlug, LOCAL_PAGE_ROUTE } from "./localPageHref";

/** One picture or page the modal shows: what it frames, the words its header reads as, and how it is drawn. */
export type Preview =
  | { readonly kind: "image"; readonly src: string; readonly title: string }
  | { readonly kind: "page"; readonly src: string; readonly title: string; readonly sandbox: string };

/** The page route an attached HTML document is served from, `/api/draft-media/<sha256>/page`. */
const DRAFT_PAGE = /^\/api\/draft-media\/[0-9a-f]{64}\/page$/u;

/** A file name an HTML document goes by. */
const HTML_NAME = /\.html?$/iu;

/** A local page's own document, the end of its address; every other file under the slug is an asset it loads. */
const PAGE_DOCUMENT = "/index.html";

/** The origin a path is parsed against, so only the pathname is judged. */
const LOCAL = "http://localhost:1";

/**
 * Whether a pathname is a briefing: a local page's own document, `/api/page/<slug>/index.html`, never one of the
 * assets it loads, or an attached HTML document's page route.
 *
 * @returns true for a page the modal frames
 */
function isBriefing({ pathname }: { pathname: string }): boolean {
  if (DRAFT_PAGE.test(pathname)) {
    return true;
  }
  const prefix = `${LOCAL_PAGE_ROUTE}/`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(PAGE_DOCUMENT)) {
    return false;
  }
  // A slug never holds a `/`, so a nested path or an empty slug fails here.
  return isPageSlug({ slug: pathname.slice(prefix.length, -PAGE_DOCUMENT.length) });
}

/**
 * The page preview a link opens, or `undefined` when it is not a briefing the console serves. Anything else — a
 * pull request, a board row, a docs page, another site, a page's own assets — keeps its link.
 *
 * @param href the link's address, as the card draws it
 * @param title the words the modal's header reads as
 * @returns the preview, or `undefined`
 */
export function pagePreviewOf({ href, title }: { href: string; title: string }): Preview | undefined {
  const shown = viewedDocument({ src: href });
  if (shown === undefined) {
    return undefined;
  }
  if (!isBriefing({ pathname: new URL(shown, LOCAL).pathname })) {
    return undefined;
  }
  return { kind: "page", sandbox: frameSandbox({ shown }), src: shown, title };
}

/**
 * The page preview of a parked draft's attachment, or `undefined` when it is not named as an HTML document. The NAME
 * only decides whether it is offered; what the route serves is decided by the bytes (`./draftMediaServe.ts`'s
 * `htmlDocumentOf`), so a misnamed file shows the route's plain 404 inside the modal.
 *
 * @param name the attachment's file name, as the draft records it
 * @param sha256 the stored blob's name
 * @returns the preview, or `undefined`
 */
export function attachmentPagePreview({ name, sha256 }: { name: string; sha256: string }): Preview | undefined {
  if (!HTML_NAME.test(name)) {
    return undefined;
  }
  return pagePreviewOf({ href: `/api/draft-media/${sha256}/page`, title: name });
}

/**
 * Whether a click opens the modal: only a plain primary click. A modified or middle click is the owner's way of asking for a
 * new tab, and keeps the link's own behaviour.
 *
 * @param button the mouse button, 0 the primary
 * @returns true when the modal opens in place of the link
 */
export function opensInPlace({
  button,
  metaKey,
  ctrlKey,
  shiftKey,
  altKey,
}: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return button === 0 && !metaKey && !ctrlKey && !shiftKey && !altKey;
}
