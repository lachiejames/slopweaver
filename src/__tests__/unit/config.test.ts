import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  cloudflareToken,
  cwdRepositoryRefusal,
  notionToken,
  onepasswordEventsToken,
  parseRepositorySlug,
  progressJsonEnabled,
  repositoryFromGitRemote,
  resolveRepository,
} from "../../config.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../tempGitRepo.js";

describe("progressJsonEnabled (env gate)", () => {
  const original = process.env["SLOPWEAVER_PROGRESS_JSON"];
  afterEach(() => {
    if (original === undefined) {
      delete process.env["SLOPWEAVER_PROGRESS_JSON"];
    } else {
      process.env["SLOPWEAVER_PROGRESS_JSON"] = original;
    }
  });

  it("is OFF unless the env var is set to a non-empty value", () => {
    delete process.env["SLOPWEAVER_PROGRESS_JSON"];
    expect(progressJsonEnabled()).toBe(false);
    process.env["SLOPWEAVER_PROGRESS_JSON"] = "";
    expect(progressJsonEnabled()).toBe(false);
    process.env["SLOPWEAVER_PROGRESS_JSON"] = "1";
    expect(progressJsonEnabled()).toBe(true);
  });
});

describe("repositoryFromGitRemote", () => {
  it.each([
    ["https://github.com/octocat/Hello-World.git"],
    ["https://github.com/octocat/Hello-World"],
    ["git@github.com:octocat/Hello-World.git"],
    ["ssh://git@github.com/octocat/Hello-World.git"],
  ])("parses %s", (url) => {
    const result = repositoryFromGitRemote({ remoteUrl: url });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({ owner: "octocat", repo: "Hello-World" });
  });

  it("handles an SSH host alias (per-account clone)", () => {
    const result = repositoryFromGitRemote({ remoteUrl: "git@github-personal:slopweaver/slopweaver.git" });
    expect(unwrap(result)).toEqual({ owner: "slopweaver", repo: "slopweaver" });
  });

  it("rejects an unparseable remote", () => {
    expect(unwrapErr(repositoryFromGitRemote({ remoteUrl: "not-a-remote" }))).toEqual([
      "could not parse owner/repo from git remote: not-a-remote",
    ]);
  });
});

describe("parseRepositorySlug", () => {
  it("accepts owner/repo", () => {
    const result = parseRepositorySlug({ slug: "a/b" });
    expect(unwrap(result)).toEqual({ owner: "a", repo: "b" });
  });

  it.each(["abc", "a/b/c", "/x", "x/"])("rejects %s", (slug) => {
    expect(unwrapErr(parseRepositorySlug({ slug }))).toEqual([`expected owner/repo, got: ${slug}`]);
  });
});

describe("notionToken", () => {
  const originalToken = process.env["NOTION_TOKEN"];
  const originalKey = process.env["NOTION_API_KEY"];

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env["NOTION_TOKEN"];
    } else {
      process.env["NOTION_TOKEN"] = originalToken;
    }
    if (originalKey === undefined) {
      delete process.env["NOTION_API_KEY"];
    } else {
      process.env["NOTION_API_KEY"] = originalKey;
    }
  });

  it("reads the credential from the explicitly selected state home", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-notion-home-"));
    mkdirSync(join(home, "secrets"));
    writeFileSync(join(home, "secrets", "notion-token"), "home-token\n", "utf8");
    delete process.env["NOTION_TOKEN"];
    delete process.env["NOTION_API_KEY"];

    expect(notionToken({ home })).toBe("home-token");

    rmSync(home, { force: true, recursive: true });
  });
});

describe("cloudflareToken", () => {
  const originalToken = process.env["CLOUDFLARE_API_TOKEN"];
  const originalKey = process.env["CF_API_TOKEN"];

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env["CLOUDFLARE_API_TOKEN"];
    } else {
      process.env["CLOUDFLARE_API_TOKEN"] = originalToken;
    }
    if (originalKey === undefined) {
      delete process.env["CF_API_TOKEN"];
    } else {
      process.env["CF_API_TOKEN"] = originalKey;
    }
  });

  it("reads the credential from the explicitly selected state home", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-cloudflare-home-"));
    mkdirSync(join(home, "secrets"));
    writeFileSync(join(home, "secrets", "cloudflare-token"), "home-token\n", "utf8");
    delete process.env["CLOUDFLARE_API_TOKEN"];
    delete process.env["CF_API_TOKEN"];

    expect(cloudflareToken({ home })).toBe("home-token");

    rmSync(home, { force: true, recursive: true });
  });

  it("prefers CLOUDFLARE_API_TOKEN over the state-home file", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-cloudflare-home-"));
    mkdirSync(join(home, "secrets"));
    writeFileSync(join(home, "secrets", "cloudflare-token"), "file-token\n", "utf8");
    process.env["CLOUDFLARE_API_TOKEN"] = "env-token";
    delete process.env["CF_API_TOKEN"];

    expect(cloudflareToken({ home })).toBe("env-token");

    rmSync(home, { force: true, recursive: true });
  });
});

describe("onepasswordEventsToken", () => {
  const originalToken = process.env["ONEPASSWORD_EVENTS_TOKEN"];

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env["ONEPASSWORD_EVENTS_TOKEN"];
    } else {
      process.env["ONEPASSWORD_EVENTS_TOKEN"] = originalToken;
    }
  });

  it("reads the credential from the explicitly selected state home", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-onepassword-home-"));
    mkdirSync(join(home, "secrets"));
    writeFileSync(join(home, "secrets", "onepassword-events-token"), "home-token\n", "utf8");
    delete process.env["ONEPASSWORD_EVENTS_TOKEN"];

    expect(onepasswordEventsToken({ home })).toBe("home-token");

    rmSync(home, { force: true, recursive: true });
  });

  it("prefers ONEPASSWORD_EVENTS_TOKEN over the state-home file", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-onepassword-home-"));
    mkdirSync(join(home, "secrets"));
    writeFileSync(join(home, "secrets", "onepassword-events-token"), "file-token\n", "utf8");
    process.env["ONEPASSWORD_EVENTS_TOKEN"] = "env-token";

    expect(onepasswordEventsToken({ home })).toBe("env-token");

    rmSync(home, { force: true, recursive: true });
  });

  it("is undefined when neither the variable nor the state-home file is present", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-onepassword-home-"));
    mkdirSync(join(home, "secrets"));
    delete process.env["ONEPASSWORD_EVENTS_TOKEN"];

    expect(onepasswordEventsToken({ home })).toBeUndefined();

    rmSync(home, { force: true, recursive: true });
  });
});

const WIDGET = { owner: "acme", repo: "widget" };
const GADGET = { owner: "acme", repo: "gadget" };

describe("cwdRepositoryRefusal", () => {
  it("refuses a cwd under the state home, naming what it resolved and both remedies", () => {
    expect(
      cwdRepositoryRefusal({
        cwd: "/h/.slopweaver/live/loop-a",
        declared: [],
        home: "/h/.slopweaver",
        repository: WIDGET,
      }),
    ).toBe(
      "refusing acme/widget, resolved from cwd /h/.slopweaver/live/loop-a: that is under the Slopweaver state " +
        "home /h/.slopweaver, whose own `origin` is never a verb's subject — pass --repo owner/repo, or run from " +
        "the checkout you mean",
    );
  });

  it("refuses the state home itself, not only what lies beneath it", () => {
    expect(
      cwdRepositoryRefusal({ cwd: "/h/.slopweaver", declared: [], home: "/h/.slopweaver", repository: WIDGET }),
    ).toContain("under the Slopweaver state home");
  });

  it("does not mistake a sibling whose name starts with the home's for the home", () => {
    expect(
      cwdRepositoryRefusal({ cwd: "/h/.slopweaver-old/x", declared: [], home: "/h/.slopweaver", repository: WIDGET }),
    ).toBeUndefined();
  });

  it("refuses a repository no declared main checkout resolves to, listing what is declared", () => {
    expect(
      cwdRepositoryRefusal({ cwd: "/work/widget", declared: [GADGET], home: "/h/.slopweaver", repository: WIDGET }),
    ).toBe(
      "refusing acme/widget, resolved from cwd /work/widget: it is not a declared main checkout's repository " +
        "(acme/gadget) — pass --repo owner/repo, or run from the checkout you mean",
    );
  });

  it("allows a declared repository, compared case-insensitively as GitHub does", () => {
    expect(
      cwdRepositoryRefusal({
        cwd: "/work/widget",
        declared: [GADGET, { owner: "Acme", repo: "Widget" }],
        home: "/h/.slopweaver",
        repository: WIDGET,
      }),
    ).toBeUndefined();
  });

  it("allows anything outside the home when nothing is declared — a fresh onboard has no profile yet", () => {
    expect(
      cwdRepositoryRefusal({ cwd: "/work/widget", declared: [], home: "/h/.slopweaver", repository: WIDGET }),
    ).toBeUndefined();
  });

  it("refuses the state home even when its repository is the declared one", () => {
    expect(
      cwdRepositoryRefusal({ cwd: "/h/.slopweaver/x", declared: [WIDGET], home: "/h/.slopweaver", repository: WIDGET }),
    ).toContain("under the Slopweaver state home");
  });
});

describe("resolveRepository (real git, scratch home)", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  const made: string[] = [];
  afterEach(() => {
    while (made.length > 0) {
      rmSync(made.pop()!, { force: true, recursive: true });
    }
  });
  const scratch = ({ prefix }: { prefix: string }): string => {
    const dir = mkdtempSync(join(tmpdir(), `slopweaver-${prefix}-`));
    made.push(dir);
    return dir;
  };
  const checkoutOf = ({ slug, dir }: { slug: string; dir: string }): string => {
    gitInTemp({ args: ["init", "--quiet"], cwd: dir });
    gitInTemp({ args: ["remote", "add", "origin", `https://github.com/${slug}.git`], cwd: dir });
    return dir;
  };
  const homeDeclaring = ({ paths }: { paths: readonly string[] }): string => {
    const home = scratch({ prefix: "home" });
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        mainCheckouts: paths.map((path) => ({ path })),
        schemaVersion: 1,
        sources: [],
      }),
      "utf8",
    );
    return home;
  };

  it("resolves origin from an ordinary checkout when the home declares nothing", () => {
    const cwd = checkoutOf({ dir: scratch({ prefix: "checkout" }), slug: "acme/widget" });
    expect(unwrap(resolveRepository({ cwd, home: scratch({ prefix: "home" }) }))).toEqual(WIDGET);
  });

  it("refuses a checkout that lives under the state home — the measured incident", () => {
    const home = scratch({ prefix: "home" });
    const loopDir = join(home, "live", "loop-a");
    mkdirSync(loopDir, { recursive: true });
    checkoutOf({ dir: home, slug: "someone/state" });

    const problems = unwrapErr(resolveRepository({ cwd: loopDir, home }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("refusing someone/state, resolved from cwd ");
    expect(problems[0]).toContain("under the Slopweaver state home");
  });

  it("refuses a checkout whose repository no declared main checkout has", () => {
    const declared = checkoutOf({ dir: scratch({ prefix: "declared" }), slug: "acme/gadget" });
    const cwd = checkoutOf({ dir: scratch({ prefix: "checkout" }), slug: "acme/widget" });

    const problems = unwrapErr(resolveRepository({ cwd, home: homeDeclaring({ paths: [declared] }) }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("it is not a declared main checkout's repository (acme/gadget)");
  });

  it("allows a second checkout of a declared repository, and a declared path that no longer exists is skipped", () => {
    const declared = checkoutOf({ dir: scratch({ prefix: "declared" }), slug: "acme/widget" });
    const cwd = checkoutOf({ dir: scratch({ prefix: "checkout" }), slug: "acme/widget" });
    const home = homeDeclaring({ paths: [join(declared, "gone-away"), declared] });

    expect(unwrap(resolveRepository({ cwd, home }))).toEqual(WIDGET);
  });

  it("still reports a missing origin as before, ahead of any refusal", () => {
    const cwd = scratch({ prefix: "noremote" });
    gitInTemp({ args: ["init", "--quiet"], cwd });

    expect(unwrapErr(resolveRepository({ cwd, home: scratch({ prefix: "home" }) }))).toEqual([
      "no `origin` git remote found — pass --repo owner/repo, or run inside a git checkout",
    ]);
  });
});
