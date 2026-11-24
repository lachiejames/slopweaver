/**
 * Which work context a `desktop e2e` test instance's console is looked at in (`--context work|slopweaver`), the pure
 * half. A fresh instance opens in the console's first-visit default, the work context, so a count probe that needs a
 * NON-ZERO Queue in the other context had no way to ask for one: a count probe compared the voice's count with a Queue
 * reading Everything (0) while the Slopweaver context held twenty.
 *
 * The context is set as the console's own switcher sets it — a CHOICE writes both the stored preference and the
 * address (`site/lib/workContext.ts`) — so every page the walk reaches, and the voice window, which resolves the
 * console window's address before storage, show the one asked for. These restate the site's values because a file
 * under `src/` may not import one under `site/`; `site/__tests__/unit/e2eWorkContextMirror.test.ts` holds them equal.
 *
 * That mirror puts this module inside the console site's own typecheck, whose CI job installs only `site/`'s
 * dependencies, so it imports nothing: the flag's read, which returns a `Result`, is `./e2eContextFlag.ts`.
 */

/** The two contexts the console can be looked at in — `site/lib/workContext.ts`'s `WorkContext`. */
export type E2eWorkContext = "work" | "slopweaver";

/** The contexts `--context` accepts, in the order its usage names them. */
export const E2E_WORK_CONTEXTS: readonly E2eWorkContext[] = ["work", "slopweaver"];

/** The `localStorage` key the console keeps the chosen context under — the site's `CONTEXT_STORAGE_KEY`. */
export const E2E_CONTEXT_STORAGE_KEY = "sw-context";

/**
 * Whether a value is one of the two contexts.
 *
 * @returns true for `work` or `slopweaver`
 */
export function isE2eWorkContext(value: unknown): value is E2eWorkContext {
  return value === "work" || value === "slopweaver";
}

/**
 * The Queue's address in a context, as the switcher leaves it.
 *
 * @returns e.g. `/queue?context=slopweaver`
 */
export function e2eContextQueuePath({ context }: { context: E2eWorkContext }): string {
  return `/queue?context=${context}`;
}

/**
 * The attribute naming the context a page DREW: the sidebar's switcher carries it on every console page
 * (`site/components/console/ContextSwitcher.tsx`), and a page head's `ContextChip` carries it too. The Queue has no
 * page head, so on the Queue the switcher is the only element that carries it.
 */
export const E2E_DRAWN_CONTEXT_ATTRIBUTE = "data-context";

/**
 * The selector for the context as the RENDERED page draws it: what proves the Queue adopted the context, where the
 * address and the stored choice prove only that it was asked for.
 *
 * @returns e.g. `[data-context="slopweaver"]`
 */
export function e2eDrawnContextSelector({ context }: { context: E2eWorkContext }): string {
  return `[${E2E_DRAWN_CONTEXT_ATTRIBUTE}="${context}"]`;
}
