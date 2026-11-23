/*
 * The note's band pages — main, the snooze answers Not now… swaps in, and the kind answers More… swaps in after them —
 * run as the emitted source over a plain stand-in for the AppKit calls it makes, so what is asserted is the program the
 * note draws rather than a restatement of it.
 */
import { describe, expect, it } from "vitest";

import { type KindAnswerOffer, NO_KIND_ANSWERS } from "../../../hand/kindAnswers.js";
import { BAND_JS, KIND_ANSWERS_JS, SNOOZE_JS } from "../../../hand/note/band.js";
import {
  handNotePanelSource,
  PANEL_BUTTON_GAP,
  PANEL_BUTTON_WIDTH,
  PANEL_PAD,
  PANEL_WIDTH,
} from "../../../hand/note/panel.js";

const ON = 1;
const OFF = 0;

/** One drawn button: its title, left edge, width, whether it shows and its push state. */
interface Button {
  title: string;
  x: number;
  width: number;
  hidden: boolean;
  state: number;
}

/** The program's drawn buttons, `serviceBand`, and every marker suffix it wrote. */
interface Band {
  readonly buttons: readonly Button[];
  readonly service: () => boolean;
  readonly written: readonly string[];
}

/** Evaluate the band once for a step offering `kindAnswers`; `writable: false` fails every marker write. */
function band({ kindAnswers, writable = true }: { kindAnswers: KindAnswerOffer; writable?: boolean }): Band {
  const buttons: Button[] = [];
  const written: string[] = [];
  const appKit = {
    NSBezelStyleRounded: 1,
    NSButton: {
      alloc: {
        initWithFrame: (rect: { x: number; width: number }) => {
          const made: Button & Record<string, unknown> = {
            hidden: false,
            setBezelStyle: () => undefined,
            setButtonType: () => undefined,
            setFrame: (frame: { x: number; width: number }) => {
              made.x = frame.x;
              made.width = frame.width;
            },
            // named-object-params-exempt: a fake of NSButton's setHidden selector, which the emitted JXA calls positionally
            setHidden: (hidden: boolean) => {
              made.hidden = hidden;
            },
            // named-object-params-exempt: a fake of NSButton's setState selector, which the emitted JXA calls positionally
            setState: (state: number) => {
              made.state = state;
            },
            setTitle: (title: { value: string }) => {
              made.title = title.value;
            },
            state: OFF,
            title: "",
            width: rect.width,
            x: rect.x,
          };
          buttons.push(made);
          return made;
        },
      },
    },
    NSButtonTypePushOnPushOff: 2,
    NSControlStateValueOff: OFF,
    NSControlStateValueOn: ON,
    // named-object-params-exempt: a fake of Foundation's NSMakeRect, which the emitted JXA calls positionally
    NSMakeRect: (x: number, _y: number, width: number) => ({ width, x }),
  };
  const step = {
    buttonGap: PANEL_BUTTON_GAP,
    buttonWidth: PANEL_BUTTON_WIDTH,
    kindAnswers,
    literal: "",
    url: "",
    width: PANEL_WIDTH,
  };
  // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text, as in panel.test.ts
  const load = new Function(
    "$",
    "nsstr",
    "STEP",
    "PAD",
    "effect",
    "writeMarker",
    "openLink",
    `${SNOOZE_JS}\n${KIND_ANSWERS_JS}\n${BAND_JS}\nreturn serviceBand;`,
  ) as (...args: readonly unknown[]) => () => boolean;
  const nsstr: (value: unknown) => { value: unknown } = (value) => ({ value });
  const writeMarker: (suffix: unknown) => boolean = (suffix) => {
    written.push(String(suffix));
    return writable;
  };
  const service = load(appKit, nsstr, step, PANEL_PAD, { addSubview: () => undefined }, writeMarker, () => undefined);
  return { buttons, service, written };
}

/** The drawn button titled `title`. */
function titled({ buttons, title }: { buttons: readonly Button[]; title: string }): Button {
  return buttons.find((button) => button.title === title)!;
}

/** The titles currently showing, left to right. */
function showing({ buttons }: { buttons: readonly Button[] }): readonly string[] {
  return buttons
    .filter((button) => !button.hidden)
    .toSorted((a, b) => a.x - b.x)
    .map((button) => button.title);
}

/** Press `title` and run one poll. */
function press({ note, title }: { note: Band; title: string }): boolean {
  titled({ buttons: note.buttons, title }).state = ON;
  return note.service();
}

const BOTH: KindAnswerOffer = { muteKind: true, whenWorse: true };

describe("the note's band pages", () => {
  it("leaves a step offering no kind answer exactly the two pages it always had: no More…, Back on the snooze page", () => {
    const note = band({ kindAnswers: NO_KIND_ANSWERS });
    expect(note.buttons.some((button) => button.title === "More…")).toBe(false);
    expect(showing(note)).toEqual(["Not now…", "Done"]);
    press({ note, title: "Not now…" });
    expect(showing(note)).toEqual(["1 hour", "3 hours", "Tomorrow", "Back"]);
    press({ note, title: "Back" });
    expect(showing(note)).toEqual(["Not now…", "Done"]);
  });

  it("ends the snooze page in More…, which swaps in both kind answers and Back", () => {
    const note = band({ kindAnswers: BOTH });
    press({ note, title: "Not now…" });
    expect(showing(note)).toEqual(["1 hour", "3 hours", "Tomorrow", "More…"]);
    press({ note, title: "More…" });
    expect(showing(note)).toEqual(["Never for this kind", "When it gets worse", "Back"]);
    press({ note, title: "Back" });
    expect(showing(note)).toEqual(["Not now…", "Done"]);
  });

  it("offers only the kind answers the step names — a monitor with no idea of worse offers Never alone", () => {
    const note = band({ kindAnswers: { muteKind: true, whenWorse: false } });
    expect(note.buttons.some((button) => button.title === "When it gets worse")).toBe(false);
    press({ note, title: "Not now…" });
    press({ note, title: "More…" });
    expect(showing(note)).toEqual(["Never for this kind", "Back"]);
  });

  it("writes the pressed kind answer's marker and closes the note once it lands", () => {
    const note = band({ kindAnswers: BOTH });
    press({ note, title: "Not now…" });
    press({ note, title: "More…" });
    expect(press({ note, title: "When it gets worse" })).toBe(true);
    expect(note.written).toEqual(["when-worse"]);
  });

  it("keeps the note up and unpresses the answer when its marker does not land", () => {
    const note = band({ kindAnswers: BOTH, writable: false });
    press({ note, title: "Not now…" });
    press({ note, title: "More…" });
    expect(press({ note, title: "Never for this kind" })).toBe(false);
    expect(note.written).toEqual(["mute-kind"]);
    expect(titled({ buttons: note.buttons, title: "Never for this kind" }).state).toBe(OFF);
  });

  it("fits both kind answers and Back in one band, with Back clear of the answers", () => {
    const note = band({ kindAnswers: BOTH });
    const worse = titled({ buttons: note.buttons, title: "When it gets worse" });
    const back = titled({ buttons: note.buttons, title: "Back" });
    expect(worse.x + worse.width).toBe(308);
    expect(back.x).toBe(316);
  });

  it("emits the step's offer and the KIND list into the panel program", () => {
    const source = panelSource({ kindAnswers: BOTH });
    expect(source.split("\n")[0]).toContain('"kindAnswers":{"muteKind":true,"whenWorse":true}');
    expect(source).toContain(KIND_ANSWERS_JS);
    expect(source.indexOf("var KIND = ")).toBeLessThan(source.indexOf("function markerPresent()"));
  });
});

/** The whole panel program for one plain step offering `kindAnswers`. */
function panelSource({ kindAnswers }: { kindAnswers: KindAnswerOffer }): string {
  return handNotePanelSource({
    beatPath: "/live/a.t.beat",
    consoleBase: "http://localhost:3000",
    kindAnswers,
    level: "ordinary",
    liveDir: "/live",
    markerDir: "/m",
    slot: 0,
    step: { id: "a", postedBy: "s", postedIso: "2026-11-02T00:00:00.000Z", unblocks: "u", what: "w", witness: "x" },
    token: "t",
    triage: { commandsDir: "/triage/commands", statePath: "/triage/state.json" },
    wantPath: "/live/a.want",
  });
}
