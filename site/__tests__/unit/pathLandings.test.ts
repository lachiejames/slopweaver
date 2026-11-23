/*
 * A router move in a plain browser is opened only once the page reports the card's path, so a navigation pending past
 * the call's deadline is never answered as opened.
 */
import { describe, expect, it } from "vitest";

import { pathLandings } from "../../lib/pathLandings";

/**
 * Whether a promise has settled, after one turn of the microtask queue.
 *
 * @param promise the wait
 * @returns true once it settled
 */
async function settled({ promise }: { promise: Promise<void> }): Promise<boolean> {
  const pending = Symbol("pending");
  const first = await Promise.race([promise, Promise.resolve(pending)]);
  return first !== pending;
}

describe("pathLandings", () => {
  it("leaves a wait out until its own pathname lands", async () => {
    const landings = pathLandings();
    const wait = landings.waitFor({ pathname: "/alignment" });
    landings.landed({ pathname: "/queue" });
    expect([await settled({ promise: wait }), landings.pending()]).toEqual([false, 1]);
  });

  it("settles every wait on a pathname once it lands, and drops them", async () => {
    const landings = pathLandings();
    const first = landings.waitFor({ pathname: "/alignment" });
    const second = landings.waitFor({ pathname: "/alignment" });
    landings.landed({ pathname: "/alignment" });
    expect([await settled({ promise: first }), await settled({ promise: second }), landings.pending()]).toEqual([
      true,
      true,
      0,
    ]);
  });

  it("settles a wait registered before the move even when the page lands at once", async () => {
    const landings = pathLandings();
    const wait = landings.waitFor({ pathname: "/queue" });
    landings.landed({ pathname: "/queue" });
    expect(await settled({ promise: wait })).toBe(true);
  });

  it("does nothing when a pathname lands that no wait is on", () => {
    const landings = pathLandings();
    landings.landed({ pathname: "/queue" });
    expect(landings.pending()).toBe(0);
  });
});
