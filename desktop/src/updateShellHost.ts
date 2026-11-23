/**
 * The update shell's boundary: what `updateShell.ts` reads from, and asks of, the rest of the shell, what it tells
 * the console's pages, and the reader for the outcome record an update writes.
 */
import { readFileSync } from "node:fs";

import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import type { Result } from "neverthrow";

import type { CheckoutError } from "./errors";
import type { PersistedState } from "./persistedState";
import { decodeUpdateOutcome, type UpdateOutcome } from "./updatePlan";

/** What the update's half reads from, and asks of, the rest of the shell. */
export interface UpdateShellHost {
  /** The checkout whose `bin/slopweaver` runs the update. */
  readonly checkout: () => Result<string, CheckoutError>;
  /** The saved state, as last written. */
  readonly saved: () => PersistedState;
  /** Replace the saved state and write it at once — the update quits the app, so nothing may wait out a delay. */
  readonly persist: (next: PersistedState) => void;
  /** A voice call is up, in the overlay or anywhere. */
  readonly callLive: () => boolean;
  /** A window other than the overlay holds the microphone: a call the shell cannot end for the owner. */
  readonly consoleWindowHoldsMic: () => boolean;
  /** The overlay's page, while it listens for commands. */
  readonly listeningOverlay: () => WebContents | undefined;
  /**
   * Load the overlay's page if it is not loaded onto the console yet; a page already there is left as it is. The
   * restart itself is sent straight to {@link listeningOverlay}, so the shell knows whether it was handed over.
   */
  readonly ensureOverlay: () => void;
  /** Load the overlay's page afresh, onto the console as it serves now. */
  readonly reloadOverlay: () => void;
  /** Redraw the menu bar. */
  readonly drawTray: () => void;
  /** Which window sent a message: only the console's may ask anything of the update. */
  readonly roleOf: (event: IpcMainEvent | IpcMainInvokeEvent) => "main" | "overlay" | undefined;
}

/** What the console's pages are told of the update. */
export interface UpdateWire {
  readonly running: boolean;
  readonly outcome: UpdateOutcome | null;
}

/**
 * The record at `path`, when it is there and is one.
 *
 * @returns the outcome, or `undefined` while it is absent or unreadable
 */
export function readOutcome({ path }: { path: string }): UpdateOutcome | undefined {
  try {
    return decodeUpdateOutcome({ value: JSON.parse(readFileSync(path, "utf8")) });
  } catch {
    return undefined;
  }
}
