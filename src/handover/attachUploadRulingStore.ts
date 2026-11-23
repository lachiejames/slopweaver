/**
 * The effectful walk behind `./attachUploadRuling.ts`: read every run journal that names the attach-upload half, and
 * say whether attach upload is permitted.
 *
 * No projection cache, unlike `./rulingGateStore.ts`. That cache exists because the dispatch boundary runs ahead of
 * EVERY verb; this is read only by `github attach upload` and `github pr review-prepare`, both rare and both slower
 * than the walk. A cache would also fail open, which is the wrong direction for an upload refused by default. The cost
 * is the gate walk's own: `./rulingGateIndex.ts` measures the whole-journal read at 728 ms, and a key pre-filter
 * skips `parseLedger` on every journal that does not name the half.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isAbsentError } from "#lib/presentFile.js";

import { type AttachUploadStanding, attachUploadStanding, type RowJournal } from "./attachUploadRuling.js";
import { parseLedger } from "./ledger.js";

/** The `.jsonl` suffix a run journal carries. */
const JOURNAL_SUFFIX = ".jsonl";

/** A journal that MAY carry the half, whatever whitespace its writer put around the colon. */
const ATTACH_UPLOAD_KEY = /"attachUpload"\s*:/;

/**
 * Whether a journal must be decoded rather than skipped. A JSON `\u` escape can spell the key in bytes the literal
 * test never sees (`"attachUpload"` decodes to `attachUpload`), so any journal carrying one is decoded too: the
 * pre-filter may only ever cost a parse, never hide a ruling.
 *
 * @param text the journal's whole contents
 * @returns true when the journal may name the half
 */
function mayNameAttachUpload({ text }: { text: string }): boolean {
  return ATTACH_UPLOAD_KEY.test(text) || text.includes("\\u");
}

/**
 * The attach-upload standing on this home.
 *
 * A runs directory that is genuinely absent is a home with no rulings, so attach upload is refused and unruled. One that is
 * there and would not list, a journal naming the half that would not open, and one with a line that would not decode,
 * are each a gap, and a gap refuses: the line not read may be the owner's newer `refused`.
 *
 * @param runsDir the run journals directory, from `stateHome.ts`'s `runs`
 * @returns the standing
 */
export function readAttachUploadStanding({ runsDir }: { runsDir: string }): AttachUploadStanding {
  let names: readonly string[];
  try {
    names = readdirSync(runsDir).filter((name) => name.endsWith(JOURNAL_SUFFIX));
  } catch (error) {
    if (isAbsentError({ error, path: runsDir })) {
      return attachUploadStanding({ gaps: [], journals: [] });
    }
    return attachUploadStanding({ gaps: [`${runsDir}: would not list: ${errorMessage({ error })}`], journals: [] });
  }
  const journals: RowJournal[] = [];
  const gaps: string[] = [];
  for (const name of names.toSorted()) {
    let text: string;
    try {
      text = readFileSync(join(runsDir, name), "utf8");
    } catch (error) {
      gaps.push(`${name}: ${errorMessage({ error })}`);
      continue;
    }
    if (!mayNameAttachUpload({ text })) {
      continue;
    }
    const ledger = parseLedger({ text });
    if (ledger.unreadable.length > 0) {
      gaps.push(`${name}: line ${ledger.unreadable.join(", ")} would not decode`);
    }
    journals.push({ events: ledger.events, slug: name.slice(0, -JOURNAL_SUFFIX.length) });
  }
  return attachUploadStanding({ gaps, journals });
}
