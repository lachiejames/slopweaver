import { describe, expect, it } from "vitest";

import { errorMessage } from "../../../lib/errorMessage.js";

describe("errorMessage", () => {
  it("reads an Error's message and stringifies any other throw", () => {
    expect([new Error("boom"), "plain", 42].map((error) => errorMessage({ error }))).toEqual(["boom", "plain", "42"]);
  });

  it("answers a value String() throws on with its tag, rather than throwing out of the catch reporting it", () => {
    const hostile = {
      toString: (): string => {
        throw new Error("no");
      },
    };
    const hostileTag: unknown = Object.create(null, {
      [Symbol.toStringTag]: {
        get: (): string => {
          throw new Error("tag");
        },
      },
    });
    expect([Object.create(null), hostile, hostileTag].map((error) => errorMessage({ error }))).toEqual([
      "[object Object]",
      "[object Object]",
      "a thrown value that could not be printed",
    ]);
  });

  it("answers a Proxy whose prototype trap throws, which fails the instanceof test itself", () => {
    const trapped = new Proxy(
      {},
      {
        getPrototypeOf: (): object | null => {
          throw new Error("trap");
        },
      },
    );
    expect(errorMessage({ error: trapped })).toBe("a thrown value that could not be printed");
  });

  it("answers an Error whose message is not a string, which would throw in the caller's template", () => {
    const symbolic = new Error("replaced");
    Object.defineProperty(symbolic, "message", { value: Symbol("boom") });
    const why = errorMessage({ error: symbolic });
    expect(why).toBe("a thrown value that could not be printed");
    expect(`threw: ${why}`).toBe("threw: a thrown value that could not be printed");
  });
});
