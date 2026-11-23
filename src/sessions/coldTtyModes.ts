/**
 * Whether a tab's tty, read off `stty -g` (`../live/standing/ttyModes.ts`), would hand a typed line to the shell as
 * the line typed. Three things the kernel does with input before any process sees it can keep a resume line from
 * ever being entered while every process read shows a bare prompt: canonical mode holds the bytes until a delimiter, and a helper that set `icanon inlcr -icrnl` left
 * no delimiter a pasted `\n` or an Enter's `\r` can become, since the kernel maps `\n` to `\r` AFTER its
 * `igncr`/`icrnl` step and `\r` delimits nothing; `igncr` drops the `\r` the Enter key the send ends with produces
 * (`../cmux/client.ts`'s `sendLineOver`: the text with a `\n`, then `enter`); and a control character set to a byte
 * the line carries is acted on by the kernel, never passed through: on `^J` or `^M` it eats the line's end, and
 * `stty intr c` makes every `c` of `claude` an interrupt that flushes what was typed before it. So every ENABLED
 * control character must be a control byte, below `0x20` or `DEL`, and not tab, newline or return; which flag turns
 * each one on is deliberately not modelled, since a byte the kernel might act on is a byte the line must not carry.
 * MEASURED the same day: a bare tab's zsh waits in its line editor with the tty RAW (`-icanon`), `-igncr`, and
 * `inlcr icrnl` both set, so a `\n` reaches it as `^M` and its editor accepts the line on either byte; every control
 * character sits on a control byte, `DEL` or is disabled. The modes are read ONCE, after the executables and before the holders, so `stty`'s own brief descriptor
 * on the tty is never a holder that read sees; a helper that sets the modes after the read is the instant residue
 * every read here already states, and the flag words this file does not read (`cflag`, `oflag`, the rest of
 * `iflag`) are a stated residue too.
 */
import type { TtyModes } from "../live/standing/ttyModes.js";
import { type ColdGraftExecutableError, ColdGraftExecutableErrors } from "./coldExecutableErrors.js";

/** macOS `termios.h` local-mode bits the verdict reads: canonical input, and line editing done outside the kernel. */
const ICANON = 0x00_00_01_00;
const EXTPROC = 0x00_00_08_00;
/** The macOS `termios.h` input-mode bit that drops every carriage return, the byte an Enter key sends. */
const IGNCR = 0x00_00_00_80;

/** `_POSIX_VDISABLE`: a control character the kernel never matches. */
const DISABLED = 0xff;
/** The first printable byte, and `DEL`, the one byte above it that is still a control byte. */
const SPACE = 0x20;
const DELETE = 0x7f;
/** The three control bytes a typed line can carry, by the name `stty -a` gives each. */
const LINE_BYTES: ReadonlyMap<number, string> = new Map([
  [0x09, "^I"],
  [0x0a, "^J"],
  [0x0d, "^M"],
]);

/**
 * Whether the tab's tty is in the modes a shell at its prompt leaves it in, as far as a typed line's entry goes: raw,
 * passing carriage returns, with every enabled control character on a control byte the line never carries. A shell at its prompt with its line
 * editor off runs canonical and is refused with the rest; a reopened tab's shell runs its editor, and the recovery
 * reads that shape alone.
 *
 * @param modes the tty's modes
 * @param tty the tab's tty, for the refusal
 * @returns the refusal, or `undefined` when a typed line would reach the shell entered as typed
 */
export function ttyModesAtPrompt({
  modes,
  tty,
}: {
  readonly modes: TtyModes;
  readonly tty: string;
}): ColdGraftExecutableError | undefined {
  if ((modes.lflag & ICANON) !== 0) {
    return ColdGraftExecutableErrors.ttyCanonical({ flag: "icanon", tty });
  }
  if ((modes.lflag & EXTPROC) !== 0) {
    return ColdGraftExecutableErrors.ttyCanonical({ flag: "extproc", tty });
  }
  if ((modes.iflag & IGNCR) !== 0) {
    return ColdGraftExecutableErrors.ttyIgnoresReturn({ tty });
  }
  for (const [name, char] of modes.cchars) {
    const spelled = lineByte({ char });
    if (spelled !== undefined) {
      return ColdGraftExecutableErrors.ttyEatsLineByte({ char: spelled, name, tty });
    }
  }
  return undefined;
}

/**
 * How a control character's byte is spelled in a refusal when a typed line can carry it, or `undefined` when the
 * line never can: a disabled character, or a control byte other than tab, newline and return.
 *
 * @param char the control character's byte
 * @returns the byte spelled for the refusal, or `undefined` when it is no line byte
 */
function lineByte({ char }: { readonly char: number }): string | undefined {
  if (char === DISABLED || char === DELETE) {
    return undefined;
  }
  const named = LINE_BYTES.get(char);
  if (named !== undefined) {
    return named;
  }
  if (char < SPACE) {
    return undefined;
  }
  const hex = `0x${char.toString(16).padStart(2, "0")}`;
  return char < DELETE ? `"${String.fromCharCode(char)}" (${hex})` : hex;
}
