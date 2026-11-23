/**
 * The floating note a failed console raises: what failed, in which build, and what to do about it. Pure.
 *
 * A failure inside the shell reaches the owner as a floating note naming what failed and what to do, never as a stray
 * window whose meaning they have to guess. The note is the fleet note's shape (`fleetPage.ts`): no
 * script, a policy that allows none, every value escaped, and links on its own `slopweaver-shell:` scheme that the
 * main process acts on only while they name the failure standing at that moment.
 */
import type { BuildIdentity } from "./buildIdentity";
import { type CheckoutError, type ConsoleError, isCheckoutProblem } from "./errors";
import { dataUrl, documentOf, escapeHtml } from "./fleetPage";

/** The scheme the note's links navigate to. */
export const CONSOLE_NOTE_SCHEME = "slopweaver-shell:";

/** The note's width, the same as the fleet note's. */
export const CONSOLE_NOTE_WIDTH = 380;

/** The note's content height: a headline, two short paragraphs and a row of links. */
export const CONSOLE_NOTE_HEIGHT = 240;

/** What a link on the note asks for, and the failure it was drawn for. */
export interface ConsoleNoteLink {
  readonly kind: "choose-checkout" | "retry" | "dismiss" | "quit";
  readonly serial: number;
}

/** The note as plain data, before it is drawn. */
export interface ConsoleNoteView {
  /** What failed, naming the build. */
  readonly headline: string;
  /** The failure's own sentence. */
  readonly problem: string;
  /** What to do about it. */
  readonly todo: string;
  /** The links, the first drawn as the button. */
  readonly actions: ReadonlyArray<{ readonly link: ConsoleNoteLink; readonly label: string }>;
}

/**
 * The link a note navigation names, when it is one of ours.
 *
 * @param url the URL the note tried to open
 * @returns the link, or `undefined` for anything else
 */
export function consoleNoteLinkOf({ url }: { url: string }): ConsoleNoteLink | undefined {
  const match = /^slopweaver-shell:\/\/(choose-checkout|retry|dismiss|quit)\/(\d{1,9})$/u.exec(url);
  if (match === null) {
    return undefined;
  }
  const kind = match[1];
  const serial = Number(match[2]);
  if (kind === "choose-checkout" || kind === "retry" || kind === "dismiss" || kind === "quit") {
    return { kind, serial };
  }
  return undefined;
}

/**
 * Decide what the note says for one failure. A missing or invalid checkout is not something Retry can fix, so it
 * offers a folder picker to choose a clone instead, and Retry only for a console that failed to start or answer; a
 * dev build also offers to quit itself, so a stray one left open by a session is gone in one click.
 *
 * @param failure why the console is not serving
 * @param identity this run
 * @param serial which failure this is, so a link drawn for an older one is never acted on
 * @returns the note's lines and links
 */
export function consoleNoteView({
  failure,
  identity,
  serial,
}: {
  failure: ConsoleError | CheckoutError;
  identity: BuildIdentity;
  serial: number;
}): ConsoleNoteView {
  const actions: Array<{ readonly link: ConsoleNoteLink; readonly label: string }> = [];
  let todo = "Retry runs scripts/docs-site.sh --serve once more; Retry Console in the menu bar does the same.";
  if (isCheckoutProblem({ failure })) {
    todo = "Choose the folder you cloned Slopweaver into. The app remembers it, and serves the console from it.";
    actions.push({ label: "Choose a Slopweaver clone…", link: { kind: "choose-checkout", serial } });
  } else {
    actions.push({ label: "Retry", link: { kind: "retry", serial } });
  }
  if (identity.dev) {
    todo = `${todo} This is a dev build run from source; if nobody is working on it, quit it.`;
    actions.push({ label: "Quit this dev build", link: { kind: "quit", serial } });
  }
  actions.push({ label: "Not now", link: { kind: "dismiss", serial } });
  return { actions, headline: `${identity.label} could not start its console.`, problem: failure.message, todo };
}

/**
 * The href for one link.
 *
 * @returns the `slopweaver-shell://…` URL
 */
function hrefOf({ link }: { link: ConsoleNoteLink }): string {
  return `${CONSOLE_NOTE_SCHEME}//${link.kind}/${String(link.serial)}`;
}

/**
 * The note as a `data:` URL.
 *
 * @param view what it says
 * @param title the document's title, which the window shows as its own
 * @returns the URL the note's window loads
 */
export function consoleNoteUrl({ view, title }: { view: ConsoleNoteView; title: string }): string {
  const links = view.actions.map(({ link, label }, index) => {
    const href = escapeHtml({ text: hrefOf({ link }) });
    const shape = index === 0 ? "act" : "detail";
    return `<a class="${shape}" href="${href}">${escapeHtml({ text: label })}</a>`;
  });
  const body = [
    `<p class="title">${escapeHtml({ text: view.headline })}</p>`,
    `<p class="sub">${escapeHtml({ text: view.problem })}</p>`,
    `<p class="sub">${escapeHtml({ text: view.todo })}</p>`,
    links.join(" "),
  ].join("");
  return dataUrl({ html: documentOf({ body, title }) });
}

/**
 * Where the note's window goes: the top-right of the work area, under the fleet's note while that one is up, so the
 * two never cover each other.
 *
 * @param workArea the primary display's work area
 * @param above the fleet note's window bounds, when it is up
 * @returns the window's top-left corner
 */
export function consoleNotePosition({
  workArea,
  above,
}: {
  workArea: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  above: { readonly y: number; readonly height: number } | undefined;
}): { readonly x: number; readonly y: number } {
  const x = workArea.x + workArea.width - CONSOLE_NOTE_WIDTH - 16;
  if (above === undefined) {
    return { x, y: workArea.y + 16 };
  }
  return { x, y: above.y + above.height + 12 };
}
