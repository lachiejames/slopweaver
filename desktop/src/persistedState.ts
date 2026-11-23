/**
 * What the shell keeps across a restart: which checkout serves the console, where the window was and how big,
 * whether it was maximised or fullscreen, the page the owner was last on, the tabs they had open, whether a call was open
 * when it last wrote, which permissions the permissions guide was told Not now about, and the owner's answer to the
 * optional mouse and keyboard control step. Kept in Electron's `userData` (`stateStore.ts`), never the repository and never `$SLOPWEAVER_HOME`:
 * it is the window's state, not the fleet's. Pure.
 */
import { err, ok, type Result } from "neverthrow";

import { isRecord } from "./desktopBridge";
import { type StateError, StateErrors } from "./errors";
import { INPUT_CONTROL_CONSENTS, type InputControlConsent } from "./inputControlConsent";
import { GUIDED_PERMISSIONS, type PermissionId } from "./permissionGuide";
import { QUEUE_PATH } from "./shellState";
import type { SavedTab } from "./tabStrip";
import {
  decodePendingUpdate,
  decodeResumeVoice,
  type PendingUpdate,
  type ResumeVoice,
  type UpdateFieldsChange,
} from "./updatePlan";

/** A rectangle in screen points. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The saved state, version 1. */
export interface PersistedState {
  readonly version: 1;
  /** The checkout whose `scripts/docs-site.sh` serves the console, once one has been validated. */
  readonly checkout: string | null;
  readonly window: {
    /** The window's bounds when neither maximised nor fullscreen. */
    readonly bounds: Bounds | null;
    readonly maximised: boolean;
    readonly fullscreen: boolean;
  };
  /** The console page the owner was last on: path, query and hash, never an origin. */
  readonly lastPath: string;
  /** A voice call was open when this was written. */
  readonly callOpen: boolean;
  /**
   * The console window's tabs, in strip order, the pinned one first (`tabStrip.ts`). Absent in a state written before
   * the strip, which opens as the pinned tab alone.
   */
  readonly tabs?: readonly SavedTab[];
  /**
   * The permissions that were off when the owner last said Not now to the permissions guide (`permissionGuide.ts`), so it
   * raises itself at launch again only for one newly off. Absent until they first do.
   */
  readonly permissionsDismissed?: readonly PermissionId[];
  /**
   * What the owner answered when the guide offered mouse and keyboard control (`inputControlConsent.ts`): consent,
   * never the grant, which macOS is always asked for. Absent until they answer.
   */
  readonly inputControlConsent?: InputControlConsent;
  /**
   * The update this app launched and has not read the outcome of (`updatePlan.ts`). Written before the update quits
   * the app, so whichever app opens next — the new build, or the previous one put back — waits for that outcome.
   */
  readonly update?: PendingUpdate;
  /** A call the app ended for an update, restarted once the update settles. */
  readonly resumeVoice?: ResumeVoice;
}

/** The most tabs a saved state may carry; more is not a strip the owner lined up but a file gone wrong. */
const MAX_SAVED_TABS = 100;

/** The longest saved tab title; a page's title is a line. */
const MAX_SAVED_TITLE = 512;

/** A first launch: no checkout yet, a centred window, the Queue. */
export const FRESH_STATE: PersistedState = {
  callOpen: false,
  checkout: null,
  lastPath: QUEUE_PATH,
  version: 1,
  window: { bounds: null, fullscreen: false, maximised: false },
};

/**
 * The saved state with the update's two fields changed (`updatePlan.ts`): a cleared one is absent, never `undefined`,
 * so the file it is written to never carries it.
 *
 * @param state the saved state as it stands
 * @param change each field's new value, `null` to clear it, absent to keep it
 * @returns the new state
 */
export function withUpdateFields({
  state,
  change,
}: {
  state: PersistedState;
  change: UpdateFieldsChange;
}): PersistedState {
  const { update: savedUpdate, resumeVoice: savedResume, ...rest } = state;
  let next: PersistedState = rest;
  // A field the change leaves out keeps its saved value; `null` clears it.
  let update = savedUpdate;
  if (change.update === null) {
    update = undefined;
  } else if (change.update !== undefined) {
    update = change.update;
  }
  if (update !== undefined) {
    next = { ...next, update };
  }
  let resumeVoice = savedResume;
  if (change.resumeVoice === null) {
    resumeVoice = undefined;
  } else if (change.resumeVoice !== undefined) {
    resumeVoice = change.resumeVoice;
  }
  if (resumeVoice !== undefined) {
    next = { ...next, resumeVoice };
  }
  return next;
}

/** The size a fresh window opens at, centred on the primary display. */
export const FRESH_SIZE = { height: 860, width: 1320 } as const;

/** The smallest window worth restoring; anything smaller was a mistake, not a choice. */
const MIN_SIDE = 400;

/**
 * Read the saved state, refusing anything that is not exactly version 1 and naming the field that failed.
 *
 * @param value the parsed JSON
 * @returns the state, or which field was malformed
 */
export function decodePersistedState({ value }: { value: unknown }): Result<PersistedState, StateError> {
  if (!isRecord(value) || value["version"] !== 1) {
    return err(StateErrors.malformed({ field: "version" }));
  }
  const checkout = value["checkout"];
  if (checkout !== null && typeof checkout !== "string") {
    return err(StateErrors.malformed({ field: "checkout" }));
  }
  const window = value["window"];
  if (!isRecord(window)) {
    return err(StateErrors.malformed({ field: "window" }));
  }
  const bounds = window["bounds"];
  if (bounds !== null && !isBounds(bounds)) {
    return err(StateErrors.malformed({ field: "window.bounds" }));
  }
  if (typeof window["maximised"] !== "boolean" || typeof window["fullscreen"] !== "boolean") {
    return err(StateErrors.malformed({ field: "window.maximised/fullscreen" }));
  }
  const lastPath = value["lastPath"];
  if (typeof lastPath !== "string" || consolePath({ path: lastPath }) === undefined) {
    return err(StateErrors.malformed({ field: "lastPath" }));
  }
  if (typeof value["callOpen"] !== "boolean") {
    return err(StateErrors.malformed({ field: "callOpen" }));
  }
  let state: PersistedState = {
    callOpen: value["callOpen"],
    checkout,
    lastPath,
    version: 1,
    window: { bounds, fullscreen: window["fullscreen"], maximised: window["maximised"] },
  };
  if ("tabs" in value) {
    const tabs = decodeTabs({ value: value["tabs"] });
    if (tabs === undefined) {
      return err(StateErrors.malformed({ field: "tabs" }));
    }
    state = { ...state, tabs };
  }
  if ("permissionsDismissed" in value) {
    const dismissed = decodePermissions({ value: value["permissionsDismissed"] });
    if (dismissed === undefined) {
      return err(StateErrors.malformed({ field: "permissionsDismissed" }));
    }
    state = { ...state, permissionsDismissed: dismissed };
  }
  if ("inputControlConsent" in value) {
    const consent = INPUT_CONTROL_CONSENTS.find((answer) => answer === value["inputControlConsent"]);
    if (consent === undefined) {
      return err(StateErrors.malformed({ field: "inputControlConsent" }));
    }
    state = { ...state, inputControlConsent: consent };
  }
  if ("update" in value) {
    const update = decodePendingUpdate({ value: value["update"] });
    if (update === undefined) {
      return err(StateErrors.malformed({ field: "update" }));
    }
    state = { ...state, update };
  }
  if ("resumeVoice" in value) {
    const resumeVoice = decodeResumeVoice({ value: value["resumeVoice"] });
    if (resumeVoice === undefined) {
      return err(StateErrors.malformed({ field: "resumeVoice" }));
    }
    state = { ...state, resumeVoice };
  }
  return ok(state);
}

/**
 * The dismissed permissions, exactly: each a guided permission, none twice.
 *
 * @param value the `permissionsDismissed` field as parsed
 * @returns the permissions, or `undefined` when any part is malformed
 */
function decodePermissions({ value }: { value: unknown }): readonly PermissionId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const permissions: PermissionId[] = [];
  for (const entry of value) {
    const known = GUIDED_PERMISSIONS.find((permission) => permission === entry);
    if (known === undefined || permissions.includes(known)) {
      return undefined;
    }
    permissions.push(known);
  }
  return permissions;
}

/**
 * The saved tabs, exactly: one to {@link MAX_SAVED_TABS} of `{ path, title }`, every path a console path.
 *
 * @param value the `tabs` field as parsed
 * @returns the tabs, or `undefined` when any part is malformed
 */
function decodeTabs({ value }: { value: unknown }): readonly SavedTab[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SAVED_TABS) {
    return undefined;
  }
  const tabs: SavedTab[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || Object.keys(entry).length !== 2) {
      return undefined;
    }
    const { path, title } = entry;
    if (typeof path !== "string" || consolePath({ path }) === undefined) {
      return undefined;
    }
    if (typeof title !== "string" || title.length > MAX_SAVED_TITLE) {
      return undefined;
    }
    tabs.push({ path, title });
  }
  return tabs;
}

/**
 * A console path worth keeping: it starts with one `/`, is not protocol-relative, and parses against a local
 * origin to the same origin. Anything else — an external URL, `//host`, a `javascript:` string — is refused.
 *
 * @param path the candidate path, query and hash
 * @returns the path, or `undefined` when it is not one
 */
export function consolePath({ path }: { path: string }): string | undefined {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return undefined;
  }
  const base = "http://localhost:1";
  const parsed = URL.canParse(path, base) ? new URL(path, base) : undefined;
  if (parsed === undefined || parsed.origin !== base) {
    return undefined;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * The console path of a URL the window is on, when it is on the console.
 *
 * @param url the window's URL
 * @param origin the console's origin
 * @returns the path, query and hash, or `undefined` when the URL is elsewhere
 */
export function consolePathOf({ url, origin }: { url: string; origin: string }): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.origin !== origin) {
    return undefined;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Where to open the window: the saved bounds when they still sit mostly on a display, otherwise a fresh
 * window centred on the primary display. A display unplugged since the last session is the case this exists
 * for — restoring onto it would open a window the owner cannot see.
 *
 * @param saved the saved bounds, or `null` when none were saved
 * @param displays each display's work area
 * @param primary the primary display's work area
 * @returns the bounds to open at
 */
export function windowPlacement({
  saved,
  displays,
  primary,
}: {
  saved: Bounds | null;
  displays: readonly Bounds[];
  primary: Bounds;
}): Bounds {
  const centred: Bounds = {
    height: Math.min(FRESH_SIZE.height, primary.height),
    width: Math.min(FRESH_SIZE.width, primary.width),
    x: primary.x + Math.round((primary.width - Math.min(FRESH_SIZE.width, primary.width)) / 2),
    y: primary.y + Math.round((primary.height - Math.min(FRESH_SIZE.height, primary.height)) / 2),
  };
  if (saved === null || saved.width < MIN_SIDE || saved.height < MIN_SIDE) {
    return centred;
  }
  const area = saved.width * saved.height;
  const visible = displays.some((display) => overlapArea({ a: saved, b: display }) * 2 >= area);
  return visible ? saved : centred;
}

/**
 * The area two rectangles share.
 *
 * @returns the shared area in square points, zero when they do not meet
 */
function overlapArea({ a, b }: { a: Bounds; b: Bounds }): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Whether a value is a {@link Bounds} of finite numbers.
 *
 * @returns true when all four fields are finite numbers
 */
function isBounds(value: unknown): value is Bounds {
  if (!isRecord(value)) {
    return false;
  }
  return ["x", "y", "width", "height"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}
