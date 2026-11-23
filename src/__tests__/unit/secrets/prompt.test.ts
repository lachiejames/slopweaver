import { describe, expect, it } from "vitest";

import { promptSecretNoEcho, type SecretPromptTerminal } from "../../../secrets/prompt.js";

/** A fake terminal that logs every operation and hands the installed data listener back to the test. */
interface FakeTerminal {
  readonly terminal: SecretPromptTerminal;
  readonly log: string[];
  readonly installed: ((chunk: Buffer) => void)[];
  readonly removed: ((chunk: Buffer) => void)[];
  /** Deliver one chunk of typed bytes to the currently installed listener. */
  readonly type: (args: { text: string }) => void;
}

/**
 * Build the fake terminal.
 *
 * @returns the terminal, its log, the listeners it saw and a way to type into it
 */
function fakeTerminal(): FakeTerminal {
  const log: string[] = [];
  const installed: ((chunk: Buffer) => void)[] = [];
  const removed: ((chunk: Buffer) => void)[] = [];
  return {
    installed,
    log,
    removed,
    terminal: {
      onData: ({ listener }) => {
        log.push("onData");
        installed.push(listener);
      },
      pause: () => {
        log.push("pause");
      },
      removeData: ({ listener }) => {
        log.push("removeData");
        removed.push(listener);
      },
      resume: () => {
        log.push("resume");
      },
      setRawMode: ({ enabled }) => {
        log.push(`raw ${String(enabled)}`);
      },
      writeError: ({ text }) => {
        log.push(`write ${JSON.stringify(text)}`);
      },
    },
    type: ({ text }) => {
      installed[0]!(Buffer.from(text, "utf8"));
    },
  };
}

describe("promptSecretNoEcho", () => {
  it("writes the prompt, turns echo off, reads until Enter and returns the line without echoing it", async () => {
    const fake = fakeTerminal();
    const answer = promptSecretNoEcho({ prompt: "token-alpha: ", terminal: fake.terminal });
    fake.type({ text: "sec" });
    fake.type({ text: "ret-bravo\r" });
    expect(await answer).toBe("secret-bravo");
    expect(fake.log).toEqual([
      'write "token-alpha: "',
      "raw true",
      "resume",
      "onData",
      "raw false",
      "pause",
      "removeData",
      'write "\\n"',
    ]);
  });

  it("removes exactly the listener it installed", async () => {
    const fake = fakeTerminal();
    const answer = promptSecretNoEcho({ prompt: "p: ", terminal: fake.terminal });
    fake.type({ text: "x\n" });
    await answer;
    expect(fake.installed.length).toBe(1);
    expect(fake.removed).toEqual(fake.installed);
    expect(fake.removed[0]).toBe(fake.installed[0]);
  });

  it("deletes one character for DEL and one for backspace, and ignores a backspace on an empty buffer", async () => {
    const fake = fakeTerminal();
    const answer = promptSecretNoEcho({ prompt: "p: ", terminal: fake.terminal });
    fake.type({ text: "\bab\u007fcd\bef\n" });
    expect(await answer).toBe("acef");
  });

  it("stops at the first Enter in a chunk and ignores what follows it", async () => {
    const fake = fakeTerminal();
    const answer = promptSecretNoEcho({ prompt: "p: ", terminal: fake.terminal });
    fake.type({ text: "charlie\ndelta" });
    expect(await answer).toBe("charlie");
  });

  it("aborts with an empty string on Ctrl-C, discarding what was typed, and still restores the terminal", async () => {
    const fake = fakeTerminal();
    const answer = promptSecretNoEcho({ prompt: "p: ", terminal: fake.terminal });
    fake.type({ text: "echo\u0003" });
    expect(await answer).toBe("");
    expect(fake.log.slice(-4)).toEqual(["raw false", "pause", "removeData", 'write "\\n"']);
  });

  it("keeps Ctrl-D as an ordinary character, since raw mode delivers it as one", async () => {
    const fake = fakeTerminal();
    const answer = promptSecretNoEcho({ prompt: "p: ", terminal: fake.terminal });
    fake.type({ text: "f\u0004\n" });
    expect(await answer).toBe("f\u0004");
  });
});
