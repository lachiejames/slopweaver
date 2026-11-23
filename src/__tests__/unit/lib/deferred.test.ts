/** The one-shot deferred: the first settle wins, every later one is a no-op. */
import { describe, expect, it } from "vitest";

import { deferred } from "../../../lib/deferred.js";

describe("deferred", () => {
  it("resolves with the first settled value", async () => {
    const pending = deferred<number>();

    pending.settle({ value: 1 });

    expect(await pending.promise).toBe(1);
  });

  it("ignores every settle after the first", async () => {
    const pending = deferred<string>();

    pending.settle({ value: "first" });
    pending.settle({ value: "second" });

    expect(await pending.promise).toBe("first");
  });

  it("reports whether it has settled yet", () => {
    const pending = deferred<number>();

    expect(pending.settled()).toBe(false);
    pending.settle({ value: 1 });
    expect(pending.settled()).toBe(true);
  });

  it("settles a promise a consumer is already awaiting", async () => {
    const pending = deferred<number>();
    const awaited = pending.promise.then((value) => value + 1);

    pending.settle({ value: 41 });

    expect(await awaited).toBe(42);
  });
});
