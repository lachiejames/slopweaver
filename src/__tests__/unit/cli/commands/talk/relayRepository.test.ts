/**
 * Which checkout a relay row is born with: none for the owner's words landing on an `ask:` card (the ask's row carries the
 * work), this build's own declared checkout otherwise, and a named refusal when that does not resolve.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { relayUsesAskRow, resolveRelayRepository } from "../../../../../cli/commands/talk/relayRepository.js";
import { unwrap } from "../../../../../lib/result.js";
import { resolveSelfRepository } from "../../../../../organisation/read.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

const LANDS = { kind: "land" } as const;
const WITHHELD = { kind: "withheld", why: "names #dev-alerts, which the card does not" } as const;

describe("relayUsesAskRow", () => {
  it("is an answer when the owner's words land on the ask card they were looking at", () => {
    expect(relayUsesAskRow({ about: "ask:acme-home-storage-ask", disposition: LANDS })).toBe(true);
  });

  it("is not an answer when the owner's words over an ask card were withheld from it", () => {
    expect(relayUsesAskRow({ about: "ask:acme-home-storage-ask", disposition: WITHHELD })).toBe(false);
  });

  it("is not an answer over any other card kind", () => {
    expect(relayUsesAskRow({ about: "post:sd-359bafb2", disposition: LANDS })).toBe(false);
  });

  it("is not an answer over no card", () => {
    expect(relayUsesAskRow({ about: "", disposition: LANDS })).toBe(false);
  });
});

describe("resolveRelayRepository", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "relay-repository-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("names no checkout for an answer relay, reading nothing", () => {
    const resolved = resolveRelayRepository({ about: "ask:acme-home-storage-ask", disposition: LANDS, home });
    expect(unwrap(resolved)).toBeUndefined();
  });

  it("refuses by name when a home declares no checkout for this build's own repository", () => {
    const resolved = resolveRelayRepository({ about: "", disposition: LANDS, home });
    expect(resolved._unsafeUnwrapErr().code).toBe("RELAY_REPOSITORY_UNRESOLVED");
    expect(resolved._unsafeUnwrapErr().message).toContain("this build's own checkout did not resolve");
  });

  /** A main checkout whose origin is this build's own repository, and a linked worktree cut from it. */
  function checkoutAndWorktree(): { main: string; linked: string } {
    const self = unwrap(resolveSelfRepository({ home }));
    const main = realpathSync(mkdtempSync(join(tmpdir(), "relay-main-")));
    const linked = join(home, "seat");
    const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: main });
    git("init", "--initial-branch=main", ".");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    git("remote", "add", "origin", `https://github.com/${self}.git`);
    git("commit", "-q", "--allow-empty", "-m", "base");
    git("worktree", "add", "-q", "-b", "seat", linked);
    made.push(main);
    return { linked, main };
  }

  function declare({ path }: { path: string }): void {
    const profile = { displayName: "", gitNamespace: "", id: "me", mainCheckouts: [{ path }] };
    writeFileSync(join(home, "profile.json"), JSON.stringify({ ...profile, schemaVersion: 1, sources: [] }), "utf8");
  }

  it("names the declared main checkout of this build's own repository", () => {
    const { main } = checkoutAndWorktree();
    declare({ path: main });
    expect(unwrap(resolveRelayRepository({ about: "", disposition: LANDS, home }))).toBe(main);
  });

  // `handover register --repo` refuses a linked worktree, so naming one would lose the row, never hold it.
  it("refuses a declared linked worktree exactly as handover register would, so the relay is held", () => {
    const { linked } = checkoutAndWorktree();
    declare({ path: linked });
    const resolved = resolveRelayRepository({ about: "", disposition: LANDS, home });
    expect(resolved._unsafeUnwrapErr().code).toBe("RELAY_REPOSITORY_UNRESOLVED");
    expect(resolved._unsafeUnwrapErr().message).toContain("is a linked worktree");
  });
});

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});
