/**
 * `parseTtyModes`: a tty's input modes off one `stty -g` line, the two flag words and every control character read
 * exactly, and anything else refused whole with what was wrong about it.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseTtyModes } from "../../../../live/standing/ttyModes.js";
import { MEASURED_TTY_MODES } from "../../cli/commands/fleet/fleetKit.js";

describe("parseTtyModes", () => {
  it("reads the measured bare tab's flags and every control character off its gfmt1 line", () => {
    const modes = unwrap(parseTtyModes({ text: `${MEASURED_TTY_MODES}\n`, tty: "ttys005" }));

    expect([modes.iflag, modes.lflag, [...modes.cchars]]).toEqual([
      0x6b42,
      0x4c3,
      [
        ["discard", 0xff],
        ["dsusp", 0xff],
        ["eof", 0x04],
        ["eol", 0xff],
        ["eol2", 0xff],
        ["erase", 0x7f],
        ["intr", 0x03],
        ["kill", 0x15],
        ["lnext", 0xff],
        ["quit", 0xff],
        ["reprint", 0x12],
        ["start", 0x11],
        ["status", 0x14],
        ["stop", 0x13],
        ["susp", 0xff],
        ["werase", 0x17],
      ],
    ]);
  });

  it("refuses a line that is not gfmt1, a field that is not name=hex, and a line missing a flag word or a character", () => {
    const [, ...fields] = MEASURED_TTY_MODES.split(":");
    const noLflag = ["gfmt1", ...fields.filter((field) => !field.startsWith("lflag="))].join(":");
    const noSusp = ["gfmt1", ...fields.filter((field) => !field.startsWith("susp="))].join(":");

    // A 17-digit lflag carries icanon in its low bits and parseInt rounds it away.
    const wideLflag = MEASURED_TTY_MODES.replace("lflag=4c3", "lflag=10000000000000100");
    // A second lflag clearing icanon won over the first that set it.
    const twoLflags = MEASURED_TTY_MODES.replace("lflag=4c3", "lflag=5c3:lflag=4c3");

    expect([
      unwrapErr(parseTtyModes({ text: "stty: /dev/ttys005: Device not configured\n", tty: "ttys005" })),
      unwrapErr(parseTtyModes({ text: "gfmt1:iflag=6b42:lflag=4c3:cflag", tty: "ttys005" })).cause,
      unwrapErr(parseTtyModes({ text: wideLflag, tty: "ttys005" })).cause,
      unwrapErr(parseTtyModes({ text: twoLflags, tty: "ttys005" })).cause,
      unwrapErr(parseTtyModes({ text: noLflag, tty: "ttys005" })).cause,
      unwrapErr(parseTtyModes({ text: noSusp, tty: "ttys005" })).cause,
    ]).toEqual([
      {
        cause: 'stty -g printed "stty: /dev/ttys005: Device not configured", not a gfmt1 line',
        code: "TTY_MODES_UNREADABLE",
        message:
          'the modes of tty ttys005 could not be read (stty -g printed "stty: /dev/ttys005: Device not configured", not a gfmt1 line)',
        tty: "ttys005",
      },
      'field "cflag" of the gfmt1 line is not name=hex of at most eight digits',
      'field "lflag=10000000000000100" of the gfmt1 line is not name=hex of at most eight digits',
      'field "lflag=4c3" of the gfmt1 line repeats lflag, which it already holds',
      "the gfmt1 line holds no iflag or no lflag",
      "the gfmt1 line holds no susp character",
    ]);
  });

  it("refuses the measured line behind blank lines, or followed by a second line, never trimming it into one", () => {
    expect([
      unwrapErr(parseTtyModes({ text: `\n\n${MEASURED_TTY_MODES}\n`, tty: "ttys005" })),
      unwrapErr(parseTtyModes({ text: `${MEASURED_TTY_MODES}\n\n`, tty: "ttys005" })).cause,
      unwrapErr(parseTtyModes({ text: `${MEASURED_TTY_MODES}\nstty: warning\n`, tty: "ttys005" })).cause,
      unwrap(parseTtyModes({ text: MEASURED_TTY_MODES, tty: "ttys005" })).lflag,
    ]).toEqual([
      {
        cause: `stty -g printed ${JSON.stringify(`\n\n${MEASURED_TTY_MODES}\n`)}, not one gfmt1 line`,
        code: "TTY_MODES_UNREADABLE",
        message: `the modes of tty ttys005 could not be read (stty -g printed ${JSON.stringify(`\n\n${MEASURED_TTY_MODES}\n`)}, not one gfmt1 line)`,
        tty: "ttys005",
      },
      `stty -g printed ${JSON.stringify(`${MEASURED_TTY_MODES}\n\n`)}, not one gfmt1 line`,
      `stty -g printed ${JSON.stringify(`${MEASURED_TTY_MODES}\nstty: warning\n`)}, not one gfmt1 line`,
      0x4c3,
    ]);
  });
});
