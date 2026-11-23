/*
 * The one line a Codex hook-trust pass prints: a write Codex refused, a store it could not read and a pass with
 * nothing due each say which they are, so none reads as the other.
 */
import { describe, expect, it } from "vitest";

import { renderTrustPass } from "../../../../../cli/commands/codex/hooksRun.js";

const HOME = "/x/.codex";

describe("renderTrustPass", () => {
  it("names a refused write by Codex's own message", () => {
    const pass = {
      failure: "config/batchWrite refused: locked",
      reading: { hooks: [], kind: "read" },
      trusted: 0,
    } as const;
    expect(renderTrustPass({ codexHome: HOME, pass })).toBe(
      "codex hooks: Codex did not write trust in /x/.codex — config/batchWrite refused: locked",
    );
  });

  it("never reads an unreadable store as nothing waiting", () => {
    const pass = { failure: undefined, reading: { kind: "unreadable", reason: "no answer" }, trusted: 0 } as const;
    expect(renderTrustPass({ codexHome: HOME, pass })).toBe(
      "codex hooks: nothing was trusted in /x/.codex — its hooks could not be read",
    );
  });

  it("says nothing was waiting when every hook was already trusted", () => {
    const pass = { failure: undefined, reading: { hooks: [], kind: "read" }, trusted: 0 } as const;
    expect(renderTrustPass({ codexHome: HOME, pass })).toBe(
      "codex hooks: no Slopweaver hook in /x/.codex was waiting on trust",
    );
  });

  it("counts the hooks Codex trusted", () => {
    const pass = { failure: undefined, reading: { hooks: [], kind: "read" }, trusted: 13 } as const;
    expect(renderTrustPass({ codexHome: HOME, pass })).toBe(
      "codex hooks: Codex trusted 13 Slopweaver hook(s) in /x/.codex",
    );
  });
});
