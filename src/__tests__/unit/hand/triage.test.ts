/*
 * The note's triage buttons, run as the emitted source over a plain stand-in for the AppKit and Foundation calls it
 * makes, so what is asserted is the program the note draws rather than a restatement of it.
 */
import { describe, expect, it } from "vitest";

import { NO_KIND_ANSWERS } from "../../../hand/kindAnswers.js";
import { handNotePanelSource } from "../../../hand/note/panel.js";
import { TRIAGE_JS, TRIAGE_STATE_FRESH_MS } from "../../../hand/note/triage.js";
import { triageNotePaths } from "../../../hand/note/triagePaths.js";

/** One drawn button: its title, whether it shows, and whether a click has latched it. */
interface Button {
  title: string;
  hidden: boolean;
  on: boolean;
  readonly frame: { readonly size: { readonly width: number } };
  readonly setTitle: (title: { value: string }) => void;
  readonly setHidden: (hidden: boolean) => void;
  readonly setFrameOrigin: (point: { x: number }) => void;
  readonly setBezelStyle: (style: unknown) => void;
  readonly setButtonType: (kind: unknown) => void;
  readonly setControlSize: (size: unknown) => void;
  readonly setFont: (font: unknown) => void;
  readonly setAutoresizingMask: (mask: unknown) => void;
}

/** The emitted program's `nsstr(value)`, which it calls positionally. */
type Nsstr = (value: string) => {
  value: string;
  writeToFileAtomicallyEncodingError: (path: { value: string }) => boolean;
};

/** The program's two buttons and `serviceTriage`, over a file table and a fixed clock. */
interface Note {
  readonly pause: Button;
  readonly off: Button;
  readonly service: () => void;
}

const PATHS = triageNotePaths({ home: "/home" });
const NOW = 1_800_000_000_000;

function button(): Button {
  const made: Button = {
    get frame() {
      return { size: { width: made.title.length * 7 } };
    },
    hidden: false,
    on: false,
    setAutoresizingMask: () => undefined,
    setBezelStyle: () => undefined,
    setButtonType: () => undefined,
    setControlSize: () => undefined,
    setFont: () => undefined,
    setFrameOrigin: () => undefined,
    setHidden: (hidden) => {
      made.hidden = hidden;
    },
    setTitle: (title) => {
      made.title = title.value;
    },
    title: "",
  };
  return made;
}

/** Evaluate TRIAGE_JS once over `files`, with its clock stopped at {@link NOW}; `writable: false` fails every write. */
function note({ files, writable = true }: { files: Map<string, string>; writable?: boolean }): Note {
  const drawn: Button[] = [];
  const nsstr: Nsstr = (value) => ({
    value,
    writeToFileAtomicallyEncodingError: (path) => {
      if (writable) {
        files.set(path.value, value);
      }
      return writable;
    },
  });
  const appKit = {
    NSButton: {
      alloc: {
        initWithFrame: () => {
          const made = button();
          drawn.push(made);
          return made;
        },
      },
    },
    NSFont: { systemFontOfSize: () => ({}) },
    NSMakePoint: (...xy: readonly number[]) => ({ x: xy[0]! }),
    NSMakeRect: () => ({}),
    NSString: {
      stringWithContentsOfFileEncodingError: (path: { value: string }) => {
        const text = files.get(path.value);
        return text === undefined ? { isNil: () => true, js: "" } : { isNil: () => false, js: text };
      },
    },
    NSUUID: { UUID: { UUIDString: { js: "0A1B2C3D-0000-4000-8000-00000000ABCD" } } },
    NSUTF8StringEncoding: 4,
  };
  const step = { triage: { ...PATHS, freshMs: TRIAGE_STATE_FRESH_MS }, width: 420 };
  // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text, as in panel.test.ts
  const load = new Function(
    "$",
    "ObjC",
    "Date",
    "nsstr",
    "STEP",
    "PAD",
    "effect",
    "contentHeight",
    "pressed",
    "unpress",
    `${TRIAGE_JS}\nreturn serviceTriage;`,
  ) as (...args: readonly unknown[]) => () => void;
  const service = load(
    appKit,
    { unwrap: (box: { js: string }) => box.js },
    { now: () => NOW },
    nsstr,
    step,
    20,
    { addSubview: () => undefined },
    200,
    (pressedButton: Button) => pressedButton.on,
    (latched: Button) => {
      latched.on = false;
    },
  );
  return { off: drawn[0]!, pause: drawn[1]!, service };
}

function stateFile({ on, paused, writtenMs }: { on: boolean; paused: boolean; writtenMs: number }): string {
  return JSON.stringify({ on, paused, writtenMs });
}

function presses({ files }: { files: Map<string, string> }): readonly string[] {
  return [...files.keys()]
    .filter((key) => key.startsWith(`${PATHS.commandsDir}/`))
    .map((key) => key.slice(PATHS.commandsDir.length + 1));
}

describe("TRIAGE_JS", () => {
  it("is embedded whole in the panel program, serviced before the note shows and on every poll", () => {
    const source = handNotePanelSource({
      beatPath: "/live/a.t.beat",
      consoleBase: "http://localhost:3000",
      kindAnswers: NO_KIND_ANSWERS,
      level: "ordinary",
      liveDir: "/live",
      markerDir: "/m",
      slot: 0,
      step: { id: "a", postedBy: "s", postedIso: "2026-11-02T00:00:00.000Z", unblocks: "u", what: "w", witness: "x" },
      token: "t",
      triage: PATHS,
      wantPath: "/live/a.want",
    });
    expect(source).toContain(TRIAGE_JS);
    expect(source.split("serviceTriage();").length - 1).toBe(2);
    expect(source.indexOf("serviceTriage();")).toBeLessThan(source.indexOf("panel.orderFrontRegardless;"));
  });

  it("draws no button while no triage state exists", () => {
    const files = new Map<string, string>();
    const drawn = note({ files });
    drawn.service();
    expect([drawn.pause.hidden, drawn.off.hidden]).toEqual([true, true]);
  });

  it("shows Pause timer and Triage off while the shell's state is fresh and on", () => {
    const files = new Map([[PATHS.statePath, stateFile({ on: true, paused: false, writtenMs: NOW - 500 })]]);
    const drawn = note({ files });
    drawn.service();
    expect([drawn.pause.hidden, drawn.off.hidden]).toEqual([false, false]);
    expect([drawn.pause.title, drawn.off.title]).toEqual(["Pause timer", "Triage off"]);
  });

  it("hides both once the state is older than the freshness window, a shell that quit", () => {
    const stale = NOW - TRIAGE_STATE_FRESH_MS - 1;
    const files = new Map([[PATHS.statePath, stateFile({ on: true, paused: false, writtenMs: stale })]]);
    const drawn = note({ files });
    drawn.service();
    expect([drawn.pause.hidden, drawn.off.hidden]).toEqual([true, true]);
  });

  it("hides both when triage is off, or the file is not JSON", () => {
    const off = new Map([[PATHS.statePath, stateFile({ on: false, paused: false, writtenMs: NOW })]]);
    const broken = new Map([[PATHS.statePath, "{not json"]]);
    const [first, second] = [note({ files: off }), note({ files: broken })];
    first.service();
    second.service();
    expect([first.pause.hidden, second.pause.hidden]).toEqual([true, true]);
  });

  it("drops one pause press named for itself, and unlatches the button", () => {
    const files = new Map([[PATHS.statePath, stateFile({ on: true, paused: false, writtenMs: NOW })]]);
    const drawn = note({ files });
    drawn.service();
    drawn.pause.on = true;
    drawn.service();
    expect(presses({ files })).toEqual([`${NOW}-0a1b2c3d-0000-4000-8000-00000000abcd.pause`]);
    expect(drawn.pause.on).toBe(false);
  });

  it("reads Resume timer while paused, and its press asks to resume", () => {
    const files = new Map([[PATHS.statePath, stateFile({ on: true, paused: true, writtenMs: NOW })]]);
    const drawn = note({ files });
    drawn.service();
    drawn.pause.on = true;
    drawn.service();
    expect(drawn.pause.title).toBe("Resume timer");
    expect(presses({ files })).toEqual([`${NOW}-0a1b2c3d-0000-4000-8000-00000000abcd.resume`]);
  });

  it("drops an off press for Triage off", () => {
    const files = new Map([[PATHS.statePath, stateFile({ on: true, paused: false, writtenMs: NOW })]]);
    const drawn = note({ files });
    drawn.off.on = true;
    drawn.service();
    expect(presses({ files })).toEqual([`${NOW}-0a1b2c3d-0000-4000-8000-00000000abcd.off`]);
  });

  it("retitles a button whose press could not be written, so the failure shows", () => {
    const files = new Map([[PATHS.statePath, stateFile({ on: true, paused: false, writtenMs: NOW })]]);
    const drawn = note({ files, writable: false });
    drawn.service();
    drawn.off.on = true;
    drawn.service();
    expect(presses({ files })).toEqual([]);
    expect([drawn.pause.title, drawn.off.title]).toEqual(["Pause timer", "Not sent, press again"]);
  });

  it("writes nothing for a click that lands after triage went off, and still unlatches", () => {
    const files = new Map<string, string>();
    const drawn = note({ files });
    drawn.off.on = true;
    drawn.service();
    expect(presses({ files })).toEqual([]);
    expect(drawn.off.on).toBe(false);
  });
});

describe("triageNotePaths", () => {
  it("puts the state file and the commands directory under hand-steps/triage", () => {
    expect(triageNotePaths({ home: "/home" })).toEqual({
      commandsDir: "/home/hand-steps/triage/commands",
      statePath: "/home/hand-steps/triage/state.json",
    });
  });
});
