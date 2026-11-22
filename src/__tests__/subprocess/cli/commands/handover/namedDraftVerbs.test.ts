/**
 * `handover ask` and `handover reconfirm` refuse card text naming a draft the register does not hold. `ask` checks
 * the run's own slug and summary too, because the console draws the slug as the card's subject and the summary as
 * a linked hand card's what, and resolves every id either names; `reconfirm` checks the still-real line it replaces.
 *
 * A review found each: a run whose slug or summary named `sd-deadbeef`, or a reconfirmed
 * still-real line naming it, was journalled while the console drew a draft it could not show. This runs the SHIPPED
 * verbs over a throwaway home, because the row has to be written as a doc (a decision `register` refuses that slug).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";
import { ASK_SHAPE } from "./askShapeArgs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home carrying one handover doc under the given slug. */
function homeWithDoc({ slug, summary }: { slug: string; summary: string }): string {
  const home = mkdtempSync(join(tmpdir(), "ask-slug-draft-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"));
  mkdirSync(join(home, "runs"));
  writeFileSync(
    join(home, "handovers", `${slug}.md`),
    ["---", `slug: ${slug}`, `summary: ${summary}`, "status: ready", "---", "", "# A row", ""].join("\n"),
  );
  return home;
}

function run({ args, env = {} }: { args: readonly string[]; env?: Record<string, string> }): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      TMPDIR: process.env["TMPDIR"]!,
      ...env,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === null) {
    throw new Error(`slopweaver ${args.join(" ")} ended on a signal (${String(result.signal)}), with no exit status`);
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** Open a run on the doc, then ask a question — by default one naming no draft at all. */
function ask({
  slug,
  summary = "a row",
  question = "OK to ship?",
  shape = ASK_SHAPE,
  env = {},
}: {
  slug: string;
  summary?: string;
  question?: string;
  shape?: readonly string[];
  env?: Record<string, string>;
}): {
  home: string;
  status: number;
  stderr: string;
} {
  const home = homeWithDoc({ slug, summary });
  expect(run({ args: ["handover", "start", slug, "--home", home] }).status).toBe(0);
  const result = run({ args: ["handover", "ask", slug, "--home", home, "--question", question, ...shape], env });
  return { home, status: result.status, stderr: result.stderr };
}

/** The question one recorded ask carried with its draft on a page, as measured — its card drew nothing. */
const UNDRAWN = "The payments-channel post is drafted as you and UNSENT on the page — post it?";

describe("handover ask on a run whose slug is a draft id", () => {
  it("refuses, names the id, and journals no question", () => {
    const { home, status, stderr } = ask({ slug: "sd-deadbeef" });

    expect(status).toBe(2);
    expect(stderr).toContain("sd-deadbeef is not in the drafts register");
    expect(readFileSync(join(home, "runs", "sd-deadbeef.jsonl"), "utf8")).not.toContain('"kind":"question"');
  });

  it("refuses when the doc's summary names the draft, since a linked hand card draws the summary", () => {
    const { home, status, stderr } = ask({ slug: "a-summary-row", summary: "Review sd-deadbeef" });

    expect(status).toBe(2);
    expect(stderr).toContain("sd-deadbeef is not in the drafts register");
    expect(readFileSync(join(home, "runs", "a-summary-row.jsonl"), "utf8")).not.toContain('"kind":"question"');
  });

  it("records the same ask on a slug naming no draft", () => {
    const { home, status } = ask({ slug: "a-plain-row" });

    expect(status).toBe(0);
    expect(readFileSync(join(home, "runs", "a-plain-row.jsonl"), "utf8")).toContain('"kind":"question"');
  });
});

describe("a card saying a message was drafted as the owner, carrying no draft", () => {
  it("is refused by ask, which journals no question", () => {
    const { home, status, stderr } = ask({ question: UNDRAWN, slug: "an-undrawn-ask" });

    expect(status).toBe(2);
    expect(stderr).toContain('it says "drafted as you", names no parked draft and offers no message');
    expect(readFileSync(join(home, "runs", "an-undrawn-ask.jsonl"), "utf8")).not.toContain('"kind":"question"');
  });

  it("is refused by correct and reconfirm, which journal nothing", () => {
    const { home } = ask({ slug: "an-undrawn-rewrite" });
    const correct = run({
      args: [
        "handover",
        "correct",
        "an-undrawn-rewrite",
        "--home",
        home,
        "--question",
        UNDRAWN,
        "--why",
        "it was vague",
        "--still-real",
        "the post is unsent",
      ],
    });
    const reconfirm = run({
      args: ["handover", "reconfirm", "an-undrawn-rewrite", "--home", home, "--still-real", "drafted as you, unsent"],
    });

    expect([correct.status, reconfirm.status]).toEqual([2, 2]);
    expect([correct.stderr, reconfirm.stderr].map((text) => text.includes("names no parked draft"))).toEqual([
      true,
      true,
    ]);
    expect(readFileSync(join(home, "runs", "an-undrawn-rewrite.jsonl"), "utf8")).not.toMatch(
      /"kind":"question-(corrected|reconfirmed)"/u,
    );
  });

  // The shape a correction keeps is still drawn, so plain new text does not clear it.
  it("is refused by correct and reconfirm when the shape the card keeps says it", () => {
    const shape = ASK_SHAPE.map((arg, index) => (ASK_SHAPE[index - 1] === "--problem" ? UNDRAWN : arg));
    const recorded = ask({ env: { SLOPWEAVER_ALLOW_UNDRAWN_ASK_DRAFT: "1" }, shape, slug: "an-undrawn-shape" });
    const corrected = run({
      args: ["handover", "correct", "an-undrawn-shape", "--home", recorded.home, "--question", "Post it now?"].concat([
        "--why",
        "the old question was vague",
        "--still-real",
        "the post is unsent",
      ]),
    });
    const reconfirm = run({
      args: ["handover", "reconfirm", "an-undrawn-shape", "--home", recorded.home, "--still-real", "it is on the page"],
    });

    expect([recorded.status, corrected.status, reconfirm.status]).toEqual([0, 2, 2]);
    expect([corrected.stderr, reconfirm.stderr].map((text) => text.includes("names no parked draft"))).toEqual([
      true,
      true,
    ]);
    expect(readFileSync(join(recorded.home, "runs", "an-undrawn-shape.jsonl"), "utf8")).not.toMatch(
      /"kind":"question-(corrected|reconfirmed)"/u,
    );
  });
});

describe("a correction over a reconfirmed line saying a message was drafted as the owner", () => {
  // The card draws the reconfirmed line under the question. A correction may not keep it bare —
  // the line must be restated — and a restatement saying the same is held to the same gate.
  it("is refused bare and restated alike, and journals no correction", () => {
    const { home } = ask({ slug: "an-undrawn-reconfirm" });
    const reconfirmed = run({
      args: ["handover", "reconfirm", "an-undrawn-reconfirm", "--home", home, "--still-real", UNDRAWN],
      env: { SLOPWEAVER_ALLOW_UNDRAWN_ASK_DRAFT: "1" },
    });
    const correct = ["handover", "correct", "an-undrawn-reconfirm", "--home", home, "--question", "Post it now?"];
    const bare = run({ args: correct.concat(["--why", "the old question was vague"]) });
    const restated = run({
      args: correct.concat(["--why", "the old question was vague", "--still-real", UNDRAWN]),
    });

    expect([reconfirmed.status, bare.status, restated.status]).toEqual([0, 2, 2]);
    expect(bare.stderr).toContain(`--still-real is required — the card prints "${UNDRAWN}"`);
    expect(restated.stderr).toContain("names no parked draft");
    expect(readFileSync(join(home, "runs", "an-undrawn-reconfirm.jsonl"), "utf8")).not.toContain(
      '"kind":"question-corrected"',
    );
  });

  // The line a restatement REPLACES is no longer drawn, so replacing it with plain prose is the fix.
  it("records a correction whose restated line replaces it with one naming no draft", () => {
    const { home } = ask({ slug: "an-undrawn-replaced" });
    const reconfirmed = run({
      args: ["handover", "reconfirm", "an-undrawn-replaced", "--home", home, "--still-real", UNDRAWN],
      env: { SLOPWEAVER_ALLOW_UNDRAWN_ASK_DRAFT: "1" },
    });
    const corrected = run({
      args: ["handover", "correct", "an-undrawn-replaced", "--home", home, "--question", "Post it now?"].concat([
        "--why",
        "the old question was vague",
        "--still-real",
        "the post is unsent",
      ]),
    });

    expect([reconfirmed.status, corrected.status]).toEqual([0, 0]);
    expect(corrected.stdout).toContain("still real as of");
    expect(corrected.stdout).toContain(": the post is unsent");
  });

  // The same holds when the replaced line is the asked shape's own stakes line.
  it("records a correction whose restated line replaces the shape's own stakes line", () => {
    const shape = ASK_SHAPE.map((arg, index) => (ASK_SHAPE[index - 1] === "--still-real" ? UNDRAWN : arg));
    const recorded = ask({ env: { SLOPWEAVER_ALLOW_UNDRAWN_ASK_DRAFT: "1" }, shape, slug: "an-undrawn-stake" });
    const corrected = run({
      args: ["handover", "correct", "an-undrawn-stake", "--home", recorded.home, "--question", "Post it now?"].concat([
        "--why",
        "stale wording",
        "--still-real",
        "the post is unsent",
      ]),
    });

    expect([recorded.status, corrected.status]).toEqual([0, 0]);
    expect(corrected.stdout).toContain(": the post is unsent");
  });
});

describe("handover reconfirm", () => {
  it("refuses a still-real line naming a draft the register does not hold, and journals no reconfirmation", () => {
    const { home, status } = ask({ slug: "a-reconfirmed-row" });
    expect(status).toBe(0);

    const result = run({
      args: ["handover", "reconfirm", "a-reconfirmed-row", "--home", home, "--still-real", "checked sd-deadbeef"],
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("sd-deadbeef is not in the drafts register");
    expect(readFileSync(join(home, "runs", "a-reconfirmed-row.jsonl"), "utf8")).not.toContain(
      '"kind":"question-reconfirmed"',
    );
  });

  it("records a still-real line naming no draft", () => {
    const { home } = ask({ slug: "a-plain-reconfirm" });

    const result = run({
      args: ["handover", "reconfirm", "a-plain-reconfirm", "--home", home, "--still-real", "the PR is still open"],
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(home, "runs", "a-plain-reconfirm.jsonl"), "utf8")).toContain(
      '"kind":"question-reconfirmed"',
    );
  });
});
