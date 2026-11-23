/**
 * Whether a raise should draw a note, or keep the one already up — the pure half of "one note per step".
 *
 * Two identical notes for one arrival is the defect it prevents: `hand post` raising the note and `hand push`
 * raising a second for the same arrival twelve seconds later.
 *
 * The protocol is per STEP and nothing wider: notes of different steps stack and cascade (`./cascade.ts`), each
 * its own window, and none closes another, because a note dropped before the owner gets a chance to see it is
 * lost.
 *
 * ## The protocol this decides over, and who writes what
 *
 * - **The raiser alone writes `<id>.want`**, the token of the newest raise of that step. A running panel
 *   compares its own token against it each poll and closes, with no marker, once the raise it names has DRAWN
 *   — so the newest raise wins by the order raises happened, never by which process polled first, and a newer
 *   raise that never draws leaves the older note standing.
 * - **A panel alone writes `<id>.<token>.beat`**, carrying the build of the program it runs, re-written about
 *   once a second while it is up. No panel ever writes a file another panel reads as ownership, which is
 *   what makes the protocol free of a read-then-write race (a design where panels re-wrote the shared token as
 *   their heartbeat has exactly that race).
 *
 * A `keep` raise keeps what is up when the wanted token's panel is either beating on THIS build or still
 * starting. The build half is what stops `keep` from pinning a note that runs an older program forever: a
 * raise of that step on a newer build draws the current program, and the old note closes once it has.
 *
 * ## The residue, stated
 *
 * Two raises of one step inside a single launch can both draw, and the older closes on its next poll — so
 * the promise is "never two for longer than a poll", not "never two at any instant". Closing that last gap
 * needs a display lock held across the launcher and `osascript`, which the observed failure (two notes twelve seconds
 * apart) does not need. A note on an older program whose step is never raised again stays
 * on that program until the owner answers it; `hand show <id>` redraws it on the current one.
 *
 * Pure: observations in, a decision out. No clock, no filesystem.
 */

/**
 * How recently a panel must have beaten to count as up, in milliseconds.
 *
 * The panel beats about once a second (`LIVE_REFRESH_SECONDS` in `./panel.ts`). The rest is headroom for an
 * AppKit tracking session — a drag of the window, a held button — which blocks its loop. A panel killed
 * without cleaning up (a logout) leaves its beat behind, and this bound is what stops that file from
 * suppressing every later raise.
 */
export const BEAT_WINDOW_MS = 30_000;

/**
 * How long a wanted token with no beat yet counts as a note still starting, in milliseconds.
 *
 * Measured on the owner's machine: a raise to the first beat took about a second. The window is wide so
 * that a slow LaunchServices start is not read as a failed one, and bounded so that a launch which never drew
 * anything stops suppressing raises.
 */
export const STARTUP_WINDOW_MS = 30_000;

/** What the raiser found on disk for one step, read by the effectful shell in `./raise.ts`. */
export type NoteObservation =
  | { readonly kind: "absent" }
  | {
      readonly kind: "wanted";
      /** When `<id>.want` was last written, in epoch milliseconds. */
      readonly wantedAtMs: number;
      /** The wanted panel's beat, when it has written one. */
      readonly beat?: { readonly build: string; readonly atMs: number };
    };

/**
 * What a note writes into its beat as it closes, in place of a build id. A closed note's beat is gone
 * otherwise, and a note closed seconds after its raise would read exactly like one still starting.
 */
export const CLOSED_BEAT = "closed";

/**
 * A raise's token, ordered by when it was minted: the epoch milliseconds zero-padded to fifteen digits, then a
 * unique tail. A running note reads "a newer raise of my step" as a token that sorts after its own, so it learns
 * of a newer raise that drew even when a newer one still has since taken the want file and failed — the want file names only the newest.
 *
 * @param atMs the wall-clock instant the raise is minted
 * @param unique a value no other raise carries
 * @returns the token
 */
export function raiseToken({ atMs, unique }: { atMs: number; unique: string }): string {
  return `${String(Math.floor(atMs)).padStart(15, "0")}-${unique}`;
}

/** The shape of a {@link raiseToken} with a UUID tail, as regular-expression source the panel program embeds. */
export const RAISE_TOKEN_SOURCE = "^[0-9]{15}-[0-9a-f-]+$";

/** What a raise does when this step's note is already on screen. */
export type WhenLive = "keep" | "replace";

/**
 * Whether an instant lies within `window` milliseconds before `nowMs`. An instant in the FUTURE is not fresh:
 * a clock that stepped back must not make a leftover file look healthy for however long the step lasts.
 *
 * @param atMs the instant a file was written
 * @param nowMs the instant being judged at
 * @param window how old it may be and still count
 * @returns true when `0 <= nowMs - atMs <= window`
 */
function fresh({ atMs, nowMs, window }: { atMs: number; nowMs: number; window: number }): boolean {
  const age = nowMs - atMs;
  return age >= 0 && age <= window;
}

/**
 * Decide whether a raise draws a note or keeps the one already up.
 *
 * `replace` always draws — it is `hand show`, asked for by name, often because the note that is up is where
 * the owner cannot see it, and the new note's token closes the old one once it has drawn. `keep` draws unless the
 * wanted panel is beating on this build, or has no beat yet and was wanted within {@link STARTUP_WINDOW_MS}.
 *
 * @param whenLive the caller's policy
 * @param observation what the shell read for this step
 * @param nowMs the instant being judged at
 * @param currentBuild the build this checkout's panel program carries
 * @returns `keep` to draw nothing, `launch` to draw
 */
export function decideNoteRaise({
  whenLive,
  observation,
  nowMs,
  currentBuild,
}: {
  whenLive: WhenLive;
  observation: NoteObservation;
  nowMs: number;
  currentBuild: string;
}): "keep" | "launch" {
  if (whenLive === "replace" || observation.kind === "absent") {
    return "launch";
  }
  if (observation.beat !== undefined && observation.beat.build !== currentBuild) {
    return "launch";
  }
  return noteShowing({ nowMs, observation }) ? "keep" : "launch";
}

/**
 * Whether the wanted panel is on the owner's screen, or still starting — on ANY build. A raise re-launches a note running an
 * older program ({@link decideNoteRaise}), but that note is still up until it does: `noteStanding` asks this, so a
 * checkout that moved past the panel's program since it drew does not read a note the owner is looking at as gone.
 *
 * @param observation what the shell read for this step
 * @param nowMs the instant being judged at
 * @returns true when the panel is beating inside {@link BEAT_WINDOW_MS}, or has no beat yet and was wanted inside
 *   {@link STARTUP_WINDOW_MS}
 */
export function noteShowing({ observation, nowMs }: { observation: NoteObservation; nowMs: number }): boolean {
  if (observation.kind === "absent") {
    return false;
  }
  const { beat } = observation;
  if (beat === undefined) {
    return fresh({ atMs: observation.wantedAtMs, nowMs, window: STARTUP_WINDOW_MS });
  }
  return beat.build !== CLOSED_BEAT && fresh({ atMs: beat.atMs, nowMs, window: BEAT_WINDOW_MS });
}
