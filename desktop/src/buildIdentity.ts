/**
 * Which Slopweaver this is, said on every window. Pure.
 *
 * A desktop app wearing Electron's atom, called "Electron" in the Dock, is indistinguishable from a dev run of this
 * shell a session left open. So every window the shell opens names Slopweaver, a run from source says it is a dev build and of which checkout, and the
 * Dock wears the logo with a `dev` badge. A dev run also keeps its own saved state, so it can neither write a
 * worktree into the installed app's remembered checkout nor be swallowed by its single-instance lock.
 */
import { basename } from "node:path";

/** The build a window belongs to. */
export interface BuildIdentity {
  /** Run from source (`yarn start`), not the packaged app. */
  readonly dev: boolean;
  /** The name every window carries. */
  readonly label: string;
  /** The checkout its console is served from, when one is set. */
  readonly checkout: string | undefined;
}

/** The product's name. */
const PRODUCT = "Slopweaver";

/** A dev run's own directory under Application Support, beside the installed app's `Slopweaver`. */
export const DEV_USER_DATA = "Slopweaver Dev";

/** The Dock badge a dev run wears over the logo. */
export const DEV_DOCK_BADGE = "dev";

/**
 * The identity of this run.
 *
 * @param packaged Electron's `app.isPackaged`: false for a run from source
 * @param checkout the checkout the console is served from, when one validated
 * @returns the name every window carries
 */
export function buildIdentity({
  packaged,
  checkout,
}: {
  packaged: boolean;
  checkout: string | undefined;
}): BuildIdentity {
  if (packaged) {
    return { checkout, dev: false, label: PRODUCT };
  }
  if (checkout === undefined) {
    return { checkout, dev: true, label: `${PRODUCT} (dev build)` };
  }
  return { checkout, dev: true, label: `${PRODUCT} (dev build · ${basename(checkout)})` };
}

/**
 * A window's title: never a bare page title, and in a dev run always saying so.
 *
 * @param identity this run
 * @param page the title the window's document asks for
 * @returns the label alone for an empty page; a page already naming Slopweaver with that name made the label; any
 *   other page followed by the label
 */
export function windowTitle({ identity, page }: { identity: BuildIdentity; page: string }): string {
  const trimmed = page.trim();
  if (trimmed.length === 0) {
    return identity.label;
  }
  if (trimmed.includes(PRODUCT)) {
    return trimmed.replace(PRODUCT, identity.label);
  }
  return `${trimmed} · ${identity.label}`;
}

/**
 * The line a dev run puts first in the menu bar's menu.
 *
 * @param identity this run
 * @returns which checkout this dev build serves, or `undefined` for the packaged app
 */
export function trayIdentityLine({ identity }: { identity: BuildIdentity }): string | undefined {
  if (!identity.dev) {
    return undefined;
  }
  if (identity.checkout === undefined) {
    return "Dev build: no checkout set";
  }
  return `Dev build of ${identity.checkout}`;
}
