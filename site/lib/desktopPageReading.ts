/**
 * The page's reading as it crosses from the console window to the voice's window in the desktop shell: what the
 * console window's own `read_page` would answer, fitted there, serialised so the shell keeps it opaque, and parsed back
 * on the voice's side. Without it the voice's window answers `read_page` on `/queue`
 * with "registers no reading of its own" while the console window's Queue registers one. Pure.
 */
import type { DesktopPageIdentity } from "./desktopShell";
import { isRecord } from "./desktopShellWire";
import { type CarriedReadingState, openByOf, openKeyOf, type PageView, pageRead } from "./pageVoice";

/** A page's reading as the console window fitted it for `read_page` (`./pageVoice.ts` `pageRead`). */
export interface CarriedPageReading {
  readonly shows: unknown;
  /** Present when `shows` was cut to fit the read's bound. */
  readonly truncated: string | undefined;
}

/**
 * A page identity as the console window hands it to the shell: the reading serialised, so the shell keeps it opaque
 * (`desktop/src/desktopBridge.ts` `parsePageIdentity`).
 */
export interface DesktopPageIdentityWire {
  readonly path: string;
  readonly title: string;
  readonly open?: string;
  readonly openTitle?: string;
  readonly reading?: string | null;
}

/** The longest page reading the shell carries, in UTF-16 code units (`desktop/src/desktopBridge.ts`, the same bound). */
export const PAGE_READING_WIRE_MAX_CHARS = 24 * 1024;

/**
 * The longest open-card title sent to the shell: under the shell's own 512-character bound on a field
 * (`desktop/src/desktopBridge.ts` `MAX_TEXT`), so a long title cannot lose the whole page identity.
 */
export const OPEN_TITLE_WIRE_MAX_CHARS = 300;

/**
 * An open card's title as one bounded line, the shape the shell accepts.
 *
 * @param title the title as the page drew it
 * @returns one line of at most {@link OPEN_TITLE_WIRE_MAX_CHARS} characters, or `undefined` for a blank title
 */
export function openTitleForWire({ title }: { title: string }): string | undefined {
  const line = title.replaceAll(/\s+/gu, " ").trim().slice(0, OPEN_TITLE_WIRE_MAX_CHARS).trimEnd();
  return line === "" ? undefined : line;
}

/**
 * A carried reading off the wire.
 *
 * @param raw the identity's `reading` field as the shell sent it
 * @returns `null` for the page's word that it registers none, the reading for the JSON of exactly
 *   `{ shows, truncated? }`, and `undefined` for anything else — which reads as a reading that did not cross
 */
export function carriedReadingOf({ raw }: { raw: unknown }): CarriedPageReading | null | undefined {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== "string" || raw.length > PAGE_READING_WIRE_MAX_CHARS) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !("shows" in parsed)) {
    return undefined;
  }
  const keys = Object.keys(parsed);
  const truncated = parsed["truncated"];
  if (!keys.every((key) => key === "shows" || key === "truncated")) {
    return undefined;
  }
  if (truncated !== undefined && typeof truncated !== "string") {
    return undefined;
  }
  return { shows: parsed["shows"], truncated };
}

/**
 * The page identity the console window hands the shell: the open card's key and the page's reading each ride along
 * only when the shell says it takes one, because a shell built before it drops an identity with a key it does not
 * know and the voice would keep the page that was left (`desktop/src/desktopBridge.ts` `parsePageIdentity`). The reading
 * crosses serialised, so the shell keeps it opaque.
 *
 * @param identity the page, its card when one is open, and its reading
 * @param carriesOpenCard the shell's `DesktopBridge.carriesOpenCard`
 * @param carriesPageReading the shell's `DesktopBridge.carriesPageReading`
 * @param carriesOpenTitle the shell's `DesktopBridge.carriesOpenTitle`
 * @returns what to publish
 */
export function identityForShell({
  identity,
  carriesOpenCard,
  carriesPageReading,
  carriesOpenTitle,
}: {
  identity: DesktopPageIdentity;
  carriesOpenCard: boolean | undefined;
  carriesPageReading: boolean | undefined;
  carriesOpenTitle: boolean | undefined;
}): DesktopPageIdentityWire {
  let wire: DesktopPageIdentityWire = { path: identity.path, title: identity.title };
  if (carriesOpenCard === true && identity.open !== undefined) {
    wire = { ...wire, open: identity.open };
    if (carriesOpenTitle === true && identity.openTitle !== undefined) {
      wire = { ...wire, openTitle: identity.openTitle };
    }
  }
  if (carriesPageReading === true && identity.reading !== undefined) {
    wire = { ...wire, reading: identity.reading === null ? null : JSON.stringify(identity.reading) };
  }
  return wire;
}

/**
 * What the console window carries of its page's reading: exactly what its own `read_page` would hand back — `shows`
 * and any cut, fitted to the same bound — or `null` when the page registers none.
 *
 * @param view the page as this window sees it
 * @param maxBytes the `read_page` bound (`./pageVoice.ts` `PAGE_READ_MAX_BYTES`)
 * @returns the reading to carry
 */
export function pageReadingForShell({
  view,
  maxBytes,
}: {
  view: PageView;
  maxBytes: number;
}): CarriedPageReading | null {
  if (view.shows === undefined) {
    return null;
  }
  const read = pageRead({ maxBytes, view });
  // Only the first window crosses: the voice's window has no read on past it (`./pageReadWindow.ts`), so its cut
  // says how much it carried and that the rest stays behind, rather than naming a read on it cannot make.
  if (!("size" in read)) {
    return { shows: read.shows, truncated: read.truncated };
  }
  // A window's `shows` is text, so the whole reading's own cuts (`shows.drawnMore`) cross in its cut sentence, never
  // inside a fragment no probe reads.
  let marks = "";
  if (read.readingCuts !== undefined) {
    marks = `; the whole reading marks ${read.readingCuts.join("; ")}`;
  }
  if (read.nextFrom === undefined) {
    if (marks === "") {
      return { shows: read.shows, truncated: read.truncated };
    }
    let said = "this read carries the page's whole reading as text";
    if (read.truncated !== undefined) {
      said = read.truncated;
    }
    return { shows: read.shows, truncated: `${said}${marks}` };
  }
  const truncated = `this read carries the first ${String(read.nextFrom)} of the page's ${String(read.size)}-byte reading; the rest does not cross to the voice's window${marks}`;
  return { shows: read.shows, truncated };
}

/**
 * The page as the voice sees it in the shell's voice window: the console window's, carried across — its path, title,
 * open card and the reading its body registered, fitted there. Its open card is the one the owner's speech and every relay
 * carry (`docs/console/card-landing.md`). Whether the voice opened that card rides in the carried path's query
 * (`by=voice`), so no further identity field is needed.
 *
 * @param identity the console window's page identity
 * @returns the view
 */
export function carriedPageView({ identity }: { identity: DesktopPageIdentity }): PageView {
  const openBy = openByOf({ open: openKeyOf({ open: identity.open }), path: identity.path });
  let carried: CarriedReadingState = { kind: "unreached" };
  if (identity.reading === null) {
    carried = { kind: "none" };
  } else if (identity.reading !== undefined) {
    carried = { kind: "carried", shows: identity.reading.shows, truncated: identity.reading.truncated };
  }
  const card = { open: identity.open, openBy, openTitle: identity.openTitle };
  return { ...card, carried, path: identity.path, shows: undefined, title: identity.title };
}
