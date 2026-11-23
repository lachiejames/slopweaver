/**
 * The viewer's "Reveal in Finder" on a local page (`slopweaver:reveal-page`): the page is copied out of the store once,
 * as one file carrying its own images, and Finder opens with that file selected, ready to drag into Slack. Which page,
 * where the copy goes and what the export answered is `pageReveal.ts`; this is the thin effectful half.
 *
 * **One copy at a time, and none kept.** Each reveal makes a private directory under the OS temp directory and the
 * checkout's own `slopweaver page export` creates the one file in it. The next reveal removes the previous copy, and
 * quitting the shell removes the last one, so no page lingers on disk past the drag it was made for (the store is a page's only copy).
 *
 * Every answer is a wire reply, never a rejection: `null` once Finder was asked, else one line naming the page and
 * never a path, because a filesystem error's own message carries the owner's home.
 */
import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { app, type IpcMainInvokeEvent, ipcMain, shell } from "electron";
import type { Result } from "neverthrow";

import type { DesktopRole } from "./desktopBridge";
import type { CheckoutError } from "./errors";
import { run } from "./fleetProcess";
import { exportAnswer, exportFileOf, pageToReveal } from "./pageReveal";

/** `page export`: the CLI's start, one store connection and a page's files. Seconds, bounded well above. */
const EXPORT_TIMEOUT_MS = 60_000;

/** The private directory holding the one copy this shell made last, removed by the next reveal or by quitting. */
let held: string | undefined;

/** Remove the copy this shell holds, if any. */
async function dropHeld(): Promise<void> {
  const dir = held;
  held = undefined;
  if (dir !== undefined) {
    await rm(dir, { force: true, recursive: true });
  }
}

/**
 * Copy one page out of the store into a fresh private directory, which becomes the one this shell holds.
 *
 * @returns the file to reveal, or the one line saying why there is none
 */
async function copyOut({ checkout, slug }: { checkout: string; slug: string }): Promise<Result<string, string>> {
  await dropHeld();
  const dir = await mkdtemp(join(tmpdir(), "slopweaver-reveal-"));
  held = dir;
  const file = exportFileOf({ dir, slug });
  const ran = await run({
    cwd: checkout,
    label: join(checkout, "bin", "slopweaver"),
    launch: ({ done, options }) =>
      execFile(join(checkout, "bin", "slopweaver"), ["page", "export", slug, "--out", file, "--json"], options, done),
    timeoutMs: EXPORT_TIMEOUT_MS,
  });
  if (ran.isErr()) {
    return exportAnswer({ code: 1, file, slug, stdout: "" });
  }
  return exportAnswer({ code: ran.value.code, file, slug, stdout: ran.value.stdout });
}

/**
 * Install the handler, and the quit hook that removes the last copy. Called once, from `main.ts`'s own message install.
 *
 * @param roleOf which of the shell's windows sent a message, on the console, from its top frame
 * @param checkout the checkout whose `bin/slopweaver` exports the page: the one the console is served from
 */
export function installPageReveal({
  roleOf,
  checkout,
}: {
  roleOf: (input: { event: IpcMainInvokeEvent }) => DesktopRole | undefined;
  checkout: () => Result<string, CheckoutError>;
}): void {
  app.on("will-quit", () => {
    if (held !== undefined) {
      rmSync(held, { force: true, recursive: true });
      held = undefined;
    }
  });
  ipcMain.handle("slopweaver:reveal-page", async (event, value: unknown): Promise<string | null> => {
    const slug = pageToReveal({ role: roleOf({ event }), value });
    if (slug.isErr()) {
      return slug.error;
    }
    const served = checkout();
    if (served.isErr()) {
      return `no checkout is chosen, so the page "${slug.value}" cannot be copied out`;
    }
    let copied: Result<string, string>;
    try {
      copied = await copyOut({ checkout: served.value, slug: slug.value });
    } catch {
      return `the page "${slug.value}" could not be copied out of the store`;
    }
    if (copied.isErr()) {
      await dropHeld();
      return copied.error;
    }
    try {
      shell.showItemInFolder(copied.value);
    } catch {
      return `Finder could not reveal the page "${slug.value}"`;
    }
    return null;
  });
}
