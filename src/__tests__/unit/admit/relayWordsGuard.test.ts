/**
 * The relay-words guard's pure half. Three properties are proved rather than described: a write to anything but a board
 * row is decided with no filesystem question; every reword of the four places the incident hit — and of the offer — is
 * refused, while a status edit and an exact restore pass; and a summary is judged against the digest the SHIPPED relay
 * code stored (`../../relayWordsFixture.ts`), never a restatement of it.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { summaryRebuilds, workspaceCandidates } from "../../../admit/relayWordsDigest.js";
import {
  planRelayWordsCheck,
  type RelayWordsPlan,
  relayWordsDefects,
  relayWordsRefusal,
  relayWordsSources,
} from "../../../admit/relayWordsJudge.js";
import { relayRowProjection, rowAfterWrite } from "../../../admit/relayWordsProjection.js";
import { relayWordsTarget } from "../../../admit/relayWordsTarget.js";
import { type HisWordsRecord } from "../../../handover/hisWords.js";
import { recordOfRead } from "../../../handover/hisWordsRecord.js";
import { resolveHisWords } from "../../../handover/hisWordsResolve.js";
import type { TurnRecord } from "../../../talk/relayStore.js";
import { FIXTURE_OFFER, FIXTURE_WORKSPACE, type RelayFixture, relayFixture } from "../../relayWordsFixture.js";

const BOARD = "/home/someone/.slopweaver/handovers";
const CLASS = "[class: a private reply steer]";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh relay in a throwaway home, removed after the test. */
function fixture({ offered = undefined }: { offered?: typeof FIXTURE_OFFER | undefined } = {}): RelayFixture {
  const made = relayFixture({ offered });
  homes.push(made.home);
  return made;
}

/** The record the fixture's anchor resolves to now, as `handover quote` would store it. */
function recordOf({ made }: { made: RelayFixture }): HisWordsRecord {
  const read = resolveHisWords({ anchor: made.anchor, home: made.home, projectsDir: join(made.home, "projects") });
  return recordOfRead({ anchor: made.anchor, read });
}

/** Plan a write and expect it to need judging. */
function judged({
  made,
  postText,
  priorText = made.text,
}: {
  made: RelayFixture;
  postText: string;
  priorText?: string;
}): Extract<RelayWordsPlan, { kind: "judge" }> {
  const plan = planRelayWordsCheck({ path: made.path, postText, priorText });
  expect(plan.kind).toBe("judge");
  return plan as Extract<RelayWordsPlan, { kind: "judge" }>;
}

/**
 * Every defect one write earns, judged against the fixture's real record and turn — or with the turn unreadable, which
 * a flag says rather than an `undefined` a default parameter would swallow.
 */
function defectsOf({
  made,
  postText,
  priorText = made.text,
  turnUnreadable = false,
}: {
  made: RelayFixture;
  postText: string;
  priorText?: string;
  turnUnreadable?: boolean;
}): readonly string[] {
  let turn: TurnRecord | undefined = made.turn;
  if (turnUnreadable) {
    turn = undefined;
  }
  return relayWordsDefects({ plan: judged({ made, postText, priorText }), record: recordOf({ made }), turn });
}

/** The fixture's text with every place its ask appears replaced by a class string, as the incident's Write did. */
function reworded({ made }: { made: RelayFixture }): string {
  return made.text
    .split(JSON.stringify(made.ask))
    .join(JSON.stringify(CLASS))
    .split(made.ask)
    .join(CLASS)
    .replace(/^ownerWords: .*$/mu, `ownerWords: ${JSON.stringify(CLASS)}`);
}

describe("relayWordsTarget", () => {
  /** A `realDir` that records every directory it is asked about, and resolves one symlinked board. */
  function realDirProbe(): { realDir: (args: { dir: string }) => string | undefined; asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      realDir: ({ dir }) => {
        asked.push(dir);
        return dir === "/link/handovers" ? BOARD : dir;
      },
    };
  }

  it("decides an ordinary source write with no filesystem question", () => {
    const probe = realDirProbe();
    const target = relayWordsTarget({
      cwd: undefined,
      filePath: "/repo/src/a.md",
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Write",
    });
    expect(target).toBe(undefined);
    expect(probe.asked).toEqual([]);
  });

  it("takes a Markdown file directly on the board or in its archive", () => {
    const probe = realDirProbe();
    const live = relayWordsTarget({
      cwd: undefined,
      filePath: `${BOARD}/talk-a.md`,
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Edit",
    });
    const archived = relayWordsTarget({
      cwd: undefined,
      filePath: `${BOARD}/archive/talk-a.md`,
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Write",
    });
    expect([live, archived]).toEqual([`${BOARD}/talk-a.md`, `${BOARD}/archive/talk-a.md`]);
    expect(probe.asked).toEqual([]);
  });

  it("refuses to judge another tool, another extension, or a deeper directory", () => {
    const probe = realDirProbe();
    const read = relayWordsTarget({
      cwd: undefined,
      filePath: `${BOARD}/talk-a.md`,
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Read",
    });
    const jsonl = relayWordsTarget({
      cwd: undefined,
      filePath: `${BOARD}/talk-a.jsonl`,
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Write",
    });
    const deeper = relayWordsTarget({
      cwd: undefined,
      filePath: `${BOARD}/drafts/talk-a.md`,
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Write",
    });
    expect([read, jsonl, deeper]).toEqual([undefined, undefined, undefined]);
  });

  it("resolves a relative path and a `..` spelling lexically", () => {
    const probe = realDirProbe();
    const relative = relayWordsTarget({
      cwd: BOARD,
      filePath: "talk-a.md",
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Write",
    });
    const climbing = relayWordsTarget({
      cwd: undefined,
      filePath: `${BOARD}/../handovers/talk-a.md`,
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Write",
    });
    const homeless = relayWordsTarget({
      cwd: undefined,
      filePath: "talk-a.md",
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Write",
    });
    expect([relative, climbing, homeless]).toEqual([`${BOARD}/talk-a.md`, `${BOARD}/talk-a.md`, undefined]);
  });

  it("follows a symlinked spelling of the board, and only asks for a path named like one", () => {
    const probe = realDirProbe();
    const linked = relayWordsTarget({
      cwd: undefined,
      filePath: "/link/handovers/talk-a.md",
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Write",
    });
    const elsewhere = relayWordsTarget({
      cwd: undefined,
      filePath: "/other/handovers/talk-a.md",
      handoversDir: BOARD,
      realDir: probe.realDir,
      toolName: "Write",
    });
    expect([linked, elsewhere]).toEqual(["/link/handovers/talk-a.md", undefined]);
    expect(probe.asked).toContain("/link/handovers");
  });
});

describe("rowAfterWrite", () => {
  const prior = "alpha beta alpha";

  it("is a Write's content whole", () => {
    expect(
      rowAfterWrite({ priorText: prior, replaceAll: false, replacedText: null, text: "new", toolName: "Write" }),
    ).toBe("new");
  });

  it("replaces a unique Edit match literally, so `$&` stays text", () => {
    expect(
      rowAfterWrite({ priorText: prior, replaceAll: false, replacedText: "beta", text: "$&-x", toolName: "Edit" }),
    ).toBe("alpha $&-x alpha");
  });

  it("judges nothing the Edit tool would refuse: absent, empty, or duplicated without replace_all", () => {
    const absent = rowAfterWrite({
      priorText: prior,
      replaceAll: false,
      replacedText: "gamma",
      text: "x",
      toolName: "Edit",
    });
    const empty = rowAfterWrite({ priorText: prior, replaceAll: true, replacedText: "", text: "x", toolName: "Edit" });
    const duplicated = rowAfterWrite({
      priorText: prior,
      replaceAll: false,
      replacedText: "alpha",
      text: "x",
      toolName: "Edit",
    });
    expect([absent, empty, duplicated]).toEqual([undefined, undefined, undefined]);
  });

  it("replaces every occurrence under replace_all", () => {
    expect(
      rowAfterWrite({ priorText: prior, replaceAll: true, replacedText: "alpha", text: "x", toolName: "Edit" }),
    ).toBe("x beta x");
  });
});

describe("summaryRebuilds", () => {
  it("rebuilds the summary the shipped relay registered, under the workspace the row states", () => {
    const made = fixture();
    const workspaces = workspaceCandidates({ stated: [FIXTURE_WORKSPACE] });
    expect(summaryRebuilds({ summary: made.ask, turn: made.turn, workspaces })).toBe(true);
  });

  it("does not rebuild a reworded summary", () => {
    const made = fixture();
    const workspaces = workspaceCandidates({ stated: [FIXTURE_WORKSPACE] });
    expect(summaryRebuilds({ summary: CLASS, turn: made.turn, workspaces })).toBe(false);
  });

  it("binds the workspace: without the row's stated one, the real summary does not rebuild", () => {
    const made = fixture();
    expect(summaryRebuilds({ summary: made.ask, turn: made.turn, workspaces: [undefined] })).toBe(false);
  });

  it("tries each workspace binding once, none first", () => {
    const again = { ...FIXTURE_WORKSPACE };
    expect(workspaceCandidates({ stated: [FIXTURE_WORKSPACE, again, undefined] })).toEqual([
      undefined,
      FIXTURE_WORKSPACE,
    ]);
  });
});

describe("relayRowProjection", () => {
  it("reads the four places the owner's words sit, and the offer", () => {
    const made = fixture({ offered: FIXTURE_OFFER });
    const projection = relayRowProjection({ path: made.path, text: made.text });
    expect([projection.anchor, projection.summary, projection.heading, projection.askParagraph]).toEqual([
      made.anchor,
      made.ask,
      made.ask,
      made.ask,
    ]);
    expect(projection.group.kind).toBe("held");
    expect(projection.offerBlock).toContain("<!-- relay-offer:end talk:3d462095-0000-442a-8c38-80591f698fed -->");
    expect(projection.workspace).toEqual(FIXTURE_WORKSPACE);
  });
});

describe("planRelayWordsCheck", () => {
  it("allows a status edit having read nothing but the row", () => {
    const made = fixture();
    const plan = planRelayWordsCheck({
      path: made.path,
      postText: made.text.replace("status: ready", "status: done"),
      priorText: made.text,
    });
    expect(plan.kind).toBe("allow");
  });

  it("allows any write to a row that is not a talk relay row", () => {
    const made = fixture();
    const other = made.text.replace(`anchor: ${made.anchor}`, "anchor: pr:acme/widgets#12");
    const plan = planRelayWordsCheck({ path: made.path, postText: reworded({ made }), priorText: other });
    expect(plan.kind).toBe("allow");
  });

  it("reads the record only for a changed quote, and the turn only for a changed summary or offer", () => {
    const made = fixture();
    const headingOnly = made.text.replace(`# ${made.ask}`, `# ${CLASS}`);
    expect(relayWordsSources({ plan: judged({ made, postText: headingOnly }) })).toEqual({
      record: false,
      turn: false,
    });
    expect(relayWordsSources({ plan: judged({ made, postText: reworded({ made }) }) })).toEqual({
      record: true,
      turn: true,
    });
  });
});

describe("relayWordsDefects", () => {
  it("refuses the incident's own Write: summary, quote, heading and paragraph all reworded", () => {
    const made = fixture();
    expect(defectsOf({ made, postText: reworded({ made }) })).toEqual([
      "the ownerWords quote no longer equals what the relay turn holds — `handover quote --apply` writes it",
      "the summary no longer rebuilds to the digest the relay turn stored, so it is not the owner's words as relayed",
    ]);
  });

  it("refuses a reword of the heading alone, and of the paragraph alone", () => {
    const made = fixture();
    const heading = defectsOf({ made, postText: made.text.replace(`# ${made.ask}`, `# ${CLASS}`) });
    const paragraph = defectsOf({
      made,
      postText: made.text.replace(`\n\n${made.ask}\n\nRegistered`, `\n\n${CLASS}\n\nRegistered`),
    });
    expect(heading).toEqual(["the heading no longer reads exactly the summary"]);
    expect(paragraph).toEqual(["the paragraph under the first section heading no longer reads exactly the summary"]);
  });

  it("refuses a line appended directly under the ask, which joins its paragraph", () => {
    const made = fixture();
    const appended = defectsOf({
      made,
      postText: made.text.replace(`\n\n${made.ask}\n\nRegistered`, `\n\n${made.ask}\n${CLASS}\n\nRegistered`),
    });
    expect(appended).toEqual(["the paragraph under the first section heading no longer reads exactly the summary"]);
  });

  it("refuses an appended `#word` line, which CommonMark reads as paragraph text, not a heading", () => {
    const made = fixture();
    const appended = defectsOf({
      made,
      postText: made.text.replace(`\n\n${made.ask}\n\nRegistered`, `\n\n${made.ask}\n#appended\n\nRegistered`),
    });
    expect(appended).toEqual(["the paragraph under the first section heading no longer reads exactly the summary"]);
  });

  it("refuses removing the quote group", () => {
    const made = fixture();
    expect(defectsOf({ made, postText: made.text.replace(/^ownerWords: .*\n/mu, "") })).toEqual([
      "the ownerWords quote no longer equals what the relay turn holds — `handover quote --apply` writes it",
    ]);
  });

  it("passes an exact restore of a reworded row", () => {
    const made = fixture();
    expect(defectsOf({ made, postText: made.text, priorText: reworded({ made }) })).toEqual([]);
  });

  it("refuses moving the anchor, and a changed summary whose turn cannot be read", () => {
    const made = fixture();
    const moved = made.text.replace(`anchor: ${made.anchor}`, "anchor: talk:0f6b7a52-0000-4d55-9b8e-5f0c2a1d9e33");
    const blind = defectsOf({
      made,
      postText: made.text.replace(JSON.stringify(made.ask), JSON.stringify(CLASS)),
      turnUnreadable: true,
    });
    expect(defectsOf({ made, postText: moved })).toEqual([
      `the anchor moved off ${made.anchor}, which changes whose words the row names`,
    ]);
    expect(blind).toEqual(["the summary changed and the relay turn that would prove it unchanged cannot be read"]);
  });

  it("refuses rewording or dropping the offer section, and passes it restored", () => {
    const made = fixture({ offered: FIXTURE_OFFER });
    const offerDefect =
      "the running-list offer section no longer reads the voice's offer exactly as the relay turn holds it";
    const rewordedOffer = made.text.replace(FIXTURE_OFFER.text, "A different draft.");
    const dropped = made.text.replace(/<!-- relay-offer:start [\s\S]*<!-- relay-offer:end [^\n]*\n/u, "");
    expect(defectsOf({ made, postText: rewordedOffer })).toEqual([offerDefect]);
    expect(defectsOf({ made, postText: dropped })).toEqual([offerDefect]);
    expect(defectsOf({ made, postText: made.text, priorText: dropped })).toEqual([]);
  });

  it("refuses a hand edit of a further steer's quote", () => {
    const made = fixture();
    const steered = made.text.replace(
      "priority: p1",
      'ownerWordsSteer1Anchor: "talk:0f6b7a52-0000-4d55-9b8e-5f0c2a1d9e33"\npriority: p1',
    );
    expect(defectsOf({ made, postText: steered })).toEqual([
      "a further steer's quote changed — `handover quote --add-steer` writes those",
    ]);
  });
});

describe("relayWordsRefusal", () => {
  it("names the row, every defect and the hatch, and allows when there is none", () => {
    const refusal = relayWordsRefusal({
      defects: ["the heading no longer reads exactly the summary"],
      path: `${BOARD}/talk-a.md`,
    });
    expect(refusal).toContain(`${BOARD}/talk-a.md — the heading no longer reads exactly the summary`);
    expect(refusal).toContain("SLOPWEAVER_ALLOW_RELAY_WORDS=1");
    expect(relayWordsRefusal({ defects: [], path: `${BOARD}/talk-a.md` })).toBe(undefined);
  });
});
