/**
 * The permissions guide: which macOS permissions the voice call still lacks, and a script-free window that walks the owner
 * to each switch with an animated System Settings — a pointer to the app's row, the row lit, the switch pressed on.
 * Pure; `permissionGuideShell.ts` applies it.
 *
 * A first install on a fresh Mac meets Screen Recording and the microphone before a call works, and apps remove that
 * friction with an animated finger going to the particular setting, a highlight on that setting, and the finger
 * clicking on the enable: guided permissions onboarding, not one disabled line in the menu bar.
 *
 * System Audio Recording is among them: macOS asks for it mid-call the moment the owner switches audio
 * device, and freezes every app's audio while the prompt waited (`systemAudioPermission.ts`). Asked here, it is
 * answered before any call needs it.
 *
 * The window is the notes' shape (`fleetPage.ts`): no script under a policy that allows none, every value escaped,
 * and its controls links on its own `slopweaver-guide:` scheme that the main process acts on. The animation is CSS
 * alone, and under reduced motion it is its last frame.
 */
import type { InputControlView } from "./inputControlConsent";

/**
 * A macOS permission the voice call needs. Automation (cmux) is the fleet note's own step (`fleetAutomation.ts`).
 * `systemAudio` is "System Audio Recording Only": coreaudiod asks it the first time a call's audio starts or moves
 * device, and stalls every app's audio until it is answered, so the guide asks it first (`systemAudioPermission.ts`).
 */
export type PermissionId = "microphone" | "systemAudio" | "screen";

/**
 * Every permission the guide covers, in the order a call meets them: the microphone at Start, System Audio Recording
 * as the audio starts or the owner switches headphones, Screen Recording only at a look. The guide walks the first one
 * off, so System Audio Recording comes before a Screen Recording the owner may leave for later.
 */
export const GUIDED_PERMISSIONS: readonly PermissionId[] = ["microphone", "systemAudio", "screen"];

/** What `systemPreferences.getMediaAccessStatus` answers. */
export type MacAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

/** Each guided permission's status as macOS answered it. */
export type PermissionStatuses = Readonly<Record<PermissionId, MacAccessStatus>>;

/**
 * Where one permission stands, as the guide acts on it: `ask` raises macOS's own prompt (never asked yet),
 * `settings` deep-links the switch (refused, or a status macOS will not name), `managed` is a management profile's
 * call and no switch of the owner's.
 */
export type PermissionStanding = "granted" | "ask" | "settings" | "managed";

/** The scheme the guide's links navigate to. */
export const GUIDE_SCHEME = "slopweaver-guide:";

/** The guide window's width. */
export const GUIDE_WIDTH = 420;

/** The guide window's content height; its page scrolls past it. */
export const GUIDE_HEIGHT = 640;

/** The menu bar line while the microphone is refused, and what raises the guide on it. */
export const MICROPHONE_OFF =
  "Microphone is off for Slopweaver: System Settings › Privacy & Security › Microphone (Set up permissions… walks you there)";

/** One permission as the guide describes it. */
interface PermissionCopy {
  /** Its name in System Settings. */
  readonly label: string;
  /** Why the voice needs it, in one line. */
  readonly why: string;
  /** The System Settings page that holds its switch. */
  readonly settingsUrl: string;
  /** The page's title, as the animation draws it. */
  readonly paneTitle: string;
}

/**
 * Each permission's words and page. The URLs are System Settings' own Privacy & Security extension ids, the ones
 * Chromium opens and documents as tested on macOS 13, 14, 15 and 26 (`base/mac/mac_util.mm`); Apple publishes no
 * contract for them, so a page that stops opening is a macOS change to re-read, not a guess to widen.
 */
export const COPY: Readonly<Record<PermissionId, PermissionCopy>> = {
  microphone: {
    label: "Microphone",
    paneTitle: "Microphone",
    settingsUrl: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
    why: "So the voice can hear you. Only during a call you start.",
  },
  // The same Settings page as Screen Recording: its "System Audio Recording Only" list sits under the screen one.
  systemAudio: {
    label: "System Audio Recording",
    paneTitle: "Screen & System Audio Recording",
    settingsUrl: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
    why: "So the voice's audio keeps playing when you switch headphones or speakers. Nothing else is recorded.",
  },
  screen: {
    label: "Screen Recording",
    paneTitle: "Screen & System Audio Recording",
    settingsUrl: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
    why: "So the voice can look at your screen when you ask. One picture per look, only during a call.",
  },
};

/**
 * What a link on the guide asks for. The three `input-control-*` links are the optional mouse and keyboard control
 * step (`inputControlConsent.ts`): accept it, Not now to it, or open its Settings page.
 */
export type GuideLink =
  | { readonly kind: "ask"; readonly permission: PermissionId }
  | { readonly kind: "settings"; readonly permission: PermissionId }
  | { readonly kind: "reopen" }
  | { readonly kind: "recheck" }
  | { readonly kind: "dismiss" }
  | { readonly kind: "input-control-accept" }
  | { readonly kind: "input-control-decline" }
  | { readonly kind: "input-control-settings" };

/** One permission's row on the guide. */
export interface GuideRow {
  readonly permission: PermissionId;
  readonly label: string;
  readonly why: string;
  readonly standing: PermissionStanding;
}

/** The step the guide walks the owner through now: the first permission still off. */
export interface GuideStep {
  readonly permission: PermissionId;
  readonly label: string;
  readonly paneTitle: string;
  readonly standing: PermissionStanding;
  /** The numbered instructions under the animation. */
  readonly how: readonly string[];
  /** The button, when there is one the owner can press. */
  readonly button: { readonly label: string; readonly link: GuideLink } | undefined;
  /**
   * Once its Settings page was opened and macOS still says off: offer to reopen the app — macOS applies a switch
   * changed after a refusal only to a process started after it — or say why not during a call. Conditional on
   * purpose: a status that still reads off cannot tell a switch left off from one macOS has not applied yet.
   */
  readonly reopen: "offer" | "after-call" | "none";
}

/** The guide as plain data, before it is drawn. */
export interface GuideView {
  readonly headline: string;
  readonly sub: string;
  readonly rows: readonly GuideRow[];
  /** `undefined` once every permission is on. */
  readonly step: GuideStep | undefined;
  /**
   * The optional mouse and keyboard control step. Its `step` is drawn only once `step` above is `undefined`: a voice
   * permission still off always comes first.
   */
  readonly inputControl: InputControlView;
  /** The name the app carries in System Settings' lists. */
  readonly appName: string;
  /** Why the last press did nothing, when it failed. */
  readonly problem: string | undefined;
}

/**
 * Where one permission stands, from what macOS answered.
 *
 * @param status `getMediaAccessStatus` for it
 * @returns the standing the guide acts on
 */
export function permissionStanding({ status }: { status: MacAccessStatus }): PermissionStanding {
  switch (status) {
    case "granted":
      return "granted";
    case "not-determined":
      return "ask";
    case "restricted":
      return "managed";
    case "denied":
    case "unknown":
      return "settings";
    default: {
      const unhandled: never = status;
      return unhandled;
    }
  }
}

/**
 * The permissions still off, in the order a call meets them.
 *
 * @param statuses what macOS answered for each
 * @returns every permission not granted
 */
export function missingPermissions({ statuses }: { statuses: PermissionStatuses }): readonly PermissionId[] {
  return GUIDED_PERMISSIONS.filter((permission) => statuses[permission] !== "granted");
}

/**
 * Whether the guide raises itself as the app opens: only the installed app (a dev build is a seat's run on the owner's
 * screen, never their onboarding), only while a permission is off, and not when the owner already said Not now to every
 * permission off now. A permission newly off raises it again. A run the guide's own Reopen started always raises it,
 * in any build and with everything on, so the owner sees what macOS applied — the "You're set" frame closes itself.
 *
 * @param missing the permissions off now
 * @param dismissed the permissions off when the owner last said Not now
 * @param packaged whether this is the installed app
 * @param reopened whether the guide's own Reopen started this run
 * @returns true to raise it
 */
export function guideRaisesAtLaunch({
  missing,
  dismissed,
  packaged,
  reopened,
}: {
  missing: readonly PermissionId[];
  dismissed: readonly PermissionId[];
  packaged: boolean;
  reopened: boolean;
}): boolean {
  if (reopened) {
    return true;
  }
  return packaged && missing.some((permission) => !dismissed.includes(permission));
}

/**
 * The menu bar item that opens the guide, naming what is off.
 *
 * @param missing the permissions off now
 * @returns the item's label, or `undefined` once every permission is on
 */
export function guideMenuLabel({ missing }: { missing: readonly PermissionId[] }): string | undefined {
  if (missing.length === 0) {
    return undefined;
  }
  return `Turn on ${namesOf({ permissions: missing })}…`;
}

/**
 * Names joined as a sentence would: "Microphone", "Microphone and Screen Recording", "Microphone, System Audio
 * Recording and Screen Recording".
 *
 * @returns the joined names
 */
export function namesOf({ permissions }: { permissions: readonly PermissionId[] }): string {
  const labels = permissions.map((permission) => COPY[permission].label);
  const last = labels.pop();
  if (last === undefined) {
    return "";
  }
  if (labels.length === 0) {
    return last;
  }
  return `${labels.join(", ")} and ${last}`;
}

/**
 * The guided permission a link's path names, when it names one.
 *
 * @param name the link's last path segment
 * @returns the permission, or `undefined` for anything else
 */
function guidedPermissionOf({ name }: { name: string | undefined }): PermissionId | undefined {
  return GUIDED_PERMISSIONS.find((permission) => permission === name);
}

/**
 * The link a guide navigation names, when it is one of ours.
 *
 * @param url where the guide tried to go
 * @returns the link, or `undefined` for anything else
 */
export function guideLinkOf({ url }: { url: string }): GuideLink | undefined {
  const scoped = /^slopweaver-guide:\/\/(ask|settings)\/([A-Za-z]+)$/u.exec(url);
  if (scoped !== null) {
    const permission = guidedPermissionOf({ name: scoped[2] });
    if (permission === undefined) {
      return undefined;
    }
    return scoped[1] === "ask" ? { kind: "ask", permission } : { kind: "settings", permission };
  }
  const inputControl = /^slopweaver-guide:\/\/input-control\/(accept|decline|settings)$/u.exec(url);
  if (inputControl !== null) {
    if (inputControl[1] === "accept") {
      return { kind: "input-control-accept" };
    }
    return inputControl[1] === "decline" ? { kind: "input-control-decline" } : { kind: "input-control-settings" };
  }
  const bare = /^slopweaver-guide:\/\/(reopen|recheck|dismiss)$/u.exec(url);
  if (bare === null) {
    return undefined;
  }
  if (bare[1] === "reopen") {
    return { kind: "reopen" };
  }
  return bare[1] === "recheck" ? { kind: "recheck" } : { kind: "dismiss" };
}

/**
 * The System Settings page one permission's switch is on.
 *
 * @returns the `x-apple.systempreferences:` URL
 */
export function settingsUrlOf({ permission }: { permission: PermissionId }): string {
  return COPY[permission].settingsUrl;
}

/** What the guide's Reopen adds to the relaunched app's arguments, so the app it starts confirms what macOS applied. */
export const GUIDE_REOPEN_ARGUMENT = "--permission-guide-reopened";

/**
 * The arguments the guide's Reopen relaunches with: this run's own, the marker added exactly once — a run that was
 * itself reopened by the guide never carries it twice.
 *
 * @param argv this process's arguments, its executable first
 * @returns the arguments after the executable
 */
export function reopenArguments({ argv }: { argv: readonly string[] }): string[] {
  return [...argv.slice(1).filter((argument) => argument !== GUIDE_REOPEN_ARGUMENT), GUIDE_REOPEN_ARGUMENT];
}

/**
 * Where the guide's window goes: the top-right of the work area, beside System Settings rather than over it.
 *
 * @param workArea the primary display's work area
 * @returns the window's top-left corner
 */
export function guidePosition({
  workArea,
}: {
  workArea: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}): { readonly x: number; readonly y: number } {
  return { x: workArea.x + workArea.width - GUIDE_WIDTH - 16, y: workArea.y + 16 };
}
