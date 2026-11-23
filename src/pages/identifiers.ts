/**
 * EVERY IDENTIFIER ON A PAGE THE OWNER READS IS A HYPERLINK, and no raw machine id shows at all — the Slack door's
 * bare-reference rule, carried onto the authored page `page publish` writes.
 *
 * A control id written on a page needs to be clearly a control, one that can be linked to, and the mechanical
 * enforcement on Slack messages helps here too, because otherwise an identifier is hyperlinked sometimes and not
 * others. MEASURED on one evidence page: every control id sat as plain text while a Linear key and a pull request
 * number on the same page were links.
 *
 * ## Mirroring the door, not inventing a second one
 *
 * The Slack door (`../outbound/linkify/bareRefs.ts`) LINKS what it can resolve and REFUSES the residue. This does the
 * same over HTML: {@link linkPageIdentifiers} wraps every reference the context resolves in an anchor — the words
 * verbatim, only the anchor added — and {@link identifierFindings} names what is left. Candidacy and resolution are
 * that module's, unchanged: a control id is a candidate only when the install's atlas holds it, a Linear key only
 * when its prefix is a known team key, a bare `#<n>` resolves only against the ONE repository the page's own GitHub
 * links name ({@link pageIdentifierContext}). Two classes the door has no resolver for are refused here by shape:
 * an incident reference and a URL sitting in prose — a Slack permalink most often.
 *
 * ## What is prose
 *
 * Text outside every tag and comment. A `<script>` or `<style>` body is never text. An `<a>` is already a link, and a
 * `<code>`, `<pre>`, `<kbd>` or `<samp>` holds its contents as the SUBJECT — the same exemption the door gives a code
 * span and `./lint.ts` gives a raw timestamp. A `<title>` or `<textarea>` cannot hold a link, so nothing is linked or
 * refused for a reference inside one. HTML entities are masked to spaces before scanning, because the door's bare
 * `#<n>` arm reads a numeric character reference as a number.
 *
 * A raw machine id (`./machineIds.ts`) is scanned over MORE of the page: link text and a title are text the owner reads, so
 * an id there is refused too; only an attribute — an `href`, a `title=` hover — may carry one.
 */
import { bareRefContextOfPage } from "../briefing/bareRef.js";
import { escapeAttribute } from "../outbound/briefing/escape.js";
import {
  type BareRefContext,
  type BareRefSpan,
  bareRefRefusalMessage,
  resolveBareRef,
  scanBareRefs,
} from "../outbound/linkify/bareRefs.js";
import { machineIdsIn } from "./machineIds.js";

/** A reference sitting in the page's prose as plain text rather than a link. */
export interface UnlinkedIdentifierFinding {
  readonly code: "UNLINKED_IDENTIFIER";
  readonly message: string;
  readonly identifier: string;
}

/** A URL sitting in the page's prose as text a reader has to select and copy. */
export interface UnlinkedUrlFinding {
  readonly code: "UNLINKED_URL";
  readonly message: string;
  readonly url: string;
}

/** A session, call, talk, turn or run id in text the reader sees. */
export interface RawMachineIdFinding {
  readonly code: "RAW_MACHINE_ID";
  readonly message: string;
  readonly id: string;
}

/** One reason a page's identifiers are not fit to publish. */
export type PageIdentifierFinding = UnlinkedIdentifierFinding | UnlinkedUrlFinding | RawMachineIdFinding;

/** The one place an identifier finding's words are written. */
export const PageIdentifierFindings = {
  rawMachineId: ({ id }: { id: string }): RawMachineIdFinding => ({
    code: "RAW_MACHINE_ID",
    id,
    message: `"${id}" is a machine id in text the owner reads — name it by what it was doing (the run's title, "the supervisor chair while it ran"), and put the id behind a link or a title= hover at most`,
  }),
  unlinkedIdentifier: ({ identifier, reason }: { identifier: string; reason: string }): UnlinkedIdentifierFinding => ({
    code: "UNLINKED_IDENTIFIER",
    identifier,
    message: `${reason} On a page, wrap it as <a href="…">${identifier}</a>.`,
  }),
  unlinkedIncident: ({ identifier }: { identifier: string }): UnlinkedIdentifierFinding => ({
    code: "UNLINKED_IDENTIFIER",
    identifier,
    message: `"${identifier}" is an incident written as plain text — wrap it as <a href="https://app.incident.io/<org>/incidents/<n>">${identifier}</a>`,
  }),
  unlinkedUrl: ({ url }: { url: string }): UnlinkedUrlFinding => ({
    code: "UNLINKED_URL",
    message: `${url} sits in the text as plain characters, so reading it costs the owner a select, a copy and a new tab — wrap it in an <a> whose text says what it is`,
    url,
  }),
} as const;

/** One reference {@link linkPageIdentifiers} wrapped in an anchor. */
export interface LinkedIdentifier {
  readonly raw: string;
  readonly url: string;
}

/** A run of the fragment: markup passed through untouched, or text with the elements it sits inside. */
interface Segment {
  readonly kind: "markup" | "text";
  readonly text: string;
  /** The tracked elements open around this text — empty for markup. */
  readonly inside: ReadonlySet<string>;
}

/** The elements whose contents are never a bare reference to link or refuse: a link already, or the subject. */
const NO_LINKING = new Set(["a", "button", "code", "kbd", "pre", "samp", "textarea", "title"]);

/** The elements whose contents are not prose a machine id could hide in — the subject, quoted as code. */
const NOT_READ = new Set(["code", "kbd", "pre", "samp"]);

/**
 * One token of HTML: a comment (1), a raw-text element whole (2, its name 3), a tag (4, its slash 5, its name 6), or
 * text (7) — a `<` that opens nothing is text on its own. A `>` inside a quoted attribute value never ends a tag.
 */
const TOKEN =
  /(<!--[\s\S]*?(?:-->|$))|(<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\3\s*>|$))|(<(\/?)([A-Za-z][A-Za-z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>)|([^<]+|<)/gi;

/** An HTML entity, named or numeric. */
const ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;

/** A URL loose in prose, up to but not including the punctuation a sentence supplies (`../outbound/briefing/linkify.ts`). */
const BARE_URL = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}]/g;

/** An incident.io reference — `INC-98` — which the door has no resolver for. */
const INCIDENT_REF = /\bINC-\d{1,6}\b/g;

/**
 * The fragment as markup and text runs, each text run carrying the tracked elements open around it.
 *
 * @returns the segments in document order; joined, they are the fragment byte for byte
 */
function segmentsOf({ fragment }: { fragment: string }): readonly Segment[] {
  const open = new Map<string, number>();
  const segments: Segment[] = [];
  for (const match of fragment.matchAll(TOKEN)) {
    const [whole, , , , tag, slash, rawName, text] = match;
    if (text !== undefined) {
      const inside = new Set([...open].filter(([, count]) => count > 0).map(([name]) => name));
      segments.push({ inside, kind: "text", text });
      continue;
    }
    segments.push({ inside: new Set(), kind: "markup", text: whole });
    if (tag === undefined || rawName === undefined) {
      continue;
    }
    const name = rawName.toLowerCase();
    if (!NO_LINKING.has(name) || tag.endsWith("/>")) {
      continue;
    }
    const count = open.get(name);
    let current = 0;
    if (count !== undefined) {
      current = count;
    }
    if (slash === "/") {
      open.set(name, Math.max(0, current - 1));
    } else {
      open.set(name, current + 1);
    }
  }
  return segments;
}

/**
 * Text with every entity and every URL replaced by spaces of the same length, so a scan's offsets still index the
 * original and neither a numeric character reference nor a `#<n>` inside a URL is read as a reference.
 *
 * @returns the masked text, exactly as long as the input
 */
function masked({ text }: { text: string }): string {
  const blank = (found: string): string => " ".repeat(found.length);
  // The URL first: `&amp;` inside one is part of it, and masking the entity first would split it at the `&`.
  return text.replace(BARE_URL, blank).replace(ENTITY, blank);
}

/**
 * Below this, a bare `#N` on a page is a rank or an item number — a leading ordinal, "cause" and a number — never a pull request.
 * Every repository a page here names is past its hundredth number, and the measured page corpus carried 135 refusals
 * before this, the ordinals among them. An `owner/repo#N` is a reference at any number.
 */
const ORDINAL_CEILING = 100;

/**
 * Whether a Linear key on this install is ALSO a known compliance control — `OPS-7` is both when `OPS` is a team key
 * and a Vanta control prefix. The door picks Linear for that tie; a page cannot know which the author meant, so it
 * links neither and asks for the link by hand.
 */
function ambiguousKey({ span, context }: { span: BareRefSpan; context: BareRefContext }): boolean {
  if (span.kind !== "linearKey" || context.complianceControls === undefined) {
    return false;
  }
  return context.complianceControls.some((control) => control.id === span.key);
}

/**
 * Every bare reference in a page's text run, less the ordinals {@link ORDINAL_CEILING} names.
 *
 * @returns the spans, in document order
 */
function pageSpans({ text, context }: { text: string; context: BareRefContext }): readonly BareRefSpan[] {
  return scanBareRefs({ context, text: masked({ text }) }).filter(
    (span) => !(span.kind === "githubRef" && span.owner === undefined && span.number < ORDINAL_CEILING),
  );
}

/** Whether a text segment sits inside any element of `set`. */
function within({ segment, set }: { segment: Segment; set: ReadonlySet<string> }): boolean {
  return [...segment.inside].some((name) => set.has(name));
}

/** The text segments a bare reference may be linked or refused in. */
function linkableTexts({ segments }: { segments: readonly Segment[] }): readonly string[] {
  return segments
    .filter((segment) => segment.kind === "text" && !within({ segment, set: NO_LINKING }))
    .map((segment) => segment.text);
}

/**
 * The context a page's references resolve against: the install's own compliance controls and Linear facts, and the
 * repositories and object numbers the page's OWN GitHub links name — never the checkout's `origin`, which is not
 * evidence of what a page is about (`../cli/bareRefContext.ts`'s `botAnswerBareRefContext`).
 *
 * @param install the install's context, with no repository in it
 * @param fragment the page as its author wrote it
 * @returns the merged context
 */
export function pageIdentifierContext({
  install,
  fragment,
}: {
  install: BareRefContext;
  fragment: string;
}): BareRefContext {
  const page = bareRefContextOfPage({ html: fragment });
  const teamKeys = new Set<string>();
  for (const keys of [install.linearTeamKeys, page.linearTeamKeys]) {
    if (keys !== undefined) {
      for (const key of keys) {
        teamKeys.add(key);
      }
    }
  }
  let slug = page.linearWorkspaceSlug;
  if (install.linearWorkspaceSlug !== undefined) {
    slug = install.linearWorkspaceSlug;
  }
  return {
    attested: page.attested,
    complianceControls: install.complianceControls,
    linearTeamKeys: [...teamKeys],
    linearWorkspaceSlug: slug,
    repos: page.repos,
  };
}

/**
 * The fragment with every bare reference the context resolves wrapped in an anchor, the words left verbatim — the
 * door's linking half, over HTML. A reference inside a link, a code element, a title or a textarea is left alone;
 * so is one the context cannot resolve, for {@link identifierFindings} to name.
 *
 * @param fragment the page as its author wrote it
 * @param context what the page's references resolve against ({@link pageIdentifierContext})
 * @returns the linked fragment, and each reference linked in document order
 */
export function linkPageIdentifiers({ fragment, context }: { fragment: string; context: BareRefContext }): {
  readonly fragment: string;
  readonly linked: readonly LinkedIdentifier[];
} {
  const linked: LinkedIdentifier[] = [];
  const out = segmentsOf({ fragment }).map((segment) => {
    if (segment.kind === "markup" || within({ segment, set: NO_LINKING })) {
      return segment.text;
    }
    let text = "";
    let cursor = 0;
    for (const span of pageSpans({ context, text: segment.text })) {
      const resolved = resolveBareRef({ context, span });
      if (resolved === undefined || ambiguousKey({ context, span })) {
        continue;
      }
      const raw = segment.text.slice(span.start, span.end);
      text += `${segment.text.slice(cursor, span.start)}<a href="${escapeAttribute({ text: resolved.url })}">${raw}</a>`;
      cursor = span.end;
      linked.push({ raw, url: resolved.url });
    }
    return text + segment.text.slice(cursor);
  });
  return { fragment: out.join(""), linked };
}

/** Whether `start`–`end` overlaps any span already found. */
function overlaps({ spans, start, end }: { spans: readonly BareRefSpan[]; start: number; end: number }): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

/**
 * Every identifier the page carries as plain text — a bare reference (resolvable or not, so a caller that skipped
 * {@link linkPageIdentifiers} is still told the URL), an incident reference, a URL in prose — and every raw machine
 * id in text the owner reads. Each distinct one is reported once, in document order.
 *
 * @param fragment the page as it will be published
 * @param context what the page's references resolve against ({@link pageIdentifierContext})
 * @returns the findings, empty when every identifier is a link and no machine id shows
 */
export function identifierFindings({
  fragment,
  context,
}: {
  fragment: string;
  context: BareRefContext;
}): readonly PageIdentifierFinding[] {
  const segments = segmentsOf({ fragment });
  const findings = new Map<string, PageIdentifierFinding>();
  const add = (finding: PageIdentifierFinding): void => {
    const key = `${finding.code}:${finding.message}`;
    if (!findings.has(key)) {
      findings.set(key, finding);
    }
  };
  for (const text of linkableTexts({ segments })) {
    const scanned = masked({ text });
    const spans = pageSpans({ context, text });
    for (const span of spans) {
      add(
        PageIdentifierFindings.unlinkedIdentifier({ identifier: span.raw, reason: unlinkedReason({ context, span }) }),
      );
    }
    for (const match of scanned.matchAll(INCIDENT_REF)) {
      if (!overlaps({ end: match.index + match[0].length, spans, start: match.index })) {
        add(PageIdentifierFindings.unlinkedIncident({ identifier: match[0] }));
      }
    }
    for (const [url] of text.matchAll(BARE_URL)) {
      add(PageIdentifierFindings.unlinkedUrl({ url }));
    }
  }
  for (const id of machineIdsIn({ text: proseRead({ segments }) })) {
    add(PageIdentifierFindings.rawMachineId({ id }));
  }
  return [...findings.values()];
}

/**
 * Why one bare reference was left as plain text: the URL it resolves to, the reason it resolves to none, or that it
 * names both a Linear issue and a control and so is not the publisher's to pick.
 *
 * @returns the finding's reason
 */
function unlinkedReason({ context, span }: { context: BareRefContext; span: BareRefSpan }): string {
  if (ambiguousKey({ context, span })) {
    return `"${span.raw}" is both a Linear key and a compliance control on this install, so it is not linked for you.`;
  }
  const resolved = resolveBareRef({ context, span });
  if (resolved !== undefined) {
    return `"${span.raw}" is a reference written as plain text, and it resolves to ${resolved.url}.`;
  }
  return bareRefRefusalMessage({ context, span });
}

/**
 * Every text segment the owner reads, outside code, joined — an entity read as a space, so a session label and a
 * short id split by a non-breaking space is the id it renders as.
 *
 * @returns the prose the machine-id scan reads
 */
function proseRead({ segments }: { segments: readonly Segment[] }): string {
  const read = segments.filter((segment) => segment.kind === "text" && !within({ segment, set: NOT_READ }));
  return read.map((segment) => segment.text.replace(ENTITY, " ")).join(" ");
}
