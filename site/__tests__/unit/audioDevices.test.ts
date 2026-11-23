/*
 * The call's device lines name the device the live track is on, and warn when that is not where the owner would expect —
 * above all when the system default moved to their headset after the call opened on the laptop.
 */
import { describe, expect, it } from "vitest";

import {
  audioChoicesOf,
  type DeviceRow,
  deviceNameOf,
  inputReading,
  isPickedDeviceGone,
  micConstraintsOf,
  micFollowOf,
  outputReading,
  pickerOptionsOf,
  SYSTEM_DEFAULT,
  speakerFollowOf,
  systemDefaultDeviceOf,
  type TrackOnDevice,
} from "../../lib/audioDevices";

/** Chrome on macOS with a headset plugged in and the headset the system default. */
const HEADSET_DEFAULT: readonly DeviceRow[] = [
  { deviceId: "default", groupId: "g-headset", kind: "audioinput", label: "Default - Jabra Evolve2 65" },
  { deviceId: "mic-headset", groupId: "g-headset", kind: "audioinput", label: "Jabra Evolve2 65" },
  { deviceId: "mic-laptop", groupId: "g-laptop", kind: "audioinput", label: "MacBook Pro Microphone" },
  { deviceId: "default", groupId: "g-laptop", kind: "audiooutput", label: "Default - MacBook Pro Speakers" },
  { deviceId: "out-laptop", groupId: "g-laptop", kind: "audiooutput", label: "MacBook Pro Speakers" },
  { deviceId: "out-headset", groupId: "g-headset", kind: "audiooutput", label: "Jabra Evolve2 65" },
  { deviceId: "cam", groupId: "g-cam", kind: "videoinput", label: "FaceTime HD Camera" },
];

/** A track opened on the system default while the laptop microphone was it. */
const ON_LAPTOP: TrackOnDevice = {
  deviceId: "default",
  ended: false,
  groupId: "g-laptop",
  label: "Default - MacBook Pro Microphone",
};

describe("deviceNameOf", () => {
  it("takes Chrome's default prefix off, and names a blank label", () => {
    expect(deviceNameOf({ label: "Default - AirPods Pro" })).toBe("AirPods Pro");
    expect(deviceNameOf({ label: "AirPods Pro" })).toBe("AirPods Pro");
    expect(deviceNameOf({ label: "" })).toBe("an unnamed device (allow the microphone to see names)");
  });
});

describe("audioChoicesOf", () => {
  it("splits inputs from outputs, the system default first and named by what it is now", () => {
    const choices = audioChoicesOf({ devices: HEADSET_DEFAULT });
    expect(choices.inputs).toEqual([
      { deviceId: "default", groupId: "g-headset", label: "System default (Jabra Evolve2 65)" },
      { deviceId: "mic-headset", groupId: "g-headset", label: "Jabra Evolve2 65" },
      { deviceId: "mic-laptop", groupId: "g-laptop", label: "MacBook Pro Microphone" },
    ]);
    expect(choices.outputs.map((device) => device.label)).toEqual([
      "System default (MacBook Pro Speakers)",
      "MacBook Pro Speakers",
      "Jabra Evolve2 65",
    ]);
  });

  it("offers a system default where the browser lists none, and drops the communications pseudo-device", () => {
    const choices = audioChoicesOf({
      devices: [
        { deviceId: "communications", groupId: "g1", kind: "audioinput", label: "Communications - Headset" },
        { deviceId: "abc", groupId: "g1", kind: "audioinput", label: "" },
        { deviceId: "", groupId: "", kind: "audioinput", label: "" },
      ],
    });
    expect(choices.inputs).toEqual([
      { deviceId: "default", groupId: "", label: "System default" },
      { deviceId: "abc", groupId: "g1", label: "an unnamed device (allow the microphone to see names)" },
    ]);
    expect(choices.outputs).toEqual([{ deviceId: "default", groupId: "", label: "System default" }]);
  });
});

describe("pickerOptionsOf", () => {
  const inputs = audioChoicesOf({ devices: HEADSET_DEFAULT }).inputs;

  it("is the devices alone when the owner's pick is among them", () => {
    expect(pickerOptionsOf({ chosen: "mic-laptop", devices: inputs })).toEqual(inputs);
  });

  it("keeps a pick that is no longer connected, said as one", () => {
    const options = pickerOptionsOf({ chosen: "mic-gone", devices: inputs });
    expect(options.length).toBe(4);
    expect(options.at(-1)).toEqual({
      deviceId: "mic-gone",
      groupId: "",
      label: "the device you picked (not connected)",
    });
  });
});

describe("micConstraintsOf", () => {
  it("asks for no device on the system default, and the owner's pick exactly otherwise", () => {
    expect(micConstraintsOf({ chosen: SYSTEM_DEFAULT })).toEqual({ echoCancellation: true, noiseSuppression: true });
    expect(micConstraintsOf({ chosen: "mic-headset" })).toEqual({
      deviceId: { exact: "mic-headset" },
      echoCancellation: true,
      noiseSuppression: true,
    });
  });
});

describe("isPickedDeviceGone", () => {
  it("retries only a missing device, never a permission refusal", () => {
    expect(isPickedDeviceGone({ name: "OverconstrainedError" })).toBe(true);
    expect(isPickedDeviceGone({ name: "NotFoundError" })).toBe(true);
    expect(isPickedDeviceGone({ name: "NotAllowedError" })).toBe(false);
  });
});

describe("inputReading", () => {
  const inputs = audioChoicesOf({ devices: HEADSET_DEFAULT }).inputs;

  it("says nothing is open with no call", () => {
    expect(
      inputReading({ chosen: SYSTEM_DEFAULT, failed: undefined, fellBack: false, inputs, track: undefined }),
    ).toStrictEqual({
      warning: undefined,
      warningWhy: undefined,
      words: "no call open",
    });
  });

  it("names the incident: the system default moved to the headset, the call stayed on the laptop", () => {
    expect(
      inputReading({ chosen: SYSTEM_DEFAULT, failed: undefined, fellBack: false, inputs, track: ON_LAPTOP }),
    ).toEqual({
      warning: "your system default is now Jabra Evolve2 65, and the call is still on MacBook Pro Microphone",
      words: "on MacBook Pro Microphone",
    });
  });

  it("is quiet when the call is on what the system default still is", () => {
    const onHeadset: TrackOnDevice = { ...ON_LAPTOP, groupId: "g-headset", label: "Default - Jabra Evolve2 65" };
    expect(
      inputReading({ chosen: SYSTEM_DEFAULT, failed: undefined, fellBack: false, inputs, track: onHeadset }),
    ).toEqual({
      warning: undefined,
      words: "on Jabra Evolve2 65",
    });
  });

  it("cannot compare a default with no group, and so does not claim one moved", () => {
    const noGroup: TrackOnDevice = { ...ON_LAPTOP, groupId: "" };
    expect(
      inputReading({ chosen: SYSTEM_DEFAULT, failed: undefined, fellBack: false, inputs, track: noGroup }).warning,
    ).toBe(undefined);
  });

  it("is quiet on the device the owner picked", () => {
    const onPick: TrackOnDevice = {
      deviceId: "mic-headset",
      ended: false,
      groupId: "g-headset",
      label: "Jabra Evolve2 65",
    };
    expect(
      inputReading({ chosen: "mic-headset", failed: undefined, fellBack: false, inputs, track: onPick }).warning,
    ).toBe(undefined);
  });

  it("says when the call is not on the device the owner picked", () => {
    const onLaptop: TrackOnDevice = { ...ON_LAPTOP, deviceId: "mic-laptop", label: "MacBook Pro Microphone" };
    expect(
      inputReading({ chosen: "mic-headset", failed: undefined, fellBack: false, inputs, track: onLaptop }).warning,
    ).toBe("you picked Jabra Evolve2 65, but the call is on MacBook Pro Microphone");
  });

  it("says the call fell back to the system default because the owner's pick was not connected", () => {
    expect(
      inputReading({ chosen: "mic-gone", failed: undefined, fellBack: true, inputs, track: ON_LAPTOP }).warning,
    ).toBe("the microphone you picked is not connected; the call is on MacBook Pro Microphone instead");
  });

  // The browser's own message is folded under our sentence, never lifted into it.
  it("says a refused mid-call switch left the call where it was, the browser's message kept whole beside it", () => {
    const failed = "NotReadableError: Could not start audio source\n    at setDevice (useAudioRoute.ts:88:5)";
    expect(inputReading({ chosen: "mic-headset", failed, fellBack: false, inputs, track: ON_LAPTOP })).toStrictEqual({
      warning: "could not switch the microphone; the call is still on MacBook Pro Microphone",
      warningWhy: "NotReadableError: Could not start audio source\n    at setDevice (useAudioRoute.ts:88:5)",
      words: "on MacBook Pro Microphone",
    });
  });

  it("carries no caught reason beside a warning that is wholly our own sentence", () => {
    expect(
      inputReading({ chosen: SYSTEM_DEFAULT, failed: undefined, fellBack: false, inputs, track: ON_LAPTOP }).warningWhy,
    ).toBe(undefined);
  });

  it("says a microphone unplugged mid-call is moving to the system default", () => {
    const ended: TrackOnDevice = { ...ON_LAPTOP, ended: true };
    expect(
      inputReading({ chosen: SYSTEM_DEFAULT, failed: undefined, fellBack: false, inputs, track: ended }).warning,
    ).toBe("MacBook Pro Microphone was disconnected; moving the call to the system default");
  });

  it("says an unplugged microphone whose reopen was refused left the call without one", () => {
    const ended: TrackOnDevice = { ...ON_LAPTOP, ended: true };
    expect(
      inputReading({ chosen: SYSTEM_DEFAULT, failed: "NotReadableError", fellBack: false, inputs, track: ended }),
    ).toStrictEqual({
      warning: "MacBook Pro Microphone was disconnected and the call could not reopen a microphone",
      warningWhy: "NotReadableError",
      words: "on MacBook Pro Microphone",
    });
  });
});

describe("systemDefaultDeviceOf", () => {
  it("names the real device the default means now, of each kind", () => {
    expect(systemDefaultDeviceOf({ devices: HEADSET_DEFAULT, kind: "audioinput" })).toBe("mic-headset");
    expect(systemDefaultDeviceOf({ devices: HEADSET_DEFAULT, kind: "audiooutput" })).toBe("out-laptop");
  });

  it("takes the one device in the default's group when names are hidden", () => {
    const hidden: readonly DeviceRow[] = [
      { deviceId: "default", groupId: "g1", kind: "audiooutput", label: "" },
      { deviceId: "out-1", groupId: "g1", kind: "audiooutput", label: "" },
      { deviceId: "out-2", groupId: "g2", kind: "audiooutput", label: "" },
    ];
    expect(systemDefaultDeviceOf({ devices: hidden, kind: "audiooutput" })).toBe("out-1");
  });

  it("names none where the browser lists no default, or two devices share its group and neither its name", () => {
    expect(systemDefaultDeviceOf({ devices: HEADSET_DEFAULT.slice(1, 3), kind: "audioinput" })).toBe(undefined);
    const ambiguous: readonly DeviceRow[] = [
      { deviceId: "default", groupId: "g1", kind: "audiooutput", label: "Default - Display" },
      { deviceId: "out-1", groupId: "g1", kind: "audiooutput", label: "Left" },
      { deviceId: "out-2", groupId: "g1", kind: "audiooutput", label: "Right" },
    ];
    expect(systemDefaultDeviceOf({ devices: ambiguous, kind: "audiooutput" })).toBe(undefined);
  });
});

describe("micFollowOf", () => {
  const inputs = audioChoicesOf({ devices: HEADSET_DEFAULT }).inputs;
  const onHeadset: TrackOnDevice = {
    deviceId: "mic-headset",
    ended: false,
    groupId: "g-headset",
    label: "Jabra Evolve2 65",
  };

  it("follows the Mac when the headset became the default after the call opened on the laptop", () => {
    expect(micFollowOf({ chosen: SYSTEM_DEFAULT, inputs, track: ON_LAPTOP })).toBe("follow");
  });

  it("stays on what the default still is, and with no call open", () => {
    const onDefaultHeadset: TrackOnDevice = { ...ON_LAPTOP, groupId: "g-headset" };
    expect(micFollowOf({ chosen: SYSTEM_DEFAULT, inputs, track: onDefaultHeadset })).toBe("stay");
    expect(micFollowOf({ chosen: SYSTEM_DEFAULT, inputs, track: undefined })).toBe("stay");
  });

  it("follows the default when the default's microphone was unplugged mid-call", () => {
    expect(micFollowOf({ chosen: SYSTEM_DEFAULT, inputs, track: { ...ON_LAPTOP, ended: true } })).toBe("follow");
  });

  it("does not claim the default moved when either group is unknown", () => {
    expect(micFollowOf({ chosen: SYSTEM_DEFAULT, inputs, track: { ...ON_LAPTOP, groupId: "" } })).toBe("stay");
  });

  it("keeps the owner's own pick while it is connected, even when the default is elsewhere", () => {
    expect(micFollowOf({ chosen: "mic-laptop", inputs, track: ON_LAPTOP })).toBe("stay");
  });

  it("drops the owner's pick for the system default when it is unplugged or its track ends", () => {
    const laptopOnly = audioChoicesOf({ devices: HEADSET_DEFAULT.filter((row) => row.groupId !== "g-headset") }).inputs;
    expect(micFollowOf({ chosen: "mic-headset", inputs: laptopOnly, track: onHeadset })).toBe("reset");
    expect(micFollowOf({ chosen: "mic-headset", inputs, track: { ...onHeadset, ended: true } })).toBe("reset");
  });

  it("never reads a list with every device hidden as the owner's pick unplugged", () => {
    const hidden = audioChoicesOf({ devices: [] }).inputs;
    expect(micFollowOf({ chosen: "mic-headset", inputs: hidden, track: onHeadset })).toBe("stay");
  });
});

describe("speakerFollowOf", () => {
  it("routes the system default to the device it names now", () => {
    expect(speakerFollowOf({ chosen: SYSTEM_DEFAULT, devices: HEADSET_DEFAULT })).toEqual({
      reset: false,
      sinkId: "out-laptop",
    });
  });

  it("re-routes when the Mac's default output moves to the headset", () => {
    const movedToHeadset = HEADSET_DEFAULT.map((row) =>
      row.kind === "audiooutput" && row.deviceId === "default"
        ? { ...row, groupId: "g-headset", label: "Default - Jabra Evolve2 65" }
        : row,
    );
    expect(speakerFollowOf({ chosen: SYSTEM_DEFAULT, devices: movedToHeadset }).sinkId).toBe("out-headset");
  });

  it("leaves the browser's own default where the default names no device", () => {
    expect(speakerFollowOf({ chosen: SYSTEM_DEFAULT, devices: [] })).toEqual({ reset: false, sinkId: "" });
  });

  it("plays on the owner's own pick while it is connected, and before any device is listed", () => {
    expect(speakerFollowOf({ chosen: "out-headset", devices: HEADSET_DEFAULT })).toEqual({
      reset: false,
      sinkId: "out-headset",
    });
    expect(speakerFollowOf({ chosen: "out-headset", devices: [] })).toEqual({ reset: false, sinkId: "out-headset" });
  });

  it("drops the owner's pick for the system default when it is unplugged", () => {
    expect(speakerFollowOf({ chosen: "out-gone", devices: HEADSET_DEFAULT })).toEqual({
      reset: true,
      sinkId: "out-laptop",
    });
  });
});

describe("outputReading", () => {
  const outputs = audioChoicesOf({ devices: HEADSET_DEFAULT }).outputs;

  it("names the system default the element plays on when its sink is unset", () => {
    expect(outputReading({ failed: undefined, outputs, sinkId: "", supported: true })).toEqual({
      warning: undefined,
      words: "on System default (MacBook Pro Speakers)",
    });
  });

  it("names a picked speaker", () => {
    expect(outputReading({ failed: undefined, outputs, sinkId: "out-headset", supported: true }).words).toBe(
      "on Jabra Evolve2 65",
    );
  });

  it("warns on a refused switch, on an unlisted sink, and in a browser that cannot choose", () => {
    expect(outputReading({ failed: "NotAllowedError", outputs, sinkId: "", supported: true })).toStrictEqual({
      warning: "could not switch the speaker",
      warningWhy: "NotAllowedError",
      words: "on System default (MacBook Pro Speakers)",
    });
    expect(outputReading({ failed: undefined, outputs, sinkId: "out-gone", supported: true })).toStrictEqual({
      warning: "the speaker the call plays on is no longer listed; pick another",
      warningWhy: undefined,
      words: "on an unlisted device",
    });
    expect(outputReading({ failed: undefined, outputs, sinkId: "", supported: false })).toStrictEqual({
      warning: "this browser cannot choose a speaker, so the call plays on the system default",
      warningWhy: undefined,
      words: "on the system default",
    });
  });
});
