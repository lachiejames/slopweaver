/**
 * The pure half of a salvage: which branch the work goes onto, and the exact steps that put it there.
 *
 * Every shape here is one the real verb can reach, including the one that is awkward to stage against a
 * real checkout, a tree whose HEAD sha git never reported.
 *
 * Two cases here are regression guards rather than coverage. A tree that HAS a branch still gets a fresh
 * one, so no open pull request's head is moved. And `attempt` yields a DIFFERENT name each time, which is
 * what lets the caller step over a name the remote already carries — a review pass falsified the earlier
 * claim that such a collision was benign, by fast-forwarding a real ref on a bare remote.
 *
 * The ignored-file listing's cases left with the decline they tested.
 */

import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { countNulEntries, planSalvage, salvageBranchName, unwatchedPaths } from "../../../worktree/pruneSalvage.js";
import { oneDestination } from "../../../worktree/salvageDestination.js";
import { SalvageDestinationErrors } from "../../../worktree/salvageErrors.js";
import { HOOKS_OFF as HOOKS_OFF_LIST } from "../../../worktree/salvageHooksOff.js";
import { armoured, salvagePushArgs, withheldIfSecret } from "../../../worktree/salvagePush.js";

const PATH = "/repo/.claude/worktrees/tagged-turn-answers";
const FREE = "salvage/tagged-turn-answers-a1b2c3d4";

describe("salvageBranchName", () => {
  it("namespaces under salvage/ and pins the commit, so it cannot collide with a live branch", () => {
    expect(salvageBranchName({ headSha: "a1b2c3d4e5f67890", path: PATH })).toBe("salvage/tagged-turn-answers-a1b2c3d4");
  });

  it("flattens a basename that is not filesystem-safe into one segment", () => {
    expect(salvageBranchName({ headSha: "0123456789ab", path: "/repo/trees/feat/a b" })).toBe("salvage/a-b-01234567");
  });

  it("walks to a DIFFERENT name per attempt, so a taken one can be stepped over", () => {
    const names = [0, 1, 2, 3].map((attempt) => salvageBranchName({ attempt, headSha: "a1b2c3d4e5f6", path: PATH }));
    expect(names).toEqual([
      "salvage/tagged-turn-answers-a1b2c3d4",
      "salvage/tagged-turn-answers-a1b2c3d4-2",
      "salvage/tagged-turn-answers-a1b2c3d4-3",
      "salvage/tagged-turn-answers-a1b2c3d4-4",
    ]);
    expect(new Set(names).size).toBe(4);
  });
});

/** The two config overrides every salvage git command carries, and how many argv entries they occupy. */
const HOOKS_OFF = "-c core.hooksPath=/dev/null -c core.fsmonitor=false";
const HOOKS_OFF_ARGS = 4;

/**
 * One salvage step's git command with the hooks-off prefix taken off, so a case can assert the command.
 *
 * The prefix is asserted once, on its own, by the case that exists for it — not smeared across every index
 * in this block.
 */
const bare = (step: { readonly args: readonly string[] }): readonly string[] => step.args.slice(HOOKS_OFF_ARGS);

describe("planSalvage", () => {
  it("turns every hook OFF on every step, because git switch fires post-checkout before the index is captured", () => {
    // Two executables, one prefix. A `post-checkout` hook running `git add` overwrites the index between
    // the switch and the commit meant to capture it, and every later check still passes — this repository
    // declares such a hook. `core.fsmonitor` names a second executable that `core.hooksPath` does not
    // govern at all, and a review pass reproduced it destroying staged content through the very first read.
    const plan = planSalvage({ branch: FREE, headSha: "a1b2c3d4e5f6", path: PATH, staged: 1, unstaged: 1 });
    expect(plan.steps.length).toBe(5);
    expect(plan.steps.filter((step) => step.args.slice(0, HOOKS_OFF_ARGS).join(" ") !== HOOKS_OFF)).toEqual([]);
  });

  it("branches and switches before anything else, onto the name it was given", () => {
    const plan = planSalvage({ branch: FREE, headSha: "a1b2c3d4e5f6", path: PATH, staged: 0, unstaged: 0 });
    expect(plan.branch).toBe(FREE);
    expect(plan.steps.map((step) => bare(step)[0])).toEqual(["branch", "switch"]);
    expect(bare(plan.steps[0]!)).toEqual(["branch", FREE, "a1b2c3d4e5f6"]);
  });

  it("uses the caller's resolved name even when it is not the plain one, so a dodged collision is honoured", () => {
    const dodged = "salvage/tagged-turn-answers-a1b2c3d4-2";
    const plan = planSalvage({ branch: dodged, headSha: "a1b2c3d4e5f6", path: PATH, staged: 0, unstaged: 2 });
    expect(plan.branch).toBe(dodged);
    expect(bare(plan.steps[0]!)[1]).toBe(dodged);
    expect(bare(plan.steps[1]!)[1]).toBe(dodged);
  });

  it("commits the INDEX before staging anything over it, so a staged version is not destroyed", () => {
    // The MM case: a file staged with one content and then edited to another. Committing only the working
    // tree loses the staged version for good once the worktree goes, which a review pass reproduced.
    const plan = planSalvage({ branch: FREE, headSha: "a1b2c3d4e5f6", path: PATH, staged: 1, unstaged: 1 });
    expect(plan.steps.map((step) => bare(step)[0])).toEqual(["branch", "switch", "commit", "add", "commit"]);
    expect(bare(plan.steps[2]!)[3]).toContain("the staged index");
    expect(bare(plan.steps[4]!)[3]).toContain("the working tree");
  });

  it("commits ONLY the index when nothing is unstaged, rather than a second commit with nothing in it", () => {
    const plan = planSalvage({ branch: FREE, headSha: "a1b2c3d4e5f6", path: PATH, staged: 2, unstaged: 0 });
    expect(plan.steps.map((step) => bare(step)[0])).toEqual(["branch", "switch", "commit"]);
    expect(bare(plan.steps[2]!)[3]).toContain("the staged index");
  });

  it("stages and commits ONCE when nothing was in the index", () => {
    const plan = planSalvage({ branch: FREE, headSha: "a1b2c3d4e5f6", path: PATH, staged: 0, unstaged: 3 });
    expect(plan.steps.map((step) => bare(step)[0])).toEqual(["branch", "switch", "add", "commit"]);
    expect(bare(plan.steps[2]!)).toEqual(["add", "-A"]);
    expect(bare(plan.steps[3]!)[1]).toBe("--no-verify");
  });

  it("answers a NULL branch when the HEAD sha could not be read, rather than inventing a name", () => {
    const plan = planSalvage({ branch: FREE, headSha: null, path: PATH, staged: 1, unstaged: 1 });
    expect(plan.branch).toBe(null);
    expect(plan.steps).toEqual([]);
  });

  it("answers a NULL branch when no free name was found, rather than pushing over a ref", () => {
    const plan = planSalvage({ branch: null, headSha: "a1b2c3d4e5f6", path: PATH, staged: 1, unstaged: 1 });
    expect(plan.branch).toBe(null);
    expect(plan.steps).toEqual([]);
  });

  it("names the run in every commit message, so the branch says what it came from", () => {
    const plan = planSalvage({ branch: FREE, headSha: "a1b2c3d4e5f6", path: PATH, staged: 1, unstaged: 1 });
    const messages = plan.steps.filter((step) => bare(step)[0] === "commit").map((step) => String(bare(step)[3]));
    expect(messages.length).toBe(2);
    expect(messages.every((message) => message.includes("tagged-turn-answers"))).toBe(true);
    expect(messages.every((message) => message.includes("captured by `slopweaver worktree prune`"))).toBe(true);
  });
});

describe("countNulEntries", () => {
  it("counts TERMINATORS, so an entry that lost a leading space to a trim is still counted", () => {
    // The defect this replaced `countPorcelain` for: the shared `readGit` ends in `.trim()` — it has to,
    // every other consumer wants a bare sha — and that ate column one of porcelain's FIRST line, turning a
    // worktree-only edit into a staged one. The capture then committed an empty index, git exited 1, and the
    // whole salvage declined. Reproduced end to end against real git. A path list has no such column.
    expect(countNulEntries({ listing: "a.txt\0b.txt\0" })).toBe(2);
    expect(countNulEntries({ listing: "leading space.txt\0b.txt\0".slice(1) })).toBe(2);
  });

  it("counts a path containing a NEWLINE as one entry, which a line split could not", () => {
    expect(countNulEntries({ listing: "dir/two\nlines.txt\0plain.txt\0" })).toBe(2);
  });

  it("counts a NON-ASCII path as one entry, unquoted because -z never quotes", () => {
    expect(countNulEntries({ listing: "é.txt\0" })).toBe(1);
  });

  it("answers zero for a listing naming nothing, which is what a clean tree returns", () => {
    expect(countNulEntries({ listing: "" })).toBe(0);
  });

  it("ignores a trailing fragment with no terminator, rather than counting a truncated path as work", () => {
    // Every git `-z` listing terminates its last entry, so a fragment means the read was cut short. Counting
    // it would report work the capture cannot name; not counting it leaves the tree measured as it reads.
    expect(countNulEntries({ listing: "a.txt\0b.tx" })).toBe(1);
  });
});

describe("unwatchedPaths", () => {
  it("picks the LOWERCASE letter, which is the assume-unchanged bit that hides a real edit from status", () => {
    // Verbatim `git ls-files -v -z` output for a tree with one such file — the shape a review pass used to
    // delete uncaptured work: porcelain reported only the other file, so the capture planned nothing.
    expect(unwatchedPaths({ listing: "h hidden.txt\0H visible.txt\0" })).toEqual(["hidden.txt"]);
  });

  it("picks S, the skip-worktree bit, which hides an edit the same way", () => {
    expect(unwatchedPaths({ listing: "S sparse.txt\0H normal.txt\0" })).toEqual(["sparse.txt"]);
  });

  it("answers nothing for a tree git is watching in full", () => {
    expect(unwatchedPaths({ listing: "H a.txt\0H b.txt\0" })).toEqual([]);
    expect(unwatchedPaths({ listing: "" })).toEqual([]);
  });

  it("keeps a NON-ASCII path as one name, which the newline listing would have C-quoted into eight", () => {
    // This is the whole reason the read is `-z`. Git's default `core.quotePath` emits this very entry as
    // `h "\\303\\251.txt"`, a name matching no index entry, so the bit it is fetched to clear never clears.
    // A review pass drove that to a real deletion of uncaptured work; the NUL listing never quotes.
    expect(unwatchedPaths({ listing: "h é.txt\0H visible.txt\0" })).toEqual(["é.txt"]);
  });

  it("keeps a path with a NEWLINE in it whole, which splitting on newlines could not", () => {
    expect(unwatchedPaths({ listing: "h dir/two\nlines.txt\0H b.txt\0" })).toEqual(["dir/two\nlines.txt"]);
  });

  it("keeps a path with spaces whole, because only the first two characters are the letter and its space", () => {
    expect(unwatchedPaths({ listing: "h dir/a file.txt\0" })).toEqual(["dir/a file.txt"]);
  });
});

describe("oneDestination", () => {
  it("answers the one push url when it is the fetch url", () => {
    expect(
      unwrap(
        oneDestination({
          config: "",
          fetchUrl: "git@h:o/r.git\n",
          pushUrls: "git@h:o/r.git\n",
          remote: "origin",
          remotes: "origin\n",
          environment: {},
        }),
      ),
    ).toBe("git@h:o/r.git");
  });

  it("refuses a push url that differs from the fetch url", () => {
    expect(
      unwrapErr(
        oneDestination({
          config: "",
          fetchUrl: "a",
          pushUrls: "b\n",
          remote: "origin",
          remotes: "origin\n",
          environment: {},
        }),
      ),
    ).toEqual(SalvageDestinationErrors.pushUrlMismatch({ count: 1, remote: "origin" }));
  });

  it("refuses a url that is another configured remote's NAME, which git reads and pushes through separately", () => {
    expect(
      unwrapErr(
        oneDestination({
          config: "",
          fetchUrl: "relay",
          pushUrls: "relay\n",
          remote: "origin",
          remotes: "origin\nrelay\n",
          environment: {},
        }),
      ),
    ).toEqual(SalvageDestinationErrors.urlIsRemoteName({ remote: "origin" }));
  });

  it.each(["url.git@elsewhere:.pushinsteadof=git@h:", "url.file:///tmp/router/.insteadof=ssh://trusted.example/"])(
    "refuses any insteadOf rule, which git applies again to the checked url: %s",
    (rule) => {
      expect(
        unwrapErr(
          oneDestination({
            config: `core.bare=false\n${rule}\n`,
            fetchUrl: "git@h:o/r.git",
            pushUrls: "git@h:o/r.git\n",
            remote: "origin",
            remotes: "origin\n",
            environment: {},
          }),
        ),
      ).toEqual(SalvageDestinationErrors.insteadOf());
    },
  );

  it.each([
    { config: "core.sshcommand=ssh -F /tmp/router\n", environment: {} },
    { config: "", environment: { GIT_SSH_COMMAND: "/tmp/router" } },
    { config: "", environment: { GIT_SSH: "/tmp/router" } },
  ])("refuses a configured ssh command, which carries every connection: %o", ({ config, environment }) => {
    expect(
      unwrapErr(
        oneDestination({
          config,
          environment,
          fetchUrl: "git@h:o/r.git",
          pushUrls: "git@h:o/r.git\n",
          remote: "origin",
          remotes: "origin\n",
        }),
      ),
    ).toEqual(SalvageDestinationErrors.sshCommand());
  });

  it.each([
    { config: "http.sslverify=false\n", environment: {} },
    { config: "http.proxy=http://127.0.0.1:8080\nhttp.https://h/.sslverify=0\n", environment: {} },
    { config: "http.sslverify=\n", environment: {} },
    { config: "http.sslverify=00\n", environment: {} },
    { config: "http.sslverify=0k\n", environment: {} },
    { config: "http.https://h/.sslverify=nope\n", environment: {} },
    { config: "", environment: { GIT_SSL_NO_VERIFY: "" } },
  ])(
    "refuses TLS verification switched off, which leaves no certificate binding the url: %o",
    ({ config, environment }) => {
      expect(
        unwrapErr(
          oneDestination({
            config,
            environment,
            fetchUrl: "https://h/o/r.git",
            pushUrls: "https://h/o/r.git\n",
            remote: "origin",
            remotes: "origin\n",
          }),
        ),
      ).toEqual(SalvageDestinationErrors.tlsUnverified());
    },
  );

  it.each(["http.sslverify=true\n", "http.sslverify=YES\nhttp.https://h/.sslverify=1\n", "http.sslverify\n"])(
    "accepts verification spelled on, and a bare key, which git reads as true: %o",
    (config) => {
      expect(
        unwrap(
          oneDestination({
            config,
            environment: {},
            fetchUrl: "https://h/o/r.git",
            pushUrls: "https://h/o/r.git\n",
            remote: "origin",
            remotes: "origin\n",
          }),
        ),
      ).toBe("https://h/o/r.git");
    },
  );

  it("accepts a proxy with verification left on, and an explicit sslverify=true", () => {
    expect(
      unwrap(
        oneDestination({
          config: "http.proxy=http://127.0.0.1:8080\nhttp.sslverify=true\n",
          environment: {},
          fetchUrl: "https://h/o/r.git",
          pushUrls: "https://h/o/r.git\n",
          remote: "origin",
          remotes: "origin\n",
        }),
      ),
    ).toBe("https://h/o/r.git");
  });

  it("accepts an empty GIT_SSH_COMMAND, which git reads as unset", () => {
    expect(
      unwrap(
        oneDestination({
          config: "",
          environment: { GIT_SSH_COMMAND: "" },
          fetchUrl: "git@h:o/r.git",
          pushUrls: "git@h:o/r.git\n",
          remote: "origin",
          remotes: "origin\n",
        }),
      ),
    ).toBe("git@h:o/r.git");
  });

  it("refuses a url naming no authenticated host, which a symlink or DNS-free path can re-point mid-push", () => {
    const refused = [
      "/srv/git/repo.git",
      "file:///srv/git/repo.git",
      "../repo",
      "git://h/o/r.git",
      "http://h/o/r.git",
      "ext::sh -c x",
    ];
    const codes = refused.map(
      (url) =>
        unwrapErr(
          oneDestination({
            config: "",
            fetchUrl: url,
            pushUrls: `${url}\n`,
            remote: "origin",
            remotes: "origin\n",
            environment: {},
          }),
        ).code,
    );
    expect(codes).toEqual(refused.map(() => "UNAUTHENTICATED_DESTINATION"));
  });

  it("accepts the ssh, https and scp-like urls a hosted remote uses", () => {
    const accepted = [
      "git@github.com:lachiejames/slopweaver.git",
      "ssh://git@github.com/o/r.git",
      "https://github.com/o/r.git",
    ];
    const urls = accepted.map((url) =>
      unwrap(
        oneDestination({
          config: "",
          fetchUrl: url,
          pushUrls: `${url}\n`,
          remote: "origin",
          remotes: "origin\n",
          environment: {},
        }),
      ),
    );
    expect(urls).toEqual(accepted);
  });

  it("refuses several push urls even when the first is the fetch url", () => {
    expect(
      unwrapErr(
        oneDestination({
          config: "",
          fetchUrl: "a",
          pushUrls: "a\nb\n",
          remote: "origin",
          remotes: "origin\n",
          environment: {},
        }),
      ),
    ).toEqual(SalvageDestinationErrors.pushUrlMismatch({ count: 2, remote: "origin" }));
  });
});

describe("withheldIfSecret", () => {
  /** A GitHub token shape, built at runtime so this file never carries one for the repository gate to find. */
  const token = "ghp_" + "a".repeat(36);

  it("withholds a url whole and keeps the rest of git's message, which is what makes it useful", () => {
    const text = `could not be listed — Command failed: git ls-remote https://user:${token}@github.com/o/r.git HEAD; nothing was pushed`;
    expect(withheldIfSecret({ denylist: [], text })).toBe(
      "could not be listed — Command failed: git ls-remote https://<url withheld> HEAD; nothing was pushed",
    );
    expect(text).toContain(token);
  });

  it("withholds a url whose QUERY carries the credential, which masking userinfo alone left", () => {
    const text = "fatal: unable to access 'https://h:1/r.git?token=hunter2': refused";
    expect(withheldIfSecret({ denylist: [], text })).toBe("fatal: unable to access 'https://<url withheld>': refused");
    expect(text).toContain("hunter2");
  });

  it("withholds a reason carrying a PRIVATE denylist string, which no built-in pattern knows", () => {
    const text = "git would not stop ignoring 1 file(s) — correct-horse-battery-staple.txt";
    expect(withheldIfSecret({ denylist: ["correct-horse-battery-staple"], text })).toBe(
      "its reason is withheld because it matches a secret pattern — nothing was pushed",
    );
    expect(withheldIfSecret({ denylist: [], text })).toBe(text);
  });

  it("withholds a reason still carrying a credential after the mask, rather than half-redacting it", () => {
    const text = `git commit refused — hook printed ${token}`;
    expect(withheldIfSecret({ denylist: [], text })).toBe(
      "its reason is withheld because it matches a secret pattern — nothing was pushed",
    );
    expect(text).toContain(token);
  });

  it("passes an ordinary reason through unchanged", () => {
    expect(withheldIfSecret({ denylist: [], text: "git commit refused" })).toBe("git commit refused");
  });
});

describe("salvagePushArgs", () => {
  it("leases the ref as MUST-NOT-EXIST, so a branch created after the probe refuses instead of moving", () => {
    // The empty value after the colon is the whole point: git checks it at the receiving end, which closes
    // the window between the availability probe and this push. Reproduced as a real race before it existed.
    expect(
      salvagePushArgs({ sha: "c0ffee", target: "salvage/tagged-turn-answers-a1b2c3d4", url: "git@h:o/r.git" }),
    ).toEqual([
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "push",
      "--recurse-submodules=no",
      "--no-follow-tags",
      "--force-with-lease=refs/heads/salvage/tagged-turn-answers-a1b2c3d4:",
      "git@h:o/r.git",
      "c0ffee^{commit}:refs/heads/salvage/tagged-turn-answers-a1b2c3d4",
    ]);
  });

  it("carries no bare --force, which would defeat the lease it just set", () => {
    const args = salvagePushArgs({ sha: "c0ffee", target: "salvage/x-0000aaaa", url: "git@h:o/r.git" });
    expect(args.includes("--force")).toBe(false);
    expect(args.includes("-f")).toBe(false);
  });
});

describe("armoured", () => {
  it("puts hooks-off in front of every command, once, reads and writes alike", () => {
    const seen: string[] = [];
    const deps = armoured({
      deps: {
        out: () => undefined,
        readGit: ({ args }) => {
          seen.push(args.join(" "));
          return "";
        },
        writeGit: ({ args }) => {
          seen.push(args.join(" "));
          return ok(undefined);
        },
      },
    });
    deps.readGit({ args: ["status", "--porcelain"], cwd: "/t" });
    deps.readGit({ args: [...HOOKS_OFF_LIST, "rev-parse", "HEAD"], cwd: "/t" });
    deps.writeGit({ args: ["push", "u"], cwd: "/t" });
    expect(seen).toEqual([`${HOOKS_OFF} status --porcelain`, `${HOOKS_OFF} rev-parse HEAD`, `${HOOKS_OFF} push u`]);
  });
});
