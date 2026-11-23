"use client";

/**
 * The microphone and speaker the voice is on, and the choice of each: the audio tray, above the corner's bar or
 * drawn in the stage's left half, opened in both by the chevron beside mute. The icon buttons and their positions
 * follow Google Meet's.
 *
 * **No microphone level and no test sound**: the tray picks the devices and
 * says which one the call holds, nothing more.
 *
 * Under each picker is the device the call ACTUALLY holds, or — warning-coloured — why that is not where the owner would
 * expect (`site/lib/audioDevices.ts`), because a pick and the device in use can differ. Either switches at once, mid-call
 * too (`useAudioRoute.ts`). The pickers are native selects: a portalled list would draw outside the desktop overlay's
 * interactive card and let a click on an option fall through to the app beneath. Everything else about a call is chosen
 * in the Settings modal, over the console's own pages, which the overlay never draws.
 */
import type { ReactElement } from "react";

import type { AudioDevice, AudioRouteState, DeviceReading } from "../../lib/audioDevices";
import { PlainWhy } from "../console/RawFold";

/** One labelled picker: its label over a select as wide as the menu, the console's quiet field. */
const PICK =
  "grid gap-1 text-[0.75rem] text-muted-foreground [&_select]:w-full [&_select]:min-w-0 [&_select]:truncate [&_select]:rounded-[6px] [&_select]:border [&_select]:border-solid [&_select]:border-border [&_select]:bg-(--c-panel) [&_select]:px-[0.4rem] [&_select]:py-[0.3rem] [&_select]:text-[0.8rem] [&_select]:text-foreground";

/**
 * The microphone and speaker pickers.
 *
 * @param audio the call's audio route: the devices, the owner's picks, what each is actually on, and the pickers' setters
 * @returns the two pickers with their readings
 */
export function AudioDeviceMenu({ audio }: { audio: AudioRouteState }): ReactElement {
  return (
    <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0" aria-label="microphone and speaker">
      <DevicePick
        label="Microphone"
        devices={audio.inputs}
        value={audio.input}
        reading={audio.mic}
        onChange={audio.pickInput}
      />
      <DevicePick
        label="Speaker"
        devices={audio.outputs}
        value={audio.output}
        reading={audio.speaker}
        onChange={audio.pickOutput}
      />
    </fieldset>
  );
}

/** One picker, and under it the device the call is actually on or the warning that it is not where the owner expects. */
function DevicePick({
  label,
  devices,
  value,
  reading,
  onChange,
}: {
  label: string;
  devices: readonly AudioDevice[];
  value: string;
  reading: DeviceReading;
  onChange: (next: string) => void;
}): ReactElement {
  return (
    <div className={PICK}>
      <label className="grid gap-1">
        {label}
        <select
          value={value}
          title={devices.find((device) => device.deviceId === value)?.label}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </label>
      <div
        className="text-[0.72rem] break-words text-muted-foreground data-[warning=true]:text-warning"
        data-warning={reading.warning === undefined ? "false" : "true"}
      >
        <HeldLine reading={reading} />
      </div>
    </div>
  );
}

/**
 * The device the call holds, or the warning that it is not where the owner expects: the warning is our own sentence, and a
 * refused switch's caught reason is said plainly under it with the browser's own message folded.
 */
function HeldLine({ reading }: { reading: DeviceReading }): ReactElement {
  const { warning, warningWhy } = reading;
  if (warning === undefined) {
    return <>{reading.words}</>;
  }
  if (warningWhy === undefined) {
    return <>{warning}</>;
  }
  return (
    <>
      {warning}
      <div>
        <PlainWhy why={warningWhy} />
      </div>
    </>
  );
}
