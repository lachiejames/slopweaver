/**
 * {@link mainCheckoutEntries} and {@link describeMainCheckoutEntries} — the `handover lint` rule that stops
 * a doc telling a spawned child to `cd` into a shared main checkout. Pure: the declared checkouts and the
 * home directory are passed in.
 */
import { describe, expect, it } from "vitest";

import { describeMainCheckoutEntries, mainCheckoutEntries } from "../../../handover/childStanding.js";

const HOME = "/fixture-root";
const DECLARED = ["/fixture-root/dev/work-repo", "/fixture-root/dev/plugin"];

/** One fenced bash block around a body, the shape a handover doc writes a command in. */
function fenced({ body }: { body: string }): string {
  return `# Doc\n\nSome prose.\n\n\`\`\`bash\n${body}\n\`\`\`\n`;
}

/** The entries a fenced body produces against the fixture home and declared set. */
function entriesFor({ body }: { body: string }): ReturnType<typeof mainCheckoutEntries> {
  return mainCheckoutEntries({ declared: DECLARED, home: HOME, text: fenced({ body }) });
}

describe("mainCheckoutEntries", () => {
  it("finds a tilde-written cd into a declared main checkout", () => {
    expect(entriesFor({ body: "cd ~/dev/work-repo && yarn thing" })).toEqual([
      { checkout: "/fixture-root/dev/work-repo", line: 6, target: "~/dev/work-repo" },
    ]);
  });

  it("finds an absolute cd into a declared main checkout", () => {
    expect(entriesFor({ body: "cd /fixture-root/dev/work-repo" })[0]!.checkout).toBe("/fixture-root/dev/work-repo");
  });

  it("finds a cd into a subdirectory of a declared main checkout", () => {
    expect(entriesFor({ body: "cd ~/dev/work-repo/packages/console" })[0]!.checkout).toBe(
      "/fixture-root/dev/work-repo",
    );
  });

  it("allows a cd into one of that checkout's own worktrees", () => {
    expect(entriesFor({ body: "cd ~/dev/work-repo/.claude/worktrees/my-slug" })).toEqual([]);
  });

  it("allows a cd to a directory in no declared checkout", () => {
    expect(entriesFor({ body: "cd ~/dev/somewhere-else" })).toEqual([]);
  });

  it("ignores the same cd written as prose, so a doc may recount the incident", () => {
    expect(
      mainCheckoutEntries({
        declared: DECLARED,
        home: HOME,
        text: "step 1 told them to `cd ~/dev/work-repo`, which is what caused this\n",
      }),
    ).toEqual([]);
  });

  it("ignores a cd whose target is built from shell expansion", () => {
    expect(entriesFor({ body: "cd $REPO_ROOT" })).toEqual([]);
  });

  it("finds a cd that follows another command in the same line", () => {
    expect(entriesFor({ body: "set -e; cd ~/dev/work-repo" })[0]!.target).toBe("~/dev/work-repo");
  });

  it("does not read `cd` inside a longer word as a command", () => {
    expect(entriesFor({ body: "abcd ~/dev/work-repo" })).toEqual([]);
  });

  it("reports every offending line in document order", () => {
    expect(entriesFor({ body: "cd ~/dev/work-repo\ncd ~/dev/plugin" }).map((entry) => entry.line)).toEqual([6, 7]);
  });

  it("finds nothing when nothing is declared, which is the fail-open direction", () => {
    expect(mainCheckoutEntries({ declared: [], home: HOME, text: fenced({ body: "cd ~/dev/work-repo" }) })).toEqual([]);
  });

  it("stops reading at the closing fence, so a later prose mention is not an instruction", () => {
    expect(
      mainCheckoutEntries({
        declared: DECLARED,
        home: HOME,
        text: `\`\`\`bash\nls\n\`\`\`\nand never \`cd ~/dev/work-repo\`\n`,
      }),
    ).toEqual([]);
  });

  it("reads a tilde-only cd as the home directory, which is in no declared checkout here", () => {
    expect(entriesFor({ body: "cd ~" })).toEqual([]);
  });
});

describe("describeMainCheckoutEntries", () => {
  it("names each offending line and the checkout it enters", () => {
    expect(
      describeMainCheckoutEntries({
        entries: [{ checkout: "/fixture-root/dev/work-repo", line: 6, target: "~/dev/work-repo" }],
      })[2],
    ).toBe("    line 6: cd ~/dev/work-repo  →  /fixture-root/dev/work-repo");
  });

  it("closes with the two repairs an author may choose between", () => {
    expect(describeMainCheckoutEntries({ entries: [] }).at(-1)).toBe(
      "  state what that command produces inline in the doc, or find a route that works from the worktree.",
    );
  });
});
