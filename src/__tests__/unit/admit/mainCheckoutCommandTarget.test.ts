import { describe, expect, it } from "vitest";

import {
  hasInlineEnvironmentOverride,
  hasSegmentInlineEnvironmentOverride,
  resolveMainCheckoutCommandTargets,
} from "../../../admit/mainCheckoutCommandTarget.js";

describe("resolveMainCheckoutCommandTargets", () => {
  it("resolves a command after a literal cd against the session cwd", () => {
    expect(resolveMainCheckoutCommandTargets({ command: "cd ../other && git add file.ts", cwd: "/repos/one" })).toEqual(
      [
        {
          command: " git add file.ts",
          cwd: "/repos/other",
          segmentIndex: 1,
          shellCwd: "/repos/other",
          visited: ["/repos/one", "/repos/other"],
        },
      ],
    );
  });

  it("resolves a spaced git -C target, keeping the shell's own directory beside it", () => {
    expect(resolveMainCheckoutCommandTargets({ command: "git -C ../other add file.ts", cwd: "/repos/one" })).toEqual([
      {
        command: "git -C ../other add file.ts",
        cwd: "/repos/other",
        segmentIndex: 0,
        shellCwd: "/repos/one",
        visited: ["/repos/one"],
      },
    ]);
  });

  it("strips one single-quote pair from a git -C target", () => {
    expect(resolveMainCheckoutCommandTargets({ command: "git -C '../other' add file.ts", cwd: "/repos/one" })).toEqual([
      {
        command: "git -C '../other' add file.ts",
        cwd: "/repos/other",
        segmentIndex: 0,
        shellCwd: "/repos/one",
        visited: ["/repos/one"],
      },
    ]);
  });

  it("strips one double-quote pair from a git -C target", () => {
    expect(resolveMainCheckoutCommandTargets({ command: 'git -C "../other" add file.ts', cwd: "/repos/one" })).toEqual([
      {
        command: 'git -C "../other" add file.ts',
        cwd: "/repos/other",
        segmentIndex: 0,
        shellCwd: "/repos/one",
        visited: ["/repos/one"],
      },
    ]);
  });

  it("resolves an empty quoted git -C target to the cwd itself", () => {
    expect(resolveMainCheckoutCommandTargets({ command: 'git -C "" add file.ts', cwd: "/repos/one" })).toEqual([
      {
        command: 'git -C "" add file.ts',
        cwd: "/repos/one",
        segmentIndex: 0,
        shellCwd: "/repos/one",
        visited: ["/repos/one"],
      },
    ]);
  });

  it("applies multiple relative git -C options in order", () => {
    expect(
      resolveMainCheckoutCommandTargets({ command: "git -C ../other -C nested add file.ts", cwd: "/repos/one" }),
    ).toEqual([
      {
        command: "git -C ../other -C nested add file.ts",
        cwd: "/repos/other/nested",
        segmentIndex: 0,
        shellCwd: "/repos/one",
        visited: ["/repos/one"],
      },
    ]);
  });

  it("moves nothing for an attached -C<dir>, which git refuses as an unknown option", () => {
    expect(resolveMainCheckoutCommandTargets({ command: "git -C../other add file.ts", cwd: "/repos/one" })).toEqual([
      {
        command: "git -C../other add file.ts",
        cwd: "/repos/one",
        segmentIndex: 0,
        shellCwd: "/repos/one",
        visited: ["/repos/one"],
      },
    ]);
  });

  it("carries an unresolved cwd for a cd built from shell expansion", () => {
    const [target] = resolveMainCheckoutCommandTargets({ command: "cd $TARGET && git add file.ts", cwd: "/repos/one" });
    expect(Object.keys(target!).toSorted()).toEqual(["command", "cwd", "segmentIndex", "shellCwd", "visited"]);
    expect(target).toEqual({
      command: " git add file.ts",
      cwd: undefined,
      segmentIndex: 1,
      shellCwd: undefined,
      visited: ["/repos/one"],
    });
  });

  it("keeps a cd segment that runs more than the cd as a target, from where the shell already was", () => {
    expect(resolveMainCheckoutCommandTargets({ command: "cd ../other & git add file.ts", cwd: "/repos/one" })).toEqual([
      {
        command: "cd ../other & git add file.ts",
        cwd: "/repos/one",
        segmentIndex: 0,
        shellCwd: "/repos/one",
        visited: ["/repos/one"],
      },
    ]);
  });

  it("does not apply a piped cd to the next command", () => {
    expect(resolveMainCheckoutCommandTargets({ command: "cd ../other | git add file.ts", cwd: "/repos/one" })).toEqual([
      {
        command: " git add file.ts",
        cwd: "/repos/one",
        segmentIndex: 1,
        shellCwd: "/repos/one",
        visited: ["/repos/one"],
      },
    ]);
  });
});

describe("hasInlineEnvironmentOverride", () => {
  it("recognises a command-scoped assignment", () => {
    expect(
      hasInlineEnvironmentOverride({ command: "SLOPWEAVER_ALLOW_RAW=1 git push", name: "SLOPWEAVER_ALLOW_RAW" }),
    ).toBe(true);
  });

  it("recognises an env-prefixed assignment", () => {
    expect(
      hasInlineEnvironmentOverride({
        command: "env FOO=x SLOPWEAVER_ALLOW_RAW=1 git push",
        name: "SLOPWEAVER_ALLOW_RAW",
      }),
    ).toBe(true);
  });

  it("recognises an env-prefixed assignment after env options", () => {
    expect(
      hasInlineEnvironmentOverride({
        command: "env -i -u FOO SLOPWEAVER_ALLOW_RAW=1 git push",
        name: "SLOPWEAVER_ALLOW_RAW",
      }),
    ).toBe(true);
  });

  it("recognises a same-invocation export", () => {
    expect(
      hasInlineEnvironmentOverride({
        command: "export SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE=1 && git add file.ts",
        name: "SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE",
      }),
    ).toBe(true);
  });

  it("rejects the wrong value", () => {
    expect(
      hasInlineEnvironmentOverride({ command: "SLOPWEAVER_ALLOW_RAW=0 git push", name: "SLOPWEAVER_ALLOW_RAW" }),
    ).toBe(false);
  });

  it("rejects a decoy assignment in an ordinary argument", () => {
    expect(
      hasInlineEnvironmentOverride({
        command: "echo SLOPWEAVER_ALLOW_RAW=1 && git push",
        name: "SLOPWEAVER_ALLOW_RAW",
      }),
    ).toBe(false);
  });

  it("rejects a command-scoped override that would not apply to a later command", () => {
    expect(
      hasInlineEnvironmentOverride({
        command: "SLOPWEAVER_ALLOW_RAW=1 git status && git push",
        name: "SLOPWEAVER_ALLOW_RAW",
      }),
    ).toBe(false);
  });

  it("rejects an export followed by more than one command rather than simulating a shell", () => {
    expect(
      hasInlineEnvironmentOverride({
        command: "export SLOPWEAVER_ALLOW_RAW=1 && git status && git push",
        name: "SLOPWEAVER_ALLOW_RAW",
      }),
    ).toBe(false);
  });
});

describe("hasSegmentInlineEnvironmentOverride", () => {
  const name = "SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE";

  it("recognises the override on the first of two newline-separated commands", () => {
    const command = `${name}=1 git commit -m wip\ngit status`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 0 })).toBe(true);
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 1 })).toBe(false);
  });

  it("recognises the override on the first of two &&-chained commands, not the second", () => {
    const command = `${name}=1 git commit -m wip && echo done`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 0 })).toBe(true);
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 1 })).toBe(false);
  });

  it("recognises the override on a later segment when an unrelated cd precedes it", () => {
    const command = `cd ../other && ${name}=1 git push`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 0 })).toBe(false);
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 1 })).toBe(true);
  });

  it("does not let an override on one segment authorise a different, non-overridden segment", () => {
    const command = `${name}=1 git status && git push`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 0 })).toBe(true);
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 1 })).toBe(false);
  });

  it("generalises the export-then-command shape to every later segment, not just the first", () => {
    const command = `export ${name}=1 && git add file.ts && git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 1 })).toBe(true);
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(true);
  });

  it("does not let an export persist across a pipe into a subshell", () => {
    const command = `export ${name}=1 | git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 1 })).toBe(false);
  });

  it("does not let an export ON THE RIGHT SIDE of a pipe persist to a later chained segment", () => {
    // `true | export NAME=1` runs the export in the pipeline's own subshell fork; the export dies with that
    // fork even though its own separator to the next segment is `&&`.
    const command = `true | export ${name}=1 && git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(false);
  });

  it("still treats a pipe-forked export as isolated when a newline immediately after the pipe hides it behind an empty gap segment", () => {
    // A newline right after `|` is shell line-continuation, not a fresh statement, so this splits into an
    // empty gap segment between the `|` and the `\n` match -- the export is still pipe-forked and isolated.
    const command = `true |\nexport ${name}=1\ngit push`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 3 })).toBe(false);
  });

  it("still treats a pipe-forked export as isolated when a comment sits between the pipe and its continuation newline", () => {
    const command = `true | # continuation comment\nexport ${name}=1\ngit push`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 3 })).toBe(false);
  });

  it("stops a previously exported override once an intervening unset clears it", () => {
    const command = `export ${name}=1; unset ${name}; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(false);
  });

  it("stops a previously exported override once an intervening re-export sets a different value", () => {
    const command = `export ${name}=1; export ${name}=0; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(false);
  });

  it("stops a previously exported override once an intervening bare reassignment sets a different value", () => {
    const command = `export ${name}=1; ${name}=0; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(false);
  });

  it("does not let a command-scoped reassignment on a later segment clear the export for segments after it", () => {
    // `NAME=0 echo hi` only scopes NAME=0 to `echo`'s own environment; it never touches the shell variable.
    const command = `export ${name}=1; ${name}=0 echo hi; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(true);
  });

  it("stops a previously exported override on a bare reassignment even with a trailing comment", () => {
    const command = `export ${name}=1; ${name}=0 # cancel\ngit commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(false);
  });

  it("takes the LAST operand when one export sets the same variable twice, not just any occurrence of =1", () => {
    const command = `export ${name}=1 ${name}=0; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 1 })).toBe(false);
  });

  it("takes the LAST operand when one export sets the same variable twice, the other order", () => {
    const command = `export ${name}=0 ${name}=1; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 1 })).toBe(true);
  });

  it("does not treat a bare NAME=1 as an override when the variable was never actually exported", () => {
    // A bare (non-export) assignment is a local shell variable -- invisible to a later command's own
    // environment unless NAME already carries the export attribute from an earlier real `export`.
    const command = `${name}=1; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 1 })).toBe(false);
  });

  it("still recognises a bare cancelling reassignment with a redirection attached", () => {
    // `NAME=0 >/dev/null` is still an assignment-only simple command in real shell grammar -- the
    // redirection is not a command word.
    const command = `export ${name}=1; ${name}=0 >/dev/null; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(false);
  });

  it("stops a previously exported override once an intervening `export -n` removes the export attribute", () => {
    const command = `export ${name}=1; export -n ${name}; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(false);
  });

  it("does not mistake a bare assignment's redirection TARGET for an assignment to name", () => {
    // `> NAME=1` redirects stdout to a file literally named "NAME=1" -- it is never a real assignment.
    const command = `export ${name}=0; FOO=x > ${name}=1; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(false);
  });

  it("does not mistake an export statement's redirection TARGET for one of its operands", () => {
    const command = `export ${name}=0; export FOO=x > ${name}=1; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(false);
  });

  it("recognises `export -n` regardless of where a redirection sits relative to the flag", () => {
    const command = `export ${name}=1; export >/dev/null -n ${name}; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 2 })).toBe(false);
  });

  it("does not mistake a `<>` redirection's separate target token for an export operand", () => {
    // `<>` is a distinct two-character operator (open for read+write), not `<` with a stray `>` attached --
    // its target is the NEXT token, same as a detached `>`.
    const command = `export ${name}=0 <> ${name}=1; git commit -m wip`;
    expect(hasSegmentInlineEnvironmentOverride({ command, name, segmentIndex: 1 })).toBe(false);
  });

  it("still recognises the plain single-segment shape", () => {
    expect(hasSegmentInlineEnvironmentOverride({ command: `${name}=1 git commit -m wip`, name, segmentIndex: 0 })).toBe(
      true,
    );
  });

  it("returns false for a segment index past the end", () => {
    expect(hasSegmentInlineEnvironmentOverride({ command: "git status", name, segmentIndex: 5 })).toBe(false);
  });
});
