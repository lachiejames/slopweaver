/**
 * The pure core of `slopweaver briefing recut`: rewrite the fleet words in a form's AUTHORED prose into
 * plain ones, and report, per authored string, the first fleet word it could not rewrite.
 *
 * ## What the report does not see, stated rather than discovered
 *
 * It reads one string at a time, so a fleet phrase split across two runs — `[text("this "), strong("tick")]`
 * — is neither rewritten nor reported. That page is still refused where it matters: the section gate
 * (`../outbound/briefing/sectionQuality.ts`) reads each disclosure level's visible text with its own scope
 * rules, and `briefing render` refuses the form. A second visible-content walker here would be a second
 * opinion about the same rule, so the blind spot is named instead of closed.
 *
 * It replaces the supervisor chair's `recut.py`. The substitutions
 * themselves live in `./fleetJargon.ts` beside the senses they retire; this module only decides WHICH strings
 * of a form are prose a session composed, and walks them.
 *
 * ## The allowlist, and why it is one
 *
 * `recut.py` rewrote every string in the form. Most strings in a form are not prose: a link's `url`, an
 * anchor's `target`, a paste block's bytes (which the owner copies into a box verbatim), a draft of a message in the
 * owner's own voice, a card's `subject` (a pull request's title, somebody else's words), a premise's pointer, and the
 * two projected sections nobody here composes. A global substitution would turn `…/reaper` in a URL into a
 * link to nowhere. So only these are rewritten:
 *
 * - the `text` of an inline run of kind `text`, `strong`, `link` or `anchor` — never `code`;
 * - a fold's or section's `summary`;
 * - a card's `question`, and each option's `text`.
 *
 * And these subtrees are skipped whole: `yourList`, `reactNow.openArtifacts`, `awaiting`, every `alignment`
 * field (its headline and intake are `handover reconcile`'s own sentences, pasted verbatim by rule — a word
 * wrong there is a defect in the generator, never a line to edit), a card's `subject`, `premise` and
 * `readiness`, and every `paste`, `draft` and `image` block.
 *
 * Pure: raw JSON in, raw JSON and a report out.
 */

import { absentAsNumber } from "#lib/absent.js";
import { isRecord } from "#lib/parsers.js";
import { recutText, ungloss } from "./fleetJargon.js";

/**
 * A fleet word left in the prose after the rewrite, for a composer to fix by hand.
 *
 * @internal — read off {@link RecutResult} by the verb that prints it; nothing imports it by name.
 */
export interface RecutLeftover {
  /** The string's JSON path. */
  readonly path: string;
  readonly term: string;
  /** The phrase as it reads now. */
  readonly used: string;
}

/** What one recut pass did. */
export interface RecutResult {
  readonly form: unknown;
  /** Substitutions per fleet term, across the whole form. */
  readonly counts: Readonly<Record<string, number>>;
  /** Every authored string still carrying an unglossed fleet word after the rewrite. */
  readonly leftovers: readonly RecutLeftover[];
}

/** Keys whose whole subtree is never prose a session composed. */
const SKIPPED_KEYS: ReadonlySet<string> = new Set([
  "alignment",
  "awaiting",
  "openArtifacts",
  "premise",
  "readiness",
  "subject",
  "yourList",
]);

/** Block kinds whose payload is kept byte for byte. */
const OPAQUE_KINDS: ReadonlySet<unknown> = new Set(["code", "draft", "image", "paste"]);

/** Inline run kinds whose `text` is authored prose. */
const PROSE_RUN_KINDS: ReadonlySet<unknown> = new Set(["anchor", "link", "strong", "text"]);

/** The walk's accumulator: the running counts and the leftovers found so far. */
interface RecutTally {
  readonly counts: Record<string, number>;
  readonly leftovers: RecutLeftover[];
}

/**
 * Rewrite one authored string, adding to the tally.
 *
 * @param text the string
 * @param path its JSON path
 * @param tally the running counts and leftovers
 * @returns the rewritten string
 */
function recutCell({ text, path, tally }: { text: string; path: string; tally: RecutTally }): string {
  const recut = recutText({ text });
  for (const [term, count] of Object.entries(recut.counts)) {
    tally.counts[term] = absentAsNumber({ value: tally.counts[term], whenAbsent: 0 }) + count;
  }
  const left = ungloss({ aboveFold: recut.text });
  if (left !== undefined) {
    tally.leftovers.push({ path, term: left.term, used: left.used });
  }
  return recut.text;
}

/**
 * Whether one string field of an object is authored prose, by its key and the object that holds it.
 *
 * @param key the field name
 * @param holder the object carrying it
 * @returns true for a prose run's `text`, an option's `text`, a `summary` or a card's `question`
 */
function isProseField({ key, holder }: { key: string; holder: Record<string, unknown> }): boolean {
  if (key === "summary" || key === "question") {
    return true;
  }
  if (key !== "text") {
    return false;
  }
  return PROSE_RUN_KINDS.has(holder["kind"]) || (holder["kind"] === undefined && typeof holder["letter"] === "string");
}

/**
 * Walk one value, rewriting the authored strings under it.
 *
 * @param value the raw JSON value
 * @param path its JSON path
 * @param tally the running counts and leftovers
 * @returns the value with its authored prose rewritten, everything else as it was
 */
function walk({ value, path, tally }: { value: unknown; path: string; tally: RecutTally }): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown, index) => walk({ path: `${path}.${String(index)}`, tally, value: item }));
  }
  if (!isRecord(value) || OPAQUE_KINDS.has(value["kind"])) {
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    const fieldPath = path === "" ? key : `${path}.${key}`;
    if (SKIPPED_KEYS.has(key)) {
      next[key] = field;
      continue;
    }
    if (typeof field === "string") {
      next[key] = isProseField({ holder: value, key }) ? recutCell({ path: fieldPath, tally, text: field }) : field;
      continue;
    }
    next[key] = walk({ path: fieldPath, tally, value: field });
  }
  return next;
}

/**
 * Recut every authored string in a form.
 *
 * @param form the form as parsed JSON, whatever shape it is in
 * @returns the rewritten form, the per-term counts and every fleet word left unrewritten
 */
export function recutForm({ form }: { form: unknown }): RecutResult {
  const tally: RecutTally = { counts: {}, leftovers: [] };
  const next = walk({ path: "", tally, value: form });
  return { counts: tally.counts, form: next, leftovers: tally.leftovers };
}
