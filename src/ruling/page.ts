/**
 * The one read-only view of the ruling register: a page fragment, one section per category, each current ruling in
 * the owner's words, and every ruling it replaced folded beneath it.
 *
 * Built straight from the register and published through the page publisher without `page publish`'s identifier
 * linker or lint, because both would change or refuse the owner's words (a call id, a clock time). So escaping is
 * this renderer's whole safety: every value from the register crosses {@link escapeText} before it reaches markup,
 * and the words keep their line breaks through `white-space: pre-wrap`, never through an inserted tag.
 */
import { err, ok, type Result } from "#lib/result.js";
import { escapeText } from "../outbound/briefing/escape.js";
import { type RulingError, RulingErrors } from "./errors.js";
import type { RulingProjection, RulingRecord } from "./registry.js";

/** The page's slug, and so its console address. */
export const RULING_PAGE_SLUG = "ruling";

/** The largest fragment the view publishes: far past any register a person keeps, and a bound on one string. */
const RULING_PAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Every ruling a given one replaced, newest first, read off the projection's reverse map. */
function replacedUnder({
  record,
  projection,
}: {
  record: RulingRecord;
  projection: RulingProjection;
}): readonly RulingRecord[] {
  const byId = new Map(projection.rows.map((row) => [row.id, row]));
  return record.replaces.map((id) => byId.get(id)!).toReversed();
}

/** The line under a ruling's words: when it was decided, where, and its id. */
function metaLine({ record }: { record: RulingRecord }): string {
  const parts = [`decided ${escapeText({ text: record.decidedOn })}`];
  if (record.anchor !== undefined) {
    parts.push(`said at <code>${escapeText({ text: record.anchor })}</code>`);
  }
  if (record.context !== undefined) {
    parts.push(escapeText({ text: record.context }));
  }
  parts.push(`<code>${escapeText({ text: record.id })}</code>`);
  return `<p class="ruling-meta">${parts.join(" · ")}</p>`;
}

/** One ruling, and beneath it the chain of rulings it replaced. */
function rulingBlock({ record, projection }: { record: RulingRecord; projection: RulingProjection }): string {
  const words = `<blockquote style="white-space: pre-wrap">${escapeText({ text: record.words })}</blockquote>`;
  const earlier = replacedUnder({ projection, record });
  const fold =
    earlier.length === 0
      ? ""
      : `<details><summary>Replaced ${String(earlier.length)} earlier ruling(s)</summary>${earlier
          .map((row) => rulingBlock({ projection, record: row }))
          .join("")}</details>`;
  return `<article class="ruling">${words}${metaLine({ record })}${fold}</article>`;
}

/**
 * Render the register as the view's page fragment.
 *
 * @param projection the register as read
 * @returns the fragment, or a refusal when it would pass {@link RULING_PAGE_MAX_BYTES}
 */
export function renderRulingPage({ projection }: { projection: RulingProjection }): Result<string, RulingError> {
  // A category whose every ruling was replaced from another category has nothing current to head: its words are
  // folded under the ruling that replaced them, wherever that one is filed.
  const shown = projection.categories.filter((category) => projection.current.some((row) => row.category === category));
  const sections = shown
    .map((category) => {
      const current = projection.current.filter((row) => row.category === category).toReversed();
      const heading = `<h2>${escapeText({ text: category })} <small>(${String(current.length)} current)</small></h2>`;
      return `<section>${heading}${current.map((record) => rulingBlock({ projection, record })).join("")}</section>`;
    })
    .join("");
  const total = projection.current.length;
  const lede =
    total === 0
      ? "<p>No rulings are recorded yet.</p>"
      : `<p>${String(total)} current ruling(s) in ${String(shown.length)} categories, newest first in ` +
        "each. A ruling another replaced is folded under the one that replaced it.</p>";
  const fragment = `<title>Rulings</title><h1>Rulings</h1>${lede}${sections}`;
  const bytes = Buffer.byteLength(fragment);
  if (bytes > RULING_PAGE_MAX_BYTES) {
    return err(RulingErrors.tooLarge({ bytes, max: RULING_PAGE_MAX_BYTES }));
  }
  return ok(fragment);
}
