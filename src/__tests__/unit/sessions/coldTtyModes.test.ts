/**
 * `ttyModesAtPrompt`: a tab's tty must be in a line editor's modes for a typed line to be entered as typed, raw with
 * every enabled control character on a control byte a line never carries.
 */
import { describe, expect, it } from "vitest";

import type { TtyModes } from "../../../live/standing/ttyModes.js";
import type { ColdGraftExecutableError } from "../../../sessions/coldExecutableErrors.js";
import { ttyModesAtPrompt } from "../../../sessions/coldTtyModes.js";
import { honestTtyModes } from "../cli/commands/fleet/fleetKit.js";

/** The measured bare tab's `lflag`, `-icanon iexten isig echoe echoke echoctl`. */
const MEASURED_LFLAG = 0x4c3;

/**
 * The measured modes with one control character moved.
 *
 * @param name the control character
 * @param char the byte to set it to
 * @returns the modes
 */
function withChar({ name, char }: { readonly name: string; readonly char: number }): TtyModes {
  return { ...honestTtyModes(), cchars: new Map([...honestTtyModes().cchars, [name, char]]) };
}

/**
 * The byte a line-byte refusal spells, the whole refusal when it is another kind, or `undefined` when accepted.
 *
 * @param modes the modes to judge
 * @param tty the tab's tty
 * @returns the spelled byte, another refusal, or `undefined`
 */
function eatenByte({
  modes,
  tty,
}: {
  readonly modes: TtyModes;
  readonly tty: string;
}): ColdGraftExecutableError | string | undefined {
  const refusal = ttyModesAtPrompt({ modes, tty });
  return refusal?.code === "TTY_EATS_LINE_BYTE" ? refusal.char : refusal;
}

describe("ttyModesAtPrompt", () => {
  it("accepts the measured bare tab's modes, raw with inlcr and icrnl both set", () => {
    expect(ttyModesAtPrompt({ modes: honestTtyModes(), tty: "ttys005" })).toBeUndefined();
  });

  // `stty -f /dev/ttys005 icanon inlcr -icrnl` from another tab, exited before the reads.
  it("refuses a canonical tty, naming the flag, and one handing its line editing to the pty's master", () => {
    const canonical = { ...honestTtyModes(), iflag: 0x6a42, lflag: MEASURED_LFLAG | 0x100 };
    const external = { ...honestTtyModes(), lflag: MEASURED_LFLAG | 0x800 };

    expect([
      ttyModesAtPrompt({ modes: canonical, tty: "ttys005" }),
      ttyModesAtPrompt({ modes: external, tty: "ttys005" })?.code,
    ]).toEqual([
      {
        code: "TTY_CANONICAL",
        flag: "icanon",
        message:
          "the tab's tty ttys005 has icanon set in the stty read beside it, so it is in canonical mode, where the kernel holds a typed line until a delimiter it may have been set to map away, where a shell at its prompt reads raw through its own line editor and a typed line would never be entered",
        tty: "ttys005",
      },
      "TTY_CANONICAL",
    ]);
  });

  // `stty -f /dev/ttys005 igncr` from another tab, the tty otherwise as measured.
  it("refuses a tty dropping carriage returns, the byte the send's Enter key produces", () => {
    expect(ttyModesAtPrompt({ modes: { ...honestTtyModes(), iflag: 0x6bc2 }, tty: "ttys005" })).toEqual({
      code: "TTY_IGNORES_RETURN",
      message:
        "the tab's tty ttys005 has igncr set in the stty read beside it, so the kernel would drop the carriage return an Enter sends before the shell saw it and a typed line would never be entered",
      tty: "ttys005",
    });
  });

  // `stty -f /dev/ttys003 intr c` from another tab makes every `c` of `claude` an
  // interrupt, with the tty still raw and no control character on ^J or ^M.
  it("refuses a control character on any byte a typed line can carry, spelling it, and accepts a control byte", () => {
    expect([
      ttyModesAtPrompt({ modes: withChar({ char: 0x63, name: "intr" }), tty: "ttys003" }),
      eatenByte({ modes: withChar({ char: 0x0d, name: "status" }), tty: "ttys005" }),
      eatenByte({ modes: withChar({ char: 0x0a, name: "stop" }), tty: "ttys005" }),
      eatenByte({ modes: withChar({ char: 0x09, name: "eof" }), tty: "ttys005" }),
      eatenByte({ modes: withChar({ char: 0x20, name: "quit" }), tty: "ttys005" }),
      eatenByte({ modes: withChar({ char: 0x7e, name: "susp" }), tty: "ttys005" }),
      eatenByte({ modes: withChar({ char: 0x80, name: "lnext" }), tty: "ttys005" }),
      eatenByte({ modes: withChar({ char: 0x1f, name: "discard" }), tty: "ttys005" }),
      eatenByte({ modes: withChar({ char: 0x7f, name: "intr" }), tty: "ttys005" }),
      eatenByte({ modes: withChar({ char: 0xff, name: "eof" }), tty: "ttys005" }),
    ]).toEqual([
      {
        char: '"c" (0x63)',
        code: "TTY_EATS_LINE_BYTE",
        message:
          'the tab\'s tty ttys003 has its intr character set to "c" (0x63) in the stty read beside it, a byte a typed line can carry, so the kernel would act on that byte itself and the shell would never see the line entered as typed',
        name: "intr",
        tty: "ttys003",
      },
      "^M",
      "^J",
      "^I",
      '" " (0x20)',
      '"~" (0x7e)',
      "0x80",
      undefined,
      undefined,
      undefined,
    ]);
  });
});
