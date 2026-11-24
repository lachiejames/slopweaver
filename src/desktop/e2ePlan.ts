/**
 * What `slopweaver desktop e2e` walks, in order, and what "there" means on each step. Pure: the driver
 * (`src/cli/commands/desktop/e2eDriver.ts`) performs it against a real bundle launched as a test instance.
 *
 * The requirement: everything in the desktop app that can be tested end to end is, so it never regresses and every
 * change is proven. So the walk goes the way the owner does — every page is reached by clicking its own link in the
 * sidebar, never by typing an address, so a broken link fails here — and every step ends in a photograph a reader can
 * check. The pages the sidebar does not link are reached by address, because that is the only way the owner reaches
 * them too.
 *
 * "Drawn" and "settled" are the console perf walk's own definitions (`src/consoleProfile/plan.ts`), so the two
 * walks never disagree about whether a page has finished loading.
 *
 * Nothing on a step acts: the queue card is opened and photographed, never answered; the chat box is found, never
 * typed into; no call is placed. A walk that pressed an option would send something as the owner.
 */
import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";

import { CONSOLE_ROUTES, LOADING_SHOWN, PAGE_LANDED, PAGE_PENDING } from "../consoleProfile/plan.js";
import { FIXTURE_MARKER } from "./e2eFixture.js";

/** The sidebar every console page carries (`site/components/console/Shell.tsx`). */
const SIDEBAR = "aside.sw-glass-sidebar";

/** Anything on a page that says it is still loading, as the perf walk reads it. */
export const STILL_LOADING = LOADING_SHOWN;

/**
 * Next's own error dialog, which a page error in a dev build raises over the page. Never the bare `nextjs-portal`:
 * a dev build mounts that on every healthy page for its dev-tools toast, so matching it failed all fifteen steps of
 * a walk against a worktree's dev console with nothing on screen. Playwright's CSS reaches into the portal's open
 * shadow root. Repro: open any dev-console page, then throw from `setTimeout` in its console; only the second holds
 * `[data-nextjs-dialog]`.
 */
export const NEXT_ERROR_OVERLAY = "nextjs-portal [data-nextjs-dialog]";

/** One step of the walk. */
export type E2eStep =
  /** A console page, reached by its sidebar link or, for a page the sidebar does not link, by address. */
  | { readonly kind: "page"; readonly id: string; readonly path: string; readonly reach: "sidebar" | "address" }
  /**
   * The Settings modal, opened from its sidebar button on the tab it opens on and closed with Escape — or, for the
   * Presence tab, that tab's own button pressed first.
   */
  | { readonly kind: "settings"; readonly id: "settings" | "settings-presence"; readonly tab: "opening" | "presence" }
  /** The first Queue card, opened and photographed, never answered. */
  | { readonly kind: "queue-card"; readonly id: "queue-card" }
  /**
   * The voice's card and its Queue link both land in the one pinned Queue tab, never a second (`./e2ePinnedQueue.ts`);
   * the tabs it opens beside the Queue are closed again.
   */
  | { readonly kind: "queue-pinned"; readonly id: "queue-pinned" }
  /**
   * The voice's window, asking for the Queue on screen through its real bridge, is handed the cards the pinned
   * Queue tab draws, in its order (`./e2eQueueScreen.ts`). No call is placed.
   */
  | { readonly kind: "queue-screen"; readonly id: "queue-screen-reading" }
  /**
   * The + after the last tab pops its menu of pages, and the page chosen off it opens last, in front, wearing its icon
   * (`./e2eNewTab.ts`); the tab it opens is closed again.
   */
  | { readonly kind: "new-tab"; readonly id: "new-tab" }
  /** The voice window idle: the chat widget, its message box and the call button, none of them pressed. */
  | { readonly kind: "voice"; readonly id: "voice" }
  /**
   * The voice's orb dragged to the top left, held, let go, and dragged back into the corner, the card open: smooth,
   * steady, nothing cut off, nothing moved on release, and home again (`./e2eOrbDrag.ts`).
   */
  | { readonly kind: "orb-drag"; readonly id: "orb-drag" }
  /** The docs, from their sidebar link: the shell opens them in its viewer (`/view`), the page in a frame there. */
  | { readonly kind: "docs"; readonly id: "docs" }
  /** A published local page in the viewer: the walk's own inert page (`./e2eFixture.ts`), neither control pressed. */
  | { readonly kind: "published-page"; readonly id: "pages" };

/** A control the viewer's own bar must draw, found by its role and exact name. */
export interface E2eViewerControl {
  readonly role: "button" | "link";
  readonly name: string;
}

/** What a step has to show before it counts as there. */
export interface E2eLandmark {
  /** A selector that must be on screen, in the frame the step is judged in. */
  readonly present: string;
  /** A selector that must be gone, or `undefined` when none is waited on. */
  readonly absent: string | undefined;
  /** Controls the page's main frame must also draw, for a step judged inside a frame; none for any other. */
  readonly viewerControls: readonly E2eViewerControl[];
  /** What the landmark is, as the report names a missing one. */
  readonly words: string;
}

/** The Settings button carries no link; it is the sidebar button that says so. */
export const SETTINGS_BUTTON = `${SIDEBAR} button:has-text("Settings")`;

/** The Settings modal's list of tabs (`site/components/console/SettingsModal.tsx`). */
export const SETTINGS_NAV = '[role="dialog"] nav[aria-label="settings"]';

/**
 * The selector for one Settings tab's button, which carries `aria-current` while its tab is shown. Plain CSS, since
 * a landmark is judged by `document.querySelector`.
 *
 * @param tab the tab's section id, as `site/lib/settingsModal.ts` names it
 * @returns the selector
 */
export function settingsTab({ tab }: { tab: string }): string {
  return `${SETTINGS_NAV} button[data-section="${tab}"]`;
}

/** A Queue row is one button carrying its card's kind (`site/components/console/QueueSections.tsx`). */
export const QUEUE_ROW = "main button[data-kind]";

/**
 * The Queue's designed empty state (`site/components/console/PageEmpty.tsx`, the `data-page-empty` mark every page's
 * empty state carries, valued by page), drawn only once every register's latest read answered, none is still replacing an
 * earlier reading, no overlay that can take a card off the list draws an earlier reading, and no row exists
 * (`site/lib/registerFreshness.ts`'s `emptyListDraw`); until then the list draws a spinner or a staleness mark, never
 * the line. A periodic poll already in flight is not visible to it, so the line is true of the instant photographed.
 * The one thing that proves an empty Queue: a page showing neither it nor a row has proven nothing.
 */
export const QUEUE_EMPTY = 'main [data-page-empty="queue"]';

/** What the Queue showed when the card step looked: a row to open, a proven-empty Queue, or neither. */
export type E2eQueueCardState = "row" | "empty" | "unproven";

/**
 * What the card step found on the Queue. A row wins over the empty line, should a re-render briefly draw both.
 *
 * @param rowShown at least one Queue row was drawn
 * @param emptyShown the measured-zero line was drawn
 * @returns the state the step acts on
 */
export function queueCardState({
  rowShown,
  emptyShown,
}: {
  rowShown: boolean;
  emptyShown: boolean;
}): E2eQueueCardState {
  if (rowShown) {
    return "row";
  }
  if (emptyShown) {
    return "empty";
  }
  return "unproven";
}

/** The voice window's page. */
export const VOICE_PATH = "/voice";

/** The voice's typed box, inside its open card: the composer sits under the conversation or a tray, in neither. */
export const VOICE_MESSAGE = 'section[aria-label="the voice"] textarea[aria-label="message"]';

/**
 * The corner orb, whose press opens the card. The card is shut whenever a click into another app folded it
 * (`site/lib/voiceWindow.ts` `voiceWindowShown`), so a walk on a machine in use meets the orb alone.
 */
export const VOICE_ORB = 'button[aria-label^="open the voice"]';

/**
 * The orb's own button whatever its label says, the card open or shut: the first button of the widget's last child,
 * the orb's wrapper (`site/components/voice/VoiceWidget.tsx`), which a page from before the drag fix draws the same.
 */
export const VOICE_ORB_BUTTON = 'aside[aria-label="voice"] > div:last-child > button:first-child';

/** The docs' own path, which their sidebar link names and the viewer's frame shows. */
export const DOCS_PATH = "/docs";

/**
 * Console pages the walk never loads. The Store page draws the private store's own rows, and a walk may capture any
 * page it loads, so no walk step may put that data on screen.
 */
export const WALK_SKIPPED_PATHS: ReadonlySet<string> = new Set(["/store"]);

/** The console's in-app viewer, where the shell opens a docs link (`site/app/(console)/view/page.tsx`). */
export const VIEWER_PATH = "/view";

/**
 * The selector for one page's own sidebar link. Its text carries an icon and a live count, so the link is matched
 * by where it goes, with or without the context the console appends.
 *
 * @param path the page
 * @returns the selector
 */
export function sidebarLink({ path }: { path: string }): string {
  return `${SIDEBAR} a[href="${path}"], ${SIDEBAR} a[href^="${path}?"]`;
}

/**
 * Every step, in the order the walk takes them: the Queue, its card and its one pinned tab first, as the owner lands; the
 * other sidebar pages;
 * Settings; the pages only an address reaches; the voice window; then the two that leave the console's layout and its
 * sidebar with it for the viewer — the docs, by their sidebar link, and a published page, by address.
 *
 * @returns the steps
 */
export function e2eSteps(): readonly E2eStep[] {
  const walked = CONSOLE_ROUTES.filter((route) => route.path !== DOCS_PATH && !WALK_SKIPPED_PATHS.has(route.path));
  const pages = walked.map((route): E2eStep => ({
    id: route.path.slice(1),
    kind: "page",
    path: route.path,
    reach: route.inSidebar ? "sidebar" : "address",
  }));
  const sidebar = pages.filter((step) => step.kind === "page" && step.reach === "sidebar");
  const [queue, ...others] = sidebar;
  const addressed = pages.filter((step) => step.kind === "page" && step.reach === "address");
  return [
    ...(queue === undefined ? [] : [queue]),
    { id: "queue-card", kind: "queue-card" },
    { id: "queue-pinned", kind: "queue-pinned" },
    { id: "queue-screen-reading", kind: "queue-screen" },
    { id: "new-tab", kind: "new-tab" },
    ...others,
    { id: "settings", kind: "settings", tab: "opening" },
    { id: "settings-presence", kind: "settings", tab: "presence" },
    ...addressed,
    { id: "voice", kind: "voice" },
    { id: "orb-drag", kind: "orb-drag" },
    { id: "docs", kind: "docs" },
    { id: "pages", kind: "published-page" },
  ];
}

/**
 * The viewer's bar on a published page: its back control reading the Queue the address named, and the desktop-only
 * Reveal in Finder, which the viewer draws only for one page's own `index.html` under the desktop shell
 * (`site/app/(console)/view/page.tsx`, `site/components/console/RevealInFinder.tsx`).
 */
const PUBLISHED_PAGE_CONTROLS: readonly E2eViewerControl[] = [
  { name: "Back to the Queue", role: "link" },
  { name: "Reveal in Finder", role: "button" },
];

/* A console page's landmark: its heading drawn and its loading skeleton gone. */
function pageLandmark({ words }: { words: string }): E2eLandmark {
  return { absent: PAGE_PENDING, present: PAGE_LANDED, viewerControls: [], words };
}

/* The voice window's landmark: the chat widget's message box drawn. */
function voiceLandmark({ words }: { words: string }): E2eLandmark {
  return { absent: undefined, present: VOICE_MESSAGE, viewerControls: [], words };
}

/**
 * What one step has to show before it is photographed.
 *
 * @returns its landmark
 */
export function landmarkOf({ step }: { step: E2eStep }): E2eLandmark {
  switch (step.kind) {
    case "page": {
      return pageLandmark({ words: `${step.path}'s heading, its skeleton gone` });
    }
    case "settings": {
      if (step.tab === "opening") {
        return { absent: undefined, present: SETTINGS_NAV, viewerControls: [], words: "the settings dialog" };
      }
      return {
        absent: undefined,
        present: `${settingsTab({ tab: step.tab })}[aria-current="true"]`,
        viewerControls: [],
        words: `the settings dialog on its ${step.tab} tab`,
      };
    }
    case "queue-card": {
      return { absent: undefined, present: '[role="dialog"]', viewerControls: [], words: "the opened card's dialog" };
    }
    case "queue-pinned": {
      return pageLandmark({ words: "the pinned Queue tab's heading, its skeleton gone" });
    }
    case "queue-screen": {
      return pageLandmark({ words: "the pinned Queue tab's heading, the Queue the voice was handed" });
    }
    case "new-tab": {
      return pageLandmark({ words: "the pinned Queue tab's heading once the chosen page's tab closed" });
    }
    case "voice": {
      return voiceLandmark({ words: "the chat widget and its message box" });
    }
    case "orb-drag": {
      return voiceLandmark({
        words: "the chat widget's message box, drawn again once the orb was dragged back into the corner",
      });
    }
    case "docs": {
      return pageLandmark({ words: "the docs page's heading, inside the viewer's frame" });
    }
    case "published-page": {
      return {
        absent: undefined,
        // The fixture's own marker, never a bare heading: a 404 or the wrong document drawn in the frame has one too.
        present: `main[${FIXTURE_MARKER}] h1`,
        viewerControls: PUBLISHED_PAGE_CONTROLS,
        words:
          "the published page's heading inside the viewer's frame, with its Back to the Queue and Reveal in Finder",
      };
    }
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

/**
 * Pick the steps one run takes. An empty pick is every step.
 *
 * @param only the step ids asked for
 * @returns the steps in walk order, or the ids that name no step
 */
export function pickSteps({ only }: { only: readonly string[] }): {
  readonly steps: readonly E2eStep[];
  readonly unknown: readonly string[];
} {
  const all = e2eSteps();
  if (only.length === 0) {
    return { steps: all, unknown: [] };
  }
  const known = new Set(all.map((step) => step.id));
  return {
    steps: all.filter((step) => only.includes(step.id)),
    unknown: only.filter((id) => !known.has(id)),
  };
}

/** The `Info.plist` key a bundle that understands the test switch carries (`desktop/package.json`). */
const E2E_PROTOCOL_KEY = "SlopweaverDesktopE2EProtocol";

/**
 * The one protocol this walk speaks: `--slopweaver-desktop-e2e=<dir>` and `--checkout=<dir>`, and (from 2) a window
 * that marks every call it places as the test instance's, so a walk's speech never reads as the owner's. A protocol-1
 * build would record its calls as the owner's words, so it is refused like a build from before the switch.
 */
const E2E_PROTOCOL = "2";

/** The switch that makes a launch a test instance (`desktop/src/e2eMode.ts`'s `E2E_SWITCH`, which `src/` cannot import). */
export const E2E_SWITCH_ARG = "--slopweaver-desktop-e2e";

/**
 * Whether a bundle understands the test switch. One from before ignores it and starts as a full second copy of the owner's
 * app — the menu bar icon, the fleet launch into cmux, an update — so the walk refuses it rather than launch it.
 *
 * @param plist the bundle's `Contents/Info.plist`, as XML
 * @returns whether it speaks this walk's protocol
 */
export function speaksE2e({ plist }: { plist: string }): boolean {
  return plistCarries({ key: E2E_PROTOCOL_KEY, plist, value: E2E_PROTOCOL });
}

/** The `Info.plist` key a bundle that can draw a test instance's own menu bar icon carries (`desktop/package.json`). */
const E2E_MENU_BAR_PROTOCOL_KEY = "SlopweaverDesktopE2EMenuBarProtocol";

/** The one menu bar protocol this walk speaks: `--slopweaver-desktop-e2e-menu-bar`, an icon named Slopweaver Test. */
const E2E_MENU_BAR_PROTOCOL = "1";

/**
 * The opt-in that draws a test instance's own menu bar icon (`desktop/src/e2eMode.ts`'s `E2E_MENU_BAR_SWITCH`, which
 * `src/` cannot import). Only ever beside {@link E2E_SWITCH_ARG}.
 */
export const E2E_MENU_BAR_SWITCH_ARG = "--slopweaver-desktop-e2e-menu-bar";

/**
 * Whether a bundle can draw a test instance's own menu bar icon. One from before would read the opt-in as nothing and
 * draw no icon, so a walk that asked for one refuses it rather than photograph a menu bar it never drew.
 *
 * @param plist the bundle's `Contents/Info.plist`, as XML
 * @returns whether it speaks the menu bar protocol
 */
export function speaksE2eMenuBar({ plist }: { plist: string }): boolean {
  return plistCarries({ key: E2E_MENU_BAR_PROTOCOL_KEY, plist, value: E2E_MENU_BAR_PROTOCOL });
}

/**
 * The plist reader: a real XML parse, element order kept so a `<key>` is paired with the element after it. Comments,
 * processing instructions and the declaration are dropped by the parser rather than by a pattern, and a named entity
 * expands to its text — text, never markup — so nothing inside any of them can become an entry. One stated residue,
 * failing closed: a numeric character reference (`&#49;`) is left as written, so a protocol spelled as one is refused
 * rather than read; the build writes plain digits, and decoding numerics needs the parser's deprecated HTML-entity mode. A CDATA section is text: markup written inside one
 * is never an entry, and a `<string>` whose content is one holds exactly that text, as XML defines it. Three regex scans each lost to a construct the
 * XML grammar allows (a comment, a CDATA section, a processing instruction holding `</dict>`), which is why this is a parser. The parser also repairs malformed input, so a document its
 * validator calls malformed is refused before it is parsed, and one root element with no stray text is required
 * Stated residue: the validator is not a full conformance checker, and a malformation it
 * misses (a declaration written after the root, say) is read rather than refused. That residue cannot turn a non-entry
 * into an entry, which is the property this reader holds: a pair counts only where it truly sits in the root dictionary.
 * XML namespaces are not processed: an element is matched by the name written in its tag, so a default `xmlns` on the
 * document changes nothing this reader sees.
 */
const PLIST_PARSER = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  parseTagValue: false,
  preserveOrder: true,
  processEntities: true,
  trimValues: false,
});

/** One parsed element or text node: `{ <tag>: children }`, or `{ "#text": value }`. */
type PlistNode = Readonly<Record<string, unknown>>;

/** Whether a parsed value is a node. */
function isPlistNode(value: unknown): value is PlistNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A node's tag: its one key that is not the parser's attribute slot. */
function tagOf({ node }: { node: PlistNode }): string | undefined {
  return Object.keys(node).find((name) => name !== ":@");
}

/** The element nodes among a node's children, text between them dropped; `undefined` when it has no child list. */
function elementsOf({ node }: { node: PlistNode }): readonly PlistNode[] | undefined {
  const tag = tagOf({ node });
  const children = tag === undefined ? undefined : node[tag];
  if (!Array.isArray(children)) {
    return undefined;
  }
  return children.filter(isPlistNode).filter((child) => tagOf({ node: child }) !== "#text");
}

/** An element's whole text, or `undefined` when it holds anything but text. */
function textOf({ node }: { node: PlistNode }): string | undefined {
  const tag = tagOf({ node });
  const children = tag === undefined ? undefined : node[tag];
  if (!Array.isArray(children)) {
    return undefined;
  }
  const parts: unknown[] = children.map((child) => (isPlistNode(child) ? child["#text"] : undefined));
  return parts.every((part): part is string => typeof part === "string") ? parts.join("") : undefined;
}

/**
 * The entries of a plist's ROOT dictionary — the `<dict>` directly inside `<plist>`, or a bare top-level `<dict>` —
 * in document order.
 */
function rootDictionary({ plist }: { plist: string }): readonly PlistNode[] | undefined {
  // The parser repairs what it is given (an unclosed `<dict>` comes back closed), so a document that is not
  // well-formed XML is refused before it is read, never trusted to have a root dictionary.
  // `SyntaxValidator.validate` throws on a malformed document, one with several root elements included.
  let parsed: unknown;
  try {
    SyntaxValidator.validate(plist);
    parsed = PLIST_PARSER.parse(plist);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  // The validator also passes a fragment with two top-level elements, so the document is held to exactly one root
  // element and no stray text beside it: a `<dict>` after a sibling is never the root dictionary.
  // The same holds inside `<plist>` and the root `<dict>`: text there is no entry, so it is refused, never dropped.
  const top = parsed.filter(isPlistNode);
  const roots = top.filter((node) => tagOf({ node }) !== "#text");
  if (roots.length !== 1 || carriesStrayText({ nodes: top })) {
    return undefined;
  }
  let dictionary = roots[0]!;
  if (tagOf({ node: dictionary }) === "plist") {
    const inside = elementsOf({ node: dictionary });
    if (inside?.length !== 1 || hasStrayTextInside({ node: dictionary })) {
      return undefined;
    }
    dictionary = inside[0]!;
  }
  if (tagOf({ node: dictionary }) !== "dict" || hasStrayTextInside({ node: dictionary })) {
    return undefined;
  }
  const entries = elementsOf({ node: dictionary });
  return entries !== undefined && isPlistDictionaryShape({ entries }) ? entries : undefined;
}

/** The elements a plist value may be, per Apple's PropertyList DTD. */
const PLIST_VALUE_TAGS: ReadonlySet<string> = new Set([
  "array",
  "data",
  "date",
  "dict",
  "false",
  "integer",
  "real",
  "string",
  "true",
]);

/**
 * Whether a dictionary's children are a plist dictionary's shape: `<key>`, value, `<key>`, value, an even count, every
 * value one of the DTD's value elements. Anything else (a node the parser made while repairing input its validator
 * passed, a key in a value slot) means the document is not a plist this reader trusts, so it carries nothing.
 */
function isPlistDictionaryShape({ entries }: { entries: readonly PlistNode[] }): boolean {
  return (
    entries.length % 2 === 0 &&
    entries.every((node, index) => {
      const tag = tagOf({ node });
      return index % 2 === 0 ? tag === "key" : tag !== undefined && PLIST_VALUE_TAGS.has(tag);
    })
  );
}

/** Whether any of these sibling nodes is text that is not whitespace. */
function carriesStrayText({ nodes }: { nodes: readonly PlistNode[] }): boolean {
  return nodes.some((node) => tagOf({ node }) === "#text" && String(node["#text"]).trim() !== "");
}

/** Whether an element holds text that is not whitespace directly among its children. */
function hasStrayTextInside({ node }: { node: PlistNode }): boolean {
  const tag = tagOf({ node });
  const children = tag === undefined ? undefined : node[tag];
  return Array.isArray(children) && carriesStrayText({ nodes: children.filter(isPlistNode) });
}

/**
 * Whether an XML `Info.plist` carries this string under this key in its ROOT dictionary.
 *
 * @param plist the plist, as XML
 * @param key the entry's key
 * @param value the string it must hold
 * @returns whether a top-level entry holds exactly that value
 */
function plistCarries({ plist, key, value }: { plist: string; key: string; value: string }): boolean {
  // A key nested in an inner dictionary is some other value's field, never the bundle's capability, so only the root
  // dictionary counts. A binary plist parses to no dictionary, so it carries nothing.
  const entries = rootDictionary({ plist });
  if (entries === undefined) {
    return false;
  }
  // A dictionary's children alternate key, value: a `<key>` in a value slot (odd index) is no entry.
  return entries.some((node, index) => {
    const next = entries[index + 1];
    if (index % 2 !== 0 || tagOf({ node }) !== "key" || textOf({ node }) !== key || next === undefined) {
      return false;
    }
    return tagOf({ node: next }) === "string" && textOf({ node: next }) === value;
  });
}

/**
 * The folder name one run writes into: its start instant, colons and the fraction dropped so it sorts and is a
 * valid file name everywhere.
 *
 * @param startedIso when the run started
 * @returns the name
 */
export function e2eRunId({ startedIso }: { startedIso: string }): string {
  return startedIso.replace(/\.\d+Z$/u, "Z").replaceAll(":", "");
}
