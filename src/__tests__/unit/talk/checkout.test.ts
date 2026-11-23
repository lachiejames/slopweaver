/**
 * The bounded-read edge, proven against a real git checkout in a temp directory.
 *
 * Every alias case here is a FALSIFIABLE witness rather than an assertion of silence: the file the alias
 * points at carries a marker, the test asserts the marker really is readable through the alias's target
 * (so a fixture that stopped building the alias reddens), and only then asserts that `readTrackedFile`
 * refuses. A `not.toContain` over a fixture that never carried the secret proves nothing.
 */
import {
  chmodSync,
  closeSync,
  constants,
  cpSync,
  fstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  READ_NOFOLLOW,
  readTrackedFile,
  refuseAliasedDescriptor,
  resolveTalkCheckout,
  trackedFilesOf,
  undecodableUnder,
} from "../../../talk/checkout.js";
import { gitInTemp } from "../../tempGitRepo.js";

const OUTSIDE_MARKER = "OUTSIDE-THE-CHECKOUT-abc123";
const IGNORED_MARKER = "UNTRACKED-BUT-INSIDE-def456";

/** U+FFFD, spelled by code point so the fixture cannot be silently normalised by an editor or a formatter. */
const REPLACEMENT = "\u{FFFD}";

/** U+FEFF, the byte-order mark `TextDecoder` strips unless it is told not to. */
const BOM = "\u{FEFF}";

let scratch: string;
let root: string;
let outsideFile: string;

const git = ({ args, input = "" }: { args: readonly string[]; input?: string | Buffer }): string =>
  gitInTemp({ args, cwd: root, input });

/**
 * The scratch directory every case starts from (its checkout initialised and configured, the outside file beside
 * it), built ONCE per file and only ever copied, never written: the `init` and two `config` calls were half of this
 * file's git spawns. Nothing is committed in it, so a copy carries no index for stale stat data to sit in.
 */
let template: string | undefined;

afterAll(() => {
  if (template !== undefined) {
    rmSync(template, { force: true, recursive: true });
  }
});

/** Build the scratch directory {@link template} describes, with real git, on the first call. */
function templateScratch(): string {
  if (template === undefined) {
    const dir = mkdtempSync(join(tmpdir(), "talk-checkout-template-"));
    const repo = join(dir, "repo");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(dir, "outside.txt"), `${OUTSIDE_MARKER}\n`);
    writeFileSync(join(repo, "src", "plain.ts"), "export const answer = 42;\n");
    writeFileSync(join(repo, ".gitignore"), "ignored.env\n");
    writeFileSync(join(repo, "ignored.env"), `${IGNORED_MARKER}\n`);
    gitInTemp({ args: ["init", "-q", repo], cwd: dir });
    gitInTemp({ args: ["config", "user.email", "t@example.com"], cwd: repo });
    gitInTemp({ args: ["config", "user.name", "t"], cwd: repo });
    template = dir;
  }
  return template;
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "talk-checkout-"));
  cpSync(templateScratch(), scratch, { recursive: true });
  root = join(scratch, "repo");
  outsideFile = join(scratch, "outside.txt");
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/** Stage everything, commit, and hand back the tracked set the reader checks membership against. */
const commitAndList = (): ReadonlySet<string> => {
  git({ args: ["add", "-A"] });
  git({ args: ["commit", "-qm", "fixture"] });
  return new Set(unwrap(trackedFilesOf({ root })).paths);
};

describe("resolveTalkCheckout", () => {
  it("resolves a real checkout to its root", () => {
    expect(unwrap(resolveTalkCheckout({ cwd: join(root, "src") }))).toBe(
      git({ args: ["rev-parse", "--show-toplevel"] }),
    );
  });

  it("refuses rather than falling back to cwd when there is no checkout", () => {
    const failure = unwrapErr(resolveTalkCheckout({ cwd: scratch }));
    expect(failure.code).toBe("CHECKOUT_UNRESOLVED");
    expect(failure.message).toContain("refusing to read");
  });
});

describe("trackedFilesOf", () => {
  it("lists tracked files and omits an ignored one, unlike the gate helper's --others listing", () => {
    // The ignored file really is there and really is readable — so its absence below is the reader's
    // behaviour, not an empty fixture.
    expect(readFileSync(join(root, "ignored.env"), "utf8")).toContain(IGNORED_MARKER);
    const tracked = unwrap(trackedFilesOf({ root }));
    expect(tracked.paths).toEqual([]);
    expect(tracked.undecodable).toEqual([]);
    const committed = unwrap(trackedFilesOf({ root: (commitAndList(), root) }));
    expect(committed.paths).toContain("src/plain.ts");
    expect(committed.paths).not.toContain("ignored.env");
  });

  it("reports ENUMERATION_FAILED rather than an empty listing when git cannot read the index", () => {
    // A corrupt `.git/index` is the state that separates the two reads: `rev-parse --show-toplevel` still
    // answers, so the checkout resolves and every caller gets that far, while `ls-files` exits 128. An
    // enumeration arm that returned an empty listing instead would read as a checkout with nothing tracked
    // — so the file really IS tracked first, and git really does refuse afterwards, both asserted.
    commitAndList();
    expect(unwrap(trackedFilesOf({ root })).paths).toContain("src/plain.ts");
    writeFileSync(join(root, ".git", "index"), "not an index");
    expect(unwrap(resolveTalkCheckout({ cwd: root }))).toBe(git({ args: ["rev-parse", "--show-toplevel"] }));

    const failure = unwrapErr(trackedFilesOf({ root }));
    expect(failure.code).toBe("ENUMERATION_FAILED");
    expect(failure.message).toContain("could not list the tracked files");
  });

  it("drops a tracked name that is not valid UTF-8 rather than letting it decode into another file's name", () => {
    // The INDEX holds a name whose bytes end `0xff`. Decoding that lossily as UTF-8 produces the string
    // `bad-�.ts` — which is the real, ordinary, UNTRACKED file written beside it, so the two names
    // used to compare equal and membership passed for a file git has never heard of. The index is the only
    // place such a name can live here: APFS rejects a filename that is not valid UTF-8 outright (EILSEQ).
    commitAndList();
    const collidingName = `bad-${REPLACEMENT}.ts`;
    writeFileSync(join(root, collidingName), `${IGNORED_MARKER}\n`);
    const blob = git({ args: ["hash-object", "-w", "--stdin"], input: "TRACKED_PLACEHOLDER\n" });
    git({
      args: ["update-index", "--add", "--index-info"],
      input: Buffer.concat([Buffer.from(`100644 ${blob}\tbad-`, "utf8"), Buffer.from([0xff]), Buffer.from(".ts\n")]),
    });

    // Falsifiable witnesses: git really tracks a name it has to quote, the untracked file really is on
    // disk, really carries the marker, and git really reports it as untracked.
    expect(git({ args: ["ls-files"] })).toContain('"bad-\\377.ts"');
    expect(readFileSync(join(root, collidingName), "utf8")).toContain(IGNORED_MARKER);
    expect(git({ args: ["status", "--porcelain", "--", collidingName] })).toContain("??");

    const listed = unwrap(trackedFilesOf({ root }));
    expect(listed.undecodable.length).toBe(1);
    expect(undecodableUnder({ names: listed.undecodable, prefix: "" })).toBe(1);
    expect(undecodableUnder({ names: listed.undecodable, prefix: "bad-" })).toBe(1);
    expect(undecodableUnder({ names: listed.undecodable, prefix: "src/" })).toBe(0);
    expect(listed.paths).not.toContain(collidingName);
    const failure = unwrapErr(
      readTrackedFile({ budget: 4096, from: 0, path: collidingName, root, tracked: new Set(listed.paths) }),
    );
    expect(failure.code).toBe("PATH_NOT_TRACKED");
  });

  it("keeps a tracked name whose leading byte-order mark a decoder would otherwise strip", () => {
    // `TextDecoder` drops a leading U+FEFF and raises nothing, so `﻿secret.ts` decoded to
    // `secret.ts` — the name of the UNTRACKED file written beside it. Both files exist here, both carry
    // their own marker, and both are asserted readable before the listing is asserted at all, so a fixture
    // that stopped building either one reddens rather than passing.
    const bomName = `${BOM}secret.ts`;
    writeFileSync(join(root, bomName), "export const tracked = 1;\n");
    const tracked = commitAndList();
    writeFileSync(join(root, "secret.ts"), `${IGNORED_MARKER}\n`);

    expect(readFileSync(join(root, bomName), "utf8")).toContain("export const tracked");
    expect(readFileSync(join(root, "secret.ts"), "utf8")).toContain(IGNORED_MARKER);
    expect(git({ args: ["status", "--porcelain", "--", "secret.ts"] })).toContain("??");

    const listed = unwrap(trackedFilesOf({ root }));
    expect(listed.undecodable).toEqual([]);
    expect(listed.paths).toContain(bomName);
    expect(listed.paths).not.toContain("secret.ts");
    expect(unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "secret.ts", root, tracked })).code).toBe(
      "PATH_NOT_TRACKED",
    );
    // And the real tracked file is still reachable by its own exact name, so this is not a blanket refusal.
    expect(unwrap(readTrackedFile({ budget: 4096, from: 0, path: bomName, root, tracked })).text).toBe(
      "export const tracked = 1;\n",
    );
  });
});

describe("a tracked name that is not a regular file", () => {
  it("refuses a TRACKED path replaced on disk by a directory", () => {
    // Tracked as a file, then swapped for a directory holding the marker — so every earlier check passes
    // (the name is tracked, contained, listed by its parent and not a link) and only the regular-file arm
    // can stop it. The marker really is readable through the swapped-in tree, which is the witness.
    const tracked = commitAndList();
    expect(tracked.has("src/plain.ts")).toBe(true);
    rmSync(join(root, "src", "plain.ts"));
    mkdirSync(join(root, "src", "plain.ts"));
    writeFileSync(join(root, "src", "plain.ts", "inside.txt"), `${IGNORED_MARKER}\n`);
    expect(readFileSync(join(root, "src", "plain.ts", "inside.txt"), "utf8")).toContain(IGNORED_MARKER);

    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "src/plain.ts", root, tracked }));
    expect(failure.code).toBe("PATH_ALIASED");
    expect(failure.message).toContain("not a regular file");
  });
});

describe("the name a directory actually lists", () => {
  it("refuses a tracked name the directory does not spell that way, which case folding hides", () => {
    // On a case-insensitive volume `open`/`lstat`/`fstat` all resolve `Tracked.ts` onto an entry really
    // called `tracked.ts`, which is regular, unlinked and not a symlink — so only the LISTING can tell the
    // two apart. The falsifiable witness is that the real entry is on disk and really holds the marker.
    writeFileSync(join(root, "src", "tracked.ts"), `${IGNORED_MARKER}\n`);
    const tracked = new Set(["src/Tracked.ts"]);
    expect(readFileSync(join(root, "src", "tracked.ts"), "utf8")).toContain(IGNORED_MARKER);

    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "src/Tracked.ts", root, tracked }));
    expect(failure.code).toBe("PATH_ALIASED");
    expect(failure.message).toContain("the name this directory actually lists");
  });

  it("refuses a tracked name whose DIRECTORY component the parent does not spell that way", () => {
    // A directory folds exactly as readily as a file, so the check walks every component rather than the
    // leaf: `SRC/plain.ts` names a real, readable file through a directory nobody lists as `SRC`.
    const tracked = new Set(["SRC/plain.ts"]);
    expect(readFileSync(join(root, "src", "plain.ts"), "utf8")).toContain("export const answer");

    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "SRC/plain.ts", root, tracked }));
    expect(failure.code).toBe("PATH_ALIASED");
    expect(failure.message).toContain("the name this directory actually lists");
  });

  it("allows a name spelled exactly as the directory lists it, so this is not a blanket refusal", () => {
    const tracked = commitAndList();
    expect(unwrap(readTrackedFile({ budget: 4096, from: 0, path: "src/plain.ts", root, tracked })).text).toBe(
      "export const answer = 42;\n",
    );
  });
});

describe("a directory the spelling check cannot list", () => {
  it("refuses rather than waving a name through when readdir is denied", () => {
    // Mode 0111 is the state that separates traversal from enumeration: the file itself opens and reads
    // perfectly, so every check downstream would pass, and only `readdir` fails. That is what makes this
    // arm worth a test — replacing it with `undefined` disables the whole spelling check silently, on a
    // directory whose files still read. Both halves are asserted: the open works, the listing does not.
    const tracked = commitAndList();
    expect(tracked.has("src/plain.ts")).toBe(true);
    chmodSync(join(root, "src"), 0o111);
    expect(readFileSync(join(root, "src", "plain.ts"), "utf8")).toBe("export const answer = 42;\n");
    expect(() => readdirSync(join(root, "src"))).toThrow(/EACCES/u);

    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "src/plain.ts", root, tracked }));
    chmodSync(join(root, "src"), 0o700);
    expect(failure.code).toBe("PATH_UNREADABLE");
    expect(failure.message).toContain("could not list");
  });
});

describe("a tracked file the open itself refuses", () => {
  it("reports PATH_UNREADABLE for a tracked file whose mode denies the read", () => {
    // Mode 000 is the one state that leaves every earlier check satisfied — the name is tracked, contained,
    // spelled the way its directory lists it, a regular file and not a link — and still fails at `open`.
    // The witness is that an ordinary read of the same path really does raise EACCES, so a fixture whose
    // chmod stopped biting reddens here rather than passing on a refusal that never fired.
    const locked = join(root, "src", "locked.ts");
    writeFileSync(locked, "export const needle = 1;\n");
    const tracked = commitAndList();
    expect(tracked.has("src/locked.ts")).toBe(true);
    chmodSync(locked, 0o000);
    expect(() => readFileSync(locked, "utf8")).toThrow(/EACCES/u);

    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "src/locked.ts", root, tracked }));
    chmodSync(locked, 0o600);
    expect(failure.code).toBe("PATH_UNREADABLE");
    expect(failure.message).toContain("EACCES");
  });
});

describe("refuseAliasedDescriptor", () => {
  it("refuses a descriptor whose link count is above one, the state only an fstat can see", () => {
    // The race that reaches this arm through a reader cannot be scheduled from a test — every fixture a
    // test can build is refused by the earlier name check instead. So the CONDITION is built directly: a
    // real hard link to a real file outside the checkout, opened, and its own fstat handed over. The
    // witness is that the descriptor really does serve the outside bytes and really does report nlink 2.
    const link = join(root, "src", "linked.ts");
    linkSync(outsideFile, link);
    const fd = openSync(link, READ_NOFOLLOW);
    try {
      expect(readFileSync(fd, "utf8")).toContain(OUTSIDE_MARKER);
      const stat = fstatSync(fd);
      expect(stat.nlink).toBe(2);
      expect(refuseAliasedDescriptor({ path: "src/linked.ts", stat })!.message).toContain("hard link");
    } finally {
      closeSync(fd);
    }
  });

  it("refuses a descriptor that is not a regular file at all", () => {
    const fd = openSync(join(root, "src"), constants.O_RDONLY);
    try {
      expect(fstatSync(fd).isDirectory()).toBe(true);
      expect(refuseAliasedDescriptor({ path: "src", stat: fstatSync(fd) })!.message).toContain("not a regular file");
    } finally {
      closeSync(fd);
    }
  });

  it("passes an ordinary tracked file, so it is not a blanket refusal", () => {
    const fd = openSync(join(root, "src", "plain.ts"), READ_NOFOLLOW);
    try {
      expect(refuseAliasedDescriptor({ path: "src/plain.ts", stat: fstatSync(fd) })).toBeUndefined();
    } finally {
      closeSync(fd);
    }
  });
});

describe("READ_NOFOLLOW", () => {
  it("refuses to open a symlink at all, which is the only check a descriptor swap cannot defeat", () => {
    // The race the flag closes cannot be scheduled from a test, so what is proven here is the flag's own
    // effect against a real symlink to a real file — and the witness is that the SAME path opens fine
    // without the flag and serves the outside bytes, so a flag that stopped working reddens this.
    const link = join(root, "src", "raced.ts");
    symlinkSync(outsideFile, link);
    const followed = openSync(link, constants.O_RDONLY);
    try {
      expect(readFileSync(followed, "utf8")).toContain(OUTSIDE_MARKER);
    } finally {
      closeSync(followed);
    }
    expect(() => openSync(link, READ_NOFOLLOW)).toThrow(/ELOOP/u);
  });

  it("opens an ordinary file, so the flag is not a blanket refusal", () => {
    const fd = openSync(join(root, "src", "plain.ts"), READ_NOFOLLOW);
    try {
      expect(readFileSync(fd, "utf8")).toBe("export const answer = 42;\n");
    } finally {
      closeSync(fd);
    }
  });
});

describe("readTrackedFile", () => {
  it("reads a tracked file whole, and reports no continuation", () => {
    const tracked = commitAndList();
    const read = unwrap(readTrackedFile({ budget: 4096, from: 0, path: "src/plain.ts", root, tracked }));
    expect(read.text).toBe("export const answer = 42;\n");
    expect(read.window.truncated).toBe(false);
    expect(read.window.nextFrom).toBe(null);
    expect(read.size).toBe(26);
  });

  it("continues a truncated read losslessly across windows", () => {
    const tracked = commitAndList();
    const first = unwrap(readTrackedFile({ budget: 10, from: 0, path: "src/plain.ts", root, tracked }));
    expect(first.window.truncated).toBe(true);
    const second = unwrap(
      readTrackedFile({ budget: 100, from: first.window.nextFrom!, path: "src/plain.ts", root, tracked }),
    );
    expect(first.text + second.text).toBe("export const answer = 42;\n");
  });

  it("refuses a path git does not track", () => {
    const tracked = commitAndList();
    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "ignored.env", root, tracked }));
    expect(failure.code).toBe("PATH_NOT_TRACKED");
  });

  it("refuses a TRACKED symlink whose target is an untracked file inside the checkout", () => {
    symlinkSync(join(root, "ignored.env"), join(root, "src", "alias.ts"));
    const tracked = commitAndList();
    // Falsifiable witness: git really tracks the alias, and the alias really serves the untracked bytes.
    expect(tracked.has("src/alias.ts")).toBe(true);
    expect(readFileSync(join(root, "src", "alias.ts"), "utf8")).toContain(IGNORED_MARKER);
    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "src/alias.ts", root, tracked }));
    expect(failure.code).toBe("PATH_ALIASED");
    expect(failure.message).toContain("symlink");
  });

  it("refuses a TRACKED hard link to a file outside the checkout, which containment alone cannot catch", () => {
    linkSync(outsideFile, join(root, "src", "linked.ts"));
    const tracked = commitAndList();
    // Falsifiable witness: the link is tracked, is an ordinary regular file, resolves INSIDE the root, and
    // serves bytes from outside it. Every check but `nlink` passes.
    expect(tracked.has("src/linked.ts")).toBe(true);
    expect(readFileSync(join(root, "src", "linked.ts"), "utf8")).toContain(OUTSIDE_MARKER);
    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "src/linked.ts", root, tracked }));
    expect(failure.code).toBe("PATH_ALIASED");
    expect(failure.message).toContain("hard link");
  });

  it("refuses a file under a symlinked ancestor — membership catches it, because git tracks the LINK", () => {
    const elsewhere = join(scratch, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "leaf.ts"), `// ${OUTSIDE_MARKER}\n`);
    symlinkSync(elsewhere, join(root, "src", "linkdir"));
    const tracked = commitAndList();
    // Falsifiable witness: the path really does serve outside bytes, and git tracks the symlink ITSELF
    // rather than anything beneath it — which is why membership, not the ancestor walk, is what refuses.
    expect(readFileSync(join(root, "src", "linkdir", "leaf.ts"), "utf8")).toContain(OUTSIDE_MARKER);
    expect(tracked.has("src/linkdir")).toBe(true);
    expect(tracked.has("src/linkdir/leaf.ts")).toBe(false);
    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "src/linkdir/leaf.ts", root, tracked }));
    expect(failure.code).toBe("PATH_NOT_TRACKED");
  });

  it("refuses a symlinked ancestor on the ancestor WALK when membership is told the path is tracked", () => {
    // The ancestor check is defence in depth behind membership, so proving it fires means handing the
    // reader the one input membership would have caught — a tracked set that claims the path. Without the
    // walk this read succeeds and serves the file the link points at.
    const elsewhere = join(scratch, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "leaf.ts"), `// ${OUTSIDE_MARKER}\n`);
    symlinkSync(elsewhere, join(root, "src", "linkdir"));
    commitAndList();
    expect(readFileSync(join(root, "src", "linkdir", "leaf.ts"), "utf8")).toContain(OUTSIDE_MARKER);
    const claimed = new Set(["src/linkdir/leaf.ts"]);
    const failure = unwrapErr(
      readTrackedFile({ budget: 4096, from: 0, path: "src/linkdir/leaf.ts", root, tracked: claimed }),
    );
    expect(failure.code).toBe("PATH_ALIASED");
    expect(failure.message).toContain("symlink");
  });

  it("refuses a traversal before touching the filesystem", () => {
    const tracked = commitAndList();
    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "src/../../outside.txt", root, tracked }));
    expect(failure.code).toBe("PATH_OUTSIDE");
  });

  it("refuses an absolute path", () => {
    const tracked = commitAndList();
    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: outsideFile, root, tracked }));
    expect(failure.code).toBe("PATH_OUTSIDE");
  });

  it("reads a tracked file under a directory whose NAME begins with two dots", () => {
    // `relative()` answers `..config/settings.ts` here, which starts with `..` and escapes nothing: the
    // directory is really called `..config` and really is inside the root. A string-prefix escape test
    // refused it — measured against the shipped verb, `talk code read` answered "resolves outside the
    // checkout root" for this exact fixture. The witness is the content, so a refusal reddens the read.
    mkdirSync(join(root, "..config"));
    writeFileSync(join(root, "..config", "settings.ts"), "export const kept = 1;\n");
    const tracked = commitAndList();
    expect(tracked.has("..config/settings.ts")).toBe(true);

    const read = unwrap(readTrackedFile({ budget: 4096, from: 0, path: "..config/settings.ts", root, tracked }));
    expect(read.text).toBe("export const kept = 1;\n");
    // And a real step out of the root is still refused, so this is not a hole the fix opened.
    expect(unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "../outside.txt", root, tracked })).code).toBe(
      "PATH_OUTSIDE",
    );
  });

  it("refuses an empty path", () => {
    const tracked = commitAndList();
    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "", root, tracked }));
    expect(failure.code).toBe("PATH_OUTSIDE");
  });

  it("refuses a directory, which is tracked-adjacent and not a regular file", () => {
    const tracked = commitAndList();
    const failure = unwrapErr(readTrackedFile({ budget: 4096, from: 0, path: "src", root, tracked }));
    expect(failure.code).toBe("PATH_NOT_TRACKED");
  });

  it("snaps a truncating window back to a UTF-8 boundary so both halves decode", () => {
    writeFileSync(join(root, "src", "accents.ts"), "// héllo wörld ünïcode\n");
    const tracked = commitAndList();
    // Budget 5 reaches the first byte of the two-byte `é`, so the whole character moves to the next
    // window rather than decoding as a replacement character on both sides of the join.
    const first = unwrap(readTrackedFile({ budget: 5, from: 0, path: "src/accents.ts", root, tracked }));
    const second = unwrap(
      readTrackedFile({ budget: 999, from: first.window.nextFrom!, path: "src/accents.ts", root, tracked }),
    );
    expect(first.text).toBe("// h");
    expect(first.window.nextFrom).toBe(4);
    expect(first.text).not.toContain("\uFFFD");
    expect(second.text).not.toContain("\uFFFD");
    expect(first.text + second.text).toBe("// héllo wörld ünïcode\n");
  });

  it("digests the WINDOW's bytes rather than the file's, so two windows are distinguishable", () => {
    const tracked = commitAndList();
    const first = unwrap(readTrackedFile({ budget: 10, from: 0, path: "src/plain.ts", root, tracked }));
    const whole = unwrap(readTrackedFile({ budget: 4096, from: 0, path: "src/plain.ts", root, tracked }));
    expect(first.digest).not.toBe(whole.digest);
  });
});
