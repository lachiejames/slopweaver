/**
 * `askFreshCheck`: `handover ask`'s check at the append re-reads the owner's rulings and the `talk-*` rows, so a ruling
 * journalled, or a row of the owner's words registered, after the verb's own check at its top — while a sign-in was
 * awaited — still refuses.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { askFreshCheck } from "../../../../../cli/commands/handover/askFreshCheck.js";
import type { HandoverDoc } from "../../../../../handover/doc.js";
import { hisWordsFields } from "../../../../../handover/hisWords.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import { RULED_REASK_HATCH } from "../../../../../handover/ruledReaskGate.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { scanBoard } from "../../../../../handover/store.js";
import { unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const SLUG = "reasked";
const QUESTION = "Ship it?";
const minted: string[] = [];

/** The row's `anchor:` and the owner's-words group stored beside it, recorded at `atIso`, as the real writer spells them. */
const ownerWordsLines = ({ atIso, words }: { atIso: string; words: string }): string => {
  const anchor = "talk:00000000-0000-0000-0000-000000000001";
  const fields = hisWordsFields({
    record: { hisWords: { anchor, atIso, cut: "none", where: "console-voice", words }, kind: "held" },
  });
  return [`anchor: ${anchor}`, ...fields.map(({ key, value }) => `${key}: ${value}`)].join("\n");
};

/** A home holding one row and a run that asked {@link QUESTION}, with no ruling yet. */
const askedHome = ({ frontMatter = "" }: { frontMatter?: string } = {}): {
  doc: HandoverDoc;
  handoverDir: string;
  runsDir: string;
} => {
  const home = mkdtempSync(join(tmpdir(), "ask-fresh-"));
  minted.push(home);
  const handoverDir = join(home, "handovers");
  mkdirSync(handoverDir);
  const runsDir = stateHomePaths({ home }).runs;
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(handoverDir, `${SLUG}.md`), `---\nslug: ${SLUG}\nstatus: ready\n${frontMatter}---\n`);
  for (const event of [
    { atIso: "2026-10-02T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
    { atIso: "2026-10-02T11:00:00.000Z", kind: "question", question: QUESTION },
  ] satisfies RunEvent[]) {
    unwrap(appendRunEvent({ event, runsDir, slug: SLUG }));
  }
  return { doc: unwrap(scanBoard({ handoverDir })).docs[0]!, handoverDir, runsDir };
};

/** The owner's ruling, journalled after the check was built — the gap a sign-in await leaves. */
const ruleLate = ({ runsDir }: { runsDir: string }): void => {
  const ruling: RunEvent = {
    anchor: "talk:late",
    atIso: "2026-10-03T09:00:00.000Z",
    kind: "ruling",
    ruling: "Ship it.",
  };
  unwrap(appendRunEvent({ event: ruling, runsDir, slug: SLUG }));
};

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("askFreshCheck", () => {
  it("refuses the same words off a ruling journalled after the check was built", () => {
    const { doc, handoverDir, runsDir } = askedHome();
    const check = askFreshCheck({ env: {}, handoverDir, question: QUESTION, readOwnerWords: [], runsDir, slug: SLUG });
    ruleLate({ runsDir });

    expect(check.refusal({ doc })!.slice(1)).toEqual([
      '  - the owner ruled on this question in these words at 2026-10-03T09:00:00.000Z (talk:late): "Ship it."',
      "  - say what changed since their ruling, in the question itself — a re-ask in the same words is drawn as a " +
        "check-in carrying their ruling, never a fresh question",
      "NOTHING was recorded and the run is not paused, so reword the question with what changed and ask again.",
    ]);
  });

  it("admits a reworded question, the same words with no ruling yet, and the same words its hatch opens", () => {
    const { doc, handoverDir, runsDir } = askedHome();
    const base = { handoverDir, readOwnerWords: [], runsDir, slug: SLUG };
    const unruled = askFreshCheck({ ...base, env: {}, question: QUESTION }).refusal({ doc });
    ruleLate({ runsDir });

    expect([
      unruled,
      askFreshCheck({ ...base, env: {}, question: "Ship it, now the revert landed?" }).refusal({ doc }),
      askFreshCheck({ ...base, env: { [RULED_REASK_HATCH]: "1" }, question: QUESTION }).refusal({ doc }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("refuses off a row of the owner's words registered after the check was built, until it is named as read", () => {
    const { doc, handoverDir, runsDir } = askedHome({
      frontMatter: `kind: ask\n${ownerWordsLines({ atIso: "2026-10-01T00:00:00.000Z", words: "ship it when green" })}\n`,
    });
    const base = { env: {}, handoverDir, question: "Ship it, now CI is green?", runsDir, slug: SLUG };
    const unnamed = askFreshCheck({ ...base, readOwnerWords: [] });
    const named = askFreshCheck({ ...base, readOwnerWords: ["talk-0000000000aa"] });
    writeFileSync(
      join(handoverDir, "talk-0000000000aa.md"),
      `---\nslug: talk-0000000000aa\nkind: ask\nstatus: ready\naskedIso: 2026-10-02T12:00:00.000Z\n` +
        `${ownerWordsLines({ atIso: "2026-10-02T12:00:00.000Z", words: "hold the ship" })}\n---\n`,
    );

    expect([unnamed.refusal({ doc })!.slice(-2), named.refusal({ doc })]).toEqual([
      [
        '  - talk-0000000000aa (registered 2026-10-02T12:00:00.000Z): "hold the ship"',
        "NOTHING was recorded and the run is not paused. Read each row in full (`slopweaver handover row --slug " +
          "<slug> --json`); if one answers the question, act on it instead of asking. Otherwise ask again with " +
          "--read-owner-words talk-0000000000aa",
      ],
      undefined,
    ]);
  });

  it("takes no row lock on a row no settle can land on, as the settled-row check alone does", () => {
    const { doc, handoverDir, runsDir } = askedHome();

    expect(
      askFreshCheck({ env: {}, handoverDir, question: QUESTION, readOwnerWords: [], runsDir, slug: SLUG }).lockWhen({
        doc,
      }),
    ).toBe(false);
  });
});
