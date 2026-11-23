/**
 * `githubToken` resolves in the credentials register's order: environment, then the state home's stored
 * `github-token`, then the `gh` CLI login. The defect this holds down is the reverse order, where any machine
 * with a gh login answered gh's account and `--home` never chose the credential. The gh tier is the injected
 * `readGhToken` seam, a plain recording fake, because the real read shells `gh` and the keychain.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { githubToken } from "../../config.js";
import { secretFilePath } from "../../stateHome.js";

const minted: string[] = [];

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home, holding `token` as its stored `github-token` when one is given. */
function homeWith({ token }: { token?: string }): string {
  const home = mkdtempSync(join(tmpdir(), "slop-github-token-"));
  minted.push(home);
  if (token !== undefined) {
    const path = secretFilePath({ home, name: "github-token" });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, token, { mode: 0o600 });
  }
  return home;
}

/** A `gh auth token` stand-in that answers `answer` and counts how often it was asked. */
function ghReader({ answer }: { answer: string | undefined }): { calls: () => number; read: () => string | undefined } {
  let count = 0;
  return {
    calls: () => count,
    read: () => {
      count += 1;
      return answer;
    },
  };
}

describe("githubToken precedence", () => {
  it("answers the environment over a stored file and the gh login, GITHUB_TOKEN before GH_TOKEN", () => {
    const gh = ghReader({ answer: "gh-token" });
    const token = githubToken({
      env: { GH_TOKEN: "gh-env-token", GITHUB_TOKEN: "github-env-token" },
      home: homeWith({ token: "file-token" }),
      readGhToken: gh.read,
    });
    expect(token).toBe("github-env-token");
    expect(gh.calls()).toBe(0);
  });

  it("answers the stored file over the gh login, trimmed, without asking gh", () => {
    const gh = ghReader({ answer: "gh-token" });
    const token = githubToken({ env: {}, home: homeWith({ token: "  file-token\n" }), readGhToken: gh.read });
    expect(token).toBe("file-token");
    expect(gh.calls()).toBe(0);
  });

  it("answers the gh login only when neither the environment nor the home holds a token", () => {
    const gh = ghReader({ answer: "gh-token" });
    const token = githubToken({ env: {}, home: homeWith({}), readGhToken: gh.read });
    expect(token).toBe("gh-token");
    expect(gh.calls()).toBe(1);
  });

  it("treats a blank stored file as absent and asks gh", () => {
    const gh = ghReader({ answer: "gh-token" });
    const token = githubToken({ env: {}, home: homeWith({ token: " \n" }), readGhToken: gh.read });
    expect(token).toBe("gh-token");
    expect(gh.calls()).toBe(1);
  });

  it("is unauthenticated when no tier answers", () => {
    const gh = ghReader({ answer: undefined });
    const token = githubToken({ env: {}, home: homeWith({}), readGhToken: gh.read });
    expect(token).toBeUndefined();
    expect(gh.calls()).toBe(1);
  });

  it("lets --home choose the credential while a gh login is present", () => {
    const gh = ghReader({ answer: "gh-token" });
    const homeA = homeWith({ token: "home-a-token" });
    const homeB = homeWith({ token: "home-b-token" });
    expect(githubToken({ env: {}, home: homeA, readGhToken: gh.read })).toBe("home-a-token");
    expect(githubToken({ env: {}, home: homeB, readGhToken: gh.read })).toBe("home-b-token");
    expect(gh.calls()).toBe(0);
  });
});
