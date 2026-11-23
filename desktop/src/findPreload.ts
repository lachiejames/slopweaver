/**
 * The preload for the find bar (`findBar.ts` `findDocument`). The bar's page runs no script of its own: this turns the
 * typing, Enter, ⇧Enter, Esc and the buttons into ONE kind of message, a find command, which main parses
 * (`parseFindCommand`) and takes only from the bar's own page, and writes main's count into the bar. Sandboxed and
 * context-isolated; it exposes nothing to the page and, like `stripPreload.ts`, imports nothing but `electron`, so it
 * spells its channel names itself.
 */
import { ipcRenderer } from "electron";

/** Main to bar: the count, whether there is a match to step to, and where the keyboard goes. */
const STATE_CHANNEL = "slopweaver:find-bar";
/** Bar to main: one find command. */
const COMMAND_CHANNEL = "slopweaver:find-command";

/**
 * Send main one command.
 *
 * @param command the command, in the shape `parseFindCommand` takes
 */
function send({ command }: { command: Record<string, unknown> }): void {
  ipcRenderer.send(COMMAND_CHANNEL, command);
}

/**
 * The search field, once the parser has built it.
 *
 * @returns the field, or `null` before it exists
 */
function queryField(): HTMLInputElement | null {
  const field = document.getElementById("query");
  return field instanceof HTMLInputElement ? field : null;
}

/** How many texts this bar has sent; main echoes it, and a count for an older one is never shown. */
let typed = 0;

/**
 * Write a count into the bar, and enable the steps when there is a match to step to.
 *
 * @param status what the count reads, `""` for none
 * @param none whether the search found nothing
 * @param canStep whether there is a match to step to
 */
function drawCount({ status, none, canStep }: { status: string; none: boolean; canStep: boolean }): void {
  const count = document.getElementById("count");
  if (count !== null) {
    count.textContent = status;
    count.toggleAttribute("data-none", none);
  }
  for (const step of document.querySelectorAll<HTMLButtonElement>("[data-find=next], [data-find=previous]")) {
    step.disabled = !canStep;
  }
}

/** Wire the field and the buttons, once. */
function wire(): void {
  const field = queryField();
  if (field === null) {
    return;
  }
  field.addEventListener("input", () => {
    typed += 1;
    // The last text's count goes as the text changes, not when main's answer for the new text arrives.
    drawCount({ canStep: false, none: false, status: "" });
    send({ command: { kind: "query", seq: typed, text: field.value } });
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      send({ command: { kind: event.shiftKey ? "previous" : "next" } });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      send({ command: { kind: "close" } });
    }
  });
  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-find]") : null;
    const kind = button?.dataset["find"];
    if (button == null || button.disabled) {
      return;
    }
    if (kind === "next" || kind === "previous" || kind === "close") {
      send({ command: { kind } });
    }
  });
}

/**
 * Run once the parser has built the bar, or now when it already has.
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

ipcRenderer.on(STATE_CHANNEL, (_event, state: unknown) => {
  if (typeof state !== "object" || state === null || !("status" in state) || !("none" in state)) {
    return;
  }
  if (!("canStep" in state) || !("focus" in state) || !("seq" in state)) {
    return;
  }
  const { status, none, canStep, focus, seq } = state;
  if (typeof status !== "string" || typeof none !== "boolean" || typeof canStep !== "boolean") {
    return;
  }
  if (focus !== "select-all" && focus !== "preserve" && focus !== "none") {
    return;
  }
  whenParsed({
    run: () => {
      // A count main drew for an older text than the field holds is dropped; where the keyboard goes still applies.
      if (seq === typed) {
        drawCount({ canStep, none, status });
      }
      const field = queryField();
      if (field === null || focus === "none") {
        return;
      }
      // Focusing a field keeps its caret and selection; only ⌘F selects the whole text.
      field.focus();
      if (focus === "select-all") {
        field.select();
      }
    },
  });
});
