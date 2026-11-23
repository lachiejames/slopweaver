/**
 * Which capture tracks the console holds, kept from what the page's observer reports (`preload.ts`). The site
 * stops a share with `track.stop()` (`site/components/voice/screenGrab.ts`), which fires no `ended` event, so
 * the observer reports a stop AND an end; a track released twice must count once, and a report naming a
 * track never acquired must count not at all. Pure: the counts are what the menu bar and the window edge draw.
 */
import { isRecord } from "./desktopBridge";

/** What a capture track carries. */
export type MediaKind = "display" | "audio";

/** One report from the page. */
export type MediaReport =
  | { readonly kind: "acquired"; readonly id: string; readonly media: MediaKind }
  | { readonly kind: "released"; readonly id: string };

/** The live tracks by id, and every id already released. */
export interface MediaLedger {
  readonly live: ReadonlyMap<string, MediaKind>;
  readonly released: ReadonlySet<string>;
}

/** No tracks. A page load starts here: a capture never outlives the document that opened it. */
export const EMPTY_MEDIA_LEDGER: MediaLedger = { live: new Map(), released: new Set() };

/**
 * Apply one report.
 *
 * @param ledger the tracks before it
 * @param report what the page saw
 * @returns the tracks after it
 */
export function reduceMediaLedger({ ledger, report }: { ledger: MediaLedger; report: MediaReport }): MediaLedger {
  if (report.kind === "acquired") {
    if (ledger.live.has(report.id) || ledger.released.has(report.id)) {
      return ledger;
    }
    return { live: new Map([...ledger.live, [report.id, report.media]]), released: ledger.released };
  }
  if (!ledger.live.has(report.id)) {
    return ledger;
  }
  const live = new Map(ledger.live);
  live.delete(report.id);
  return { live, released: new Set([...ledger.released, report.id]) };
}

/**
 * How many tracks of each kind are live.
 *
 * @param ledger the tracks
 * @returns the display and audio counts
 */
export function mediaCounts({ ledger }: { ledger: MediaLedger }): {
  readonly displayTracks: number;
  readonly audioTracks: number;
} {
  let displayTracks = 0;
  let audioTracks = 0;
  for (const media of ledger.live.values()) {
    if (media === "display") {
      displayTracks += 1;
    } else {
      audioTracks += 1;
    }
  }
  return { audioTracks, displayTracks };
}

/**
 * Every renderer's live tracks summed, leaving one window out when asked: the menu bar and the sharing edge count them
 * all, and whether another window holds a microphone counts all but the overlay's.
 *
 * @param ledgers every renderer's tracks, by `webContents.id`
 * @param exceptContentsId a window whose tracks are not counted, `undefined` to count every one
 * @returns the display and audio counts across the windows counted
 */
export function totalMediaCounts({
  ledgers,
  exceptContentsId,
}: {
  ledgers: ReadonlyMap<number, MediaLedger>;
  exceptContentsId: number | undefined;
}): { readonly displayTracks: number; readonly audioTracks: number } {
  let displayTracks = 0;
  let audioTracks = 0;
  for (const [id, ledger] of ledgers) {
    if (id !== exceptContentsId) {
      const counts = mediaCounts({ ledger });
      displayTracks += counts.displayTracks;
      audioTracks += counts.audioTracks;
    }
  }
  return { audioTracks, displayTracks };
}

/**
 * One window's live microphone tracks, never another's: the voice's native look is allowed only while ITS window holds
 * a microphone, so a call open in the console window opens no look.
 *
 * @param ledgers every renderer's tracks, by `webContents.id`
 * @param contentsId the window asked about, `undefined` when it does not exist
 * @returns its audio tracks, zero for a missing window or one that has reported nothing
 */
export function windowAudioTracks({
  ledgers,
  contentsId,
}: {
  ledgers: ReadonlyMap<number, MediaLedger>;
  contentsId: number | undefined;
}): number {
  const ledger = contentsId === undefined ? undefined : ledgers.get(contentsId);
  if (ledger === undefined) {
    return 0;
  }
  return mediaCounts({ ledger }).audioTracks;
}

/**
 * Read one report off the bridge. The page is local, but it is still web content, so anything that is not
 * exactly a report is dropped rather than trusted.
 *
 * @param value what the page sent
 * @returns the report, or `undefined` when the value is not one
 */
export function parseMediaReport({ value }: { value: unknown }): MediaReport | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = value["id"];
  if (typeof id !== "string" || id.length === 0 || id.length > 64) {
    return undefined;
  }
  if (value["kind"] === "released") {
    return { id, kind: "released" };
  }
  const media = value["media"];
  if (value["kind"] === "acquired" && (media === "display" || media === "audio")) {
    return { id, kind: "acquired", media };
  }
  return undefined;
}

/**
 * Whether a media request asks for the microphone. Electron types `mediaTypes` as always present, but a request
 * can carry it undefined, and a throw in the permission handler would leave the request unanswered.
 *
 * @param mediaTypes the request's media list, widened to what it can be at runtime
 * @returns `true` only when the list names audio
 */
export function asksForAudio({ mediaTypes }: { mediaTypes: readonly string[] | undefined }): boolean {
  return mediaTypes?.includes("audio") === true;
}
