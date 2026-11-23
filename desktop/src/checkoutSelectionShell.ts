/**
 * Which Slopweaver clone serves the console, and the one way to change it from inside the app: a native folder picker
 * the console's note offers when there is none, or the one it had is gone. Owns the checkout the rest of the shell
 * reads through `servedCheckout`, so a downloaded app with no clone set is never a dead end. Starts no process: the
 * chosen folder is checked by `validateCheckout`, remembered, and the console's existing recovery takes it from there.
 */
import { resolve } from "node:path";

import { dialog } from "electron";
import { err, type Result } from "neverthrow";

import { chosenFolder } from "./checkoutSelection";
import { validateCheckout } from "./consoleServer";
import { type CheckoutError, CheckoutErrors } from "./errors";
import { chooseCheckout } from "./startupReads";

/** What the selection reads from, and asks of, the rest of the shell. */
export interface CheckoutSelectionHost {
  /** The checkout the saved state names, `null` before one was chosen. */
  readonly savedCheckout: () => string | null;
  /** Write a change to the saved state; a chosen checkout goes `immediate` so a quit straight after cannot lose it. */
  readonly save: (options: { readonly change: { readonly checkout: string }; readonly immediate: boolean }) => void;
  /** Bring the console up from the checkout now chosen, or redraw the note with why it cannot be. */
  readonly retry: () => void;
}

let host: CheckoutSelectionHost | undefined;
let current: Result<string, CheckoutError> = err(CheckoutErrors.unset());
/** A picker is open, so a second press of the note's button raises no second one. */
let picking = false;

/**
 * The checkout the console is served from, or why there is none.
 *
 * @returns the validated checkout's path, or the checkout problem standing
 */
export function servedCheckout(): Result<string, CheckoutError> {
  return current;
}

/**
 * Take a checkout as the one served, remembering a good one that the saved state does not already name. An invalid
 * one is never remembered.
 */
function adopt({ chosen }: { chosen: Result<string, CheckoutError> }): void {
  current = chosen;
  if (host !== undefined && chosen.isOk() && host.savedCheckout() !== chosen.value) {
    host.save({ change: { checkout: chosen.value }, immediate: true });
  }
}

/**
 * Settle the checkout at start: the process's `--checkout`, else the saved one, else a dev run's own
 * (`chooseCheckout`).
 *
 * @param selectionHost the rest of the shell
 */
export function startCheckoutSelection({ selectionHost }: { selectionHost: CheckoutSelectionHost }): void {
  host = selectionHost;
  adopt({ chosen: chooseCheckout({ argv: process.argv, savedCheckout: selectionHost.savedCheckout() }) });
}

/**
 * Open one folder picker and serve the console from what it chose. A cancel changes nothing; an invalid folder or a
 * failed picker becomes the checkout problem the note redraws with, offering the picker again.
 */
export function chooseCheckoutFolder(): void {
  if (picking || host === undefined) {
    return;
  }
  picking = true;
  void pickAndAdopt({ selectionHost: host }).finally(() => {
    picking = false;
  });
}

/** One picker, and what its answer does: a cancel nothing, a folder or a failure the checkout the console retries with. */
async function pickAndAdopt({ selectionHost }: { selectionHost: CheckoutSelectionHost }): Promise<void> {
  let answer: Electron.OpenDialogReturnValue;
  try {
    answer = await dialog.showOpenDialog({
      buttonLabel: "Choose",
      message: "Choose the folder you cloned Slopweaver into.",
      properties: ["openDirectory"],
      title: "Choose a Slopweaver clone",
    });
  } catch (cause: unknown) {
    adopt({ chosen: err(CheckoutErrors.selectionFailed({ cause })) });
    selectionHost.retry();
    return;
  }
  const folder = chosenFolder({ canceled: answer.canceled, filePaths: answer.filePaths });
  if (folder === undefined) {
    return;
  }
  adopt({ chosen: validateCheckout({ path: resolve(folder) }) });
  selectionHost.retry();
}
