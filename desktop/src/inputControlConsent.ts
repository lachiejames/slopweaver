/**
 * Mouse and keyboard control — macOS Accessibility — as an OPTIONAL consent step in the permissions guide. Pure;
 * `permissionGuideShell.ts` reads macOS and records the owner's answer.
 *
 * Mouse and keyboard control is OFF by
 * default and offered as a consent step in onboarding. So it is never a voice permission: it is kept out of
 * `GUIDED_PERMISSIONS`, which feeds every surface that nags (`missingPermissions`, `guideRaisesAtLaunch`,
 * `guideMenuLabel`), and it never raises the guide on its own. It is offered only once the guide is already up with
 * every voice permission on, or when the owner opens it deliberately from the menu bar; Not now is remembered.
 *
 * The owner's answer is CONSENT, never the grant: `accepted` says they asked for it, and whether macOS trusts the app
 * is read from macOS every time.
 */
import type { GuideLink } from "./permissionGuide";

/** What the owner answered when offered mouse and keyboard control. Absent until they answer. */
export type InputControlConsent = "accepted" | "not-now";

/** Every answer, for the saved state's exact decoder. */
export const INPUT_CONTROL_CONSENTS: readonly InputControlConsent[] = ["accepted", "not-now"];

/**
 * Where mouse and keyboard control stands: `granted` once the owner accepted AND macOS trusts the app, `offer` while the owner has not
 * answered (or reopened it to reconsider), `settings` once they accepted and macOS does not trust the app yet,
 * `declined` after their Not now.
 */
export type InputControlStanding = "granted" | "offer" | "settings" | "declined";

/** Its name in System Settings, which the guide's row carries. */
export const INPUT_CONTROL_LABEL = "Accessibility";

/** What the guide calls it, in the owner's words rather than macOS's. */
export const INPUT_CONTROL_NAME = "Mouse & keyboard control";

/** Why it is offered, in one line, which says it is not needed for a call. */
export const INPUT_CONTROL_WHY =
  "Lets Slopweaver click and type only for a task you explicitly start. Voice calls do not need it.";

/**
 * The System Settings page its switch is on — the Privacy & Security extension id Chromium opens for Accessibility
 * (`base/mac/mac_util.mm`), with the same caveat as the guide's others: Apple publishes no contract for it.
 */
export const INPUT_CONTROL_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility";

/** The step the guide shows for it, when it shows one. */
export interface InputControlStep {
  /** The numbered instructions. */
  readonly how: readonly string[];
  /** The button. */
  readonly button: { readonly label: string; readonly link: GuideLink };
}

/** Mouse and keyboard control as the guide draws it. */
export interface InputControlView {
  readonly standing: InputControlStanding;
  /** `undefined` when there is nothing to do: granted, or declined and not reopened. */
  readonly step: InputControlStep | undefined;
}

/**
 * Decide what the guide says about mouse and keyboard control.
 *
 * @param consent what the owner answered, `undefined` before they have
 * @param review whether the owner opened it deliberately from the menu bar, which offers it again after a Not now
 * @param trusted whether macOS trusts the app with Accessibility now
 * @param appName the name the app carries in System Settings
 * @returns its standing and step
 */
export function inputControlView({
  consent,
  review,
  trusted,
  appName,
}: {
  consent: InputControlConsent | undefined;
  review: boolean;
  trusted: boolean;
  appName: string;
}): InputControlView {
  // Consent first: a trust macOS already holds (an earlier install, or a switch turned on by hand) is never the
  // owner's yes, so it grants nothing before they accept and nothing after their Not now.
  if (consent === "accepted" && trusted) {
    return { standing: "granted", step: undefined };
  }
  if (consent === "accepted") {
    return {
      standing: "settings",
      step: {
        button: { label: `Open ${INPUT_CONTROL_LABEL} settings`, link: { kind: "input-control-settings" } },
        how: [
          `Press Open ${INPUT_CONTROL_LABEL} settings below: it opens the exact page.`,
          `Find ${appName} in the list (not there? press + and choose it in Applications).`,
          "Turn its switch on. This window ticks it off once macOS has it.",
        ],
      },
    };
  }
  if (consent === "not-now" && !review) {
    return { standing: "declined", step: undefined };
  }
  return {
    standing: "offer",
    step: {
      button: { label: "Turn on mouse & keyboard control", link: { kind: "input-control-accept" } },
      how: [
        "Optional, and off until you turn it on.",
        "Press Turn on mouse & keyboard control below.",
        `macOS asks once: choose Open System Settings, then turn on ${appName}'s switch.`,
      ],
    },
  };
}
