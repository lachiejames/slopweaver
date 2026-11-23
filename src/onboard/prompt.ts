/**
 * The ECHOING one-line terminal prompt — the sibling of `secrets/prompt.ts`, and deliberately not the same
 * function.
 *
 * A secret is read with echo OFF because it must not reach the scrollback. An onboarding answer is the exact
 * opposite: a tier and an app name are choices the user needs to SEE, and needs to still see afterwards when
 * they are reading back what they agreed to. Sharing one prompt between the two would mean one of the two
 * behaviours is wrong, so there are two.
 *
 * The prompt is written to stderr, so `slopweaver onboard --json | jq` keeps a clean stdout. The interface is
 * created LAZILY on the first question: a run where both answers came from flags, or one that is not
 * attached to a terminal, never touches stdin at all.
 *
 * Effectful edge (like `readStdin` and `promptSecretNoEcho`): pure terminal I/O, no fs/network/SDK, so no
 * boundary/door seam. Nothing read here is ever logged.
 */

import { createInterface } from "node:readline/promises";

/** A one-question-at-a-time line reader, closed once when the questions are done. */
export interface LinePrompter {
  /** Ask one question on stderr and read the answer from stdin. */
  readonly ask: (args: { prompt: string }) => Promise<string>;
  /** Release stdin. Safe to call when nothing was ever asked. */
  readonly close: () => void;
}

/** The readline operations the prompter makes, owned here so a test can drive them without a terminal. */
export interface LineReader {
  /** Write the prompt and read one line. */
  readonly question: (args: { prompt: string }) => Promise<string>;
  /** Install a listener that fires once when the reader closes, by `close()` or by stdin ending. */
  readonly onCloseOnce: (args: { listener: () => void }) => void;
  /** Close the reader, releasing stdin. */
  readonly close: () => void;
}

/**
 * The real reader: a readline interface over this process's stdin, prompting on stderr.
 *
 * @returns the adapter, which opens the interface the moment it is called
 */
function createProcessLineReader(): LineReader {
  const iface = createInterface({ input: process.stdin, output: process.stderr });
  return {
    close: () => {
      iface.close();
    },
    onCloseOnce: ({ listener }) => {
      iface.once("close", listener);
    },
    question: ({ prompt }) => iface.question(prompt),
  };
}

/**
 * Build the live line prompter over the real stdin/stderr.
 *
 * @param createReader opens the line reader on the first question; omitted opens one over this process's stdin
 * @returns the prompter; its reader is created on the first `ask` and never before
 */
export function createLinePrompter({
  createReader = createProcessLineReader,
}: {
  createReader?: () => LineReader;
} = {}): LinePrompter {
  let iface: LineReader | undefined;
  // The reader opens on the first question and every later question reuses it, so one never asked opens nothing.
  const openReader = (): LineReader => {
    if (iface !== undefined) {
      return iface;
    }
    const opened = createReader();
    iface = opened;
    return opened;
  };
  return {
    ask: async ({ prompt }) => {
      const reader = openReader();
      // Ctrl-D (or a stdin that ends mid-question) closes the interface, and `question` then never resolves
      // — the verb would hang on a prompt nobody can answer. Racing the close turns that into an EMPTY
      // answer, which every question here reads as "take the default", the same way Ctrl-C is treated by
      // the no-echo secret prompt. Measured: without this, an EOF mid-prompt left the process wedged.
      const closed = new Promise<string>((resolve) => {
        reader.onCloseOnce({
          listener: () => {
            resolve("");
          },
        });
      });
      return Promise.race([reader.question({ prompt }).catch(() => ""), closed]);
    },
    close: () => {
      iface?.close();
    },
  };
}
