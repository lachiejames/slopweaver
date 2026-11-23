/**
 * Which paths the console voice's `file_read` refuses: a credential store on either spelling of a path, and a
 * credential-named file wherever it sits. Everything else on the machine is the owner's pick to read.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  credentialStores,
  expandLocalPath,
  isCredentialName,
  isSourcePath,
  isWithin,
  refusalFor,
  slopweaverHomesOf,
} from "../../../talk/localPath.js";

const HOME = "/Users/someone";
const STORES = credentialStores({ homeDir: HOME, homeEntries: [], slopweaverHomes: [`${HOME}/.slopweaver`] });

describe("slopweaverHomesOf and credentialStores", () => {
  it("finds every ~/.slopweaver* home beside the named ones, once each", () => {
    const homes = slopweaverHomesOf({
      homeDir: HOME,
      homeEntries: [".slopweaver", ".slopweaver-evtest", "Downloads", ".SLOPWEAVER-old"],
      named: [`${HOME}/.slopweaver`, "/opt/sw-home"],
    });
    expect(homes).toEqual([
      `${HOME}/.slopweaver`,
      "/opt/sw-home",
      `${HOME}/.slopweaver-evtest`,
      `${HOME}/.SLOPWEAVER-old`,
    ]);
  });

  it("makes each home's secrets and denylist, and every Codex and Claude login, a store", () => {
    const stores = credentialStores({
      homeDir: HOME,
      homeEntries: [".codex-one", ".claude-b", "notes"],
      slopweaverHomes: [`${HOME}/.slopweaver-evtest`],
    });
    expect(stores).toContain(`${HOME}/.ssh`);
    // The fixed home stores come first; what the entries and homes add is the tail.
    expect(stores.slice(-4)).toEqual([
      `${HOME}/.codex-one/auth.json`,
      `${HOME}/.claude-b/.credentials.json`,
      `${HOME}/.slopweaver-evtest/secrets`,
      `${HOME}/.slopweaver-evtest/hygiene-denylist.txt`,
    ]);
    expect(refusalFor({ paths: [`${HOME}/.slopweaver-evtest/secrets/backup`], stores })).toBe("credential-store");
  });
});

describe("expandLocalPath", () => {
  it("expands ~ and ~/ against the owner's home and normalises an absolute path", () => {
    expect(unwrap(expandLocalPath({ homeDir: HOME, raw: "~" }))).toBe(HOME);
    expect(unwrap(expandLocalPath({ homeDir: HOME, raw: "~/.slopweaver/pages/x/index.html" }))).toBe(
      `${HOME}/.slopweaver/pages/x/index.html`,
    );
    expect(unwrap(expandLocalPath({ homeDir: HOME, raw: "/tmp/a/../b.txt" }))).toBe("/tmp/b.txt");
  });

  it("refuses a relative path, another user's ~ and a control character", () => {
    const codes = ["notes.txt", "~other/x", "/tmp/a\u0000b", ""].map(
      (raw) => unwrapErr(expandLocalPath({ homeDir: HOME, raw })).code,
    );
    expect(codes).toEqual(["LOCAL_PATH_INVALID", "LOCAL_PATH_INVALID", "LOCAL_PATH_INVALID", "LOCAL_PATH_INVALID"]);
    expect(unwrapErr(expandLocalPath({ homeDir: HOME, raw: "notes.txt" })).message).toContain("starting / or ~/");
  });
});

describe("isCredentialName", () => {
  it("marks .env files, key material and SSH private keys", () => {
    const names = [
      ".env",
      ".env.local",
      ".envrc",
      ".env~",
      ".env-local",
      ".env_prod",
      ".env copy",
      ".env2",
      ".env(1)",
      ".env.example.bak",
      "server.pem",
      "cert.P12",
      "id_ed25519",
      "id_rsa",
      "login.keychain-db",
      ".work-console-cron.env",
      "laptop.envrc",
      "hygiene-denylist.txt.bak-1785407666",
      "hygiene-denylist.txt.pre-2026-09-10.bak",
    ];
    expect(names.filter((name) => !isCredentialName({ name }))).toEqual([]);
  });

  it("tells a source file from config by extension", () => {
    const paths = ["/a/b.ts", "/a/b.tsx", "/a/B.PY", "/a/main.go", "/a/x.yml", "/a/x.json", "/a/.env", "/a/notes"];
    expect(paths.filter((path) => isSourcePath({ path }))).toEqual(["/a/b.ts", "/a/b.tsx", "/a/B.PY", "/a/main.go"]);
  });

  it("leaves a template .env, a public key and an ordinary file readable", () => {
    const names = [
      ".env.example",
      ".env.sample",
      ".env.template",
      ".environment",
      "id_ed25519.pub",
      "index.html",
      "keys.md",
      "environment.ts",
    ];
    expect(names.filter((name) => isCredentialName({ name }))).toEqual([]);
  });
});

describe("isWithin", () => {
  it("compares by segment, folded for case", () => {
    expect(isWithin({ path: `${HOME}/.ssh/config`, root: `${HOME}/.ssh` })).toBe(true);
    expect(isWithin({ path: `${HOME}/.SSH/id_rsa`, root: `${HOME}/.ssh` })).toBe(true);
    expect(isWithin({ path: `${HOME}/.ssh`, root: `${HOME}/.ssh` })).toBe(true);
    expect(isWithin({ path: `${HOME}/.sshx/notes`, root: `${HOME}/.ssh` })).toBe(false);
    expect(isWithin({ path: HOME, root: `${HOME}/.ssh` })).toBe(false);
  });
});

describe("refusalFor", () => {
  it("refuses a store on the path as asked and on the path it resolves to", () => {
    expect(refusalFor({ paths: [`${HOME}/.aws/config`], stores: STORES })).toBe("credential-store");
    expect(
      refusalFor({ paths: [`${HOME}/Downloads/link`, `${HOME}/.slopweaver/secrets/slack-token`], stores: STORES }),
    ).toBe("credential-store");
    expect(refusalFor({ paths: [`${HOME}/.slopweaver/hygiene-denylist.txt`], stores: STORES })).toBe(
      "credential-store",
    );
  });

  it("refuses a Codex or Claude login under any of their homes, and nothing else in them", () => {
    const logins = [`${HOME}/.codex-four/auth.json`, `${HOME}/.CODEX/auth.json`, `${HOME}/.claude-b/.credentials.json`];
    expect(logins.map((path) => refusalFor({ paths: [path], stores: STORES }))).toEqual([
      "credential-store",
      "credential-store",
      "credential-store",
    ]);
    expect(refusalFor({ paths: [`${HOME}/.codex-four/config.toml`], stores: STORES })).toBe(undefined);
  });

  it("refuses a credential name outside any store", () => {
    expect(refusalFor({ paths: [`${HOME}/dev/app/.env.production`], stores: STORES })).toBe("credential-name");
  });

  it("reads a published page, a handover and a download", () => {
    const paths = [
      `${HOME}/.slopweaver/pages/voice-hosting/index.html`,
      `${HOME}/.slopweaver/handovers/some-run.md`,
      `${HOME}/Downloads/notes.txt`,
    ];
    expect(paths.map((path) => refusalFor({ paths: [path], stores: STORES }))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
