/**
 * The one-shot NO-ECHO terminal prompt — the single sanctioned interactive read (a token capture), never a
 * crawl-blocking read. It writes the prompt to stderr (so stdout stays clean for a piped `--json`), reads
 * the line from the TTY in raw mode with echo OFF (nothing the user types is shown), and returns it. Enter
 * ends the line; Ctrl-C aborts (empty string, which the caller rejects as empty). Backspace edits.
 *
 * Effectful edge (like `readStdin`): pure terminal I/O, no fs/network/SDK, so no boundary/door seam. The
 * value is returned to the caller and never logged here.
 */

const ENTER = new Set(["\n", "\r"]);
const BACKSPACE = new Set(["\u007f", "\b"]);
const CTRL_C = "\u0003";

/** What receives one chunk of stdin while the prompt is reading. */
type SecretPromptDataListener = (chunk: Buffer) => void;

/** The terminal operations the prompt makes, owned here so a test can drive them without a TTY. */
export interface SecretPromptTerminal {
  /** Write text to stderr. */
  readonly writeError: (args: { text: string }) => void;
  /** Switch stdin's raw mode, which is what turns echo off. */
  readonly setRawMode: (args: { enabled: boolean }) => void;
  /** Start reading stdin. */
  readonly resume: () => void;
  /** Stop reading stdin. */
  readonly pause: () => void;
  /** Install a listener for stdin's data chunks. */
  readonly onData: (args: { listener: SecretPromptDataListener }) => void;
  /** Remove a listener {@link SecretPromptTerminal.onData} installed. */
  readonly removeData: (args: { listener: SecretPromptDataListener }) => void;
}

/**
 * The real terminal: this process's stdin and stderr, translated to Node's positional stream calls.
 *
 * @returns the adapter, reading `process.stdin` when called rather than at import
 */
function processSecretPromptTerminal(): SecretPromptTerminal {
  const stdin = process.stdin;
  return {
    onData: ({ listener }) => {
      stdin.on("data", listener);
    },
    pause: () => {
      stdin.pause();
    },
    removeData: ({ listener }) => {
      stdin.removeListener("data", listener);
    },
    resume: () => {
      stdin.resume();
    },
    setRawMode: ({ enabled }) => {
      stdin.setRawMode(enabled);
    },
    writeError: ({ text }) => {
      process.stderr.write(text);
    },
  };
}

/**
 * Prompt on stderr and read a line from the TTY with echo disabled.
 *
 * @param prompt the prompt text (written to stderr, not stdout)
 * @param terminal the stdin/stderr operations; omitted takes this process's real terminal
 * @returns the entered line (without the trailing newline); empty string on Ctrl-C. There is no EOF case:
 *   raw mode delivers Ctrl-D as an ordinary character, and a stdin that ends without Enter never settles
 */
export async function promptSecretNoEcho({
  prompt,
  terminal = processSecretPromptTerminal(),
}: {
  prompt: string;
  terminal?: SecretPromptTerminal;
}): Promise<string> {
  terminal.writeError({ text: prompt });
  return new Promise((resolve) => {
    let buffer = "";
    const finish = ({ value }: { value: string }): void => {
      terminal.setRawMode({ enabled: false });
      terminal.pause();
      terminal.removeData({ listener: onData });
      terminal.writeError({ text: "\n" });
      resolve(value);
    };
    const onData: SecretPromptDataListener = (chunk) => {
      for (const ch of chunk.toString("utf8")) {
        if (ENTER.has(ch)) {
          finish({ value: buffer });
          return;
        }
        if (ch === CTRL_C) {
          finish({ value: "" }); // abort with an empty value (rejected upstream as empty)
          return;
        }
        buffer = BACKSPACE.has(ch) ? buffer.slice(0, -1) : buffer + ch;
      }
    };
    terminal.setRawMode({ enabled: true });
    terminal.resume();
    terminal.onData({ listener: onData });
  });
}
