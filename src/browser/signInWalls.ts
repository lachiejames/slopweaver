/**
 * Every sign-in wall a leg in this process stopped at, remembered until a reader takes them.
 *
 * ## The defect this exists to close
 *
 * MEASURED: `slopweaver atlas trelica sync` printed "the signed-in session for
 * https://acme.trelica.app is gone — open it in Chrome and sign in", and `slopweaver atlas xero walk`
 * printed "the Xero web client sent this browser to its sign-in origin". Both ran as scheduled resyncs, and
 * what the resync recorded was `exited 1` — the slot record keeps the last three stderr lines and the
 * resync-state record keeps the runner's own problems, so the one fact the owner could act on (sign in there)
 * was gone before any card could name it. The rule is that exactly that card exists: when the owner is needed
 * to sign in, a button is put in front of them.
 *
 * ## Why process-scoped, stated rather than discovered
 *
 * The same reason as `./walkStops.ts`: a scheduled resync runs its steps IN this process
 * (`live/resync/run.ts`), and every walk verb chooses its own exit code and message. So the fact is noted
 * where it is RECOGNISED — the page-walk kit's `sessionLostOn` check and the Trelica session read — and the
 * resync runner drains it around each step onto the attempt it records.
 *
 * A relay that DROPPED (a transport `SESSION_LOST`) is not a sign-in and is never noted here: that is a walk
 * stop, and a sign-in button would not bring the relay back.
 */
import type { BrowserPageTransport, PageCapture } from "./pageTransport.js";

/** Every origin whose sign-in wall stopped a leg since the last {@link takeSignInWalls}, deduplicated. */
const walls = new Set<string>();

/**
 * Remember that a leg reached `origin`'s sign-in page instead of the page it asked for.
 *
 * @param origin the platform's own app origin — the one the owner opens to sign in, e.g. `https://go.xero.com`
 */
export function noteSignInWall({ origin }: { origin: string }): void {
  walls.add(origin);
}

/**
 * Every sign-in wall noted since the last call, in the order first seen, and forget them.
 *
 * @returns the walls' origins, empty when no leg since the last call met a sign-in page
 */
export function takeSignInWalls(): readonly string[] {
  const taken = [...walls];
  walls.clear();
  return taken;
}

/**
 * Wrap a page transport so each capture the platform reads as signed out notes the requested origin.
 *
 * `atlas/kit/pageWalk.ts` wraps its transport in this once, rather than each platform doing it, because both places
 * a walk meets a sign-in page go through that transport: the platform's own root probe and every declared page after
 * it. Xero's probe is the measured case — it answers `signedOut` before a single page is walked (`slopweaver atlas xero walk`). The origin noted is the one the walk ASKED for, never the sign-in page it landed on:
 * that is the platform's own app, which is what opening it signed-out in the owner's Chrome brings the sign-in to. A failed
 * visit is never noted.
 *
 * @param transport the walk's own transport, visited and released exactly as before
 * @param sessionLostOn the platform's check that a capture landed on its sign-in page instead of the page asked for
 * @returns the noting transport
 */
export function signInNotingTransport({
  transport,
  sessionLostOn,
}: {
  transport: BrowserPageTransport;
  sessionLostOn: (input: { capture: PageCapture }) => boolean;
}): BrowserPageTransport {
  return {
    release: () => transport.release(),
    visit: async (input) => {
      const visited = await transport.visit(input);
      if (visited.isOk() && sessionLostOn({ capture: visited.value })) {
        noteSignInWall({ origin: new URL(input.url).origin });
      }
      return visited;
    },
  };
}
