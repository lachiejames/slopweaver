/**
 * One Codex destination's account as a single cell — the Codex side of what `../claude/accountBinding.ts`'s
 * `renderAccountCell` is for Claude, for a surface with one slot per plan (the capacity reading, which the Fleet
 * page draws on hover). Pure.
 *
 * The rule is `./fleetRender.ts`'s: only a live `account/read` may print an address as the account; the register's
 * cached email is printed SAID TO BE a cache, and when the two disagree both are printed rather than one chosen.
 */
import type { CodexFleetRow } from "./fleetAssessment.js";

/**
 * The account cell for one destination, off its LIVE read — unlike `../plans/render.ts`'s `codexAccountCell`, which
 * holds only the register and so can never name more than a cache.
 *
 * @param row the destination's report row, narrowed to its account fields
 * @returns the cell text, never blank
 */
export function codexLiveAccountText({
  row,
}: {
  row: Pick<CodexFleetRow, "emailCached" | "liveEmail" | "liveState">;
}): string {
  switch (row.liveState) {
    case "signed-in":
      if (row.liveEmail === null) {
        return "signed in to an account with no email";
      }
      if (row.emailCached !== null && row.emailCached !== row.liveEmail) {
        return `${row.liveEmail} (the register says ${row.emailCached})`;
      }
      return row.liveEmail;
    case "signed-out":
      return "NOT SIGNED IN";
    case "store-missing":
      return "STORE MISSING";
    case "unreadable":
      if (row.emailCached === null) {
        return "UNREAD";
      }
      return `CACHED ${row.emailCached}`;
    default: {
      const unhandled: never = row.liveState;
      return unhandled;
    }
  }
}
