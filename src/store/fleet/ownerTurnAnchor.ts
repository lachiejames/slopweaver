/**
 * Reading an anchor that cites an owner-turn file as the key `owner_turn_location` is looked up by. Pure.
 *
 * Anchors in canon are written every way a session has ever typed a path —
 * `~/.slopweaver/supervisor-scratch/handoff-<n>/owner-turn-<n>-1.txt`,
 * `$SLOPWEAVER_HOME/handovers/archive/owner-turn-…txt`, a bare `supervisor-scratch/handoff-<n>/…txt#card-7`,
 * a `state:` token, an absolute path — or as just the turn label (`<handoff>-<n>`). Each one resolves to the same two
 * questions: which path under the home, or which turn label. A fragment is the anchor's own sub-pointer
 * into the text and is dropped; a path outside the home, or one that is not where an owner-turn file lives,
 * is refused with the reason rather than looked up and reported empty.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { anchorToken, homeRelativeOfToken } from "./homeAnchor.js";
import { ownerTurnFamily, ownerTurnLabel } from "./ownerTurn.js";

/** What an anchor resolved to. */
export type OwnerTurnRef =
  /** One file, by its path under the home — every body ever recorded there. */
  | { readonly kind: "path"; readonly relativePath: string }
  /** One turn label — every copy of it in any handoff folder. */
  | { readonly kind: "turn"; readonly turn: string };

/**
 * Resolve an anchor or a turn label.
 *
 * @param ref what the caller typed — a path in any of the spellings above, or a turn label
 * @param home the state home an absolute path must sit under
 * @returns the path or turn to look up, or the refusal naming why the anchor cites no owner-turn file
 */
export function resolveOwnerTurnRef({
  ref,
  home,
}: {
  ref: string;
  home: string;
}): Result<OwnerTurnRef, FleetImportError> {
  const token = anchorToken({ ref });
  if (token === undefined) {
    return err(
      FleetImportErrors.unstorableTurnFile({
        path: ref,
        reason: "the anchor names a transcript or other record, not a file",
      }),
    );
  }
  if (token.length === 0) {
    return err(FleetImportErrors.unstorableTurnFile({ path: ref, reason: "the anchor is empty" }));
  }
  if (!token.includes("/")) {
    return bareToken({ ref, token });
  }
  const underHome = homeRelativeOfToken({ home, token });
  if (underHome === undefined) {
    return err(FleetImportErrors.unstorableTurnFile({ path: ref, reason: `it is outside the state home ${home}` }));
  }
  if (ownerTurnFamily({ relativePath: underHome }) === undefined) {
    return err(
      FleetImportErrors.unstorableTurnFile({
        path: ref,
        reason: "it is not an owner-turn-*.txt file under handovers/archive/ or supervisor-scratch/<handoff>/",
      }),
    );
  }
  return ok({ kind: "path", relativePath: underHome });
}

/**
 * Any anchor spelling of a file under the home, as the `/`-separated path under it — the same reading
 * {@link resolveOwnerTurnRef} gives a path, for a caller whose files are not owner turns
 * (`./authoredFile.ts`).
 *
 * @param ref what the caller typed — `~/.slopweaver/…`, `$SLOPWEAVER_HOME/…`, `file://…`, an absolute path
 *   or a path already relative to the home; a `#fragment` is dropped
 * @param home the state home an absolute path must sit under
 * @returns the path under the home, or `undefined` when the anchor names no file under it
 */
export function anchorHomeRelativePath({ ref, home }: { ref: string; home: string }): string | undefined {
  const token = anchorToken({ ref });
  if (token === undefined || token.length === 0) {
    return undefined;
  }
  return homeRelativeOfToken({ home, token });
}

/**
 * A token with no directory in it: a turn label, or a bare owner-turn filename read as its label.
 *
 * @param ref the anchor as typed, named in a refusal
 * @param token the token itself
 * @returns the turn to look up, or the refusal for a bare filename that is not an owner-turn file
 */
function bareToken({ ref, token }: { ref: string; token: string }): Result<OwnerTurnRef, FleetImportError> {
  const label = ownerTurnLabel({ fileName: token });
  if (label !== undefined) {
    return ok({ kind: "turn", turn: label });
  }
  if (token.endsWith(".txt")) {
    return err(FleetImportErrors.unstorableTurnFile({ path: ref, reason: "a .txt file not named owner-turn-*.txt" }));
  }
  if (token.startsWith("owner-turn-")) {
    return ok({ kind: "turn", turn: token.slice("owner-turn-".length) });
  }
  return ok({ kind: "turn", turn: token });
}
