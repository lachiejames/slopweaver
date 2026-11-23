/*
 * The three things a pull request body draws on GitHub that the console's markdown renderer would not, done to the
 * rendered tree between Streamdown's own sanitize and harden passes (`components/console/PullView.tsx`). The owner
 * should never need to open GitHub to read a description, so the console draws it exactly as GitHub does.
 *
 * - A static shields.io badge is DRAWN from its own address, never fetched: every word and colour it shows is in the
 *   URL, so the console keeps its zero-egress contract (`./markdownSafety.ts`) and still shows what GitHub shows. Any
 *   other picture is still dropped.
 * - A named anchor (`<a name="problem"></a>`) is the target a badge links to; with no `href`, rehype-harden would draw
 *   it as "[blocked]". It becomes an empty, `id`'d span — what GitHub leaves visible of it, which is nothing.
 * - A `> [!NOTE]`-style blockquote becomes GitHub's alert box.
 *
 * The hast shapes are declared here rather than imported: `hast` is not this site's own dependency, and the unit lane
 * reads this module from the root, where it is not one either.
 */

/** A hast text node. */
interface HastText {
  type: "text";
  value: string;
}

/** A hast element. */
interface HastElement {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

/** The hast root a transformer is handed. */
interface HastRoot {
  type: "root";
  children: HastNode[];
}

/** Any hast node the walk looks at: elements and the root have children, text does not. */
export type HastNode = HastElement | HastRoot | HastText;

/** A badge as shields draws it: its two halves and their grounds. */
export interface ShieldBadge {
  readonly label: string | undefined;
  readonly message: string;
  readonly color: string;
  readonly labelColor: string;
  readonly square: boolean;
}

/** Shields' default label ground. */
const LABEL_GREY = "#555555";

/**
 * Shields' named colours, from badge-maker's own table. A name not here draws no badge at all. A `Map`, because the
 * site's compiler reads a `Record` lookup as always present, and a body names whatever colour it likes.
 */
const NAMED_COLORS: ReadonlyMap<string, string> = new Map([
  ["blue", "#007ec6"],
  ["brightgreen", "#44cc11"],
  ["critical", "#e05d44"],
  ["gray", LABEL_GREY],
  ["green", "#97ca00"],
  ["grey", LABEL_GREY],
  ["important", "#fe7d37"],
  ["inactive", "#9f9f9f"],
  ["informational", "#007ec6"],
  ["lightgray", "#9f9f9f"],
  ["lightgrey", "#9f9f9f"],
  ["orange", "#fe7d37"],
  ["red", "#e05d44"],
  ["success", "#44cc11"],
  ["yellow", "#dfb317"],
  ["yellowgreen", "#a4a61d"],
]);

/** A hex colour shields accepts bare, three or six digits. Nothing else reaches an inline style. */
const HEX = /^[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu;

/** A colour a badge may be painted: a known name or a bare hex, else `undefined`. */
function colorOf({ value }: { value: string }): string | undefined {
  const named = NAMED_COLORS.get(value.toLowerCase());
  if (named !== undefined) {
    return named;
  }
  if (HEX.test(value)) {
    return `#${value.toLowerCase()}`;
  }
  return undefined;
}

/** One dash-separated part of a badge path in shields' escaping: `--` is a dash, `__` an underscore, `_` a space. */
function unescapePart({ part }: { part: string }): string {
  return part.replaceAll("__", "\u0000").replaceAll("_", " ").replaceAll("\u0000", "_");
}

/**
 * The badge a static shields.io address draws, read from the address alone — `/badge/<label>-<message>-<color>` or
 * `/badge/<message>-<color>`, with `label`, `color`, `labelColor` and `style` query overrides. A dynamic badge, a
 * colour that is neither a named one nor bare hex, or any other host is `undefined`, and stays an undrawn picture.
 *
 * @param src the image address as the body wrote it
 * @returns the badge, or `undefined` when the address is not one this can draw without fetching it
 */
export function shieldBadgeOf({ src }: { src: string }): ShieldBadge | undefined {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== "img.shields.io" || !url.pathname.startsWith("/badge/")) {
    return undefined;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice("/badge/".length)).replace(/\.svg$/u, "");
  } catch {
    return undefined;
  }
  const parts = path
    .replaceAll("--", "\u0000")
    .split("-")
    .map((part) => unescapePart({ part: part.replaceAll("\u0000", "-") }));
  let label: string | undefined;
  let message: string;
  let colorWord: string;
  if (parts.length >= 3) {
    label = parts[0];
    message = parts.slice(1, -1).join("-");
    colorWord = parts.at(-1)!;
  } else if (parts.length === 2) {
    message = parts[0]!;
    colorWord = parts[1]!;
  } else {
    return undefined;
  }
  const labelOverride = url.searchParams.get("label");
  if (labelOverride !== null) {
    label = labelOverride;
  }
  const colorOverride = url.searchParams.get("color");
  if (colorOverride !== null) {
    colorWord = colorOverride;
  }
  const color = colorOf({ value: colorWord });
  if (color === undefined) {
    return undefined;
  }
  let labelColor = LABEL_GREY;
  const labelColorWord = url.searchParams.get("labelColor");
  if (labelColorWord !== null) {
    const chosen = colorOf({ value: labelColorWord });
    if (chosen === undefined) {
      return undefined;
    }
    labelColor = chosen;
  }
  if (label === "") {
    label = undefined;
  }
  return { color, label, labelColor, message, square: url.searchParams.get("style") === "flat-square" };
}

/**
 * The ink shields puts on a ground: dark on a bright one, white otherwise — badge-maker's own brightness cut.
 *
 * @param color a `#rrggbb` or `#rgb` ground
 * @returns the text colour for it
 */
export function badgeInk({ color }: { color: string }): string {
  let hex = color.slice(1);
  if (hex.length === 3) {
    hex = hex.replace(/./gu, "$&$&");
  }
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 255_000;
  if (brightness > 0.69) {
    return "#333333";
  }
  return "#ffffff";
}

/** One half of a badge: its ground and ink inline, its shape the stylesheet's `.gh-badge-part`. */
function badgePart({ text, ground }: { text: string; ground: string }): HastElement {
  return {
    children: [{ type: "text", value: text }],
    properties: {
      className: ["gh-badge-part"],
      style: `background-color:${ground};color:${badgeInk({ color: ground })}`,
    },
    tagName: "span",
    type: "element",
  };
}

/** The badge drawn as two spans, under the alt text GitHub would read out. */
function badgeElement({ badge, alt }: { badge: ShieldBadge; alt: string }): HastElement {
  const children: HastElement[] = [];
  if (badge.label !== undefined) {
    children.push(badgePart({ ground: badge.labelColor, text: badge.label }));
  }
  children.push(badgePart({ ground: badge.color, text: badge.message }));
  const className = ["gh-badge"];
  if (badge.square) {
    className.push("gh-badge-square");
  }
  let name = badge.message;
  if (badge.label !== undefined) {
    name = `${badge.label}: ${badge.message}`;
  }
  if (alt !== "") {
    name = alt;
  }
  return { children, properties: { ariaLabel: name, className, role: "img" }, tagName: "span", type: "element" };
}

/** GitHub's five alert kinds, each with the title it draws. A `Map` for the same reason as {@link NAMED_COLORS}. */
const ALERTS: ReadonlyMap<string, string> = new Map([
  ["CAUTION", "Caution"],
  ["IMPORTANT", "Important"],
  ["NOTE", "Note"],
  ["TIP", "Tip"],
  ["WARNING", "Warning"],
]);

/** The `[!KIND]` marker opening an alert's first paragraph. */
const ALERT_MARKER = /^\s*\[!(?<kind>[A-Z]+)\][ \t]*\n?/u;

/** Whether a node is an element, and so has a tag and properties. */
function isElement(node: HastNode | undefined): node is HastElement {
  return node?.type === "element";
}

/** Whether a node is text, and so has a value. */
function isText(node: HastNode | undefined): node is HastText {
  return node?.type === "text";
}

/** The blockquote as GitHub's alert box when it opens on a marker, else `undefined`. */
function alertOf({ quote }: { quote: HastElement }): HastElement | undefined {
  const first = quote.children.find((child) => isElement(child));
  if (!isElement(first) || first.tagName !== "p") {
    return undefined;
  }
  const text = first.children[0];
  if (!isText(text)) {
    return undefined;
  }
  const kind = ALERT_MARKER.exec(text.value)?.groups?.["kind"];
  if (kind === undefined) {
    return undefined;
  }
  const title = ALERTS.get(kind);
  if (title === undefined) {
    return undefined;
  }
  const rest = text.value.replace(ALERT_MARKER, "");
  const paragraph: HastElement = { ...first, children: first.children.slice(1) };
  if (rest !== "") {
    paragraph.children.unshift({ type: "text", value: rest });
  }
  const emptied = paragraph.children.every(
    (child) => (isText(child) && child.value.trim() === "") || (isElement(child) && child.tagName === "br"),
  );
  const body = quote.children.filter((child) => child !== first);
  if (!emptied) {
    body.unshift(paragraph);
  }
  const heading: HastElement = {
    children: [{ type: "text", value: title }],
    properties: { className: ["gh-alert-title"] },
    tagName: "p",
    type: "element",
  };
  return {
    children: [heading, ...body],
    properties: { className: ["gh-alert", `gh-alert-${kind.toLowerCase()}`] },
    tagName: "div",
    type: "element",
  };
}

/** What one element becomes: itself, a drawn badge, an anchor target or an alert. */
function rewrite({ node }: { node: HastElement }): HastElement {
  if (node.tagName === "img" && typeof node.properties["src"] === "string") {
    const badge = shieldBadgeOf({ src: node.properties["src"] });
    if (badge !== undefined) {
      let alt = "";
      if (typeof node.properties["alt"] === "string") {
        alt = node.properties["alt"];
      }
      return badgeElement({ alt, badge });
    }
    return node;
  }
  if (node.tagName === "a" && node.properties["href"] === undefined) {
    // GitHub's own bodies name the target with `name`; an `id` is the same target written the newer way.
    const properties: Record<string, unknown> = {};
    if (typeof node.properties["name"] === "string") {
      properties["id"] = node.properties["name"];
    } else if (typeof node.properties["id"] === "string") {
      properties["id"] = node.properties["id"];
    }
    return { children: node.children, properties, tagName: "span", type: "element" };
  }
  if (node.tagName === "blockquote") {
    const alert = alertOf({ quote: node });
    if (alert !== undefined) {
      return alert;
    }
  }
  return node;
}

/** Rewrite every element under a node, children before the node that holds them. */
function walk({ node }: { node: HastNode }): void {
  // A comment or doctype reaches here too at run time; only a node that holds children is walked into.
  if (!("children" in node)) {
    return;
  }
  node.children = node.children.map((child) => {
    walk({ node: child });
    if (isElement(child)) {
      return rewrite({ node: child });
    }
    return child;
  });
}

/**
 * The rehype plugin: GitHub's badges, anchor targets and alerts, in place over the whole tree. It runs after
 * Streamdown's sanitize (so its inline colours survive) and before harden (so a named anchor never reads "[blocked]").
 *
 * @returns the transformer unified runs over each body
 */
export function rehypeGithubBody(): (tree: HastNode) => void {
  // named-object-params-exempt: unified invokes a transformer as transformer(tree, file) positionally
  return function transform(tree: HastNode): void {
    walk({ node: tree });
  };
}
