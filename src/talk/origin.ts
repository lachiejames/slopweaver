/**
 * Where a board row CAME FROM, in the owner's own words — the pure half of `slopweaver talk origin`.
 *
 * The owner wants the voice to come prepared with the exact quotes they gave that resulted in the row in front of
 * them. A voice that reads a card and quotes the row's own question back as if it were the owner's words has to
 * admit it is not quoted as something the owner said. `board_row` returns a row's `ruling:` and its sections
 * headed with the owner's word, and most rows carry the owner's words somewhere else: an "Owner ruling" section, a
 * words line inside the body, a `transcript:` anchor naming the turn the owner typed, or nothing at all because a session
 * registered the row off something it OBSERVED.
 *
 * ## What this returns, and the one distinction it will not blur
 *
 * {@link RowOrigin.fromOwner} says which of two things the row is. A `finding` row (`origin: finding`) is
 * something the fleet noticed — the owner never asked for it, and the voice has to say exactly that rather than
 * inventing a request. Every other row is presumed the owner's, and its quotes are every passage the doc attributes to
 * the owner, verbatim, in document order; the anchors the doc names are returned too so the verb can resolve a
 * `transcript:` pointer to the turn the owner actually typed.
 *
 * Rows the "Where this came from" text names by slug are returned as {@link RowOrigin.mentions}: a finding
 * usually names the run that observed it, and that run's own row is where the owner's words are.
 */
import type { HandoverDoc } from "../handover/doc.js";

/** The most an origin read hands back, in UTF-8 bytes; the page's tool cap is 24 KiB. */
export const ORIGIN_MAX_BYTES = 16 * 1024;

/** Where one passage cuts, in characters. */
export const QUOTE_MAX_CHARS = 1500;

/** A section heading that introduces the owner's words. */
const OWNER_WORDS_HEADING = /^#{2,4} .*(his word|in his words|owner ruling|his ruling|owner turn|owner's word)/iu;

/** A section heading that says where a row came from, which on a finding is NOT the owner's words. */
const WHERE_HEADING = /^#{2,4} .*(where this came from|where it came from|origin|provenance)/iu;

/**
 * A paragraph that attributes a quotation to the owner: the marker, then within a few characters, the quote. Every
 * quantified part is disjoint from what follows it — the owner arm's gap cannot contain a quote mark, and the
 * spaces around a colon are one run each — so no input can make it backtrack.
 */
const ATTRIBUTED_QUOTE =
  /(?:(?:his words?|his ruling|he said|he typed|he asked|in his own words)\s*(?:[:,—-]\s*)?_?|owner[^\n"“]{0,40})["“]/iu;

/** A `transcript:<session>#<record>` anchor, anywhere in the text. */
const TRANSCRIPT_ANCHOR = /transcript:[0-9a-f-]{36}#[0-9a-f-]{36}/gu;

/** A board slug named in backticks. */
const BACKTICKED_SLUG = /`([a-z0-9][a-z0-9-]{8,159})`/gu;

/** The origin of one row, as the voice is handed it. */
export interface RowOrigin {
  readonly slug: string;
  readonly kind: string;
  readonly status: string;
  readonly summary: string | undefined;
  readonly statusSummary: string | undefined;
  readonly askedIso: string | undefined;
  /** False for a `finding` row — something a session observed, which the owner never asked for. */
  readonly fromOwner: boolean;
  /** For a finding, the session that registered it. */
  readonly observedBy: string | undefined;
  /** Every passage the doc attributes to the owner, verbatim, in document order. */
  readonly quotes: readonly string[];
  /** The sections that say where the row came from, whoever it came from. */
  readonly whereFrom: readonly string[];
  /** Every anchor the doc names — `anchor:`, `rulingAnchor:`, and `transcript:` pointers in the body. */
  readonly anchors: readonly string[];
  /** Other board slugs the origin passages name, for a one-hop read of where the words really are. */
  readonly mentions: readonly string[];
}

/**
 * Read one row's origin out of its parsed front matter and its text.
 *
 * @param doc the parsed front matter
 * @param text the whole file
 * @returns the origin, uncut — {@link boundOrigin} fits it to a byte budget
 */
export function rowOriginOf({ doc, text }: { doc: HandoverDoc; text: string }): RowOrigin {
  const { quotes, whereFrom } = passagesOf({ sections: bodySections({ text }) });
  if (doc.ruling !== undefined) {
    quotes.unshift(`ruling: ${doc.ruling}`);
  }
  return {
    anchors: anchorsOf({ doc, text }),
    askedIso: doc.askedIso,
    fromOwner: doc.origin !== "finding",
    kind: doc.kind,
    mentions: mentionsOf({ doc, whereFrom }),
    observedBy: doc.observedBy,
    quotes: quotes.map((quote) => cut({ text: quote })),
    slug: doc.slug,
    status: doc.status,
    statusSummary: doc.statusSummary,
    summary: doc.summary,
    whereFrom: whereFrom.map((section) => cut({ text: section })),
  };
}

/** Every passage attributed to the owner, and every section saying where the row came from, in document order. */
function passagesOf({ sections }: { sections: readonly string[] }): { quotes: string[]; whereFrom: string[] } {
  const quotes: string[] = [];
  const whereFrom: string[] = [];
  for (const section of sections) {
    if (OWNER_WORDS_HEADING.test(section)) {
      quotes.push(section);
    } else if (WHERE_HEADING.test(section)) {
      whereFrom.push(section);
    } else {
      quotes.push(
        ...section
          .split(/\n{2,}/u)
          .filter((paragraph) => ATTRIBUTED_QUOTE.test(paragraph))
          .map((paragraph) => paragraph.trim()),
      );
    }
  }
  return { quotes, whereFrom };
}

/** The front matter's anchors, then every `transcript:` pointer in the body, each once. */
function anchorsOf({ doc, text }: { doc: HandoverDoc; text: string }): readonly string[] {
  const anchors = new Set<string>();
  for (const value of [doc.anchor, doc.rulingAnchor]) {
    if (value !== undefined && value.trim() !== "") {
      anchors.add(value.trim());
    }
  }
  for (const match of text.matchAll(TRANSCRIPT_ANCHOR)) {
    anchors.add(match[0]);
  }
  return [...anchors];
}

/** Other board slugs the origin passages and the summary name in backticks. */
function mentionsOf({ doc, whereFrom }: { doc: HandoverDoc; whereFrom: readonly string[] }): readonly string[] {
  const named = [...whereFrom];
  if (doc.summary !== undefined) {
    named.push(doc.summary);
  }
  const mentions = new Set<string>();
  for (const match of named.flatMap((passage) => [...passage.matchAll(BACKTICKED_SLUG)])) {
    const slug = match[1]!;
    if (slug !== doc.slug && slug.includes("-")) {
      mentions.add(slug);
    }
  }
  return [...mentions];
}

/**
 * The transcript pointers among a row's anchors, split into the session and the record they name.
 *
 * @param anchors the row's anchors
 * @returns each `transcript:` anchor's parts, in order
 */
export function transcriptPointers({
  anchors,
}: {
  anchors: readonly string[];
}): readonly { readonly anchor: string; readonly sessionId: string; readonly recordId: string }[] {
  return anchors.flatMap((anchor) => {
    const match = /^transcript:([0-9a-f-]{36})#([0-9a-f-]{36})$/u.exec(anchor);
    if (match === null) {
      return [];
    }
    return [{ anchor, recordId: match[2]!, sessionId: match[1]! }];
  });
}

/**
 * Fit a serialisable answer to a byte budget by cutting its longest string arrays from the end, and say so.
 *
 * @param value the answer
 * @param maxBytes the ceiling
 * @param shrink one step that makes the answer smaller, or `undefined` when nothing is left to cut
 * @returns the answer, fitted, and whether anything was cut
 */
export function fitToBytes<T>({
  value,
  maxBytes,
  shrink,
}: {
  value: T;
  maxBytes: number;
  shrink: (current: T) => T | undefined;
}): { readonly value: T; readonly cut: boolean } {
  let current = value;
  let wasCut = false;
  while (Buffer.byteLength(JSON.stringify(current), "utf8") > maxBytes) {
    const smaller = shrink(current);
    if (smaller === undefined) {
      break;
    }
    current = smaller;
    wasCut = true;
  }
  return { cut: wasCut, value: current };
}

/** Cut one passage at {@link QUOTE_MAX_CHARS}, marking the cut. */
function cut({ text }: { text: string }): string {
  if (text.length <= QUOTE_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, QUOTE_MAX_CHARS)} …`;
}

/** The body after the front matter, split at each `##`–`####` heading, blank sections dropped. */
function bodySections({ text }: { text: string }): readonly string[] {
  const match = /^---\n[\s\S]*?\n---\n?/u.exec(text);
  let body = text;
  if (match !== null) {
    body = text.slice(match[0].length);
  }
  return body
    .split(/\n(?=#{2,4} )/u)
    .map((section) => section.trim())
    .filter((section) => section !== "" && !section.startsWith("# "));
}
