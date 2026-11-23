/*
 * The voice window over an open card: the console window's open card reaches the view the voice carries (split out of
 * `desktopShell.test.ts` to keep that file under the size ratchet).
 */
import { describe, expect, it } from "vitest";

import { carriedPageView } from "../../lib/desktopPageReading";
import { pageIdentityOf } from "../../lib/desktopShell";
import { openKeyOf } from "../../lib/pageVoice";

describe("the voice window over an open card", () => {
  it("names the console window's open card, the card the owner's speech and every relay carry", () => {
    // 295 segments spoken over a pull request's card name no card when the view carried across the shell has no
    // open card. This is the chain that view runs: the shell's message, then the view.
    const identity = pageIdentityOf({
      value: { open: "pr:acme.admin.18326", path: "/queue?open=pr%3Aacme.admin.18326", title: "Queue" },
    })!;
    const view = carriedPageView({ identity });
    expect(openKeyOf({ open: view.open })).toBe("pr:acme.admin.18326");
    expect(view).toStrictEqual({
      carried: { kind: "unreached" },
      open: "pr:acme.admin.18326",
      openBy: undefined,
      openTitle: undefined,
      path: "/queue?open=pr%3Aacme.admin.18326",
      shows: undefined,
      title: "Queue",
    });
  });

  it("carries that the voice opened the card, off the carried path's by=voice", () => {
    const identity = pageIdentityOf({
      value: { open: "ask:a", path: "/queue?open=ask%3Aa&by=voice", title: "Queue" },
    })!;
    expect(carriedPageView({ identity }).openBy).toBe("voice");
  });

  it("names no card when none is open there", () => {
    const identity = pageIdentityOf({ value: { path: "/queue", title: "Queue" } })!;
    expect(carriedPageView({ identity })).toEqual({
      carried: { kind: "unreached" },
      open: undefined,
      openBy: undefined,
      path: "/queue",
      shows: undefined,
      title: "Queue",
    });
  });
});
