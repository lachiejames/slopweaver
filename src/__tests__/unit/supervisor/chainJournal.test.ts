/**
 * The chain journal file: its links round-trip in succession order, and an absent journal reads as an empty chain.
 */
import { afterEach, describe, expect, it } from "vitest";

import { readSupervisorChain } from "../../../supervisor/chainStore.js";
import { CHAIN, cleanScratch, NEW, OLD, stateHome } from "./chainReadHarness.js";

afterEach(cleanScratch);

describe("the chain journal", () => {
  it("round-trips its links through the file, in succession order", () => {
    const home = stateHome({ links: [CHAIN[1]!, CHAIN[0]!] });

    expect(readSupervisorChain({ home }).map((link) => link.session.id)).toEqual([OLD, NEW]);
  });

  it("reads an absent journal as an empty chain rather than throwing", () => {
    const home = stateHome({ links: [] });

    expect(readSupervisorChain({ home })).toEqual([]);
  });
});
