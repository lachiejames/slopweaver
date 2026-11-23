/**
 * Which page a "Reveal in Finder" copies out of the store, where the copy goes, and what the export's answer means,
 * decided without touching anything. A browser page cannot be dragged into Slack as an attachment, and navigating
 * to its path by hand is the chore this removes. The store is a page's only copy (`docs/store/published-pages.md`),
 * so Reveal copies one out, once.
 *
 * Least privilege, the shape `queueCardTabPath` (`desktopBridge.ts`) already has: the console window sends a page's
 * slug and never a path. The shell names the file itself, inside a private directory it made, and `page export`
 * creates exactly that file and nothing else. `pageRevealShell.ts` is the effectful half. Pure.
 */
import { join, resolve } from "node:path";

import { err, ok, type Result } from "neverthrow";

import type { DesktopRole } from "./desktopBridge";

/** What a page's slug may be: `src/pages/url.ts`'s `PAGE_SLUG`, restated because the shell cannot import `src/`. */
const PAGE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/**
 * The shell's Slopweaver home, resolved exactly as the console resolves its own (`site/lib/consoleHome.ts`):
 * `$SLOPWEAVER_HOME` when it is set and not blank, else `~/.slopweaver`. The shell starts the console with its own
 * environment (`consoleEndpoint.ts` `childEnv`), so both read the same home. The desktop tree's one reading of it.
 *
 * @param envHome the shell's `SLOPWEAVER_HOME`, as set
 * @param userHome the owner's own home directory
 * @returns the absolute home directory
 */
export function shellHomeOf({ envHome, userHome }: { envHome: string | undefined; userHome: string }): string {
  if (envHome !== undefined && envHome.trim() !== "") {
    return resolve(envHome);
  }
  return join(userHome, ".slopweaver");
}

/**
 * The page a reveal asks for: only from the console window, and only exactly one page's slug.
 *
 * @param role which window asked, `undefined` for anything that is not one of the shell's own
 * @param value what it sent: the page's slug
 * @returns the slug, or the one line saying why there is no page to reveal, which never names a path
 */
export function pageToReveal({
  role,
  value,
}: {
  role: DesktopRole | undefined;
  value: unknown;
}): Result<string, string> {
  if (role !== "main") {
    return err("only the console window may reveal a page in Finder");
  }
  if (typeof value !== "string" || !PAGE_SLUG.test(value)) {
    return err("that is not a page's name, so there is no file to reveal");
  }
  return ok(value);
}

/**
 * The one file a page is copied out to, inside the directory the shell made for this reveal: named for the page, so
 * what lands in Slack says which page it is.
 *
 * @param dir the private directory made for this reveal
 * @param slug the page
 * @returns the absolute file
 */
export function exportFileOf({ dir, slug }: { dir: string; slug: string }): string {
  return join(dir, `${slug}.html`);
}

/**
 * What `slopweaver page export --json` answered, read strictly: the file it wrote when it says it wrote exactly the
 * one asked for, else one line naming the page and never a path, because a filesystem error carries the owner's home.
 *
 * @param slug the page asked for
 * @param file the file the shell asked for
 * @param code the export's exit code
 * @param stdout what it printed
 * @returns the file to reveal, or why there is none
 */
export function exportAnswer({
  slug,
  file,
  code,
  stdout,
}: {
  slug: string;
  file: string;
  code: number;
  stdout: string;
}): Result<string, string> {
  let document: unknown;
  try {
    document = JSON.parse(stdout.trim());
  } catch {
    return err(`the page "${slug}" could not be copied out of the store`);
  }
  const kind = typeof document === "object" && document !== null && "kind" in document ? document.kind : undefined;
  if (kind === "not-found") {
    return err(`the page "${slug}" is not in the store, so there is nothing to reveal`);
  }
  if (kind === "store-unreadable") {
    return err(`the store could not be read, so the page "${slug}" could not be copied out`);
  }
  const wrote = typeof document === "object" && document !== null && "path" in document ? document.path : undefined;
  if (code !== 0 || kind !== "exported" || wrote !== file) {
    return err(`the page "${slug}" could not be copied out of the store`);
  }
  return ok(file);
}
