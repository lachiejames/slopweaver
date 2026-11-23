/**
 * The indirect-candidate scan's page — pure. Every candidate the scan reported, grouped by how it could be tied
 * back, each with `file:line`, what matched, the line around it and the replacement to propose. Nothing is
 * capped: an `aggregate` class is reported as totals per term by its own disposition, never by truncating a list.
 *
 * The page is published under the home only. It carries matched terms on purpose, because a candidate the owner
 * cannot see is one the owner cannot judge. Every term and excerpt sits in `<code>`, which the page lint never reads as
 * prose, so a control id or an incident number in a candidate is not mistaken for an unlinked identifier.
 */
import { escapeHtml } from "../atlas/kit/pageTable.js";
import { INDIRECT_CLASSES, type IndirectGroup, isIndirectClass } from "./indirectMap.js";
import type { IndirectClass, IndirectTerm } from "./indirectScan.js";

/** The page's slug under `$SLOPWEAVER_HOME/pages`. */
export const INDIRECT_SCAN_PAGE_SLUG = "indirect-reference-scan";

/** What the page reports, beside the classes. */
export interface IndirectPageFacts {
  readonly ref: string;
  readonly sha: string;
  readonly committedLabel: string;
  readonly scannedLabel: string;
  readonly filesScanned: number;
  readonly binaryFiles: number;
  readonly harvestSkipped: number;
  readonly harvestMaxFiles: number;
  readonly mapRows: number;
  readonly mapSha256: string;
}

/** Each group's heading, in the order the page shows them. */
const GROUP_HEADINGS: Readonly<Record<IndirectGroup | "harvest", string>> = {
  "business-and-geography": "Business and geography",
  "compliance-and-configuration": "Compliance and configuration",
  harvest: "Names nobody listed (dictionary harvest)",
  "narrative-and-time": "Narrative and time",
  "organisation-vocabulary": "Organisation vocabulary",
  people: "People",
  "provider-identity": "Provider identity",
};

const GROUP_ORDER: readonly (IndirectGroup | "harvest")[] = [
  "people",
  "organisation-vocabulary",
  "provider-identity",
  "compliance-and-configuration",
  "narrative-and-time",
  "business-and-geography",
  "harvest",
];

/**
 * Pure: the group a reported class belongs to.
 *
 * @param className the class, `map:<class>` or `harvest:<kind>`
 * @returns its group
 */
export function groupOf({ className }: { className: string }): IndirectGroup | "harvest" {
  const bare = className.replace(/^map:/, "");
  if (isIndirectClass(bare)) {
    return INDIRECT_CLASSES[bare];
  }
  return "harvest";
}

/**
 * Pure: one term's rows — every place, or for an aggregate class one totals row.
 *
 * @param term the term
 * @param aggregate whether its class reports totals only
 * @returns the table rows
 */
function termRows({ term, aggregate }: { term: IndirectTerm; aggregate: boolean }): string {
  const code = `<code>${escapeHtml({ value: term.term })}</code>`;
  if (aggregate) {
    const paths = [...new Set(term.places.map((place) => place.path))].toSorted();
    return (
      `<tr><td>${code}</td><td>${String(term.hits)} places in ${String(term.files)} files</td>` +
      `<td><details><summary>files</summary><code>${escapeHtml({ value: paths.join("\n") })}</code></details></td></tr>`
    );
  }
  return term.places
    .map(
      (place) =>
        `<tr><td>${code}</td><td><code>${escapeHtml({ value: `${place.path}:${String(place.line)}` })}</code></td>` +
        `<td><code>${escapeHtml({ value: place.excerpt })}</code></td></tr>`,
    )
    .join("");
}

/**
 * Pure: one class's section.
 *
 * @param entry the class
 * @returns its HTML
 */
function classSection({ entry }: { entry: IndirectClass }): string {
  const aggregate = entry.disposition === "aggregate";
  const replacement = entry.terms[0]!.places[0]!.replacement;
  const headers = aggregate ? "<th>Term</th><th>Totals</th><th>Where</th>" : "<th>Term</th><th>Place</th><th>Line</th>";
  return (
    `<details${entry.disposition === "remove" ? " open" : ""}><summary><code>${escapeHtml({ value: entry.className })}</code> · ` +
    `${entry.disposition} · ${String(entry.hits)} places in ${String(entry.files)} files · ` +
    `${String(entry.terms.length)} terms</summary>` +
    `<p>Proposed replacement: ${escapeHtml({ value: replacement })}</p>` +
    `<table><thead><tr>${headers}</tr></thead><tbody>` +
    entry.terms.map((term) => termRows({ aggregate, term })).join("") +
    "</tbody></table></details>"
  );
}

/**
 * Pure: the whole page fragment.
 *
 * @param classes the scan's classes
 * @param facts the run's provenance
 * @returns the fragment `publishPage` wraps in the document shell
 */
export function renderIndirectPage({
  classes,
  facts,
}: {
  classes: readonly IndirectClass[];
  facts: IndirectPageFacts;
}): string {
  const removeHits = classes.filter((entry) => entry.disposition === "remove").reduce((sum, e) => sum + e.hits, 0);
  const sections = GROUP_ORDER.map((group) => {
    const members = classes.filter((entry) => groupOf({ className: entry.className }) === group);
    if (members.length === 0) {
      return "";
    }
    return `<h2>${GROUP_HEADINGS[group]}</h2>${members.map((entry) => classSection({ entry })).join("")}`;
  }).join("");
  return (
    "<h1>Indirect-reference candidates</h1>" +
    `<p class="lede">${String(removeHits)} obvious candidate places remain. ` +
    `Everything below is a candidate for a person to judge, not a proven reference.</p>` +
    `<p class="meta">${escapeHtml({ value: facts.ref })} at <code>${facts.sha.slice(0, 12)}</code>, committed ` +
    `${escapeHtml({ value: facts.committedLabel })}, exported as a zip with no git and scanned ` +
    `${escapeHtml({ value: facts.scannedLabel })}: ${String(facts.filesScanned)} files ` +
    `(${String(facts.binaryFiles)} binary, read by the map only; ${String(facts.harvestSkipped)} generated, lockfile ` +
    `or cassette files the harvest does not read). Candidate map: ${String(facts.mapRows)} rows, ` +
    `<code>sha256:${facts.mapSha256.slice(0, 16)}</code>. A harvest word spanning more than ` +
    `${String(facts.harvestMaxFiles)} files is this tree's own vocabulary and is not listed.</p>` +
    sections
  );
}
