/**
 * A tty's input modes, decoded off `stty -f /dev/<tty> -g`: the one read that says whether a line typed at the tty
 * reaches the shell as a line. A same-owner helper can `stty -f /dev/<tty> icanon inlcr -icrnl` and exit before any
 * process read runs: the shell still shows every column a prompt shows, sleeping, childless, the tty on fd 0 and
 * its group the foreground, yet the kernel now holds every typed byte until a delimiter it maps away, so the resume
 * line queues and is never entered. MEASURED on cmux 0.65.2,
 * `stty -f /dev/ttys005 -g` on a bare tab whose zsh waited in its line editor:
 * `gfmt1:cflag=4b00:iflag=6b42:lflag=4c3:oflag=3:discard=ff:dsusp=ff:eof=4:eol=ff:eol2=ff:erase=7f:intr=3:kill=15:
 * lnext=ff:min=1:quit=ff:reprint=12:start=11:status=14:stop=13:susp=ff:time=0:werase=17:ispeed=9600:ospeed=9600`,
 * which `stty -a` spells `-icanon`, `icrnl inlcr -igncr`, and no control character on `^J` or `^M`. The `-g` form is
 * read rather than `-a` because it is one line of `name=hex` fields and never a word the locale could restyle. The
 * read is `./coldReads.ts`'s `readTtyModes`; this file is the decoder, pure; the judgement is
 * `../../sessions/coldTtyModes.ts`.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { ProcessTableErrors, type ProcessTableTtyModesUnreadableError } from "./processTableErrors.js";

/** A tty's input modes: the two flag words the verdict reads and every control character, `0xff` for one disabled. */
export type TtyModes = {
  readonly iflag: number;
  readonly lflag: number;
  readonly cchars: ReadonlyMap<string, number>;
};

/**
 * The control characters `stty -g` prints, in its own order; `min` and `time` are counts, not characters, and are
 * left out.
 */
const CONTROL_CHARACTERS: readonly string[] = [
  "discard",
  "dsusp",
  "eof",
  "eol",
  "eol2",
  "erase",
  "intr",
  "kill",
  "lnext",
  "quit",
  "reprint",
  "start",
  "status",
  "stop",
  "susp",
  "werase",
];

/**
 * One `name=hex` field of the `gfmt1` line, its value at most eight hex digits: a termios flag word uses 32 bits, and
 * a wider value would be rounded by `Number.parseInt` before the 32-bit bit test read it, so `lflag=10000000000000100`
 * carries `icanon` and would read as raw. A field the decoder cannot hold exactly is
 * refused.
 */
const FIELD = /^([a-z0-9]+)=([0-9a-f]{1,8})$/u;

/**
 * Decode a `stty -g` line into the tty's modes. Anything but one `gfmt1:` line of `name=hex` fields holding both flag
 * words and every control character is refused whole: a line the decoder cannot place is a tty whose modes are
 * unread, never one assumed raw. The text is one line and at most its own trailing newline, never trimmed: `stty -g`
 * prints exactly that, so an output with a blank line before or after it is some other program's.
 *
 * @param text the raw `stty -g` output
 * @param tty the tty it was read for, for the refusal
 * @returns the modes, or why the line could not be decoded
 */
export function parseTtyModes({
  text,
  tty,
}: {
  readonly text: string;
  readonly tty: string;
}): Result<TtyModes, ProcessTableTtyModesUnreadableError> {
  const [line = "", ...rest] = text.split("\n");
  if (rest.length > 1 || rest.join("") !== "") {
    return err(
      ProcessTableErrors.ttyModesUnreadable({
        cause: `stty -g printed ${JSON.stringify(text)}, not one gfmt1 line`,
        tty,
      }),
    );
  }
  const [tag, ...fields] = line.split(":");
  if (tag !== "gfmt1") {
    return err(
      ProcessTableErrors.ttyModesUnreadable({
        cause: `stty -g printed ${JSON.stringify(line)}, not a gfmt1 line`,
        tty,
      }),
    );
  }
  const values = fieldValues({ fields, tty });
  if (values.isErr()) {
    return err(values.error);
  }
  const iflag = values.value.get("iflag");
  const lflag = values.value.get("lflag");
  if (iflag === undefined || lflag === undefined) {
    return err(ProcessTableErrors.ttyModesUnreadable({ cause: "the gfmt1 line holds no iflag or no lflag", tty }));
  }
  const cchars = new Map<string, number>();
  for (const name of CONTROL_CHARACTERS) {
    const value = values.value.get(name);
    if (value === undefined) {
      return err(ProcessTableErrors.ttyModesUnreadable({ cause: `the gfmt1 line holds no ${name} character`, tty }));
    }
    cchars.set(name, value);
  }
  return ok({ cchars, iflag, lflag });
}

/**
 * Each `name=hex` field's value. A name that appears twice is refused on its second field, never resolved to either
 * value: `stty -g` prints each once, and `lflag=100:lflag=0` would otherwise read as raw.
 *
 * @param fields the fields after the `gfmt1` tag
 * @param tty the tty the line was read for, for the refusal
 * @returns each field's value by name, or which field is not `name=hex` of at most eight digits or repeats a name
 */
function fieldValues({
  fields,
  tty,
}: {
  readonly fields: readonly string[];
  readonly tty: string;
}): Result<ReadonlyMap<string, number>, ProcessTableTtyModesUnreadableError> {
  const values = new Map<string, number>();
  for (const field of fields) {
    const match = FIELD.exec(field);
    if (match === null) {
      return err(
        ProcessTableErrors.ttyModesUnreadable({
          cause: `field ${JSON.stringify(field)} of the gfmt1 line is not name=hex of at most eight digits`,
          tty,
        }),
      );
    }
    const [, name = "", hex = ""] = match;
    if (values.has(name)) {
      return err(
        ProcessTableErrors.ttyModesUnreadable({
          cause: `field ${JSON.stringify(field)} of the gfmt1 line repeats ${name}, which it already holds`,
          tty,
        }),
      );
    }
    values.set(name, Number.parseInt(hex, 16));
  }
  return ok(values);
}
