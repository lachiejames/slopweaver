/**
 * Parsing ONE memory file: its frontmatter, and the graph edges in its body. Pure — the caller supplies text.
 *
 * ## Why a real YAML parser
 *
 * `metadata.type` is nested, and a hand-rolled reader cannot see a duplicate `description:` key (YAML's
 * last-one-wins would hide the first), a `name:` that is accidentally a number, or a value that is a list. The
 * repo already documents why last-wins hand parsing is unsafe. `yaml` was already in the lockfile
 * transitively, so making it direct adds no package to the tree.
 *
 * Field validation is hand-written type guards rather than Zod, deliberately: the parser has already done the
 * hard part, only the small declared field set is read, and the object is never re-emitted — so unknown keys are simply
 * ignored rather than needing a passthrough schema. That matters because Claude Code stamps
 * `metadata.node_type`, `metadata.originSessionId` and `metadata.modified` of its own accord, and a schema that
 * rejected unknown keys would reject the tool's own output.
 *
 * ## Why non-content is masked before extracting edges
 *
 * A fenced code block showing `[old](deleted.md)` is documentation, not a routing pointer, and a commented-out
 * pointer must not make an orphan look routed. Both regions are blanked LINE BY LINE rather than deleted, so
 * reported line numbers still match the file the reader opens.
 */
import { parseDocument } from "yaml";

import { isOneOf, isRecord } from "../lib/parsers.js";
import {
  amendsCanonFindings,
  correctionSubjectFindings,
  overlapsFindings,
  readAmendsCanon,
  readCorrectionSubject,
  readOverlaps,
} from "./slopweaverMetadata.js";
import {
  MEMORY_TYPES,
  type MemoryAmendsCanon,
  type MemoryCorrectionSubject,
  type MemoryFinding,
  type MemoryOverlap,
  type MemoryPointer,
  type MemoryType,
  type MemoryWikilink,
} from "./types.js";

/** A markdown inline-link destination, with an optional quoted title. */
const LINK = /\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** A `[[wikilink]]`. Newlines excluded so an unclosed `[[` cannot swallow the rest of the file. */
const WIKILINK = /\[\[([^\][\n]+)\]\]/g;

/**
 * Line endings, normalised before anything is parsed.
 *
 * A CRLF file used to survive the fence match (which trims) and then fail on VALUES: reconstructing the
 * frontmatter left a trailing `\r` on its last line, so `metadata.type` parsed as `"reference\r"` and was
 * reported as an unknown kind. Normalising once, here, keeps every rule downstream ignorant of line-ending
 * style. Line COUNT is unchanged, so reported line numbers stay true.
 */
function normalised({ text }: { text: string }): string {
  return text
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
}

/** A fence opener/closer: three or more backticks or tildes. */
const FENCE = /^\s{0,3}(?:`{3,}|~{3,})/;

/**
 * The parsed result of one file's frontmatter.
 *
 * The three fields beyond `declaredName` are read for the SWEEP, and they are read here rather than by a second
 * reader on purpose: two parsers over one corpus would eventually disagree about which files are memories and
 * what they say, and that disagreement is precisely what makes a triage view untrustworthy.
 */
export interface MemoryFrontmatter {
  readonly declaredName: string | null;
  readonly description: string | null;
  readonly declaredType: MemoryType | null;
  readonly declaredModified: string | null;
  readonly ownerDirective: boolean | null;
  readonly correctionSubject: MemoryCorrectionSubject | null;
  readonly overlaps: readonly MemoryOverlap[];
  readonly amendsCanon: MemoryAmendsCanon | null;
  readonly findings: readonly MemoryFinding[];
}

/** Frontmatter with nothing usable in it — the shape every early return below starts from. */
const NO_FIELDS = {
  amendsCanon: null,
  correctionSubject: null,
  declaredModified: null,
  declaredName: null,
  declaredType: null,
  description: null,
  overlaps: [],
  ownerDirective: null,
} as const;

/**
 * Blank out fenced code blocks and HTML comments, preserving line count so line numbers stay true.
 *
 * @param text the whole file
 * @returns the same number of lines, with non-content lines emptied
 */
export function maskNonContent({ text }: { text: string }): string {
  let inFence = false;
  let inComment = false;
  return normalised({ text })
    .split("\n")
    .map((line) => {
      const opensComment = line.includes("<!--") && !line.includes("-->");
      if (inComment) {
        inComment = !line.includes("-->");
        return "";
      }
      if (FENCE.test(line)) {
        inFence = !inFence;
        return "";
      }
      if (inFence) {
        return "";
      }
      if (opensComment) {
        inComment = true;
        return "";
      }
      // A comment opened and closed on one line: drop only the commented span.
      return line.replaceAll(/<!--.*?-->/g, "");
    })
    .join("\n");
}

/**
 * Split a file at its leading frontmatter fence. Tolerates a UTF-8 BOM and CRLF line endings, both of which
 * would otherwise defeat a naive `--- ` envelope match and report every file as having no frontmatter.
 *
 * `body` is returned alongside `bodyOffset` so a caller that wants the prose does not re-derive it: the BOM
 * and CRLF normalisation above is exactly what a second reader would get subtly wrong, and a caller cannot
 * reach it because it is private to this module.
 *
 * @param text the whole file
 * @returns the frontmatter source (fences excluded), the line the body starts at, and the body itself;
 *   `frontmatter` is `null` when there is none, and `body` is then the whole normalised file
 */
export function splitFrontmatter({ text }: { text: string }): {
  readonly frontmatter: string | null;
  readonly bodyOffset: number;
  readonly body: string;
} {
  const lines = normalised({ text }).split("\n");
  if (lines[0] !== "---") {
    return { body: lines.join("\n"), bodyOffset: 0, frontmatter: null };
  }
  const close = lines.findIndex((line, index) => index > 0 && line === "---");
  if (close === -1) {
    return { body: lines.join("\n"), bodyOffset: 0, frontmatter: null };
  }
  return {
    body: lines.slice(close + 1).join("\n"),
    bodyOffset: close + 1,
    frontmatter: lines.slice(1, close).join("\n"),
  };
}

/** A finding about the file as a whole (no single line is at fault). */
function schemaFinding({ file, message }: { file: string; message: string }): MemoryFinding {
  return { check: "schema", file, line: null, message };
}

/** Read a required string field, returning it or the reason it is unusable. */
function requiredString({ value, key }: { value: unknown; key: string }): { ok: string } | { bad: string } {
  if (value === undefined || value === null) {
    return { bad: `frontmatter is missing \`${key}\`` };
  }
  if (typeof value !== "string") {
    return { bad: `frontmatter \`${key}\` must be a string` };
  }
  return value.trim() === "" ? { bad: `frontmatter \`${key}\` is empty` } : { ok: value.trim() };
}

/** Validate `metadata`, including Slopweaver's namespaced explicit owner-directive opt-in. */
function metadataFindings({ file, metadata }: { file: string; metadata: unknown }): readonly MemoryFinding[] {
  if (metadata === undefined) {
    return [];
  }
  if (!isRecord(metadata)) {
    return [schemaFinding({ file, message: "frontmatter `metadata` must be a mapping" })];
  }
  const findings: MemoryFinding[] = [];
  const declared = metadata["type"];
  if (declared !== undefined && (typeof declared !== "string" || !isOneOf(declared, MEMORY_TYPES))) {
    findings.push(
      schemaFinding({
        file,
        message: `frontmatter \`metadata.type\` is not one of ${MEMORY_TYPES.join(", ")}`,
      }),
    );
  }
  const slopweaver = metadata["slopweaver"];
  if (slopweaver === undefined) {
    return findings;
  }
  if (!isRecord(slopweaver)) {
    findings.push(schemaFinding({ file, message: "frontmatter `metadata.slopweaver` must be a mapping" }));
    return findings;
  }
  const ownerDirective = slopweaver["ownerDirective"];
  if (ownerDirective !== undefined && typeof ownerDirective !== "boolean") {
    findings.push(
      schemaFinding({ file, message: "frontmatter `metadata.slopweaver.ownerDirective` must be a boolean" }),
    );
  }
  findings.push(...correctionSubjectFindings({ file, value: slopweaver["correctionSubject"] }));
  findings.push(...overlapsFindings({ file, value: slopweaver["overlaps"] }));
  findings.push(...amendsCanonFindings({ file, value: slopweaver["amendsCanon"] }));
  return findings;
}

/**
 * The two `metadata` fields the sweep presents. Read separately from {@link metadataFindings} because they are
 * not validation: a `metadata.modified` that is not a legible timestamp is NOT a schema defect (Claude Code
 * stamps the field itself, and this checker must not fail the tool's own output), so it is carried out
 * verbatim and the sweep decides whether it can read it.
 */
function metadataFields({ metadata }: { metadata: unknown }): {
  readonly declaredType: MemoryType | null;
  readonly declaredModified: string | null;
  readonly ownerDirective: boolean | null;
  readonly correctionSubject: MemoryCorrectionSubject | null;
  readonly overlaps: readonly MemoryOverlap[];
  readonly amendsCanon: MemoryAmendsCanon | null;
} {
  if (!isRecord(metadata)) {
    return {
      amendsCanon: null,
      correctionSubject: null,
      declaredModified: null,
      declaredType: null,
      overlaps: [],
      ownerDirective: null,
    };
  }
  const declared = metadata["type"];
  const modified = metadata["modified"];
  const slopweaver = metadata["slopweaver"];
  return {
    amendsCanon: isRecord(slopweaver) ? readAmendsCanon({ value: slopweaver["amendsCanon"] }) : null,
    correctionSubject: isRecord(slopweaver) ? readCorrectionSubject({ value: slopweaver["correctionSubject"] }) : null,
    declaredModified: typeof modified === "string" && modified.trim() !== "" ? modified.trim() : null,
    declaredType: typeof declared === "string" && isOneOf(declared, MEMORY_TYPES) ? declared : null,
    overlaps: isRecord(slopweaver) ? readOverlaps({ value: slopweaver["overlaps"] }) : [],
    ownerDirective:
      isRecord(slopweaver) && typeof slopweaver["ownerDirective"] === "boolean" ? slopweaver["ownerDirective"] : null,
  };
}

/**
 * Parse and validate a leaf's frontmatter.
 *
 * @param file the leaf's basename, used in every finding
 * @param text the whole file
 * @returns the usable declared fields and owner-directive opt-in, plus every schema finding
 */
export function parseFrontmatter({ file, text }: { file: string; text: string }): MemoryFrontmatter {
  const { frontmatter } = splitFrontmatter({ text });
  if (frontmatter === null) {
    return { ...NO_FIELDS, findings: [schemaFinding({ file, message: "frontmatter is missing or never closed" })] };
  }
  // `parseDocument` RECORDS problems rather than throwing, so an unchecked `doc.errors` would let a duplicate
  // key through as valid — the one failure a hand parser also misses, which is why the dependency is here.
  const doc = parseDocument(frontmatter, { logLevel: "silent", strict: true, uniqueKeys: true, version: "1.2" });
  if (doc.errors.length > 0) {
    return {
      ...NO_FIELDS,
      findings: [
        schemaFinding({ file, message: `frontmatter is not valid YAML: ${doc.errors[0]!.message.split("\n")[0]!}` }),
      ],
    };
  }
  const parsed: unknown = doc.toJS();
  if (!isRecord(parsed)) {
    return { ...NO_FIELDS, findings: [schemaFinding({ file, message: "frontmatter is not a mapping" })] };
  }
  const findings: MemoryFinding[] = [];
  const name = requiredString({ key: "name", value: parsed["name"] });
  if ("bad" in name) {
    findings.push(schemaFinding({ file, message: name.bad }));
  }
  const description = requiredString({ key: "description", value: parsed["description"] });
  if ("bad" in description) {
    findings.push(schemaFinding({ file, message: description.bad }));
  }
  if (parsed["type"] !== undefined) {
    findings.push(
      schemaFinding({ file, message: "frontmatter declares a top-level `type:` — it belongs under `metadata:`" }),
    );
  }
  for (const finding of metadataFindings({ file, metadata: parsed["metadata"] })) {
    findings.push(finding);
  }
  return {
    ...metadataFields({ metadata: parsed["metadata"] }),
    declaredName: "ok" in name ? name.ok : null,
    description: "ok" in description ? description.ok : null,
    findings,
  };
}

/**
 * Normalise a link destination to the corpus filename it addresses, or `null` when it does not address one.
 *
 * @param raw the destination exactly as written
 * @returns the same-directory stem plus whether the destination escapes the corpus directory
 */
export function classifyDestination({
  raw,
}: {
  raw: string;
}): { readonly target: string; readonly outside: boolean } | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.includes("?")) {
    return null; // a URL, a scheme or a query — not a file in this corpus, so this checker says nothing about it
  }
  const withoutFragment = raw.split("#")[0]!;
  if (!withoutFragment.endsWith(".md")) {
    return null;
  }
  const decoded = decodePointer({ raw: withoutFragment }).replace(/^\.\//, "");
  const outside = decoded.startsWith("/") || decoded.includes("/");
  return { outside, target: outside ? decoded : decoded.replace(/\.md$/, "") };
}

/** Percent-decode a destination, falling back to the raw form when the escape sequence is malformed. */
function decodePointer({ raw }: { raw: string }): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The text an index line says about the link ending at `from`: up to the next `[`, separator stripped. */
function hookAfter({ line, from }: { line: string; from: number }): string {
  const next = line.indexOf("[", from);
  const end = next === -1 ? line.length : next;
  return line
    .slice(from, end)
    .replace(/^[\s—–:-]+/, "")
    .trimEnd();
}

/**
 * Every markdown pointer in an index.
 *
 * @param text the index file
 * @param resolvesOutside answers "does this path exist?" for a destination outside the corpus directory —
 *   injected so this stays pure, the same shape `checkHandoverDoc` uses for the same reason
 * @returns the pointers, in document order
 */
export function extractPointers({
  text,
  resolvesOutside,
}: {
  text: string;
  resolvesOutside: (args: { target: string }) => boolean;
}): readonly MemoryPointer[] {
  const pointers: MemoryPointer[] = [];
  maskNonContent({ text })
    .split("\n")
    .forEach((line, index) => {
      for (const match of line.matchAll(LINK)) {
        const raw = match[1]!;
        const classified = classifyDestination({ raw });
        if (classified !== null) {
          pointers.push({
            hook: hookAfter({ from: match.index + match[0].length, line }),
            line: index + 1,
            outside: classified.outside,
            raw,
            // Same-directory pointers are answered by the corpus itself, so only an outside one is resolved here.
            resolves: classified.outside ? resolvesOutside({ target: classified.target }) : true,
            target: classified.target,
          });
        }
      }
    });
  return pointers;
}

/**
 * Every wikilink in a body, after the frontmatter and non-content regions.
 *
 * A trailing `.md` is stripped so `[[thing.md]]` and `[[thing]]` are the same reference, but nothing else is
 * folded: `_` and `-` are BOTH valid characters in a Claude Code memory slug and two names differing only by
 * separator are two different memories, so treating them as aliases would invent a collision that is not there.
 *
 * @param text the whole leaf file
 * @returns the wikilink occurrences, in document order
 */
export function extractWikilinks({ text }: { text: string }): readonly MemoryWikilink[] {
  const { bodyOffset } = splitFrontmatter({ text });
  const links: MemoryWikilink[] = [];
  maskNonContent({ text })
    .split("\n")
    .slice(bodyOffset)
    .forEach((line, index) => {
      for (const match of line.matchAll(WIKILINK)) {
        links.push({ line: bodyOffset + index + 1, target: match[1]!.trim().replace(/\.md$/, "") });
      }
    });
  return links;
}
