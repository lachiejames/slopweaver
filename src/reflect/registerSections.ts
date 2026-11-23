/**
 * Which section of the recurring-failure register a line sits in — the heading walk `./registerDoc.ts` reads
 * every page with, and the one place a heading is mapped to a section.
 *
 * A section is not "until the next `##`". The register is a parent page and child pages, and a child's first
 * heading is its `#` title with the headings under it risen one level, so a recognised heading opens its
 * section at its own depth and an unrecognised one ends it only at that depth or shallower. On a single page
 * that is exactly the rule the register always had — `## Two seed candidates` ends a `##` section and
 * `### Medium build cost` never did — and on a child it keeps `# Survivors` open across its own
 * `## Medium build cost`. `./registerPages.ts` asks the same {@link sectionOf} whether a child opens the
 * section it is listed as opening, so the walk and that check cannot disagree about a heading.
 *
 * Pure: text in, data out.
 */

/**
 * Which section of the register a class was found under.
 *
 * `survivors`, `gated` and `ownerRuled` are the LIVE half — a class there is a real, standing failure class
 * and owes a bindings row. The rest are classified so a reader of one class can tell which, and so a
 * fixture naming a refuted class is a different, louder finding than one naming nothing at all.
 */
export type RegisterSection = "survivors" | "gated" | "ownerRuled" | "refuted" | "filed" | "bindings";

/** The register's own heading words for the classes an adversarial pass killed. */
const REFUTED_HEADING = "Refuted";

/** The register's own heading words for the declared-link table. */
const BINDINGS_HEADING = "Bindings";

/** The marker of a heading that can open a section: a page title, or a section under the parent's title. */
const SECTION_MARKER = /^#{1,2} /;

/** Any ATX heading marker, captured so its depth can be read. */
const HEADING_MARKER = /^(#{1,6}) /;

/** A run of three or more backticks or tildes that may open or close a fenced code block. */
const FENCE_MARKER = /^ {0,3}(`{3,}|~{3,})/;

/** An open fenced code block: the character its fence is made of, and how long that fence is. */
interface Fence {
  readonly char: string;
  readonly length: number;
}

/**
 * The fence after one line, or `"content"` when the line neither opens nor closes one.
 *
 * CommonMark's rule, so a fence cannot be closed early: a closing fence is the opening one's character, at
 * least as long, with nothing after it but spaces or tabs and the carriage return a CRLF line keeps (a no-break space is not blank to CommonMark); and a backtick fence's info string holds no backtick.
 *
 * @param raw the whole line
 * @param open the fence open before it, if any
 * @returns the fence open after it, `undefined` when the line closed it, or `"content"`
 */
function fenceAfter({ raw, open }: { raw: string; open: Fence | undefined }): Fence | undefined | "content" {
  const marker = FENCE_MARKER.exec(raw);
  if (marker === null) {
    return "content";
  }
  const run = marker[1]!;
  const rest = raw.slice(marker[0].length);
  if (open === undefined) {
    const backtickInInfo = run.startsWith("`") && rest.includes("`");
    return backtickInInfo ? "content" : { char: run[0]!, length: run.length };
  }
  const closes = run[0] === open.char && run.length >= open.length && /^[ \t]*\r?$/.test(rest);
  return closes ? undefined : "content";
}

/**
 * Map a `#` or `##` heading to the section it opens, or `undefined` for a heading this parser does not classify.
 *
 * Matched on the heading's opening words rather than on the whole line, because every one of them carries a
 * trailing count or gloss that a rename would otherwise have to keep byte-exact — and on WHOLE words, so
 * `# Gatedness` opens nothing rather than Gated. A `#` heading counts as
 * well as a `##`, because a section that is a child page is that page's `#` title.
 *
 * @param heading the whole heading line
 * @returns the section, or `undefined` when the heading opens none
 */
export function sectionOf({ heading }: { heading: string }): RegisterSection | undefined {
  if (!SECTION_MARKER.test(heading)) {
    return undefined;
  }
  const title = heading.replace(SECTION_MARKER, "");
  if (opensWith({ title, words: "Survivors" })) {
    return "survivors";
  }
  if (opensWith({ title, words: "Gated" })) {
    return "gated";
  }
  if (opensWith({ title, words: "Owner-ruled additions" })) {
    return "ownerRuled";
  }
  if (opensWith({ title, words: REFUTED_HEADING })) {
    return "refuted";
  }
  if (opensWith({ title, words: "Filed separately" })) {
    return "filed";
  }
  if (opensWith({ title, words: BINDINGS_HEADING })) {
    return "bindings";
  }
  return undefined;
}

/**
 * Whether a title opens with these words as whole words: followed by nothing, or by anything but a letter,
 * mark, digit or underscore in any script.
 *
 * @param title the heading with its marker stripped
 * @param words the section's opening words
 * @returns true when the title opens with them and the next character does not continue a word
 */
function opensWith({ title, words }: { title: string; words: string }): boolean {
  return title.startsWith(words) && !/^[\p{L}\p{M}\p{N}_]/u.test(title.slice(words.length));
}

/** Where the walk is: the section a heading opened, that heading's depth, and the code fence open, if any. */
export interface WalkState {
  readonly section: RegisterSection | undefined;
  readonly depth: number;
  readonly fence: Fence | undefined;
}

/** Where every page's walk starts: in no section, outside any fence. */
export const WALK_START: WalkState = { depth: 0, fence: undefined, section: undefined };

/**
 * The walk's state after one line, or `undefined` when the line does not move it and is read as content.
 *
 * A recognised heading opens its section at its own depth — unless that section is already open at a shallower
 * one, where it is a subheading of it, so `## Survivors by cost` under `# Survivors` leaves the section at `#`
 * and a sibling `## Medium build cost` inside it. An unrecognised one ends the open section only at
 * that depth or shallower. A DEEPER unrecognised heading is read as content, exactly as a `###` line always
 * was, so a class declared as its own subheading still reaches the parser's unread-class guard. A line that
 * opens or closes a fence is not content, and neither is any line inside one: it is code, so no heading or row
 * there is read.
 *
 * @param raw the whole line
 * @param state where the walk was before it
 * @returns the new state, or `undefined` when the line is content
 */
export function afterHeading({ raw, state }: { raw: string; state: WalkState }): WalkState | undefined {
  const fence = fenceAfter({ open: state.fence, raw });
  if (fence !== "content") {
    return { ...state, fence };
  }
  if (state.fence !== undefined) {
    return state;
  }
  const marker = HEADING_MARKER.exec(raw);
  if (marker === null) {
    return undefined;
  }
  const depth = marker[1]!.length;
  const opened = sectionOf({ heading: raw });
  if (opened !== undefined) {
    const nestedInItself = opened === state.section && depth > state.depth;
    return nestedInItself ? state : { depth, fence: undefined, section: opened };
  }
  if (state.section === undefined || depth > state.depth) {
    return undefined;
  }
  return { depth, fence: undefined, section: undefined };
}

/**
 * Every heading line on a page outside a code fence, in order — the first says which section the page opens —
 * and whether a fence is still open at the end, which would have swallowed every line after it.
 *
 * @param text one page
 * @returns the heading lines, and whether the page ends inside a fence
 */
export function headingsOutsideFences({ text }: { text: string }): {
  readonly headings: readonly string[];
  readonly unclosed: boolean;
} {
  const headings: string[] = [];
  let open: Fence | undefined;
  for (const raw of text.split("\n")) {
    const fence = fenceAfter({ open, raw });
    if (fence !== "content") {
      open = fence;
    } else if (open === undefined && HEADING_MARKER.test(raw)) {
      headings.push(raw);
    }
  }
  return { headings, unclosed: open !== undefined };
}
