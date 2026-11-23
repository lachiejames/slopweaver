/**
 * The tab strip's keyboard shortcuts: which key press is a tab shortcut, the ones a Mac browser uses, and which tab one
 * that changes tabs lands on. Pure; `tabsShell.ts` applies them.
 */
import type { TabStrip } from "./tabStrip";

/** What a key the shell takes does to the tabs. */
export type TabShortcut =
  | { readonly kind: "select"; readonly index: number }
  | { readonly kind: "last" }
  | { readonly kind: "next" }
  | { readonly kind: "previous" }
  | { readonly kind: "close" }
  | { readonly kind: "back" }
  | { readonly kind: "forward" };

/** A key press as Electron's `before-input-event` reports it, the fields this reads. */
export interface KeyPress {
  readonly type: string;
  readonly key: string;
  readonly meta: boolean;
  readonly control: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

/**
 * The tab shortcut a key press is, the ones a Mac browser uses: ⌘1–⌘8 a tab by place and ⌘9 the last, ⌃Tab and ⌃⇧Tab,
 * ⌘⇧] and ⌘⇧[, ⌘⌥→ and ⌘⌥← the next and previous, ⌘W close, ⌘[ and ⌘] back and forward in the tab.
 *
 * @param press the key press
 * @returns the shortcut, or `undefined` for a key the page keeps
 */
export function tabShortcut({ press }: { press: KeyPress }): TabShortcut | undefined {
  if (press.type !== "keyDown") {
    return undefined;
  }
  if (press.control && !press.meta && !press.alt && press.key === "Tab") {
    return press.shift ? { kind: "previous" } : { kind: "next" };
  }
  if (!press.meta || press.control) {
    return undefined;
  }
  if (press.alt) {
    return altArrow({ key: press.key, shift: press.shift });
  }
  if (press.shift) {
    // Shift turns the bracket into a brace on a US layout, and Electron reports either.
    if (press.key === "]" || press.key === "}") {
      return { kind: "next" };
    }
    if (press.key === "[" || press.key === "{") {
      return { kind: "previous" };
    }
    return undefined;
  }
  return plainCommand({ key: press.key });
}

/**
 * ⌘⌥ with an arrow: the next or previous tab.
 *
 * @returns the shortcut, or `undefined`
 */
function altArrow({ key, shift }: { key: string; shift: boolean }): TabShortcut | undefined {
  if (shift) {
    return undefined;
  }
  if (key === "ArrowRight") {
    return { kind: "next" };
  }
  if (key === "ArrowLeft") {
    return { kind: "previous" };
  }
  return undefined;
}

/**
 * ⌘ with one key and no other modifier.
 *
 * @returns the shortcut, or `undefined`
 */
function plainCommand({ key }: { key: string }): TabShortcut | undefined {
  if (/^[1-8]$/u.test(key)) {
    return { index: Number(key) - 1, kind: "select" };
  }
  if (key === "9") {
    return { kind: "last" };
  }
  if (key.toLowerCase() === "w") {
    return { kind: "close" };
  }
  if (key === "[") {
    return { kind: "back" };
  }
  if (key === "]") {
    return { kind: "forward" };
  }
  return undefined;
}

/**
 * The tab a shortcut that changes tabs lands on: by place, the last, or one along — wrapping at either end.
 *
 * @param shortcut a `select`, `last`, `next` or `previous`
 * @returns the tab's id, or `undefined` when no tab is at that place
 */
export function shortcutTarget({
  strip,
  shortcut,
}: {
  strip: TabStrip;
  shortcut: Extract<TabShortcut, { kind: "select" | "last" | "next" | "previous" }>;
}): string | undefined {
  const count = strip.tabs.length;
  const at = strip.tabs.findIndex((tab) => tab.id === strip.active);
  let index: number;
  switch (shortcut.kind) {
    case "select":
      index = shortcut.index;
      break;
    case "last":
      index = count - 1;
      break;
    case "next":
      index = (at + 1) % count;
      break;
    case "previous":
      index = (at - 1 + count) % count;
      break;
    default: {
      const unreachable: never = shortcut;
      return unreachable;
    }
  }
  return strip.tabs[index]?.id;
}
