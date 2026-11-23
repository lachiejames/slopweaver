/**
 * Mask every secret hit in one string — a credential class or a private-denylist word, exactly what `isSecretHit`
 * names and `store import-fleet --only authored` refuses a whole file for — as `[REDACTED:<label>]`, counted by label.
 * Identifiers are kept: the import does not refuse them, and an audit needs them. Pure: the denylist arrives loaded.
 *
 * Shared by the two console writers that keep text a tool or a provider handed over: a call's thread journal
 * (`src/talk/callThreadSanitise.ts`) and a call's own file (`src/talk/callSanitise.ts`), so the two never mask the
 * same text two ways.
 */
import { isSecretHit, scanContent } from "./scan.js";

/** How many mask passes one string gets before a survivor is judged: a mask can expose a hit the scan reported once. */
const MASK_PASSES = 8;

/** The `path` a scan reports under; `scanContent` never reads it. */
const SCAN_PATH = "masked-string";

/**
 * Every occurrence of one hit's text in a string replaced by its redaction marker — case-blind for a denylist word,
 * which the scan matches case-blind.
 *
 * @param excerpt the matched text
 * @param label the hit's label, which the marker names
 * @returns the masked string and how many occurrences it replaced
 */
function maskOne({ text, excerpt, label }: { text: string; excerpt: string; label: string }): {
  readonly text: string;
  readonly count: number;
} {
  const escaped = excerpt.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const flags = label === "denylist" ? "giu" : "gu";
  let count = 0;
  const masked = text.replace(new RegExp(escaped, flags), () => {
    count += 1;
    return `[REDACTED:${label}]`;
  });
  return { count, text: masked };
}

/**
 * One string with every secret hit masked, over a bounded number of passes — the scan reports one hit per pattern per
 * line, so a mask can expose a second.
 *
 * @param denylist the private denylist words
 * @param redactions running count per label, added to
 * @returns the masked string; a hit that outlasted every pass is still in it, which {@link secretLabelsIn} reports
 */
export function maskSecretString({
  text,
  denylist,
  redactions,
}: {
  text: string;
  denylist: readonly string[];
  redactions: Map<string, number>;
}): string {
  let current = text;
  for (let pass = 0; pass < MASK_PASSES; pass += 1) {
    const hits = scanContent({ content: current, denylist, path: SCAN_PATH }).filter((hit) => isSecretHit(hit));
    if (hits.length === 0) {
      break;
    }
    for (const hit of hits) {
      const masked = maskOne({ excerpt: hit.excerpt, label: hit.label, text: current });
      current = masked.text;
      const before = redactions.get(hit.label);
      if (masked.count > 0) {
        redactions.set(hit.label, before === undefined ? masked.count : before + masked.count);
      }
    }
  }
  return current;
}

/**
 * The secret labels a string still carries.
 *
 * @param text the string, masked or not
 * @param denylist the private denylist words
 * @returns each label once, in the order first found
 */
export function secretLabelsIn({ text, denylist }: { text: string; denylist: readonly string[] }): string[] {
  const hits = scanContent({ content: text, denylist, path: SCAN_PATH }).filter((hit) => isSecretHit(hit));
  return [...new Set(hits.map((hit) => hit.label))];
}
