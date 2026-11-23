/**
 * Which microphone and speaker a console call is on, said from the devices themselves — and the choices the owner can
 * pick between.
 *
 * A headset can show as the macOS system input while the call hears the owner only near the laptop, and nothing on the
 * localhost call said which device it was on. Chrome's `default`
 * input is a pseudo-device naming whatever macOS's default was when the microphone OPENED; a track opened on it
 * stays on that physical device when the system default later moves. So what the page shows is the live track's
 * own device, never the pick. That same comparison — the system default now against the device the call holds —
 * is what {@link micFollowOf} acts on, so a call on the system default follows the Mac.
 *
 * Pure: device rows and a track's settings in, words and decisions out. The browser calls live in
 * `site/components/voice/useAudioRoute.ts`, `useSpeakerRoute.ts` and `audioRouteBrowser.ts`.
 */

/** The pick that means "whatever the system default is when the microphone opens" — Chrome's own id for it. */
export const SYSTEM_DEFAULT = "default";

/** One row of `navigator.mediaDevices.enumerateDevices()`, as much of it as is read here. */
export interface DeviceRow {
  readonly deviceId: string;
  readonly groupId: string;
  readonly kind: string;
  readonly label: string;
}

/** One device a picker offers. `groupId` is the physical device's, shared by its input and output halves. */
export interface AudioDevice {
  readonly deviceId: string;
  readonly groupId: string;
  readonly label: string;
}

/** The inputs and outputs a picker offers, the system default first in each. */
export interface AudioChoices {
  readonly inputs: readonly AudioDevice[];
  readonly outputs: readonly AudioDevice[];
}

/** The device a live microphone track is on, read off the track itself. */
export interface TrackOnDevice {
  readonly deviceId: string;
  readonly groupId: string;
  readonly label: string;
  /** Whether the track has ended — the device was unplugged or taken away mid-call. */
  readonly ended: boolean;
}

/** What one device line says, and the warning beside it when the call is not where the owner would expect. */
export interface DeviceReading {
  readonly words: string;
  readonly warning: string | undefined;
  /**
   * Why a mid-call switch was refused, exactly as the browser said it, for a fold under the warning: never part of the
   * warning's own sentence, since a caught message is no sentence of ours. `undefined` whenever
   * the warning is one of ours alone.
   */
  readonly warningWhy: string | undefined;
}

/** The route as the pickers and the device lines read it. */
export interface AudioRouteState {
  /** The microphones to pick from — the owner's pick kept, marked, when it is not connected. */
  readonly inputs: readonly AudioDevice[];
  readonly outputs: readonly AudioDevice[];
  /** The owner's stored picks: a device id, or `default`. */
  readonly input: string;
  readonly output: string;
  /** What the microphone and speaker lines say. */
  readonly mic: DeviceReading;
  readonly speaker: DeviceReading;
  /**
   * The device the voice's element plays on at the instant this is asked, read off the element rather than a render
   * behind it; empty for the system default, `undefined` before the element exists.
   */
  readonly playingOn: () => string | undefined;
  /** Pick a microphone — switched at once on a live call. */
  readonly pickInput: (next: string) => void;
  /** Pick a speaker — switched at once, call or not. */
  readonly pickOutput: (next: string) => void;
}

/** Chrome's prefix on the `default` pseudo-device's label: `Default - AirPods Pro`. */
const DEFAULT_PREFIX = "Default - ";

/** Chrome's Windows-only second pseudo-device; listed, it would read as a second default. */
const COMMUNICATIONS = "communications";

/** What an input or output with no name is called: a browser hides names until the microphone is allowed. */
const UNNAMED = "an unnamed device (allow the microphone to see names)";

/**
 * A device label as a person reads it — Chrome's `Default - ` prefix off, a blank label named as one.
 *
 * @param label the label the browser reported
 * @returns the device's own name
 */
export function deviceNameOf({ label }: { label: string }): string {
  const name = label.startsWith(DEFAULT_PREFIX) ? label.slice(DEFAULT_PREFIX.length) : label;
  if (name.trim() === "") {
    return UNNAMED;
  }
  return name;
}

/** One kind's devices, the system default first — synthesised when the browser lists none (Safari, Firefox). */
function choicesOfKind({ devices, kind }: { devices: readonly DeviceRow[]; kind: string }): readonly AudioDevice[] {
  const rows = devices.filter((row) => row.kind === kind && row.deviceId !== "" && row.deviceId !== COMMUNICATIONS);
  const listed = rows.find((row) => row.deviceId === SYSTEM_DEFAULT);
  let first: AudioDevice = { deviceId: SYSTEM_DEFAULT, groupId: "", label: "System default" };
  if (listed !== undefined) {
    const name = listed.label === "" ? "System default" : `System default (${deviceNameOf({ label: listed.label })})`;
    first = { deviceId: SYSTEM_DEFAULT, groupId: listed.groupId, label: name };
  }
  const rest = rows
    .filter((row) => row.deviceId !== SYSTEM_DEFAULT)
    .map((row) => ({ deviceId: row.deviceId, groupId: row.groupId, label: deviceNameOf({ label: row.label }) }));
  return [first, ...rest];
}

/**
 * The inputs and outputs a picker offers.
 *
 * @param devices what `enumerateDevices()` returned
 * @returns each kind's devices, the system default first
 */
export function audioChoicesOf({ devices }: { devices: readonly DeviceRow[] }): AudioChoices {
  return {
    inputs: choicesOfKind({ devices, kind: "audioinput" }),
    outputs: choicesOfKind({ devices, kind: "audiooutput" }),
  };
}

/**
 * The options one picker shows: the devices, plus the owner's stored pick when it is no longer connected — a select whose
 * value matches no option would show the first option as if it were their choice.
 *
 * @param devices one kind's devices, from {@link audioChoicesOf}
 * @param chosen the stored pick
 * @returns the options, in order
 */
export function pickerOptionsOf({
  devices,
  chosen,
}: {
  devices: readonly AudioDevice[];
  chosen: string;
}): readonly AudioDevice[] {
  if (devices.some((device) => device.deviceId === chosen)) {
    return devices;
  }
  return [...devices, { deviceId: chosen, groupId: "", label: "the device you picked (not connected)" }];
}

/**
 * The microphone constraints a call opens with: the owner's pick, exactly, or the system default.
 *
 * @param chosen the stored pick
 * @returns the `audio` member of a `getUserMedia` request
 */
export function micConstraintsOf({ chosen }: { chosen: string }): MediaTrackConstraints {
  const processing = { echoCancellation: true, noiseSuppression: true };
  if (chosen === SYSTEM_DEFAULT) {
    return processing;
  }
  return { ...processing, deviceId: { exact: chosen } };
}

/**
 * Whether a refused `getUserMedia` means only that the owner's picked device is not there — the one refusal a retry on
 * the system default answers. A permission refusal is not this, and retrying it would ask the owner twice.
 *
 * @param name the `DOMException`'s name
 * @returns whether the call may retry on the system default
 */
export function isPickedDeviceGone({ name }: { name: string }): boolean {
  return name === "OverconstrainedError" || name === "NotFoundError";
}

/**
 * The real device the `default` pseudo-device means right now — the row of the same kind sharing its group and its
 * name, or the one row sharing its group when names are hidden.
 *
 * @param devices what `enumerateDevices()` returned
 * @param kind `audioinput` or `audiooutput`
 * @returns that device's id, or `undefined` when the browser lists no `default` row (Safari, Firefox) or none matches
 */
export function systemDefaultDeviceOf({
  devices,
  kind,
}: {
  devices: readonly DeviceRow[];
  kind: string;
}): string | undefined {
  const pseudo = devices.find((row) => row.kind === kind && row.deviceId === SYSTEM_DEFAULT);
  if (pseudo === undefined || pseudo.groupId === "") {
    return undefined;
  }
  const grouped = devices.filter(
    (row) =>
      row.kind === kind &&
      row.groupId === pseudo.groupId &&
      row.deviceId !== "" &&
      row.deviceId !== SYSTEM_DEFAULT &&
      row.deviceId !== COMMUNICATIONS,
  );
  const named = grouped.find((row) => row.label === deviceNameOf({ label: pseudo.label }));
  if (named !== undefined) {
    return named.deviceId;
  }
  if (grouped.length === 1) {
    return grouped[0].deviceId;
  }
  return undefined;
}

/**
 * What a live microphone does when the device list changes or its track ends: stay; follow the system default onto
 * the device the Mac now names; or drop a pick that is gone and follow the default from then on.
 *
 * A headset plugged in mid-call must not leave both sides unheard until the call is reopened, so the call defaults to
 * the system default; picking a device of the owner's own overrides that, and a picked device that disconnects puts the
 * selector back on the system default, where it stays.
 *
 * @param chosen the owner's stored pick
 * @param track the live track's device, or `undefined` with no call
 * @param inputs the inputs listed now, from {@link audioChoicesOf}
 * @returns `stay`, `follow` (reopen on the system default), or `reset` (the pick becomes the system default, then follow)
 */
export function micFollowOf({
  chosen,
  track,
  inputs,
}: {
  chosen: string;
  track: TrackOnDevice | undefined;
  inputs: readonly AudioDevice[];
}): "stay" | "follow" | "reset" {
  if (track === undefined) {
    return "stay";
  }
  if (chosen !== SYSTEM_DEFAULT) {
    // A list carrying no real device is a browser hiding them, never evidence the owner's pick was unplugged.
    const listsDevices = inputs.some((device) => device.deviceId !== SYSTEM_DEFAULT);
    const gone = listsDevices && !inputs.some((device) => device.deviceId === chosen);
    return track.ended || gone ? "reset" : "stay";
  }
  if (track.ended) {
    return "follow";
  }
  return defaultMovedOff({ inputs, track }) ? "follow" : "stay";
}

/**
 * Where the call's speaker element plays: the owner's pick while it is connected, else the real device the system default
 * means now — re-read on every device change, so the call moves with the Mac rather than staying where it started.
 *
 * @param chosen the owner's stored pick
 * @param devices what `enumerateDevices()` returned
 * @returns the `setSinkId` target (`""` is the browser's own default), and whether the owner's pick is gone and so resets
 */
export function speakerFollowOf({ chosen, devices }: { chosen: string; devices: readonly DeviceRow[] }): {
  readonly sinkId: string;
  readonly reset: boolean;
} {
  let reset = false;
  if (chosen !== SYSTEM_DEFAULT) {
    const outputs = choicesOfKind({ devices, kind: "audiooutput" });
    const listsDevices = outputs.some((device) => device.deviceId !== SYSTEM_DEFAULT);
    if (!listsDevices || outputs.some((device) => device.deviceId === chosen)) {
      return { reset: false, sinkId: chosen };
    }
    reset = true;
  }
  const now = systemDefaultDeviceOf({ devices, kind: "audiooutput" });
  if (now === undefined) {
    return { reset, sinkId: "" };
  }
  return { reset, sinkId: now };
}

/** Whether a track opened on the system default is no longer on the device the default names — both groups known. */
function defaultMovedOff({ track, inputs }: { track: TrackOnDevice; inputs: readonly AudioDevice[] }): boolean {
  const now = inputs.find((device) => device.deviceId === SYSTEM_DEFAULT);
  return now !== undefined && now.groupId !== "" && track.groupId !== "" && now.groupId !== track.groupId;
}

/** The words for a call on the system default when the default has moved and the call has not followed it yet. */
function movedDefaultWarning({
  track,
  inputs,
  name,
}: {
  track: TrackOnDevice;
  inputs: readonly AudioDevice[];
  name: string;
}): string | undefined {
  const now = inputs.find((device) => device.deviceId === SYSTEM_DEFAULT);
  if (now === undefined || !defaultMovedOff({ inputs, track })) {
    return undefined;
  }
  const nowNamed = inputs.find((device) => device.deviceId !== SYSTEM_DEFAULT && device.groupId === now.groupId);
  const nowName = nowNamed === undefined ? "another device" : nowNamed.label;
  return `your system default is now ${nowName}, and the call is still on ${name}`;
}

/**
 * What the microphone line says: the device the call's live track is on, and a warning when that is not where
 * the owner would expect it to be.
 *
 * @param track the live track's device, or `undefined` with no call
 * @param inputs the inputs listed now
 * @param chosen the owner's stored pick
 * @param fellBack whether the call opened on the system default because the owner's pick was not connected
 * @param failed why the last mid-call switch was refused, when it was — the call stayed where it was
 * @returns the line and its warning
 */
export function inputReading({
  track,
  inputs,
  chosen,
  fellBack,
  failed,
}: {
  track: TrackOnDevice | undefined;
  inputs: readonly AudioDevice[];
  chosen: string;
  fellBack: boolean;
  failed: string | undefined;
}): DeviceReading {
  if (track === undefined) {
    return { warning: undefined, warningWhy: undefined, words: "no call open" };
  }
  const name = deviceNameOf({ label: track.label });
  const words = `on ${name}`;
  if (failed !== undefined) {
    if (track.ended) {
      return {
        warning: `${name} was disconnected and the call could not reopen a microphone`,
        warningWhy: failed,
        words,
      };
    }
    return { warning: `could not switch the microphone; the call is still on ${name}`, warningWhy: failed, words };
  }
  if (track.ended) {
    return { warning: `${name} was disconnected; moving the call to the system default`, warningWhy: undefined, words };
  }
  if (fellBack) {
    return {
      warning: `the microphone you picked is not connected; the call is on ${name} instead`,
      warningWhy: undefined,
      words,
    };
  }
  if (chosen !== SYSTEM_DEFAULT && track.deviceId !== chosen) {
    const picked = inputs.find((device) => device.deviceId === chosen);
    const pickedName = picked === undefined ? "another microphone" : picked.label;
    return { warning: `you picked ${pickedName}, but the call is on ${name}`, warningWhy: undefined, words };
  }
  if (chosen !== SYSTEM_DEFAULT) {
    return { warning: undefined, warningWhy: undefined, words };
  }
  return { warning: movedDefaultWarning({ inputs, name, track }), warningWhy: undefined, words };
}

/**
 * What the speaker line says: the device the call's audio element plays on.
 *
 * @param sinkId the element's `sinkId` — `""` is the system default
 * @param supported whether this browser can choose a speaker at all
 * @param outputs the outputs listed now
 * @param failed why the last switch was refused, when it was
 * @returns the line and its warning
 */
export function outputReading({
  sinkId,
  supported,
  outputs,
  failed,
}: {
  sinkId: string;
  supported: boolean;
  outputs: readonly AudioDevice[];
  failed: string | undefined;
}): DeviceReading {
  if (!supported) {
    return {
      warning: "this browser cannot choose a speaker, so the call plays on the system default",
      warningWhy: undefined,
      words: "on the system default",
    };
  }
  const id = sinkId === "" ? SYSTEM_DEFAULT : sinkId;
  const device = outputs.find((output) => output.deviceId === id);
  if (device === undefined) {
    return {
      warning: "the speaker the call plays on is no longer listed; pick another",
      warningWhy: undefined,
      words: "on an unlisted device",
    };
  }
  const words = `on ${device.label}`;
  if (failed !== undefined) {
    return { warning: "could not switch the speaker", warningWhy: failed, words };
  }
  return { warning: undefined, warningWhy: undefined, words };
}
