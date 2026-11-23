import { NextResponse } from "next/server";

import {
  type DroppedReading,
  readSavedReadings,
  type SavedReadings,
  savedReadingsDirectory,
} from "../../../lib/savedReadings";

/** Never prerendered: what is saved changes with every real read. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The saved readings, and every saved file not drawn with why — the console server logs nothing, so it says here. */
export interface LiveSavedResponse {
  readonly readings: SavedReadings;
  readonly dropped: readonly DroppedReading[];
}

/**
 * Every live verb's last saved reading, read from disk — a page asks once, as its first channel opens, so its tiles
 * draw that reading marked refreshing while their own reads run (`site/components/live/useLive.ts`). Starts no verb,
 * no flight and no pack keeper.
 *
 * @returns the readings by slug, and the files dropped
 */
export async function GET(): Promise<NextResponse<LiveSavedResponse>> {
  const { readings, dropped } = await readSavedReadings({ directory: savedReadingsDirectory() });
  return NextResponse.json({ dropped, readings }, { headers: { "cache-control": "no-store" } });
}
