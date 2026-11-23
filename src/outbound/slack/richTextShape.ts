/**
 * Whether a `rich_text` block read back off disk is whole: every container and every inline element down to its
 * leaves, each carrying the field the preview and the send read. A register line is parsed JSON, so a TypeScript type
 * vouches for none of it; a Codex candidate a pick makes the row's words is held to this before it is believed
 * (`./draftComparisonLine.ts`). Pure.
 *
 * The vocabulary is exactly what the drip renderer emits (`./render.ts`), and a broadcast only at the three ranges
 * Slack posts: a `date`, an `emoji`, a `color` or a `team` element is one no candidate rendered from Codex's answer
 * can carry, and a wrong value the card would draw unlike Slack. An element of
 * any other type is refused rather than passed through, so an unknown shape hides its row instead of reaching a
 * renderer that cannot draw it.
 */
import { isRecord } from "../../lib/parsers.js";

/**
 * The one string field each inline element type must carry. Every table this module reads by a type off disk is a
 * `Map`: a plain object answers `constructor` from its prototype, so a line naming it would throw rather than refuse.
 */
const INLINE_FIELD: ReadonlyMap<string, string> = new Map([
  ["broadcast", "range"],
  ["channel", "channel_id"],
  ["link", "url"],
  ["text", "text"],
  ["user", "user_id"],
  ["usergroup", "usergroup_id"],
]);

/**
 * The link schemes the console card draws as a link, exactly as `site/components/live/readSlackDraftsRuns.ts` spells
 * it: any other, an upper-case `HTTPS://` included, it draws as text where Slack draws a link.
 */
const LINK_SCHEME = /^(?:https?:\/\/|mailto:)/;

/**
 * Whether a link's address is one the card draws and Slack posts: a drawn scheme, and an address that parses to a host
 * or a mailbox. `https://` alone carries the scheme and nothing Slack can post.
 */
function linkAddressValid({ url }: { url: string }): boolean {
  if (!LINK_SCHEME.test(url) || !URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  return parsed.protocol === "mailto:" ? parsed.pathname.includes("@") : parsed.hostname !== "";
}

/**
 * The id each reference element must carry, as `./draftComparisonLine.ts` holds a candidate's mentions to: an empty or
 * malformed one the card would draw as a chip where Slack refuses the message.
 */
const REFERENCE_ID: ReadonlyMap<string, RegExp> = new Map([
  ["channel", /^[CDG][A-Z0-9]+$/u],
  ["user", /^[UW][A-Z0-9]+$/u],
  ["usergroup", /^S[A-Z0-9]+$/u],
]);

/** The broadcast ranges Slack posts: `<!here>`, `<!channel>`, `<!everyone>`. */
const BROADCAST_RANGES = new Set(["channel", "everyone", "here"]);

/**
 * The keys each node may carry, every other refused: a node is a closed shape, so a key this version does not draw
 * hides its row rather than being dropped from the card while it rides to Slack.
 */
const BLOCK_KEYS: ReadonlySet<string> = new Set(["elements", "type"]);

/**
 * Each container type's keys: its children and type, a list's style, offset and flat indent, and a quote's or
 * preformatted run's flat border. A key on the wrong container, a section's `style` say, is one the card would drop.
 */
const CONTAINER_KEYS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["rich_text_list", new Set(["border", "elements", "indent", "offset", "style", "type"])],
  ["rich_text_preformatted", new Set(["border", "elements", "type"])],
  ["rich_text_quote", new Set(["border", "elements", "type"])],
  ["rich_text_section", new Set(["elements", "type"])],
]);

/** The one optional key each inline type may carry beside its type and field: a text run's style, a link's label. */
const INLINE_EXTRA_KEY: readonly (readonly [string, string])[] = [
  ["link", "text"],
  ["text", "style"],
];

/** Whether a record carries no key outside `keys`. */
function onlyKeys({ bag, keys }: { bag: Record<string, unknown>; keys: ReadonlySet<string> }): boolean {
  return Object.keys(bag).every((key) => keys.has(key));
}

/** The containers whose children are inline elements. */
const INLINE_CONTAINERS = new Set(["rich_text_preformatted", "rich_text_quote", "rich_text_section"]);

/**
 * Whether a value is one whole `rich_text` block: its type, and every container under it whole.
 *
 * @param block the value read where a `rich_text` block belongs
 * @returns whether every node under it is one this version can draw and send
 */
export function richTextBlockValid({ block }: { block: unknown }): boolean {
  if (!isRecord(block) || block["type"] !== "rich_text" || !onlyKeys({ bag: block, keys: BLOCK_KEYS })) {
    return false;
  }
  const { elements } = block;
  if (!Array.isArray(elements)) {
    return false;
  }
  const containers: readonly unknown[] = elements;
  return containers.every((container, at) => {
    const before = containers[at - 1];
    const afterList = isRecord(before) && before["type"] === "rich_text_list";
    return containerValid({ afterList, container }) && sectionsParted({ before, container });
  });
}

/**
 * Whether two neighbouring sections are parted the way the drip renderer parts them: a `\n\n` text run ending the first
 * (`./dripRender.ts` one-card) or opening the second (one-list trailing lines). Slack runs two sections with no break
 * between them together on one line, which the card draws as two.
 */
function sectionsParted({ before, container }: { before: unknown; container: unknown }): boolean {
  if (!isRecord(before) || !isRecord(container)) {
    return true;
  }
  if (before["type"] !== "rich_text_section" || container["type"] !== "rich_text_section") {
    return true;
  }
  const ends = Array.isArray(before["elements"]) ? before["elements"].at(-1) : undefined;
  const opens = Array.isArray(container["elements"]) ? container["elements"].at(0) : undefined;
  return breakRun({ element: ends, at: "end" }) || breakRun({ element: opens, at: "start" });
}

/** Whether an inline element is a text run carrying a paragraph break at the given end. */
function breakRun({ element, at }: { element: unknown; at: "end" | "start" }): boolean {
  if (!isRecord(element) || element["type"] !== "text" || typeof element["text"] !== "string") {
    return false;
  }
  return at === "end" ? element["text"].endsWith("\n\n") : element["text"].startsWith("\n\n");
}

/**
 * Whether a text run's line breaks are the ones the drip renderer emits and the card draws as Slack does: a `\n\n`
 * paragraph break anywhere, and one leading `\n` on the first run after a list (`./dripRender.ts` AFTER_LIST_GAP). Any
 * other `\n` Slack draws as a line break the card collapses.
 */
function breaksDrawn({ leading, text }: { leading: boolean; text: string }): boolean {
  const rest = leading && /^\n(?!\n)/u.test(text) ? text.slice(1) : text;
  return !rest.replaceAll("\n\n", "").includes("\n");
}

/** The two list styles Slack draws and the console reader reads. */
const LIST_STYLES = new Set(["bullet", "ordered"]);

/**
 * The inline style flags the drip renderer emits (`./render.ts` `styleFor`) and the console card draws: a candidate
 * carrying any other would draw differently from what Slack shows, so it refuses.
 */
const STYLE_FLAGS = new Set(["bold", "code", "italic"]);

/** Whether an inline `style` is absent, or a bag of known flags each set to a boolean. */
function styleValid({ style }: { style: unknown }): boolean {
  if (style === undefined) {
    return true;
  }
  return (
    isRecord(style) && Object.entries(style).every(([flag, on]) => STYLE_FLAGS.has(flag) && typeof on === "boolean")
  );
}

/** Whether an optional field is absent or of the one type it may carry — present and malformed refuses. */
function optionalOf({ bag, key, type }: { bag: Record<string, unknown>; key: string; type: string }): boolean {
  return bag[key] === undefined || typeof bag[key] === type;
}

/** A section, quote or preformatted run of inline elements, or a list of sections; `afterList` when one precedes it. */
function containerValid({ afterList, container }: { afterList: boolean; container: unknown }): boolean {
  if (!isRecord(container) || !Array.isArray(container["elements"])) {
    return false;
  }
  const type = container["type"];
  const keys = CONTAINER_KEYS.get(String(type));
  if (keys === undefined || !onlyKeys({ bag: container, keys })) {
    return false;
  }
  const children: readonly unknown[] = container["elements"];
  // The drip renderer builds every container from runs or sections it holds, so an empty one draws a blank line the
  // payload's text does not carry.
  if (children.length === 0) {
    return false;
  }
  // The card draws a list's offset but neither nesting nor a border, and the drip renderer emits neither: a nested or
  // bordered container would draw unlike Slack, so only their flat value passes.
  const flat = ["border", "indent"].every((key) => container[key] === undefined || container[key] === 0);
  // A list's offset is a count: a non-finite one reads as `null` once listed, so the card could not draw what folded.
  const offset = container["offset"];
  const placed = flat && (offset === undefined || (Number.isSafeInteger(offset) && Number(offset) >= 0));
  if (type === "rich_text_list") {
    const sections = children.every((child) => isRecord(child) && child["type"] === "rich_text_section");
    const styled = typeof container["style"] === "string" && LIST_STYLES.has(container["style"]);
    return (
      styled && placed && sections && children.every((child) => containerValid({ afterList: false, container: child }))
    );
  }
  const inline = typeof type === "string" && INLINE_CONTAINERS.has(type);
  return (
    inline &&
    placed &&
    children.every((element, at) => inlineValid({ inline: element, leading: afterList && at === 0 }))
  );
}

/**
 * One inline element: a type this version knows, carrying that type's field, and — where present — a `style` of known
 * boolean flags and a link label that is a string, the shapes the console reader refuses or drops otherwise.
 */
function inlineValid({ inline, leading }: { inline: unknown; leading: boolean }): boolean {
  if (!isRecord(inline) || typeof inline["type"] !== "string") {
    return false;
  }
  const field = INLINE_FIELD.get(inline["type"]);
  if (field === undefined || typeof inline[field] !== "string") {
    return false;
  }
  // A text run's style and a link's label are the only keys beside the type and its field the renderer emits.
  const keys = new Set([
    "type",
    field,
    ...INLINE_EXTRA_KEY.filter(([type]) => type === inline["type"]).map(([, key]) => key),
  ]);
  if (!onlyKeys({ bag: inline, keys })) {
    return false;
  }
  // The drip renderer styles only a text run, and the card draws a style on nothing else: a styled link or mention
  // would draw unlike Slack.
  const styled = inline["type"] === "text" ? styleValid({ style: inline["style"] }) : inline["style"] === undefined;
  if (inline["type"] === "link") {
    const drawn = linkAddressValid({ url: inline[field] });
    // An empty label draws a blank anchor on the card where Slack shows the address, and a line break inside one the
    // card folds to a space; the renderer emits neither.
    const labelled = inline["text"] !== "" && !String(inline["text"]).includes("\n");
    return styled && drawn && labelled && optionalOf({ bag: inline, key: "text", type: "string" });
  }
  // Slack refuses a text element whose text is empty (`./render.ts` `BLANK_HEADER`), where the card would draw a blank.
  if (inline["type"] === "text") {
    return styled && inline[field] !== "" && breaksDrawn({ leading, text: inline[field] });
  }
  if (inline["type"] === "broadcast") {
    return styled && BROADCAST_RANGES.has(inline[field]);
  }
  const id = REFERENCE_ID.get(inline["type"]);
  return styled && (id === undefined || id.test(inline[field]));
}
