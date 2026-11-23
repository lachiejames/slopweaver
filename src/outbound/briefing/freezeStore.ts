/**
 * The PUBLISH FREEZE's naming half: which key the exact bytes of a page that reached the owner are kept under, and
 * what a refusal to open a new history says. The bytes themselves live in the store's Storage and nowhere else
 * (`../../store/publishedPages/write.ts`, stage 6 of `docs/store/published-pages.md`); nothing here writes a file.
 *
 * A published page once had no source file on disk, so stamping one paragraph of the owner's ruling onto it
 * meant reconstructing ~30 KB of HTML from the published copy
 * — the move most likely to introduce a silent transcription error, on a page whose whole subject was a
 * defect nobody could see. That page was left unstamped and its ruling stayed on the row. The rule: **the publisher freezes every publish**, so the next round has real bytes to diff against.
 *
 * ## Why the bytes and not just a hash
 *
 * A hash answers "did this change" and `./corrections.ts` needs "WHERE did it change", which takes the whole
 * previous document. The digest is kept beside the bytes anyway, because it is what the stamped page names as
 * its provenance and what a reader uses to confirm which version a set of marks was computed against.
 *
 * ## A key with no history is REFUSED, because a drifted id reads exactly like a new page
 *
 * MEASURED: each supervisor tick's publish tail was derived by `sed`-ing the previous tick's
 * script from N-1 to N, and the fleet-briefing artifact id carries the digits `259`. From tick 259 the
 * substitution rewrote the ID ITSELF, so every tick froze into a brand-new history — 48 of them, 47 holding
 * bytes that existed nowhere else — while the canonical one's 568 versions stopped dead at tick 258. Nothing
 * complained, because opening a history and
 * extending one were the same call.
 *
 * They are not the same call any more. A freeze without `--new` naming a key the store holds no version of is
 * refused inside the store's own transaction (`../../store/publishedPages/freezeHistory.ts`), and the refusal names
 * the NEAREST held keys and how many versions each holds: a neighbour one character away holding 568 versions is
 * the sentence that ends this incident on tick 259 instead of tick 292. {@link driftDetail} words it.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { localPageSlug } from "../../pages/url.js";
import { type FreezeKeyError, FreezeStoreErrors } from "./errors.js";

/** What a key may contain. Anything else is refused rather than escaped — a key names a page in the store. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * The store key for one page, given its published URL or its bare id.
 *
 * Two address shapes, and the LOCAL one is why this is not just "the last path segment".
 *
 * An artifact URL carries its id last, which is what a reader can read off the address bar, so that is the
 * key. A LOCAL page's address (`../../pages/url.ts`) ends in the same `index.html` as every other local
 * page's, so the last segment is a constant: measured `index.html` passing {@link SAFE_KEY} and both
 * `/pages/a/index.html` and `/pages/b/index.html` keying to it, so each page silently overwrote the other's
 * latest freeze and neither call raised anything.
 * A local page is therefore keyed on its SLUG, which is the part that differs.
 *
 * Refused rather than sanitised when it is neither: quietly rewriting a key would put a page's history somewhere
 * its next freeze cannot find it.
 *
 * @param artifact the page's published URL — artifact or local — or an artifact's bare id
 * @returns the key the store files that page under
 */
export function artifactKey({ artifact }: { artifact: string }): Result<string, FreezeKeyError> {
  const slug = localPageSlug({ url: artifact });
  if (slug !== undefined) {
    return ok(slug);
  }
  if (artifact.trim().startsWith("file:")) {
    // A `file:` address that is NOT a local page must never reach the last-segment rule below, because that
    // is precisely the fall-through the row measured: any such address ending `/index.html` would be filed
    // under `index.html` and collide with every other one.
    return err(FreezeStoreErrors.fileAddressNotAPage({ artifact }));
  }
  const segments = artifact
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .split("/");
  // `split` never answers an empty array, so the last segment is always there — an empty STRING is a real
  // possible value and is what `SAFE_KEY` then refuses.
  const last = segments[segments.length - 1]!;
  if (!SAFE_KEY.test(last)) {
    return err(FreezeStoreErrors.artifactUnnameable({ artifact }));
  }
  return ok(last);
}

/**
 * The clause a new-history refusal carries: which key was resolved, and which held pages sit next to it.
 *
 * The neighbour half is the whole point. `--new` on its own would move the silence one step — an operator
 * reading "this page has no history" concludes "right, it is new" and passes the flag — whereas
 * "`…642592` is two characters different and holds 568 versions" is not a sentence anyone types `--new` past.
 *
 * @param key the key the freeze resolved to
 * @param neighbours the held keys a hair away from it, nearest first, as the store found them
 * @returns the detail clause the `freeze-opens-new-history` hatch refusal carries
 */
export function driftDetail({
  key,
  neighbours,
}: {
  key: string;
  neighbours: readonly { key: string; versions: number; distance: number }[];
}): string {
  if (neighbours.length === 0) {
    return `resolved to the key "${key}", which the store holds no version of, and no held page's key is within two characters of it`;
  }
  const named = neighbours.map(
    (row) => `${row.key} (${String(row.versions)} versions, ${String(row.distance)} character(s) different)`,
  );
  return `resolved to the key "${key}", which the store holds no version of, while these held pages are a hair away from it: ${named.join("; ")}`;
}
