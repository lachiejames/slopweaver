/**
 * The checks a pull-request title and body share with every other outbound surface: the word counter, the
 * invented-visual check, and the metadata-leak scan (secrets, the private denylist, forbidden identifiers).
 * `./prBodyGate.ts` is the one gate CI runs over a description; it calls the leak scan for every pull request and
 * the rest for this repository's own. `tableCell` stays for `github pr summary`, which still reads a retired
 * table-shaped body it finds on an old pull request.
 */

import {
  ACKNOWLEDGEMENT_MIN_WORDS,
  acknowledgementCarriesAReason,
  inventedVisualsIn,
} from "../admit/inventedVisual.js";
import { prBodyVisuals } from "../admit/inventedVisualSeams.js";
import { FORBIDDEN_IDENTIFIER_RULES } from "../hygiene/forbiddenIdentifiers.js";
import type { ForbiddenIdentifierRules } from "../hygiene/identifierScan.js";
import { type InstallationIdentifiers, pullRequestIdentifierHits } from "../hygiene/installationIdentifiers.js";
import { DENYLIST_LABEL, isRefusedHit, scanContent } from "../hygiene/scan.js";

/** Max words in a short summary cell — the cap a comment form's summary reuses. Keeps a message lean. */
export const MAX_WORDS = 50;

/**
 * Count human words in a table cell: drop HTML tags (`<img>`, `<strong>`, `<br>`, …) and markdown
 * noise, keep link text (not URLs).
 *
 * @param cell the table-cell content (HTML or markdown)
 * @returns the human word count
 */
export function countWords({ cell }: { cell: string }): number {
  const text = cell
    .replace(/<[^>]+>/g, " ") // strip HTML tags (img/strong/a/br/…)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) -> text
    .replace(/`([^`]*)`/g, "$1") // `code` -> code
    .replace(/[*_#>•|]/g, " ")
    .trim();
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/**
 * The content cell of a 2-column table row labelled `<label>`, or null if absent. Handles the canonical
 * HTML-table form (`<td>…Problem…</td><td>CONTENT</td>`) and a markdown-table fallback
 * (`| **Problem** | CONTENT |`). The capture group is guaranteed present when the regex matches, so a
 * non-null assertion is honest here (no empty-string fallback masking a miss). Exported so a reader of a
 * retired table-shaped body (`github pr summary`) finds a cell exactly where this gate does.
 *
 * @param body the PR description markdown
 * @param label the row label to find, matched as a whole word
 * @returns the cell's raw content, trimmed, or null when no row carries the label
 */
export function tableCell({ body, label }: { body: string; label: string }): string | null {
  const html = new RegExp(
    `<td[^>]*>(?:(?!</td>)[\\s\\S])*?\\b${label}\\b(?:(?!</td>)[\\s\\S])*?</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`,
    "i",
  );
  const htmlMatch = html.exec(body);
  if (htmlMatch !== null) {
    return htmlMatch[1]!.trim();
  }
  const md = new RegExp(`^\\|\\s*\\*\\*${label}\\*\\*\\s*\\|(.*?)\\|\\s*$`, "m");
  const mdMatch = md.exec(body);
  return mdMatch === null ? null : mdMatch[1]!.trim();
}

/**
 * The inline acknowledgement that waives {@link inventedVisualErrors} for this description.
 *
 * A comment in the body rather than a flag or an environment variable, because CI validates a PR
 * description from `$PR_BODY` and nothing else — a hatch it cannot see would be no hatch at all. The reason
 * is part of the marker for the same purpose the `named-object-params-exempt` marker carries one: an
 * exception stays visible in the diff instead of hidden in a config file, and the next reader is told WHY.
 */
const INVENTED_VISUAL_ACK = /<!--\s*invented-visual-ack:\s*(\S+(?:\s+\S+)*)\s*-->/i;

/**
 * Whether this description acknowledges its own invented visuals, with a reason of substance.
 *
 * @param body the PR description markdown
 * @returns whether an `invented-visual-ack` comment carries a reason of substance
 */
function acknowledgesInventedVisuals({ body }: { body: string }): boolean {
  const match = INVENTED_VISUAL_ACK.exec(body);
  if (match === null) {
    return false;
  }
  // The capture group is guaranteed present when the regex matches, so the assertion is honest.
  return acknowledgementCarriesAReason({ reason: match[1]! });
}

/**
 * Every image this description embeds that is a picture the machine drew rather than one of the real thing.
 *
 * The third of the three seams the ruling names, and the only one that runs in CI rather than at a
 * door — which is why the refusal is an error string here and a `warn` finding there. Same detector, same
 * reasons; see `../admit/inventedVisual.ts` for the instances and for why a slopweaver-rendered page is not
 * exempt.
 *
 * @param body the PR description markdown
 * @returns one error per offending embed; empty when every embed is a real capture, and empty for ANY body
 *   carrying an `invented-visual-ack` comment with a real reason
 */
export function inventedVisualErrors({ body }: { body: string }): readonly string[] {
  if (acknowledgesInventedVisuals({ body })) {
    return [];
  }
  return inventedVisualsIn({ visuals: prBodyVisuals({ body }) }).map(
    (invented) =>
      `**Proof** embeds ${invented.ref}, which is not a capture of the real thing — ${invented.why}. ` +
      `${invented.real}, or add \`<!-- invented-visual-ack: <reason, ${String(ACKNOWLEDGEMENT_MIN_WORDS)}+ words> -->\` to this description.`,
  );
}

/** What a pull request's title and body carry: the refusals, and the note for any identifier NOT refused. */
export interface PrMetadataLeakResult {
  readonly errors: readonly string[];
  readonly identifierReports: readonly string[];
}

/**
 * Every leak in the PR TITLE + BODY, judged by the repository gate's own {@link isRefusedHit}. A token or key
 * in a PR description fails CI just as it would in a tracked file — the same {@link scanContent} with the
 * same private denylist, no second list — and so does a forbidden identifier wherever `IDENTIFIER_VERDICT`,
 * the one switch, reads `refuse`: the same `scanForbiddenIdentifiers` with the same committed rules. At
 * `report` those forbidden-identifier hits come back as one aggregate note instead. Empty denylist (none configured)
 * still catches credential shapes. Pure.
 *
 * Nothing matched is ever echoed. A CI log is read, copied and pasted by more people than the pull request
 * is, so printing a credential would spread the one string the gate exists to keep out, and printing a name
 * would re-publish the identifier the rule refuses. The label and line are enough to find it.
 *
 * @param title the PR title (omit when there is none — nothing to scan)
 * @param body the PR description
 * @param denylist the private denylist substrings (from `$SLOPWEAVER_HOME/hygiene-denylist.txt`)
 * @param identifierRules the forbidden-identifier rules; the committed ones unless a test injects synthetic ones
 * @param ownRepository the pull request's own `owner/repo`, which the identifier half does not count
 *   ({@link pullRequestIdentifierHits}); the credential half reads the bytes as written
 * @param installationIdentifiers the installation's own identifiers, which the identifier half forgives together with
 *   the whole own address — given only by the write door on an installation's own repository, never by CI
 *   (`../hygiene/installationIdentifiers.ts`); the credential half never reads it
 * @returns one error per refused hit (empty ⇒ clean), and at most one note for identifiers the switch reports
 */
export function scanPrMetadataLeaks({
  title,
  body,
  denylist,
  identifierRules = FORBIDDEN_IDENTIFIER_RULES,
  ownRepository,
  installationIdentifiers,
}: {
  title?: string | undefined;
  body: string;
  denylist: readonly string[];
  identifierRules?: ForbiddenIdentifierRules;
  ownRepository?: string | undefined;
  installationIdentifiers?: InstallationIdentifiers | undefined;
}): PrMetadataLeakResult {
  const parts = [...(title === undefined ? [] : [{ content: title, path: "title" }]), { content: body, path: "body" }];
  const leaks = parts.flatMap(({ content, path }) => scanContent({ content, denylist, path }));
  const rules = identifierRules;
  const identifiers = parts.flatMap(({ content, path }) =>
    pullRequestIdentifierHits({ content, identifiers: installationIdentifiers, ownRepository, path, rules }),
  );
  const errors = [
    ...leaks
      .filter((hit) => isRefusedHit({ label: hit.label }))
      .map((hit) => {
        const what = hit.label === DENYLIST_LABEL ? "a denylisted term" : `a ${hit.label} shape`;
        return `PR ${hit.path} contains ${what} at line ${String(hit.line)} — remove it (the matched text is redacted from this log).`;
      }),
    ...identifiers
      .filter((hit) => isRefusedHit({ label: hit.kind }))
      .map(
        (hit) =>
          `PR ${hit.path} contains a ${hit.kind} identifier at line ${String(hit.line)} — replace it with a synthetic stand-in (the matched text is redacted from this log).`,
      ),
  ];
  const reported = identifiers.filter((hit) => !isRefusedHit({ label: hit.kind }));
  const kinds = new Set(reported.map((hit) => hit.kind));
  const identifierReports =
    reported.length === 0
      ? []
      : [
          `PR metadata: ${String(reported.length)} forbidden identifier hit(s) across ${String(kinds.size)} kind(s) (report mode — not a failure; matched text redacted)`,
        ];
  return { errors, identifierReports };
}

/**
 * The refusals alone, for a caller that only stops a write — {@link scanPrMetadataLeaks}'s `errors`.
 *
 * @param title the PR title (omit when there is none)
 * @param body the PR description
 * @param denylist the private denylist substrings
 * @param ownRepository the `owner/repo` the pull request is written to, which the identifier half does not count
 * @param installationIdentifiers the installation's own identifiers the identifier half forgives, given only on an
 *   installation's own repository
 * @returns one error string per refused hit (empty ⇒ clean)
 */
export function prMetadataLeakErrors({
  title,
  body,
  denylist,
  ownRepository,
  installationIdentifiers,
}: {
  title?: string | undefined;
  body: string;
  denylist: readonly string[];
  ownRepository?: string | undefined;
  installationIdentifiers?: InstallationIdentifiers | undefined;
}): readonly string[] {
  return scanPrMetadataLeaks({ body, denylist, installationIdentifiers, ownRepository, title }).errors;
}
