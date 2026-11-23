/**
 * The optional mouse and keyboard control step, applied to Electron: macOS's Accessibility trust read with no prompt,
 * the one press that may raise its prompt, and its Settings page. The decisions are `inputControlConsent.ts`; the
 * guide's window, its re-reads and its close are `permissionGuideShell.ts`, which calls in here.
 */
import { shell, systemPreferences } from "electron";
import { ResultAsync } from "neverthrow";

import { PermissionGuideErrors } from "./errors";
import {
  INPUT_CONTROL_SETTINGS_URL,
  type InputControlConsent,
  type InputControlView,
  inputControlView,
} from "./inputControlConsent";
import type { GuideLink } from "./permissionGuide";

/** One of the optional step's three links. */
export type InputControlLink = GuideLink & {
  readonly kind: "input-control-accept" | "input-control-decline" | "input-control-settings";
};

/** Whether macOS trusted the app with Accessibility at the last read; read with no prompt, every time. */
let trusted = false;
/** The owner opened the optional step from the menu bar, so it is offered even after Not now; cleared as the guide closes. */
let review = false;

/**
 * Whether a guide link is one of the optional step's.
 *
 * @param link the link the guide asked for
 * @returns whether this module carries it out
 */
export function isInputControlLink(link: GuideLink): link is InputControlLink {
  return (
    link.kind === "input-control-accept" ||
    link.kind === "input-control-decline" ||
    link.kind === "input-control-settings"
  );
}

/** Read macOS's Accessibility trust again, never prompting; off macOS there is no switch, so it reads as done. */
export function readInputControlTrust(): void {
  // `false`: only READ the trust. Passing `true` raises macOS's prompt, which only the owner's accept press may do.
  trusted = process.platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(false) : true;
}

/**
 * Mark the step as reopened from its menu bar item, or end that as the guide closes.
 *
 * @param reviewing whether the owner asked for the step themselves
 */
export function setInputControlReview({ reviewing }: { reviewing: boolean }): void {
  review = reviewing;
}

/**
 * Where the optional step stands now.
 *
 * @param appName the name macOS lists the app under
 * @param consent the owner's saved answer, `undefined` before they give one
 * @returns the step's standing and what it offers
 */
export function inputControlNow({
  appName,
  consent,
}: {
  appName: string;
  consent: InputControlConsent | undefined;
}): InputControlView {
  return inputControlView({ appName, consent, review, trusted });
}

/**
 * Carry out one of the optional step's links. Accepting records the owner's consent FIRST, then asks macOS once — the one
 * place the trust call is passed `true`, which raises macOS's own prompt; every read passes `false`. A consent that
 * could not be saved asks nothing: the press says why instead.
 *
 * @param link the optional step's link
 * @param remember saves the owner's answer, at once, answering why it could not
 * @param close closes the guide as the shell's own close, never read as the owner's Not now
 * @returns why the press did nothing, `undefined` when it worked
 */
export async function actOnInputControl({
  link,
  remember,
  close,
}: {
  link: InputControlLink;
  remember: (options: { readonly consent: InputControlConsent }) => string | undefined;
  close: () => void;
}): Promise<string | undefined> {
  if (link.kind === "input-control-decline") {
    const unsaved = remember({ consent: "not-now" });
    close();
    return unsaved;
  }
  if (link.kind === "input-control-accept") {
    const unsaved = remember({ consent: "accepted" });
    if (unsaved !== undefined) {
      return `your answer could not be saved, so macOS was not asked: ${unsaved}`;
    }
    if (process.platform === "darwin") {
      systemPreferences.isTrustedAccessibilityClient(true);
    }
    return undefined;
  }
  const opened = await ResultAsync.fromPromise(shell.openExternal(INPUT_CONTROL_SETTINGS_URL), (cause) =>
    PermissionGuideErrors.settingsOpenFailed({ cause, url: INPUT_CONTROL_SETTINGS_URL }),
  );
  return opened.isErr() ? opened.error.message : undefined;
}
