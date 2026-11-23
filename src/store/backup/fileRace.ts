/**
 * The one question the files leg asks of a failed read or clone: did the file VANISH, or did something go wrong?
 *
 * The backed-up roots are live while the leg reads them. MEASURED on a nightly run: the Trelica
 * walk wrote a page screenshot as `atlas/trelica/artifacts/pages/<epoch-ms>.png` and removed it a moment
 * later (`src/browser/playwrightCli.ts`), the leg's `readdirSync` had already listed it, and `digestFile`'s
 * `stat` failed `ENOENT` — failing the whole night, database dump included. A file that is gone is not a
 * file the manifest can name, so the leg omits and counts it; every OTHER failure still stops the backup.
 *
 * Exactly `ENOENT`, read off the error's own `code`: never `ENOTDIR`, never a permission error, never a
 * message that merely mentions it, because each of those is a layout or access fault a skip would hide.
 *
 * And `ENOENT` alone does not say WHICH path is missing. A clone names two, and a snapshot directory gone
 * from under the leg throws the same code with the source still in place — found by the r1 Codex review of
 * this change. So {@link fileVanished} also confirms the source itself is absent; a source still there is a
 * failure, which is the safe direction for the one race the confirmation opens. A clone also names the
 * directory it writes into, and a MISSING one is a failure whatever the source did since — the r2 review's
 * schedule, where the snapshot goes and the source is deleted between the clone and the check.
 *
 * **The residue, stated rather than discovered**: these checks run after the failed call, so no ordering of
 * them is atomic. What a skip guarantees is that the source's OWN lookup answered `ENOENT` after the failure,
 * while a clone's directory was still there — never that the path stays empty. Two review schedules sit in
 * that gap: the leg's private snapshot directory removed and recreated around a deleted source, and a file
 * recreated at the path just after its lookup. The second is no different from a file written after the
 * walk's listing, which a backup that is not an atomic snapshot never carries either; the next night does.
 * Cloning from a held descriptor would settle which path failed, but costs the APFS clone that keeps a 17 GB
 * root affordable.
 */
import { lstatSync } from "node:fs";

/**
 * Whether a caught filesystem error is exactly `ENOENT`. Pure.
 *
 * @param cause whatever a `stat`, `open` or `copyFile` threw
 * @returns true only for an error object whose `code` is exactly `ENOENT`
 */
export function isNotFound({ cause }: { cause: unknown }): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

/**
 * Whether a failed read or clone of `path` failed because `path` itself is gone.
 *
 * @param cause what the read or clone threw
 * @param path the live file the leg was reading — the SOURCE of a clone, never its destination
 * @param into the directory a clone writes into, which must still exist; omitted for a plain read
 * @returns true only for an exact `ENOENT` while `path` no longer exists and `into`, when named, still does
 */
export function fileVanished({ cause, path, into }: { cause: unknown; path: string; into?: string }): boolean {
  if (!isNotFound({ cause })) {
    return false;
  }
  if (into !== undefined && probe({ path: into }) !== "present") {
    return false;
  }
  return probe({ path }) === "absent";
}

/**
 * Look a path up, telling ABSENT apart from UNKNOWABLE: `existsSync` answers `false` for a permission error
 * on an ancestor too, and the final r3 review read an existing file as vanished that way.
 *
 * @param path the path to look up, never followed past its own last component
 * @returns `present`, `absent` only on the lookup's own exact `ENOENT`, else `unknown`
 */
function probe({ path }: { path: string }): "present" | "absent" | "unknown" {
  try {
    lstatSync(path);
    return "present";
  } catch (error: unknown) {
    if (isNotFound({ cause: error })) {
      return "absent";
    }
    return "unknown";
  }
}
