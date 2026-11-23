/**
 * The measured JSON seam — `JSON.stringify` and `JSON.parse` with a size a caller cannot silently exceed.
 * Owner ruling: there is never a legitimate case to stringify or parse something over a certain size, and
 * exceeding it fails loudly.
 *
 * ## Why this exists BESIDE the `whole-file-json` gate rather than instead of it
 *
 * The gate refuses three shapes it can see in the syntax. This catches the size the syntax cannot show, and
 * the pair is not redundant — a measured case proves the gap. `src/atlas/atlasFile.ts` used to serialise
 * every atlas artifact through one `JSON.stringify`, and on this install that produced a **well over 100 MiB**
 * `atlas/cloudflare/pages-project.json` (plus a superseded copy of a similar size). The gate could not see it: the
 * file was `.json` rather than `.jsonl`, and the module reads no corpus, so none of the three signals
 * reached it. Nothing static could have — the size is a property of one Cloudflare account, not of the code.
 * Reproduce on an install still holding one: `find ~/.slopweaver -name '*.json' -size +100M`.
 *
 * This seam refusing is what forced the fix rather than papering over it: an atlas kind file is now a
 * `<kind>.jsonl` streamed a record at a time (`atlasFile.ts`'s header carries the layout), so the case that
 * proved the gap is closed at the write rather than at the threshold. The measurement stays here because it
 * is what set the numbers below.
 *
 * ## The thresholds, and the measurement that set them
 *
 * MEASURED over all of the thousands of `.json` files this install holds
 * (`find ~/.slopweaver -name '*.json' -type f | xargs stat -f %z`): p50 is a few KiB, p99 is hundreds of KiB,
 * dozens of files exceed 1 MiB, under ten exceed 16 MiB — and then **nothing at all exists between under
 * twenty MiB and well over 100 MiB.** Above that band sit exactly three files, and all three are known defects of
 * this class: `graph.json` at well over 200 MiB and the two Cloudflare artifacts. So the thresholds are not a guess dressed as a number; they sit in a
 * measured empty band with the whole legitimate distribution below and every known defect above.
 *
 * {@link JSON_WARN_BYTES} is 32 MiB — above every payload this repo legitimately writes (the largest is
 * `opportunities.json` at under twenty MiB) and well below the empty band's top. {@link JSON_REFUSE_BYTES} is
 * 100 MiB, which is the owner's own figure (anything of 100 megabytes or more in memory is
 * questionable) and lands inside the same empty band.
 *
 * For scale, the ceiling these sit under is V8's: a string over `0x1fffffe8` characters (536,870,888, about
 * 512 MiB) cannot be created at all, and `graph.json` reached over half of it.
 *
 * ## How a stringify is guarded BEFORE the string exists
 *
 * A parse is easy — the text is already in hand, so `text.length` is the exact size and reading it is free
 * (MEASURED: 0.0007 ms on a 41,288,891-character string, against 86 ms to parse the same string).
 *
 * A stringify cannot be measured in advance without doing it, so the guard rides a counting REPLACER, which
 * `JSON.stringify` invokes per value: it accumulates an estimate and throws the moment the estimate passes
 * the cap, so the serialisation ABORTS instead of completing into a string nobody wanted. MEASURED on
 * 400,000 records: bare 349 ms, guarded-and-under-cap 338 ms (within noise), and guarded-and-over-cap 31 ms
 * — the guard pays for itself the one time it fires. On a small payload the replacer costs about 3 ms on an
 * 8 ms call; that is the whole price, and it buys the visibility the owner asked for. Both numbers come
 * from timing `JSON.stringify(rows)` against `JSON.stringify(rows, count)` over 400,000 synthetic records
 * under `node`; `safeJson.test.ts`'s abort case is the standing assertion that the early throw still fires.
 *
 * The estimate is deliberately approximate, and MEASURED it is not approximate enough to stand
 * alone. Run over the real `atlas/cloudflare/pages-project.json`, the counting replacer reached **about 40 MiB**
 * against a finished string of **well over 100 MiB** — an **about fourfold** undercount, which warned and did NOT refuse the
 * exact document this seam was added for. The cause is what it never sees: keys, punctuation and, above all,
 * `space` indentation on a deeply-nested pretty-printed document. Reproduce by running the replacer over any
 * such file and comparing `estimate` with `JSON.stringify(doc, count, 2).length`.
 *
 * So the cap is enforced TWICE, and the two halves do different jobs. The replacer counts keys as well as
 * string values now, and still ABORTS early — that is what stops a string-dominated payload ever being built
 * (MEASURED: 31 ms against 349 ms for the same 400,000 records). And the finished string is then measured
 * EXACTLY and refused if it is over, so the cap is a guarantee rather than an estimate's opinion. The
 * post-hoc half costs one `.length` read on every call and is the only reason a document like Cloudflare's
 * cannot slip through: nothing can know a pretty-printer's output size without producing it, and V8 will
 * produce up to 512 MiB before it refuses on its own.
 *
 * ## No package does this, and the ones that sound like they do solve something else
 *
 * The hunch that a battle-tested NPM library with huge weekly downloads already does this is half right, and the half
 * that is wrong is the useful part. The high-download "safe JSON" packages all guard a DIFFERENT hazard:
 * `fast-safe-stringify` (45.3M/week) and `json-stringify-safe` (41.8M/week) guard circular references,
 * `secure-json-parse` (35.8M/week) guards prototype poisoning, `safe-json-stringify` (6.2M/week) guards
 * throwing getters. None takes a size at all. What DOES exist for the large cases is streaming —
 * `stream-json` (9.8M/week), `bfj` (4.2M/week), `big-json` (185k/week) — and that is a different tool for a
 * different job: it is the fix once you are over the line, not the guard that tells you that you are. This
 * seam is what remains, and it is twenty lines. Counts measured with:
 * `curl -s https://api.npmjs.org/downloads/point/last-week/<pkg>`.
 */

import { logger } from "./logger.js";

/** Above this, a JSON payload is logged with its label — visibility without refusing anything. 32 MiB. */
export const JSON_WARN_BYTES = 32 * 1024 * 1024;

/** Above this, a JSON payload is refused outright. 100 MiB — the owner's figure, in the measured empty band. */
export const JSON_REFUSE_BYTES = 100 * 1024 * 1024;

/** Bytes-per-number the stringify estimate charges: enough for a float or a millisecond epoch. */
const NUMBER_WIDTH = 8;

/**
 * The message a refusal carries. Spelled once so the throw and its unit test cannot drift apart, and so the
 * refusal always names the streaming route rather than only the number it tripped.
 *
 * @param bytes the size that tripped the cap
 * @param label what the caller was serialising or parsing, for a reader who has only the stack
 * @param verb `stringify` or `parse`
 * @returns the refusal message
 */
function refusal({ bytes, label, verb }: { bytes: number; label: string; verb: string }): string {
  return (
    `safeJson${verb}: refusing ${label} at ~${String(Math.round(bytes / (1024 * 1024)))} MiB, over the ` +
    `${String(JSON_REFUSE_BYTES / (1024 * 1024))} MiB cap. A payload this size does not belong in one JS ` +
    "string — V8 cannot create one past 0x1fffffe8 characters at all. Write it as `.jsonl` through " +
    "`writeFileAtomicStream` (src/lib/writeAtomic.ts) and read it with `readJsonlLines` " +
    "(src/corpus/corpusStore.ts), one record at a time."
  );
}

/**
 * `JSON.parse`, refusing a text that is too large to be anything but a mistake. The size is exact and free
 * here, because the whole text is already in memory — which is itself the thing worth knowing.
 *
 * Throws rather than returning a `Result` on purpose: a payload over the cap is a defect in the calling
 * code, not a failure a caller can meaningfully recover from, and the owner's ruling was to fail loudly.
 * For a tolerant read of possibly-invalid JSON, `parseJson` (`./jsonParse.js`) is still the right call.
 *
 * @param text the JSON text
 * @param label what this payload is, named in the warning and the refusal
 * @returns the parsed value
 */
export function safeJsonParse({ text, label }: { text: string; label: string }): unknown {
  if (text.length > JSON_REFUSE_BYTES) {
    throw new Error(refusal({ bytes: text.length, label, verb: "Parse" }));
  }
  if (text.length > JSON_WARN_BYTES) {
    logger.warn({
      msg:
        `safeJsonParse: ${label} is ${String(text.length)} characters — the whole text is already one JS ` +
        "string, and parsing it allocates a second copy of everything in it",
    });
  }
  return JSON.parse(text);
}

/**
 * `JSON.stringify`, aborting rather than completing when the payload runs past the cap. The counting
 * replacer is what makes the abort possible at all — see this module's header for the measurement.
 *
 * @param value the value to serialise
 * @param label what this payload is, named in the warning and the refusal
 * @param space passed straight to `JSON.stringify`; omit for the compact form
 * @returns the JSON text
 */
export function safeJsonStringify({
  value,
  label,
  space,
}: {
  value: unknown;
  label: string;
  space?: string | number;
}): string {
  let estimate = 0;
  const count = (key: string, held: unknown): unknown => {
    // The key's own quotes and colon. An array element's key is its index as a string, which overcounts by a
    // character or two — the wrong direction to be wrong in is UNDER, and this is the cheap half of closing
    // the about-fourfold gap the header measures.
    estimate += key.length === 0 ? 0 : key.length + 3;
    if (typeof held === "string") {
      estimate += held.length + 2;
    } else if (typeof held === "number") {
      estimate += NUMBER_WIDTH;
    }
    if (estimate > JSON_REFUSE_BYTES) {
      throw new Error(refusal({ bytes: estimate, label, verb: "Stringify" }));
    }
    return held;
  };
  // Typed `unknown` deliberately. `JSON.stringify`'s own declaration promises `string`, and that is a lie:
  // it answers `undefined` for a top-level `undefined`, function or symbol, and for any value whose
  // `toJSON()` returns one. Taking the result as `unknown` makes the check below genuinely necessary rather
  // than a condition the compiler believes can never fire, and keeps this function's `string` return honest.
  const raw: unknown = JSON.stringify(value, count, space);
  if (typeof raw !== "string") {
    throw new Error(`safeJsonStringify: ${label} is not serialisable — JSON.stringify returned undefined`);
  }
  const text = raw;
  // The exact half of the cap. The estimate above cannot see indentation, so a pretty-printed document can
  // finish four times larger than the replacer believed — see this module's header for the measurement.
  if (text.length > JSON_REFUSE_BYTES) {
    throw new Error(refusal({ bytes: text.length, label, verb: "Stringify" }));
  }
  if (text.length > JSON_WARN_BYTES) {
    logger.warn({
      msg:
        `safeJsonStringify: ${label} serialised to ${String(text.length)} characters — a payload this size ` +
        "sits in one JS string, and V8 cannot create one past 0x1fffffe8 characters at all",
    });
  }
  return text;
}
