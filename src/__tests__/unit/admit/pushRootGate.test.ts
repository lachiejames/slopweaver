import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import { prePushLocalShas, pushUrlsOf, refuseOldHistoryPush } from "../../../admit/pushRootGate.js";
import { writePushRootBinding } from "../../../admit/pushRootStore.js";
import { HOME_WITHOUT_PUSH_ROOTS } from "../../pushRootFixture.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../tempGitRepo.js";

const NO_ENV: Readonly<Record<string, string | undefined>> = {};
const BOUND_URL = "git@github.com:acme/widgets.git";
const UNBOUND_URL = "git@github.com:acme/gadgets.git";

/** A reader that fails the test if the guard reads any Git object at all. */
const refusingGit = (): string => {
  throw new Error("the guard read git when it had nothing to judge");
};

describe("prePushLocalShas", () => {
  it("returns each ref line's local sha, lower-cased, skipping blank lines", () => {
    const stdin = `refs/heads/a ${"A".repeat(40)} refs/heads/a ${"0".repeat(40)}\n\nrefs/heads/b ${"b".repeat(40)} refs/heads/b ${"c".repeat(40)}\n`;

    expect(unwrap(prePushLocalShas({ stdin }))).toEqual(["a".repeat(40), "b".repeat(40)]);
  });

  it("returns the first line that is not a ref line, so the hook refuses rather than skips it", () => {
    expect(unwrapErr(prePushLocalShas({ stdin: "refs/heads/a deadbeef refs/heads/a\n" }))).toBe(
      "refs/heads/a deadbeef refs/heads/a",
    );
  });
});

describe("refuseOldHistoryPush without a register", () => {
  it("passes without reading git, the remote's push URLs included, when the home holds no register", () => {
    const verdict = refuseOldHistoryPush({
      env: NO_ENV,
      home: HOME_WITHOUT_PUSH_ROOTS,
      localShas: ["a".repeat(40)],
      pushUrls: () => refusingGit().split("\n"),
      readGit: refusingGit,
      repoRoot: "/nonexistent",
    });

    expect(verdict.isOk()).toBe(true);
  });
});

describe("refuseOldHistoryPush against a real repository", REAL_GIT_SUITE, () => {
  let repo = "";
  let home = "";
  let unreadableHome = "";
  let freshRoot = "";
  let freshTip = "";
  let oldTip = "";
  let mergeTip = "";
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
  const readGit = ({ cwd, args }: { cwd: string; args: readonly string[] }): string => gitInTemp({ args, cwd });
  const judge = ({
    shas,
    urls = [BOUND_URL],
    at = home,
  }: {
    shas: readonly string[];
    urls?: readonly string[];
    at?: string;
  }) => refuseOldHistoryPush({ env: NO_ENV, home: at, localShas: shas, pushUrls: () => urls, readGit, repoRoot: repo });

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "push-root-gate-"));
    home = mkdtempSync(join(tmpdir(), "push-root-home-"));
    unreadableHome = mkdtempSync(join(tmpdir(), "push-root-bad-"));
    writeFileSync(join(unreadableHome, "push-roots.json"), "{not json");
    git("init", "--initial-branch=main", ".");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    git("commit", "--allow-empty", "-m", "fresh root");
    freshRoot = git("rev-parse", "HEAD");
    git("commit", "--allow-empty", "-m", "fresh work");
    freshTip = git("rev-parse", "HEAD");
    git("checkout", "--orphan", "old");
    git("commit", "--allow-empty", "-m", "old root");
    oldTip = git("rev-parse", "HEAD");
    git("checkout", "main");
    git("merge", "--allow-unrelated-histories", "--no-edit", "old");
    mergeTip = git("rev-parse", "HEAD");
    unwrap(
      writePushRootBinding({
        binding: { recordedAtIso: "2026-01-02T03:04:05.000Z", repository: "acme/widgets", rootSha: freshRoot },
        home,
      }),
    );
  });

  afterAll(() => {
    for (const dir of [repo, home, unreadableHome]) rmSync(dir, { force: true, recursive: true });
  });

  it("passes a commit whose only root is the bound one", () => {
    expect(judge({ shas: [freshTip] }).isOk()).toBe(true);
  });

  it("refuses a commit from the old history, naming its root", () => {
    const refused = unwrapErr(judge({ shas: [oldTip] }));

    expect(refused.code).toBe("OLD_HISTORY_PUSH");
    expect(refused.message).toContain(
      `its history's roots are ${oldTip.slice(0, 12)}, not only ${freshRoot.slice(0, 12)}`,
    );
  });

  it("refuses a merge that descends from the fresh root but carries the old one too", () => {
    const refused = unwrapErr(judge({ shas: [mergeTip] }));

    expect(refused.message).toContain(`${mergeTip.slice(0, 12)}: its history's roots are`);
    expect(refused.message).toContain(oldTip.slice(0, 12));
  });

  it("names the hatch in its refusal", () => {
    expect(unwrapErr(judge({ shas: [oldTip] })).message).toContain("SLOPWEAVER_ALLOW_OLD_HISTORY_PUSH=1");
  });

  it("names every failing commit in one refusal", () => {
    const refused = unwrapErr(judge({ shas: [oldTip, freshTip, mergeTip] }));

    expect(refused.lines.filter((line) => line.startsWith("  acme/widgets ←")).length).toBe(2);
  });

  it("matches the bound repository whatever the case of the push URL", () => {
    expect(unwrapErr(judge({ shas: [oldTip], urls: ["https://github.com/ACME/Widgets.git"] })).code).toBe(
      "OLD_HISTORY_PUSH",
    );
  });

  it("refuses when any one of several push URLs is bound", () => {
    expect(unwrapErr(judge({ shas: [oldTip], urls: [UNBOUND_URL, BOUND_URL] })).code).toBe("OLD_HISTORY_PUSH");
  });

  it("passes old history to a repository that was never re-cut", () => {
    expect(judge({ shas: [oldTip], urls: [UNBOUND_URL] }).isOk()).toBe(true);
  });

  it("passes a deletion, whose local sha is forty zeroes", () => {
    expect(judge({ shas: ["0".repeat(40)] }).isOk()).toBe(true);
  });

  it("refuses a sha git cannot resolve, rather than letting an unproved push through", () => {
    expect(unwrapErr(judge({ shas: ["e".repeat(40)] })).message).toContain("its history could not be read");
  });

  it("refuses every push, even to an unbound repository, when the register is unreadable", () => {
    const refused = unwrapErr(judge({ at: unreadableHome, shas: [freshTip], urls: [UNBOUND_URL] }));

    expect(refused.message).toContain("is present and could not be read");
  });

  it("lets the old history through when the hatch is open", () => {
    const verdict = refuseOldHistoryPush({
      env: { SLOPWEAVER_ALLOW_OLD_HISTORY_PUSH: "1" },
      home,
      localShas: [oldTip],
      pushUrls: () => [BOUND_URL],
      readGit,
      repoRoot: repo,
    });

    expect(verdict.isOk()).toBe(true);
  });

  it("reads a configured pushurl rather than the fetch url", () => {
    git("remote", "add", "origin", UNBOUND_URL);
    git("remote", "set-url", "--push", "origin", BOUND_URL);

    expect(pushUrlsOf({ readGit, remote: "origin", repoRoot: repo })).toEqual([BOUND_URL]);
  });

  it("reads a name no remote carries as the URL itself", () => {
    expect(pushUrlsOf({ readGit, remote: BOUND_URL, repoRoot: repo })).toEqual([BOUND_URL]);
  });
});
