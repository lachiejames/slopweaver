/**
 * `desktop e2e --context`'s effectful half: put a launched test instance's console in the work context asked for, the
 * way the switcher does — the stored choice and the Queue's address both — and read both back before any step or call
 * runs. What the values are is the pure half's (`../../../desktop/e2eWorkContext.ts`).
 *
 * Only the TEST instance is touched: its saved state is its own throwaway folder (`./e2eWalkLeg.ts`,
 * `./e2eCallSession.ts`), so the owner's app keeps the context the owner chose.
 */
import { join } from "node:path";

import type { ElectronApplication, Page } from "playwright-core";

import { err, ok, type Result } from "#lib/result.js";
import { type ContextNotChosenError, type DesktopE2eError, DesktopE2eErrors } from "../../../desktop/e2eErrors.js";
import {
  E2E_CONTEXT_STORAGE_KEY,
  E2E_DRAWN_CONTEXT_ATTRIBUTE,
  type E2eWorkContext,
  e2eContextQueuePath,
  e2eDrawnContextSelector,
} from "../../../desktop/e2eWorkContext.js";
import { closeE2eApp, launchE2eApp } from "./e2eApp.js";
import { consolePathOfUrl, photograph, SETTLE_CAP_MS, waitForPage } from "./e2ePage.js";

/** How long the instance has to show its Queue page, from launch. A cold console read is the slow part. */
const CONSOLE_SHOWN_CAP_MS = 90_000;

/**
 * The walk's console Queue once it shows, put in the context the run asked for before the first step, so no
 * photograph is taken in a context the run did not ask for.
 *
 * @param app the launched instance
 * @param context the context asked for, or `undefined` to leave the instance as it opened
 * @param out the proof folder, where a console that never showed is photographed
 * @returns the Queue page, or that the console never showed or the context could not be chosen
 */
export async function consoleInE2eContext({
  app,
  context,
  out,
}: {
  app: ElectronApplication;
  context: E2eWorkContext | undefined;
  out: string;
}): Promise<Result<Page, DesktopE2eError>> {
  const queue = await waitForPage({ app, capMs: CONSOLE_SHOWN_CAP_MS, path: "/queue" });
  if (queue === undefined) {
    const [any] = app.context().pages();
    if (any !== undefined) {
      await photograph({ page: any, path: join(out, "00-console-never-shown.png") });
    }
    return err(DesktopE2eErrors.consoleNeverShown({ seconds: CONSOLE_SHOWN_CAP_MS / 1000 }));
  }
  const chosen = await chooseE2eContext({ app, context });
  if (chosen.isErr()) {
    return err(chosen.error);
  }
  return ok(queue);
}

/**
 * Set the instance's console to a context and wait until its Queue shows it.
 *
 * @param app the launched instance
 * @param context the context asked for, or `undefined` to leave the instance as it opened
 * @returns nothing once the Queue's address, the stored choice and its drawn context (the sidebar switcher's
 *   `data-context`) all name the context, or why
 *   not — the caller closes the instance rather than walk it in the wrong context
 */
export async function chooseE2eContext({
  app,
  context,
}: {
  app: ElectronApplication;
  context: E2eWorkContext | undefined;
}): Promise<Result<void, ContextNotChosenError>> {
  if (context === undefined) {
    return ok(undefined);
  }
  const queue = await waitForPage({ app, capMs: SETTLE_CAP_MS, path: "/queue" });
  if (queue === undefined) {
    const detail = `the console's Queue never showed, so the ${context} context could not be chosen`;
    return err(DesktopE2eErrors.contextNotChosen({ detail }));
  }
  const path = e2eContextQueuePath({ context });
  try {
    await queue.evaluate(
      ([key, value]) => {
        globalThis.localStorage.setItem(key, value);
      },
      [E2E_CONTEXT_STORAGE_KEY, context] as const,
    );
    // Only the address is awaited, never the `load` event: a worktree's DEV console still compiling chunks under load
    // took past 30s to fire it on a route that had already answered, and walked nothing. What proves the context is
    // the address, the stored choice and the drawn chip below, each under its own cap.
    await queue.goto(new URL(path, queue.url()).toString(), { timeout: SETTLE_CAP_MS, waitUntil: "commit" });
    await queue.waitForURL(
      (url) => consolePathOfUrl({ url: url.toString() }) === "/queue" && url.searchParams.get("context") === context,
      { timeout: SETTLE_CAP_MS, waitUntil: "commit" },
    );
    const stored = await queue.evaluate((key) => globalThis.localStorage.getItem(key), E2E_CONTEXT_STORAGE_KEY);
    if (stored !== context) {
      const detail = `the console kept the context "${String(stored)}" after the ${context} context was chosen`;
      return err(DesktopE2eErrors.contextNotChosen({ detail }));
    }
    // The address and the stored choice say what was ASKED; the drawn context says what the Queue drew.
    // The Queue has no page head, so its one carrier is the sidebar switcher; a page chip, where drawn, must agree.
    await queue.waitForSelector(e2eDrawnContextSelector({ context }), { state: "visible", timeout: SETTLE_CAP_MS });
    const drawn = await queue
      .locator(`[${E2E_DRAWN_CONTEXT_ATTRIBUTE}]`)
      .evaluateAll(
        (marks, attribute) => marks.map((mark) => mark.getAttribute(attribute)),
        E2E_DRAWN_CONTEXT_ATTRIBUTE,
      );
    const other = drawn.filter((value) => value !== context);
    if (other.length > 0) {
      const detail = `the Queue drew the context "${String(other[0])}" after the ${context} context was chosen`;
      return err(DesktopE2eErrors.contextNotChosen({ detail }));
    }
    return ok(undefined);
  } catch (cause: unknown) {
    return err(
      DesktopE2eErrors.contextNotChosen({ detail: `choosing the ${context} context threw: ${String(cause)}` }),
    );
  }
}

/**
 * Launch a test instance and put its console in the context asked for, closing it when the context cannot be chosen,
 * so neither a step nor a Talk press runs over a context the run did not ask for.
 *
 * @param launch what the instance is launched with
 * @param context the context asked for, or `undefined` to leave the instance as it opened
 * @returns the running instance, or why it did not launch or could not be put in the context
 */
export async function launchInE2eContext({
  launch,
  context,
}: {
  launch: Parameters<typeof launchE2eApp>[0];
  context: E2eWorkContext | undefined;
}): Promise<Result<ElectronApplication, string>> {
  const launched = await launchE2eApp(launch);
  if (launched.isErr()) {
    return err(launched.error.message);
  }
  const chosen = await chooseE2eContext({ app: launched.value, context });
  if (chosen.isErr()) {
    await closeE2eApp({ app: launched.value });
    return err(chosen.error.detail);
  }
  return ok(launched.value);
}
