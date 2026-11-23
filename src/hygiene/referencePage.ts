/**
 * The zero-references proof page — pure. It renders one run of `audit references` as the fragment published at
 * the fixed slug {@link ZERO_REFERENCES_PAGE_SLUG}, so the page the owner opens is always the latest run's.
 *
 * The page carries NO name. It shows counts by class, the commit and the zip, and the residue list by file and
 * class; a file whose own path carries a reference is listed by its directory and class with the file name
 * withheld, so the page can be shown to anyone the zip could be.
 */
import type { ReferenceProof } from "./referenceExport.js";
import { type ReferenceResidueFile, type ReferenceSection, referenceSection } from "./referenceSummary.js";

/** The page's one slug: re-rendered on every run, never a new page per run. */
export const ZERO_REFERENCES_PAGE_SLUG = "zero-references-proof";

/** How many residue rows the page lists before it says how many more there are. */
const RESIDUE_ROWS = 300;

/** What a class name means, in a sentence, for the classes the map and the scanners are known to report. */
const CLASS_MEANING: Readonly<Record<string, string>> = {
  "gate:embedded-upper": "a name spelled inside an id",
  "gate:exact-id": "a real provider id",
  "gate:provider-location": "a real workspace host",
  "gate:substring-ci": "a name inside a word",
  "gate:substring-cs": "a name inside a word",
  "gate:team-key": "a real team key",
  "gate:word-ci": "a name as a word",
  "gate:word-cs": "a name as a word",
  "leak:client-secret": "a credential shape",
  "leak:denylist": "a private denylist word",
  "leak:github-oauth-token": "a credential shape",
  "leak:github-pat": "a credential shape",
  "leak:id-query-param": "an opaque account id in a URL",
  "leak:linear-api-key": "a credential shape",
  "leak:openai-style-key": "a credential shape",
  "leak:raw-workspace-id": "a Slack id an outsider cannot tell from a real one (a stand-in spells 0SYN)",
  "leak:slack-app-token": "a credential shape",
  "leak:slack-token": "a credential shape",
  "map:bots-and-runners": "the organisation's own bots and CI runner",
  "map:hosts": "the organisation's hosts and email domain",
  "map:org-names": "the organisation's name",
  "map:owner": "the owner's personal name and handle",
  "map:owner-employer": "the owner's handle and email at the organisation",
  "map:people": "a colleague's name or handle",
  "map:products": "the organisation's product names",
  "map:project-ids": "the organisation's cloud project ids",
  "map:repositories": "the organisation's repository paths",
  "map:self-reference": "this repository named under the organisation",
  "map:team-names": "an internal team's name",
  "map:vendor-ids": "a vendor's tenant id",
  "map:vendors": "an outside firm the organisation works with",
};

/**
 * Pure: escape text for HTML.
 *
 * @param text raw text
 * @returns the escaped text
 */
function escapeHtml({ text }: { text: string }): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * Pure: a count with thousands separators.
 *
 * @param value the count
 * @returns the formatted count
 */
function count({ value }: { value: number }): string {
  return value.toLocaleString("en-AU");
}

/**
 * Pure: how one residue row reads with no name in it.
 *
 * @param file the residue file
 * @returns its path, or its directory with the file name withheld when the path itself carries a reference
 */
function residuePath({ file }: { file: ReferenceResidueFile }): string {
  if (!file.pathCarriesReference) {
    return file.path;
  }
  return "(path withheld: it carries a reference itself)";
}

/** The page's own styles, scoped by the `zr-` prefix. */
const PAGE_STYLE = [
  `<style>`,
  `.zr-big{font-size:2.6rem;font-weight:700;margin:.2em 0}.zr-ok{color:#1a7f37}.zr-bad{color:#cf222e}`,
  `.zr-muted{color:#6e7781;font-size:.9em}.zr-table{border-collapse:collapse;margin:.8em 0}`,
  `.zr-table td,.zr-table th{border-bottom:1px solid #d0d7de;padding:.3em .7em;text-align:left;vertical-align:top}`,
  `.zr-n{text-align:right;font-variant-numeric:tabular-nums}`,
  `</style>`,
].join("\n");

/**
 * Pure: one section's per-class table, every class in it a row.
 *
 * @param summary the run's outcome
 * @param section which section's classes to list
 * @returns the table's HTML
 */
function classTable({ summary, section }: { summary: ReferenceProof["summary"]; section: ReferenceSection }): string {
  const rows = summary.classes
    .filter((row) => row.section === section)
    .map((row) => {
      const meaning = CLASS_MEANING[row.className];
      const described = meaning === undefined ? "" : ` <span class="zr-muted">${escapeHtml({ text: meaning })}</span>`;
      return (
        `<tr><td><code>${escapeHtml({ text: row.className })}</code>${described}</td>` +
        `<td class="zr-n">${count({ value: row.hits })}</td><td class="zr-n">${count({ value: row.files })}</td>` +
        `<td class="zr-n">${count({ value: row.codeFiles })}</td><td class="zr-n">${count({ value: row.docsFiles })}</td></tr>`
      );
    })
    .join("\n");
  return (
    `<table class="zr-table"><thead><tr><th>Class</th><th>Places</th><th>Files</th><th>Code files</th>` +
    `<th>Docs files</th></tr></thead><tbody>\n${rows}\n</tbody></table>`
  );
}

/** What the class prefixes mean, printed once under the acceptance table. */
const PREFIX_NOTE =
  `<p class="zr-muted">A place is one line of one file, or the file's own name. One line can count under more ` +
  `than one class. <code>map:</code> is the name map, <code>gate:</code> the hygiene gate's hashed rules, ` +
  `<code>leak:</code> its leak classes.</p>`;

/**
 * Pure: the owner's-own-name section — the owner's personal name and handle, counted beside the acceptance and never
 * failing it.
 *
 * @param summary the run's outcome
 * @returns the section's HTML
 */
function ownNameSection({ summary }: { summary: ReferenceProof["summary"] }): string {
  const { ownName } = summary;
  return (
    `<h2>The owner's own name</h2>\n` +
    `<p>${count({ value: ownName.hits })} places in ${count({ value: ownName.files })} files carry the owner's personal ` +
    `name or handle. This is not a reference to the organisation and is not part of the zero above: the repository ` +
    `lives under the owner's own account, and the owner's name leaves the code as the stateless series resolves every ` +
    `name from the installation's own store.</p>\n` +
    classTable({ section: "own-name", summary })
  );
}

/**
 * Pure: the folded residue list of files still carrying an organisation reference, by file and class, capped at
 * {@link RESIDUE_ROWS} rows; empty when the acceptance reads zero.
 *
 * @param summary the run's outcome
 * @returns the section's HTML, or the empty string
 */
function residueSection({ summary }: { summary: ReferenceProof["summary"] }): string {
  const residue = summary.residue.filter((file) =>
    file.classes.some((className) => referenceSection({ className }) === "acceptance"),
  );
  if (residue.length === 0) {
    return "";
  }
  const listed = residue.slice(0, RESIDUE_ROWS);
  const more = residue.length - listed.length;
  const rows = listed
    .map(
      (file) =>
        `<tr><td><code>${escapeHtml({ text: residuePath({ file }) })}</code></td><td>${file.area}</td>` +
        `<td>${file.classes.map((name) => `<code>${escapeHtml({ text: name })}</code>`).join(" ")}</td></tr>`,
    )
    .join("\n");
  const overflow =
    more > 0
      ? `<p class="zr-muted">and ${count({ value: more })} more: <code>slopweaver audit references --list</code></p>\n`
      : "";
  return (
    `<details><summary>What still carries a reference to the organisation, by file and class (${count({ value: residue.length })} files)</summary>\n` +
    `<table class="zr-table"><thead><tr><th>File</th><th>Area</th><th>Classes</th></tr></thead><tbody>\n` +
    `${rows}\n</tbody></table>\n${overflow}</details>`
  );
}

/**
 * Pure: the page fragment for one proof run.
 *
 * @param proof what the run exported and found
 * @param scannedLabel when the scan ran, already formatted for a person to read
 * @param committedLabel when the exported commit was made, already formatted for a person to read
 * @returns the fragment to publish at {@link ZERO_REFERENCES_PAGE_SLUG}
 */
export function renderReferencePage({
  proof,
  scannedLabel,
  committedLabel,
}: {
  proof: ReferenceProof;
  scannedLabel: string;
  committedLabel: string;
}): string {
  const { summary } = proof;
  const { acceptance } = summary;
  const clean = acceptance.hits === 0;
  const headline = clean
    ? `<p class="zr-big zr-ok">0 references to the organisation</p>`
    : `<p class="zr-big zr-bad">${count({ value: acceptance.hits })} references to the organisation in ${count({ value: acceptance.files })} files</p>`;
  const verdict = clean
    ? "Nothing in the zip names the organisation, its people, its hosts, its products or the owner's handle there."
    : `Code: ${count({ value: acceptance.codeFiles })} files still carry one. Docs: ${count({ value: acceptance.docsFiles })} files.`;
  const zipMb = (proof.zipBytes / (1024 * 1024)).toFixed(1);
  return [
    PAGE_STYLE,
    `<h1>Zero references: the repository as a zip, with no git</h1>`,
    headline,
    `<p>${verdict}</p>`,
    `<p>The main branch at <code>${proof.sha.slice(0, 12)}</code> (committed ${escapeHtml({ text: committedLabel })}) was exported as a ` +
      `zip with no <code>.git</code>, no history and no pull requests: ${count({ value: summary.filesScanned })} files, ${zipMb} MB. ` +
      `Every file and every file name in it was scanned on ${escapeHtml({ text: scannedLabel })}.</p>`,
    classTable({ section: "acceptance", summary }),
    PREFIX_NOTE,
    residueSection({ summary }),
    ownNameSection({ summary }),
    `<h2>What this proves, and what it does not</h2>`,
    `<p>Each file is checked three ways: the hygiene gate's own rules, which hold the names as hashes; its leak ` +
      `classes (real workspace ids, home paths, credentials); and a name map kept off the repository, one row per ` +
      `name, host, product, project and person the organisation has. A zero means none of those appear anywhere in ` +
      `the zip. A name that is in none of the three would not be counted, so the map is what to grow when one is found.</p>`,
    `<p class="zr-muted">Re-run: <code>slopweaver audit references</code>. The zip itself: <code>$SLOPWEAVER_HOME/proof/zero-references/` +
      `slopweaver-${proof.sha.slice(0, 12)}.zip</code> (its absolute path is not printed here, because a home ` +
      `directory names a person).</p>`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
