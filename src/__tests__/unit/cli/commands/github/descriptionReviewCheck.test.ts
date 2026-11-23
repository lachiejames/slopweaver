/**
 * The write verbs' description-review seam: a screenshot reaches a description only through an upload receipt, the
 * comments already on an open pull request are read whole or the write is refused, and a refusal prints the one
 * `review-prepare` command over the exact bytes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type DescriptionWrite,
  descriptionImagesOf,
  makeDescriptionReviewCheck,
  reviewPrepareCommand,
} from "../../../../../cli/commands/github/descriptionReviewCheck.js";
import { err } from "../../../../../lib/result.js";
import type { DescriptionReviewCommentsReader } from "../../../../../outbound/github/descriptionReviewComments.js";
import { DescriptionReviewErrors } from "../../../../../outbound/github/descriptionReviewErrors.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import type { PrForm } from "../../../../../outbound/github/types.js";

const homes: string[] = [];

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-review-check-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The example form with both proof slots given as reasons, so the body shows no picture. */
const NO_PICTURES: PrForm = {
  ...EXAMPLE_PR_FORM,
  solutionProof: { kind: "reason", reason: [{ kind: "text", text: "Nothing on screen changes." }] },
};

/** A write over the example form, with any field overridden. */
function write(over: Partial<DescriptionWrite> = {}): DescriptionWrite {
  return {
    body: "body",
    comments: [],
    form: NO_PICTURES,
    headRef: "HEAD",
    home: "/h",
    pullRequest: { kind: "new" },
    repoDir: "/repo",
    ...over,
  };
}

/** A reader that records each pull request it was asked for and answers with one fixed failure. */
function failingReader(): { readonly reader: DescriptionReviewCommentsReader; readonly asked: number[] } {
  const asked: number[] = [];
  const reader: DescriptionReviewCommentsReader = ({ number }) => {
    asked.push(number);
    return Promise.resolve(
      err(DescriptionReviewErrors.commentsReadFailed({ detail: "the conversation comments has more than 100 nodes" })),
    );
  };
  return { asked, reader };
}

describe("descriptionImagesOf", () => {
  it("binds no image when neither slot is a screenshot", () => {
    expect(descriptionImagesOf({ form: NO_PICTURES, home: freshHome() })).toStrictEqual({ images: [], problems: [] });
  });

  it("refuses a screenshot no upload receipt names, naming the slot and the verb that checks pictures", () => {
    const found = descriptionImagesOf({ form: EXAMPLE_PR_FORM, home: freshHome() });
    expect(found.images).toStrictEqual([]);
    expect(found.problems).toStrictEqual([
      "the solution screenshot https://github.com/user-attachments/assets/0b6a1c2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d " +
        "has no upload receipt: a picture reaches a description only through `slopweaver github attach upload`, " +
        "which checks, uploads and reads it back first",
    ]);
  });
});

describe("reviewPrepareCommand", () => {
  it("names the repository, base, head, branch, checkout, title, body and comments files, and a new pull request", () => {
    const command = reviewPrepareCommand({
      bodyFile: "/h/pending/abc.md",
      commentsFile: "/h/pending/abc.comments.json",
      imagesFile: undefined,
      write: write({ form: { ...NO_PICTURES, title: "fix(parser): keep the lapse" } }),
    });
    expect(command).toBe(
      "slopweaver github pr review-prepare --repo acme/widgets --base main --head HEAD --branch a-branch --cwd /repo " +
        "--title 'fix(parser): keep the lapse' --body-file /h/pending/abc.md " +
        "--comments /h/pending/abc.comments.json --new",
    );
  });

  it("names an open pull request by number, so its existing comments are read into the packet", () => {
    const command = reviewPrepareCommand({
      bodyFile: "/h/b.md",
      commentsFile: "/h/b.comments.json",
      imagesFile: undefined,
      write: write({ pullRequest: { kind: "existing", number: 42 } }),
    });
    expect(command.endsWith("--body-file /h/b.md --comments /h/b.comments.json --number 42")).toBe(true);
  });

  it("adds the images file when the body shows pictures", () => {
    const command = reviewPrepareCommand({
      bodyFile: "/h/b.md",
      commentsFile: "/h/b.comments.json",
      imagesFile: "/h/b.images.json",
      write: write({ headRef: "abc123", repoDir: "/r" }),
    });
    expect(command.endsWith("--comments /h/b.comments.json --new --images /h/b.images.json")).toBe(true);
  });
});

describe("makeDescriptionReviewCheck", () => {
  it("refuses a write to an open pull request whose comments cannot be read whole, naming why", async () => {
    const { asked, reader } = failingReader();
    const check = makeDescriptionReviewCheck({ readComments: reader });
    const verdict = await check(write({ home: freshHome(), pullRequest: { kind: "existing", number: 42 } }));
    expect(asked).toStrictEqual([42]);
    expect(verdict).toStrictEqual({
      kind: "refused",
      lines: [
        "the pull request's existing comments could not be read whole, so no review can say the description " +
          "answers to them: the conversation comments has more than 100 nodes",
      ],
    });
  });

  it("refuses an unmatched screenshot before reading any comment", async () => {
    const { asked, reader } = failingReader();
    const check = makeDescriptionReviewCheck({ readComments: reader });
    const verdict = await check(
      write({ form: EXAMPLE_PR_FORM, home: freshHome(), pullRequest: { kind: "existing", number: 42 } }),
    );
    expect(asked).toStrictEqual([]);
    expect(verdict.kind).toBe("refused");
  });
});
