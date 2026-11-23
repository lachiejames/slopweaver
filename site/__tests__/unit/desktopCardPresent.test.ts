/*
 * Which shell method puts a card in front of the owner: a shell that opens Alignment cards is
 * handed every card, and an older Queue-only shell a Queue card only.
 */
import { describe, expect, it } from "vitest";

import { presentCardOnShell } from "../../lib/desktopCardPresent";

const QUEUE = "/queue?open=ask%3Aacme&by=voice";
const ALIGNMENT = "/alignment?open=act%3Aacme-act-1&by=voice";

/**
 * A shell method that records every address it was handed, in order.
 *
 * @returns the method and what it was handed
 */
function recorder(): { method: (input: { readonly path: string }) => Promise<void>; handed: string[] } {
  const handed: string[] = [];
  return {
    handed,
    method: async ({ path }) => {
      handed.push(path);
    },
  };
}

describe("presentCardOnShell", () => {
  it("hands every card to a shell that opens Alignment cards, never its Queue-only method", async () => {
    const consoleCard = recorder();
    const queueCard = recorder();
    const bridge = { presentConsoleCard: consoleCard.method, presentQueueCard: queueCard.method };
    expect([
      await presentCardOnShell({ bridge, path: QUEUE }),
      await presentCardOnShell({ bridge, path: ALIGNMENT }),
    ]).toEqual([{ kind: "opened" }, { kind: "opened" }]);
    expect([consoleCard.handed, queueCard.handed]).toEqual([[QUEUE, ALIGNMENT], []]);
  });

  it("hands an older shell a Queue card, and refuses it an Alignment one in words that say why", async () => {
    const queueCard = recorder();
    const bridge = { presentQueueCard: queueCard.method };
    expect([
      await presentCardOnShell({ bridge, path: QUEUE }),
      await presentCardOnShell({ bridge, path: ALIGNMENT }),
    ]).toEqual([
      { kind: "opened" },
      { kind: "refused", why: "this desktop app predates opening Alignment cards; restart it after a pull" },
    ]);
    expect(queueCard.handed).toEqual([QUEUE]);
  });

  it("refuses every card on a shell that opens none", async () => {
    expect(await presentCardOnShell({ bridge: {}, path: QUEUE })).toEqual({
      kind: "refused",
      why: "this desktop app predates opening cards; restart it after a pull",
    });
  });
});
