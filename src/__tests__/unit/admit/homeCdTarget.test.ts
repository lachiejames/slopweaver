import { describe, expect, it } from "vitest";

import { homeCdTarget } from "../../../admit/homeCdTarget.js";
import { resolveMainCheckoutCommandTargets } from "../../../admit/mainCheckoutCommandTarget.js";

const ENV = { HOME: "/u/alice", SLOPWEAVER_HOME: "/u/alice/.slopweaver" } as const;

describe("homeCdTarget", () => {
  it.each([
    { token: "~", want: "/u/alice" },
    { token: "~/.slopweaver/talk/calls", want: "/u/alice/.slopweaver/talk/calls" },
    { token: "$HOME/.slopweaver", want: "/u/alice/.slopweaver" },
    { token: "${HOME}", want: "/u/alice" },
    { token: '"$SLOPWEAVER_HOME/talk/calls"', want: "/u/alice/.slopweaver/talk/calls" },
    { token: "${SLOPWEAVER_HOME}/talk", want: "/u/alice/.slopweaver/talk" },
    { token: '"$SLOPWEAVER_HOME"/talk/calls', want: "/u/alice/.slopweaver/talk/calls" },
    { token: '"${HOME}/.slopweaver"/talk', want: "/u/alice/.slopweaver/talk" },
    { token: '$SLOPWEAVER_HOME/"talk"/calls', want: "/u/alice/.slopweaver/talk/calls" },
  ])("reads $token as $want", ({ token, want }) => {
    expect(homeCdTarget({ env: ENV, token })).toBe(want);
  });

  it.each([
    { token: '"~/x"', why: "a quoted tilde does not expand" },
    { token: "~bob/x", why: "another account's home is unknowable" },
    { token: "$HOMEDIR/x", why: "a different variable" },
    { token: "$HOME/$X", why: "a further expansion" },
    { token: "$HOMEx", why: "a longer name" },
    { token: '"$HOM"E/x', why: "a shorter name the quote ends" },
    { token: '"$HOME/x', why: "an unclosed quote" },
    { token: "$HOME/'x'", why: "a single quote" },
    { token: "$HOME/\\x", why: "a backslash" },
    { token: "relative/dir", why: "no home in it" },
  ])("cannot know $token: $why", ({ token }) => {
    expect(homeCdTarget({ env: ENV, token })).toBe(undefined);
  });

  it("cannot know $SLOPWEAVER_HOME when the environment does not set it", () => {
    expect(homeCdTarget({ env: { HOME: "/u/alice" }, token: "$SLOPWEAVER_HOME" })).toBe(undefined);
  });
});

describe("resolveMainCheckoutCommandTargets with a home expansion", () => {
  const command = "cd ~/.slopweaver/talk/calls && rm live.jsonl";

  it("runs the segment after a cd into a home in that home, only when the caller expands it", () => {
    const expanded = resolveMainCheckoutCommandTargets({
      command,
      cwd: "/w",
      expandCdTarget: (token) => homeCdTarget({ env: ENV, token }),
    });
    expect(expanded.map((target) => target.cwd)).toEqual(["/u/alice/.slopweaver/talk/calls"]);
    expect(resolveMainCheckoutCommandTargets({ command, cwd: "/w" }).map((target) => target.cwd)).toEqual([undefined]);
  });
});
