import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runHandoverOffer } from "../../../cli/commands/handover/offerRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import type { AskAction } from "../../../handover/askAction.js";
import { appendRunEvent, readRunJournal } from "../../../handover/runStore.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../supervisor/session.js";

/** The slug every case runs against. */
const SLUG = "offer-me";

/** The whole action a well-formed offer carries. */
const ACTION: AskAction = {
  actor: "me",
  body: "<@U01ARI> the E2E switch-over is green again and still needs one approval.",
  destinations: [
    {
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees we are still blocked",
    },
    {
      conversation: "D01GROUP",
      kind: "dm",
      label: "DM the two reviewers",
      recipients: [{ label: "Ari", userId: "U01ARI" }],
      tradeoff: "quieter, and nobody else learns it has been dragging",
    },
  ],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

const homes: string[] = [];
const savedSession = process.env[CLAUDE_CODE_SESSION_ID_ENV];

afterEach(() => {
  if (savedSession === undefined) {
    delete process.env[CLAUDE_CODE_SESSION_ID_ENV];
  } else {
    process.env[CLAUDE_CODE_SESSION_ID_ENV] = savedSession;
  }
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** A real board and journal, optionally already waiting on a recorded question. */
function run({
  asked,
  question = "post it to #delivery, DM them, or hold?",
  slug = SLUG,
  summary = "offer an action",
}: {
  asked: boolean;
  question?: string;
  slug?: string;
  summary?: string;
}): {
  home: string;
  runsDir: string;
} {
  process.env[CLAUDE_CODE_SESSION_ID_ENV] = "the-one-session";
  const home = mkdtempSync(join(tmpdir(), "slopweaver-offer-"));
  homes.push(home);
  const handovers = join(home, "handovers");
  const runsDir = join(home, "runs");
  mkdirSync(handovers, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    join(handovers, `${slug}.md`),
    ["---", `slug: ${slug}`, `summary: ${summary}`, "status: in-progress", "---", "", "# Offer me", ""].join("\n"),
  );
  appendRunEvent({
    event: { atIso: "2026-09-22T10:00:00.000Z", branch: "feat/offer", docHash: "hash", kind: "started" },
    runsDir,
    slug,
  });
  appendRunEvent({
    event: {
      atIso: "2026-09-22T10:00:01.000Z",
      host: "claude-code",
      kind: "claimed",
      pid: process.pid,
      sessionId: "the-one-session",
      why: "the test owns it",
      worktree: process.cwd(),
    },
    runsDir,
    slug,
  });
  if (asked) {
    appendRunEvent({
      event: {
        atIso: "2026-09-22T10:00:02.000Z",
        kind: "question",
        question,
      },
      runsDir,
      slug,
    });
  }
  return { home, runsDir };
}

/** Real argv for `handover offer`. */
function argv({
  home,
  action = JSON.stringify(ACTION),
  extra = [],
  slug = SLUG,
}: {
  home: string;
  action?: string;
  extra?: readonly string[];
  slug?: string;
}): string[] {
  return [
    "node",
    "cli",
    "handover",
    "offer",
    slug,
    "--home",
    home,
    "--action",
    action,
    "--problem",
    "nine days of no review, and the conflicts are back",
    "--lean",
    "A: the channel, because visibility is the whole point",
    "--risk",
    "the review lapses again and the conflicts compound",
    "--blast-radius",
    "one PR and whoever reviews it",
    "--still-real",
    "the PR is still open with no review on it",
    ...extra,
  ];
}

describe("handover offer", () => {
  it("appends one question-offered event carrying the action, and leaves the question's own text and clock alone", () => {
    const { home, runsDir } = run({ asked: true });

    expect(runHandoverOffer(argv({ home }))).toBe(EXIT_OK);

    const events = readRunJournal({ runsDir, slug: SLUG })._unsafeUnwrap().events;
    expect(events.map((event) => event.kind)).toEqual(["started", "claimed", "question", "question-offered"]);
    const offered = events[3]!;
    expect(offered.kind).toBe("question-offered");
    expect(offered).toMatchObject({
      action: ACTION,
      problem: "nine days of no review, and the conflicts are back",
      question: "post it to #delivery, DM them, or hold?",
    });
  });

  it("derives one option per destination rather than letting a caller author them", () => {
    const { home, runsDir } = run({ asked: true });

    expect(runHandoverOffer(argv({ home }))).toBe(EXIT_OK);

    const offered = readRunJournal({ runsDir, slug: SLUG })._unsafeUnwrap().events[3]!;
    expect(offered).toMatchObject({
      options: [
        { letter: "A", option: "Post it to #delivery", tradeoff: "the whole channel sees we are still blocked" },
        {
          letter: "B",
          option: "DM the two reviewers",
          tradeoff: "quieter, and nobody else learns it has been dragging",
        },
        {
          letter: "C",
          option: "Hold it — send nothing for now",
          tradeoff: "the thread moves on without our answer, and the draft goes stale",
        },
      ],
    });
  });

  it("refuses an offer whose re-recorded question names a draft the register does not hold, and writes nothing", () => {
    const { home, runsDir } = run({ asked: true, question: "OK to send draft sd-12345678 to #delivery?" });

    expect(runHandoverOffer(argv({ home }))).toBe(EXIT_USAGE);

    expect(
      readRunJournal({ runsDir, slug: SLUG })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "question"]);
  });

  it("refuses an offer on a run whose slug is a draft id the register does not hold, since the card draws it", () => {
    const { home, runsDir } = run({ asked: true, slug: "sd-deadbeef" });

    expect(runHandoverOffer(argv({ home, slug: "sd-deadbeef" }))).toBe(EXIT_USAGE);

    expect(
      readRunJournal({ runsDir, slug: "sd-deadbeef" })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "question"]);
  });

  it("refuses an offer whose action body quotes a draft the register does not hold, and writes nothing", () => {
    const { home, runsDir } = run({ asked: true });

    expect(runHandoverOffer(argv({ action: JSON.stringify({ ...ACTION, body: "as in sd-12345678" }), home }))).toBe(
      EXIT_USAGE,
    );

    expect(
      readRunJournal({ runsDir, slug: SLUG })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "question"]);
  });

  it("refuses an offer on a run whose summary names a draft the register does not hold, and writes nothing", () => {
    const { home, runsDir } = run({ asked: true, summary: "Review sd-deadbeef" });

    expect(runHandoverOffer(argv({ home }))).toBe(EXIT_USAGE);

    expect(
      readRunJournal({ runsDir, slug: SLUG })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "question"]);
  });

  it("refuses an offer whose stakes name a draft the register does not hold, and writes nothing", () => {
    const { home, runsDir } = run({ asked: true });
    const args = argv({ home });
    args[args.indexOf("--risk") + 1] = "sd-12345678 goes out stale";

    expect(runHandoverOffer(args)).toBe(EXIT_USAGE);

    expect(
      readRunJournal({ runsDir, slug: SLUG })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "question"]);
  });

  it("refuses a run with no open question, and writes nothing", () => {
    const { home, runsDir } = run({ asked: false });

    expect(runHandoverOffer(argv({ home }))).not.toBe(EXIT_OK);

    expect(
      readRunJournal({ runsDir, slug: SLUG })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed"]);
  });

  it("refuses --options beside --action, since the options ARE the destinations", () => {
    const { home, runsDir } = run({ asked: true });

    expect(runHandoverOffer(argv({ extra: ["--options", "A|post it"], home }))).not.toBe(EXIT_OK);

    expect(
      readRunJournal({ runsDir, slug: SLUG })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "question"]);
  });

  it("refuses an action document that is not JSON, and writes nothing", () => {
    const { home, runsDir } = run({ asked: true });

    expect(runHandoverOffer(argv({ action: "{not json", home }))).not.toBe(EXIT_OK);

    expect(
      readRunJournal({ runsDir, slug: SLUG })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "question"]);
  });
});
