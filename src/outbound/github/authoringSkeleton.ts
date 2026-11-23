/**
 * The authoring file's section SKELETON: which `## ` headers it recognises, the one order they may appear in,
 * which are required, and the cut of a markdown body into one raw string per section.
 *
 * Split out of `./authoringFile.ts`, which keeps the frontmatter and the assembly of a draft; each section's own
 * grammar lives in `./authoringGrammar.ts`. Like the rest of the format it DECLINES what it does not recognise — an
 * unknown, repeated or out-of-order header, text before the first header, a missing required section — rather than
 * guessing.
 */

/** The section headers this format recognises, in the one order they may appear, which is the description's. */
const SECTION_HEADERS: readonly string[] = [
  "Explainer",
  "Proof of the problem",
  "Proof of the solution",
  "Checks",
  "Not checked, and why",
  "Re-run",
];

/** The sections every file carries; the rest are optional and absent when the form has none. */
const REQUIRED_SECTIONS: readonly string[] = ["Explainer", "Proof of the problem", "Proof of the solution"];

/** The sections, in order, as a decline names them. */
const SECTION_LIST = SECTION_HEADERS.map((h) => `## ${h}`).join(", ");

/** One `## Header` line's name and where its header and its content start. */
type SectionStart = { readonly name: string; readonly contentAt: number; readonly headerAt: number };

/** Why a header may not stand where it does — unknown, repeated, or before one it should follow — or its order. */
function headerOrder({
  start,
  seen,
  lastOrder,
}: {
  start: SectionStart;
  seen: ReadonlyMap<string, string>;
  lastOrder: number;
}): { readonly order: number } | { readonly error: string } {
  const order = SECTION_HEADERS.indexOf(start.name);
  if (order < 0) {
    return { error: `unknown section "## ${start.name}" — this format's sections are: ${SECTION_LIST}` };
  }
  if (seen.has(start.name)) {
    return { error: `"## ${start.name}" appears more than once — a section may only be given once` };
  }
  if (order < lastOrder) {
    return { error: `"## ${start.name}" is out of order — the sections go: ${SECTION_LIST}` };
  }
  return { order };
}

/** Every `## ` header line in the body, in order. */
function sectionStarts({ body }: { body: string }): readonly SectionStart[] {
  return [...body.matchAll(/^## (.+)$/gm)].map((match) => ({
    contentAt: match.index + match[0].length,
    headerAt: match.index,
    name: match[1]!.trim(),
  }));
}

/**
 * Each `## Header` section's raw body, cut on the header lines, in the one order the format allows.
 *
 * Only the section's edge NEWLINES are stripped, never its spaces, so a cell's own edge whitespace survives a
 * pull and a push.
 *
 * @param body the markdown after the frontmatter
 * @returns each present section's raw text by header name, or a decline naming the first header that cannot
 *   stand where it does, or every missing required section
 */
export function splitSections({ body }: { body: string }): ReadonlyMap<string, string> | { readonly error: string } {
  const starts = sectionStarts({ body });
  const firstAt = starts.length > 0 ? starts[0]!.headerAt : 0;
  if (body.slice(0, firstAt).trim().length > 0) {
    return { error: "there is text before the first `## ` section header — every section must be under one" };
  }
  const sections = new Map<string, string>();
  let lastOrder = -1;
  for (const [index, start] of starts.entries()) {
    const placed = headerOrder({ lastOrder, seen: sections, start });
    if ("error" in placed) {
      return placed;
    }
    lastOrder = placed.order;
    const end = index + 1 < starts.length ? starts[index + 1]!.headerAt : body.length;
    sections.set(start.name, body.slice(start.contentAt, end).replace(/^\n+/, "").replace(/\n+$/, ""));
  }
  const missing = REQUIRED_SECTIONS.filter((name) => !sections.has(name));
  if (missing.length > 0) {
    return { error: `missing required section(s): ${missing.map((name) => `## ${name}`).join(", ")}` };
  }
  return sections;
}
