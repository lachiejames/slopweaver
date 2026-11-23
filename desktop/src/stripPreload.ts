/**
 * The preload for the tab strip, the console window's top row (`tabStripLook.ts` `stripDocument`). The strip page runs no
 * script of its own: this draws the markup main sends into it and turns the owner's clicks, middle-clicks and drags into ONE
 * kind of message, a tab command, which main parses (`parseTabCommand`) and takes only from the strip's own page.
 * Sandboxed and context-isolated; it exposes nothing to the page and, like `preload.ts`, imports nothing but
 * `electron`, so it spells its channel names itself.
 */
import { ipcRenderer } from "electron";

/** Main to strip: what to draw, and whether the window's buttons sit at its left. */
const STATE_CHANNEL = "slopweaver:tab-strip";
/** Strip to main: one tab command. */
const COMMAND_CHANNEL = "slopweaver:tab-command";

/**
 * Send main one command.
 *
 * @param command the command, in the shape `parseTabCommand` takes
 */
function send({ command }: { command: Record<string, unknown> }): void {
  ipcRenderer.send(COMMAND_CHANNEL, command);
}

/**
 * The strip's own element, once the parser has built it.
 *
 * @returns the element, or `null` before it exists
 */
function stripElement(): HTMLElement | null {
  return document.getElementById("strip");
}

/** The tab being dragged, by id and place. */
let dragging: { readonly id: string; readonly from: number } | undefined;

/**
 * The tab element an event happened on.
 *
 * @returns the element, or `null` off a tab
 */
function tabAt({ target }: { target: EventTarget | null }): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-tab]") : null;
}

/** Clear every drop marker. */
function clearMarks(): void {
  for (const marked of document.querySelectorAll(".drop-before, .drop-after")) {
    marked.classList.remove("drop-before", "drop-after");
  }
}

/**
 * Where a drop over a tab lands: before it when the pointer is on its left half, after it otherwise, as the index the
 * dragged tab ends at once it has left its old place.
 *
 * @returns the end index and which side to mark
 */
function dropPlace({ over, clientX }: { over: HTMLElement; clientX: number }): {
  readonly to: number;
  readonly side: "before" | "after";
} {
  const box = over.getBoundingClientRect();
  const side = clientX < box.left + box.width / 2 ? "before" : "after";
  let to = Number(over.dataset["index"]) + (side === "after" ? 1 : 0);
  if (dragging !== undefined && dragging.from < to) {
    to -= 1;
  }
  return { side, to };
}

/** Wire the strip's clicks and drags, once. */
function wire(): void {
  const strip = stripElement();
  if (strip === null) {
    return;
  }
  strip.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const close = target?.closest<HTMLElement>("[data-close]");
    const id = close?.dataset["close"];
    if (id !== undefined) {
      send({ command: { id, kind: "close" } });
      return;
    }
    const command = target?.closest<HTMLButtonElement>("[data-command]");
    const kind = command?.dataset["command"];
    if (command !== undefined && command !== null && !command.disabled && (kind === "back" || kind === "forward")) {
      send({ command: { kind } });
      return;
    }
    // The new-tab button: main opens its menu of pages at the button's lower left, as Chrome's opens under its own.
    if (command !== undefined && command !== null && kind === "new-tab") {
      const box = command.getBoundingClientRect();
      send({ command: { kind, x: Math.max(0, Math.round(box.left)), y: Math.max(0, Math.round(box.bottom)) } });
      return;
    }
    const tab = tabAt({ target: event.target })?.dataset["tab"];
    if (tab !== undefined) {
      send({ command: { id: tab, kind: "activate" } });
    }
  });
  // A middle-click closes a tab, as in a browser — never the pinned Queue tab, which has no close (main refuses one too).
  strip.addEventListener("auxclick", (event) => {
    const tab = tabAt({ target: event.target });
    if (event.button !== 1 || tab === null || tab.classList.contains("pinned")) {
      return;
    }
    const id = tab.dataset["tab"];
    if (id !== undefined) {
      send({ command: { id, kind: "close" } });
    }
  });
  strip.addEventListener("dragstart", (event) => {
    const tab = tabAt({ target: event.target });
    const id = tab?.dataset["tab"];
    if (tab === null || id === undefined) {
      return;
    }
    dragging = { from: Number(tab.dataset["index"]), id };
    tab.classList.add("dragging");
    event.dataTransfer?.setData("text/plain", id);
  });
  strip.addEventListener("dragover", (event) => {
    const over = tabAt({ target: event.target });
    if (dragging === undefined || over === null) {
      return;
    }
    event.preventDefault();
    clearMarks();
    over.classList.add(`drop-${dropPlace({ clientX: event.clientX, over }).side}`);
  });
  strip.addEventListener("drop", (event) => {
    const over = tabAt({ target: event.target });
    if (dragging === undefined || over === null) {
      return;
    }
    event.preventDefault();
    send({ command: { id: dragging.id, kind: "move", to: dropPlace({ clientX: event.clientX, over }).to } });
  });
  strip.addEventListener("dragend", () => {
    dragging = undefined;
    clearMarks();
    for (const moved of document.querySelectorAll(".dragging")) {
      moved.classList.remove("dragging");
    }
  });
}

/**
 * Run once the parser has built the strip, or now when it already has.
 *
 * @param run what to run
 */
function whenParsed({ run }: { run: () => void }): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
    return;
  }
  run();
}

whenParsed({ run: wire });

/** `tabStripLook.ts`'s `StripPaletteProperty`: the only custom properties a palette from main may set. */
const PALETTE_PROPERTIES = ["--ground", "--tab", "--on", "--line", "--ink", "--muted"] as const;

/**
 * The colours main sent, one per strip property — main's own, from `stripPaletteProperties` over colours
 * `parseStripTokens` checked. Main sends `null` until a console page has reported a look, which is the one absence; a
 * palette that is anything else but not all six colours is main breaking its own contract, and throws rather than
 * leaving the strip on colours nobody chose.
 *
 * @param palette the state's `palette` field
 * @returns each property and its colour, or `undefined` while main has none
 */
function paletteOf({ palette }: { palette: unknown }): readonly (readonly [string, string])[] | undefined {
  if (palette === null) {
    return undefined;
  }
  if (typeof palette !== "object") {
    throw new Error("the tab strip was sent a state whose palette is missing or not an object");
  }
  const pairs: (readonly [string, string])[] = [];
  for (const property of PALETTE_PROPERTIES) {
    const colour: unknown = Reflect.get(palette, property);
    if (typeof colour !== "string") {
      throw new Error(`the tab strip was sent a palette with no colour for ${property}`);
    }
    pairs.push([property, colour]);
  }
  return pairs;
}

ipcRenderer.on(STATE_CHANNEL, (_event, state: unknown) => {
  if (typeof state !== "object" || state === null || !("markup" in state) || !("inset" in state)) {
    return;
  }
  const { markup, inset } = state;
  if (typeof markup !== "string" || typeof inset !== "boolean") {
    return;
  }
  // Read, not tested for: a state with no `palette` field at all is main breaking its contract, and throws below.
  const palette = paletteOf({ palette: Reflect.get(state, "palette") });
  whenParsed({
    run: () => {
      const strip = stripElement();
      if (strip === null) {
        return;
      }
      // The look the console wears, set property by property — never as stylesheet text. Before a console page has
      // reported one, the strip keeps its first paint.
      if (palette !== undefined) {
        for (const [property, colour] of palette) {
          document.documentElement.style.setProperty(property, colour);
        }
      }
      // The markup is main's own, built by `stripMarkup` with every title escaped.
      strip.innerHTML = markup;
      document.body.dataset["controls"] = inset ? "inset" : "none";
    },
  });
});
