/**
 * The voice window as the call leg drives it, through one of two routes behind one shape.
 *
 * **Playwright's page, until a crash.** Clicks are dispatched into the page, so the owner's cursor never moves.
 *
 * **The window's own web contents, after one.** Once `forcefullyCrashRenderer()` kills the voice renderer, Playwright's
 * page for it answers every call with "Target crashed" for good, while Electron reloads the SAME web contents and the
 * app recovers the call (measured on a candidate build: the page threw at +3s, +10s and +20s while the main
 * process read the contents as reloaded and not crashed; reproduce by crashing a test instance's voice renderer and
 * calling `page.evaluate` on the old page). So the recovered page is read and pressed from the main process, over the
 * channel Playwright already holds: `webContents.executeJavaScript(…, true)`, a user gesture, and `capturePage()` for
 * the photograph. A press there is a DOM `click()`, not Playwright's input pipeline, and page errors the reloaded
 * renderer throws are not heard; `skills/desktop/reference/e2e.md` names both.
 */
import { writeFileSync } from "node:fs";

import type { ElectronApplication, Page } from "playwright-core";

import { isRecord } from "#lib/parsers.js";
import {
  E2E_ANY_LIVE_ROWS,
  E2E_LIVE_ROWS,
  type E2eRow,
  type LiveSnapshot,
  liveSnapshotOf,
  rowsOf,
} from "../../../desktop/e2eCallRows.js";
import { VOICE_PATH } from "../../../desktop/e2ePlan.js";
import { pause } from "./e2ePage.js";

/** The voice window, driven. Each act reads a page mid-reload or gone as nothing there, never a throw. */
export interface VoiceView {
  /** Whether the first match of a selector is visible. */
  readonly shows: (options: { readonly selector: string }) => Promise<boolean>;
  /** Whether the first match of a selector is visible and enabled. */
  readonly enabled: (options: { readonly selector: string }) => Promise<boolean>;
  /** Press the first match; whether it was pressed. */
  readonly click: (options: { readonly selector: string }) => Promise<boolean>;
  /** Fill the first match, a text box; whether it was filled. */
  readonly fill: (options: { readonly selector: string; readonly text: string }) => Promise<boolean>;
  /** The first match's value, `undefined` when it cannot be read. */
  readonly value: (options: { readonly selector: string }) => Promise<string | undefined>;
  /** How many matches carry a text. */
  readonly count: (options: { readonly selector: string; readonly text: string }) => Promise<number>;
  /** The live call's settled rows, in order, none when the page cannot be read. */
  readonly rows: () => Promise<readonly E2eRow[]>;
  /**
   * One snapshot of the live call's rows, settled and still being heard, `undefined` when the page cannot be read:
   * never confused with none.
   */
  readonly readLive: () => Promise<LiveSnapshot | undefined>;
  /** Whether the document has loaded. */
  readonly ready: () => Promise<boolean>;
  /** Photograph it to a path; the path, or `undefined` when it could not be taken. */
  readonly photograph: (options: { readonly path: string }) => Promise<string | undefined>;
  /** Its address now, `undefined` when it cannot be read. */
  readonly url: () => Promise<string | undefined>;
  /** The Playwright page behind it, `undefined` for the web-contents route. */
  readonly page: Page | undefined;
}

/**
 * Rows read, or none for a page that could not be read.
 *
 * @param read the rows, `undefined` when unreadable
 * @returns the rows, none for an unreadable page
 */
function noneUnread({ read }: { read: readonly E2eRow[] | undefined }): readonly E2eRow[] {
  if (read === undefined) {
    return [];
  }
  return read;
}

/** The live call's settled rows on a Playwright page, `undefined` when the page cannot be read. */
async function pageRows({ page }: { page: Page }): Promise<readonly E2eRow[] | undefined> {
  return page
    .evaluate(
      (selector) =>
        [...document.querySelectorAll(selector)].map((row) => ({
          medium: row.getAttribute("data-medium"),
          text: row.textContent,
          who: row.getAttribute("data-who"),
        })),
      E2E_LIVE_ROWS,
    )
    .then((raw): readonly E2eRow[] | undefined => rowsOf({ raw }))
    .catch(() => undefined);
}

/** One snapshot of every live row on a Playwright page, `undefined` when the page cannot be read. */
async function pageLive({ page }: { page: Page }): Promise<LiveSnapshot | undefined> {
  return page
    .evaluate(
      (selector) =>
        [...document.querySelectorAll(selector)].map((row) => ({
          final: row.getAttribute("data-final"),
          medium: row.getAttribute("data-medium"),
          text: row.textContent,
          who: row.getAttribute("data-who"),
        })),
      E2E_ANY_LIVE_ROWS,
    )
    .then((raw): LiveSnapshot | undefined => liveSnapshotOf({ raw }))
    .catch(() => undefined);
}

/**
 * A view over a Playwright page.
 *
 * @param page the voice page
 * @returns the view
 */
export function pageView({ page }: { page: Page }): VoiceView {
  return {
    click: async ({ selector }) =>
      page
        .locator(selector)
        .first()
        .click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false),
    count: async ({ selector, text }) =>
      page
        .locator(selector)
        .filter({ hasText: text })
        .count()
        .catch(() => 0),
    enabled: async ({ selector }) => {
      const one = page.locator(selector).first();
      return (await one.isVisible().catch(() => false)) && one.isEnabled().catch(() => false);
    },
    fill: async ({ selector, text }) =>
      page
        .locator(selector)
        .first()
        .fill(text, { timeout: 5000 })
        .then(() => true)
        .catch(() => false),
    page,
    photograph: async ({ path }) =>
      page
        .screenshot({ path })
        .then(() => path)
        .catch(() => undefined),
    ready: async () =>
      Promise.race([
        page.evaluate(() => document.readyState === "complete").catch(() => false),
        pause({ ms: 2000 }).then(() => false),
      ]),
    readLive: async () => pageLive({ page }),
    rows: async () => noneUnread({ read: await pageRows({ page }) }),
    shows: async ({ selector }) =>
      page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false),
    url: async () => (page.isClosed() ? undefined : page.url()),
    value: async ({ selector }) =>
      page
        .locator(selector)
        .first()
        .inputValue({ timeout: 2000 })
        .catch(() => undefined),
  };
}

/**
 * Run a script in the ONE live web contents whose page is `/voice`, from the main process.
 *
 * @param app the instance
 * @param script an expression, evaluated as a user gesture
 * @returns the script's value, `undefined` when not exactly one contents matched or the run threw
 */
async function inVoiceContents({ app, script }: { app: ElectronApplication; script: string }): Promise<unknown> {
  return app
    .evaluate(
      async ({ webContents }, input) => {
        // `src/` has no Electron types, so the one shape read here is spelled out.
        const all: readonly {
          isDestroyed: () => boolean;
          isCrashed: () => boolean;
          getURL: () => string;
          // named-object-params-exempt: Electron's WebContents.executeJavaScript(code, userGesture), spelled out because `src/` has no Electron types
          executeJavaScript: (code: string, userGesture: boolean) => Promise<unknown>;
        }[] = webContents.getAllWebContents();
        const matching = all.filter((contents) => {
          try {
            const { pathname } = new URL(contents.getURL());
            return !contents.isDestroyed() && !contents.isCrashed() && pathname === input.path;
          } catch {
            return false;
          }
        });
        return matching.length === 1 ? matching[0]!.executeJavaScript(input.script, true) : undefined;
      },
      { path: VOICE_PATH, script },
    )
    .catch(() => undefined);
}

/**
 * Photograph the ONE web contents whose page is `/voice`, from the main process.
 *
 * @param app the instance
 * @returns the PNG, base64, or `undefined` when not exactly one contents matched or the capture threw
 */
export async function captureVoiceContents({ app }: { app: ElectronApplication }): Promise<string | undefined> {
  return app
    .evaluate(async ({ webContents }, voicePath) => {
      const all: readonly {
        isDestroyed: () => boolean;
        getURL: () => string;
        capturePage: () => Promise<{ toPNG: () => { toString: (encoding: "base64") => string } }>;
      }[] = webContents.getAllWebContents();
      const matching = all.filter((contents) => {
        try {
          return !contents.isDestroyed() && new URL(contents.getURL()).pathname === voicePath;
        } catch {
          return false;
        }
      });
      return matching.length === 1 ? (await matching[0]!.capturePage()).toPNG().toString("base64") : undefined;
    }, VOICE_PATH)
    .catch(() => undefined);
}

/**
 * A script over the first match of a selector, bound to `el`.
 *
 * @param selector what to match
 * @param body statements over `el`, never null inside them, ending in a `return`
 * @param none what the script answers when nothing matches
 * @returns the script
 */
function overFirst({ selector, body, none }: { selector: string; body: string; none: string }): string {
  const find = `const el = document.querySelector(${JSON.stringify(selector)});`;
  return `(() => { ${find} if (el === null) { return ${none}; } ${body} })()`;
}

/** Statements binding `seen` to whether `el` is visible as Playwright judges it: a box, and not hidden. */
const VISIBLE =
  "const box = el.getBoundingClientRect(); " +
  "const seen = box.width > 0 && box.height > 0 && el.checkVisibility({ visibilityProperty: true });";

/** React owns a text box's value, so it is set through the prototype's setter and announced as typed input. */
const fillBody = ({ text }: { text: string }): string =>
  'const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set; ' +
  "if (setter === undefined) { return false; } " +
  `el.focus(); setter.call(el, ${JSON.stringify(text)}); ` +
  'el.dispatchEvent(new Event("input", { bubbles: true })); return true;';

/**
 * A view over the voice window's web contents, through the main process.
 *
 * @param app the instance
 * @returns the view
 */
export function contentsView({ app }: { app: ElectronApplication }): VoiceView {
  const isTrue = async ({ selector, body }: { selector: string; body: string }): Promise<boolean> =>
    (await inVoiceContents({ app, script: overFirst({ body, none: "false", selector }) })) === true;
  const contentsRows = async (): Promise<readonly E2eRow[] | undefined> => {
    const script = `[...document.querySelectorAll(${JSON.stringify(E2E_LIVE_ROWS)})].map((row) => ({ medium: row.getAttribute("data-medium"), text: row.textContent, who: row.getAttribute("data-who") }))`;
    const raw = await inVoiceContents({ app, script });
    if (!Array.isArray(raw)) {
      return undefined;
    }
    return rowsOf({ raw: raw.filter(isRawRow) });
  };
  const contentsLive = async (): Promise<LiveSnapshot | undefined> => {
    const script = `[...document.querySelectorAll(${JSON.stringify(E2E_ANY_LIVE_ROWS)})].map((row) => ({ final: row.getAttribute("data-final"), medium: row.getAttribute("data-medium"), text: row.textContent, who: row.getAttribute("data-who") }))`;
    const raw = await inVoiceContents({ app, script });
    if (!Array.isArray(raw)) {
      return undefined;
    }
    return liveSnapshotOf({ raw: raw.filter(isRawLiveRow) });
  };
  return {
    click: async ({ selector }) =>
      isTrue({ body: `${VISIBLE} if (!seen) { return false; } el.click(); return true;`, selector }),
    count: async ({ selector, text }) => {
      const matches = `[...document.querySelectorAll(${JSON.stringify(selector)})]`;
      const script = `${matches}.filter((el) => String(el.textContent).includes(${JSON.stringify(text)})).length`;
      const counted = await inVoiceContents({ app, script });
      return typeof counted === "number" ? counted : 0;
    },
    enabled: async ({ selector }) => isTrue({ body: `${VISIBLE} return seen && el.disabled !== true;`, selector }),
    fill: async ({ selector, text }) => isTrue({ body: fillBody({ text }), selector }),
    page: undefined,
    photograph: async ({ path }) => {
      const png = await captureVoiceContents({ app });
      if (png === undefined) {
        return undefined;
      }
      // A write that fails is no photograph, as on the page route, never a throw past the session's close (Codex
      // call-r2-cleanup).
      try {
        writeFileSync(path, Buffer.from(png, "base64"));
        return path;
      } catch {
        return undefined;
      }
    },
    ready: async () => (await inVoiceContents({ app, script: 'document.readyState === "complete"' })) === true,
    readLive: async () => contentsLive(),
    rows: async () => noneUnread({ read: await contentsRows() }),
    shows: async ({ selector }) => isTrue({ body: `${VISIBLE} return seen;`, selector }),
    url: async () => {
      const href = await inVoiceContents({ app, script: "location.href" });
      return typeof href === "string" ? href : undefined;
    },
    value: async ({ selector }) => {
      const body = 'return typeof el.value === "string" ? el.value : null;';
      const read = await inVoiceContents({ app, script: overFirst({ body, none: "null", selector }) });
      return typeof read === "string" ? read : undefined;
    },
  };
}

/**
 * Whether a value is one raw row as the page's script built it.
 *
 * @param value what the script answered for one row
 * @returns whether it is a row
 */
function isRawRow(
  value: unknown,
): value is { readonly who: string | null; readonly text: string | null; readonly medium: string | null } {
  return (
    isRecord(value) &&
    [value["who"], value["text"], value["medium"]].every((field) => field === null || typeof field === "string")
  );
}

/**
 * Whether a value is one raw live row as the snapshot's script built it, its `data-final` included.
 *
 * @param value what the script answered for one row
 * @returns whether it is a live row
 */
function isRawLiveRow(value: unknown): value is {
  readonly who: string | null;
  readonly text: string | null;
  readonly medium: string | null;
  readonly final: string | null;
} {
  return isRecord(value) && (value["final"] === null || typeof value["final"] === "string") && isRawRow(value);
}
