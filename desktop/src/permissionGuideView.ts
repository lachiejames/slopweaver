/**
 * What the permissions guide says: its headline, its rows and the step it walks the owner through now, with that step's
 * numbered instructions, button and reopen offer. Pure; `permissionGuidePage.ts` draws it.
 */
import type { InputControlView } from "./inputControlConsent";
import {
  COPY,
  GUIDED_PERMISSIONS,
  type GuideStep,
  type GuideView,
  type MacAccessStatus,
  missingPermissions,
  namesOf,
  type PermissionId,
  type PermissionStatuses,
  permissionStanding,
} from "./permissionGuide";

/**
 * Decide what the guide says.
 *
 * @param statuses what macOS answered for each permission
 * @param settingsVisited the permissions whose Settings page this run of the app opened
 * @param promptsRaised the permissions whose macOS prompt this run of the app has already raised
 * @param appName the name the app carries in System Settings — "Electron" for a dev build
 * @param callLive whether a voice call is up, which reopening the app would end
 * @param inputControl the optional mouse and keyboard control step, drawn only once every voice permission is on
 * @param problem why the last press did nothing, when it failed
 * @returns the guide's lines, rows and current step
 */
export function guideView({
  statuses,
  settingsVisited,
  promptsRaised,
  appName,
  callLive,
  inputControl,
  problem,
}: {
  statuses: PermissionStatuses;
  settingsVisited: readonly PermissionId[];
  promptsRaised: readonly PermissionId[];
  appName: string;
  callLive: boolean;
  inputControl: InputControlView;
  problem: string | undefined;
}): GuideView {
  const rows = GUIDED_PERMISSIONS.map((permission) => ({
    label: COPY[permission].label,
    permission,
    standing: permissionStanding({ status: statuses[permission] }),
    why: COPY[permission].why,
  }));
  const missing = missingPermissions({ statuses });
  const first = missing[0];
  if (first === undefined) {
    return {
      appName,
      headline: "You're set: the voice can hear you, keep talking when you switch headphones, and see your screen.",
      inputControl,
      problem,
      rows,
      step: undefined,
      sub: "Press the orb, then talk, to start a call.",
    };
  }
  return {
    appName,
    headline: `Turn on ${namesOf({ permissions: missing })} for ${appName}`,
    inputControl,
    problem,
    rows,
    step: guideStep({
      appName,
      callLive,
      permission: first,
      raised: promptsRaised.includes(first),
      status: statuses[first],
      visited: settingsVisited.includes(first),
    }),
    sub: "Each is one switch in System Settings. This window opens the exact page, shows you the switch, and ticks it off once it is on.",
  };
}

/**
 * The step for one permission still off.
 *
 * @param status what macOS answered for it
 * @param raised whether this run already raised its macOS prompt
 * @param visited whether this run opened its Settings page
 * @param appName the name the app carries in System Settings
 * @param callLive whether a call is up, which reopening would end
 * @returns its instructions, button and reopen offer
 */
function guideStep({
  permission,
  status,
  raised,
  visited,
  appName,
  callLive,
}: {
  permission: PermissionId;
  status: MacAccessStatus;
  raised: boolean;
  visited: boolean;
  appName: string;
  callLive: boolean;
}): GuideStep {
  const copy = COPY[permission];
  // A prompt this run raised may still be up, unanswered, even once its asker stopped waiting: a second ask would
  // stack another over it, so the step sends the owner to Settings instead.
  const fromStatus = permissionStanding({ status });
  const standing = raised && fromStatus === "ask" ? "settings" : fromStatus;
  let reopen: GuideStep["reopen"] = "none";
  // Not System Audio Recording: whether macOS applies its switch only after a reopen is unmeasured, so the guide
  // re-reads it rather than sending the owner through a quit that may change nothing.
  if (visited && standing === "settings" && permission !== "systemAudio") {
    reopen = callLive ? "after-call" : "offer";
  }
  const common = { label: copy.label, paneTitle: copy.paneTitle, permission, reopen, standing };
  if (standing === "managed") {
    return {
      ...common,
      button: undefined,
      how: [
        `This Mac's management profile decides ${copy.label}, so there is no switch for you to press.`,
        `Whoever manages this Mac has to allow ${copy.label} for ${appName}.`,
      ],
    };
  }
  if (standing === "ask") {
    return {
      ...common,
      button: { label: `Allow ${copy.label}`, link: { kind: "ask", permission } },
      how: askHow({ appName, label: copy.label, permission }),
    };
  }
  return {
    ...common,
    button: { label: `Open ${copy.label} settings`, link: { kind: "settings", permission } },
    how: settingsHow({ appName, label: copy.label, permission }),
  };
}

/**
 * The numbered lines for a permission macOS has never asked about.
 *
 * @param label its name in System Settings
 * @param appName the name the app carries in System Settings
 * @returns the lines
 */
function askHow({
  permission,
  label,
  appName,
}: {
  permission: PermissionId;
  label: string;
  appName: string;
}): string[] {
  switch (permission) {
    case "microphone":
    case "systemAudio":
      return [`Press Allow ${label} below.`, "macOS asks once: choose Allow."];
    case "screen":
      return [
        `Press Allow ${label} below.`,
        "macOS asks once: choose Open System Settings.",
        `Turn on ${appName}'s switch.`,
        "When macOS asks, press Quit & Reopen.",
      ];
    default: {
      const unhandled: never = permission;
      return unhandled;
    }
  }
}

/**
 * The numbered lines for a permission refused, or one macOS will not name, walked through its Settings page.
 *
 * @param label its name in System Settings
 * @param appName the name the app carries in System Settings
 * @returns the lines
 */
function settingsHow({
  permission,
  label,
  appName,
}: {
  permission: PermissionId;
  label: string;
  appName: string;
}): string[] {
  const open = `Press Open ${label} settings below: it opens the exact page.`;
  switch (permission) {
    case "microphone":
      return [
        open,
        `Find ${appName} in the list.`,
        `Turn its switch on. If this window does not tick it off, reopen ${appName}.`,
      ];
    case "systemAudio":
      return [
        open,
        `Scroll to the "System Audio Recording Only" list and find ${appName} there (not there? press + under it and choose it in Applications).`,
        "Turn its switch on. This window ticks it off once macOS has it.",
      ];
    case "screen":
      return [
        open,
        `Find ${appName} in the list (not there? press + and choose it in Applications).`,
        "Turn its switch on.",
        "When macOS asks, press Quit & Reopen. Already on and still asked? Select it, remove it with −, and allow it again.",
      ];
    default: {
      const unhandled: never = permission;
      return unhandled;
    }
  }
}
