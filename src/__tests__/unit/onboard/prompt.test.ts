import { describe, expect, it } from "vitest";

import { createLinePrompter, type LineReader } from "../../../onboard/prompt.js";

/** A fake reader whose answers the test settles by hand, and which logs every operation it receives. */
interface FakeReaders {
  readonly createReader: () => LineReader;
  readonly log: string[];
  /** How many readers were created. */
  readonly created: () => number;
  /** Settle the oldest pending question with an answer. */
  readonly answer: (args: { text: string }) => void;
  /** Reject the oldest pending question. */
  readonly fail: () => void;
  /** Fire every close listener installed so far, as stdin ending would. */
  readonly endInput: () => void;
}

/**
 * Build the fake reader factory.
 *
 * @returns the factory and the handles that drive it
 */
function fakeReaders(): FakeReaders {
  const log: string[] = [];
  let created = 0;
  const pending: { resolve: (text: string) => void; reject: (cause: Error) => void }[] = [];
  const closeListeners: (() => void)[] = [];
  return {
    answer: ({ text }) => {
      pending.shift()!.resolve(text);
    },
    created: () => created,
    createReader: () => {
      created += 1;
      log.push("create");
      return {
        close: () => {
          log.push("close");
        },
        onCloseOnce: ({ listener }) => {
          log.push("onCloseOnce");
          closeListeners.push(listener);
        },
        question: ({ prompt }) => {
          log.push(`question ${prompt}`);
          return new Promise<string>((resolve, reject) => {
            pending.push({ reject, resolve });
          });
        },
      };
    },
    endInput: () => {
      for (const listener of closeListeners) {
        listener();
      }
    },
    fail: () => {
      pending.shift()!.reject(new Error("ERR_USE_AFTER_CLOSE"));
    },
    log,
  };
}

describe("createLinePrompter", () => {
  it("creates no reader until the first question", () => {
    const fake = fakeReaders();
    createLinePrompter({ createReader: fake.createReader });
    expect(fake.created()).toBe(0);
  });

  it("asks the question and returns the typed answer", async () => {
    const fake = fakeReaders();
    const prompter = createLinePrompter({ createReader: fake.createReader });
    const answer = prompter.ask({ prompt: "tier? " });
    fake.answer({ text: "alpha" });
    expect(await answer).toBe("alpha");
    expect(fake.log).toEqual(["create", "onCloseOnce", "question tier? "]);
  });

  it("reuses one reader across questions", async () => {
    const fake = fakeReaders();
    const prompter = createLinePrompter({ createReader: fake.createReader });
    const first = prompter.ask({ prompt: "one? " });
    fake.answer({ text: "bravo" });
    expect(await first).toBe("bravo");
    const second = prompter.ask({ prompt: "two? " });
    fake.answer({ text: "charlie" });
    expect(await second).toBe("charlie");
    expect(fake.created()).toBe(1);
  });

  it("answers empty when the question rejects", async () => {
    const fake = fakeReaders();
    const prompter = createLinePrompter({ createReader: fake.createReader });
    const answer = prompter.ask({ prompt: "p? " });
    fake.fail();
    expect(await answer).toBe("");
  });

  it("answers empty when stdin ends before the question settles, rather than hanging", async () => {
    const fake = fakeReaders();
    const prompter = createLinePrompter({ createReader: fake.createReader });
    const answer = prompter.ask({ prompt: "p? " });
    fake.endInput();
    expect(await answer).toBe("");
  });

  it("closes the reader it created, once per close call", async () => {
    const fake = fakeReaders();
    const prompter = createLinePrompter({ createReader: fake.createReader });
    const answer = prompter.ask({ prompt: "p? " });
    fake.answer({ text: "delta" });
    await answer;
    prompter.close();
    expect(fake.log.filter((entry) => entry === "close")).toEqual(["close"]);
  });

  it("closes nothing and creates nothing when no question was ever asked", () => {
    const fake = fakeReaders();
    const prompter = createLinePrompter({ createReader: fake.createReader });
    prompter.close();
    expect(fake.log).toEqual([]);
  });
});
