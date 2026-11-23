import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { MAX_BOOT_BLOCK_LINES, MAX_STATE_DOC_LINES } from "../../../supervisor/stateDoc.js";
import { bootHeadingPrefix } from "../../../supervisor/stateDocBlock.js";
import { amendBootBlock, archiveBootBlock } from "../../../supervisor/stateDocEdit.js";

/** A doc with a one-line preamble and handoff-9008's block at the tail. */
const AMENDABLE = "# State\n\n## handoff-9008 boot — Sep 13\n- 08:00 BOOTED.\n### RULINGS\n";

/** A doc whose preamble carries the note handoff-9008 wrote when it archived handoff-9007, with handoff-9008's block at the tail. */
const ARCHIVABLE =
  "# State\n\nNotes (archived by handoff-9008). Nothing was deleted. RESTORE by handoff-9001: kept.\n\n" +
  "## handoff-9008 boot — Sep 13\n- 08:00 BOOTED.\n### RULINGS\n- none\n\n";

/** The successor block an archive pass installs. */
const SUCCESSOR = "## handoff-9009 boot — Sep 13\n- 09:00 BOOTED.\n### RULINGS\n";

/** The archive inputs every archive test shares, overridable per test. */
const archive = (over: Partial<Parameters<typeof archiveBootBlock>[0]> = {}): ReturnType<typeof archiveBootBlock> =>
  archiveBootBlock({
    archiveDisplayPath: "~/h/archive/x.md",
    description: "the eighth seat",
    docName: "state.md",
    predecessor: "9008",
    successor: "9009",
    successorBlock: SUCCESSOR,
    text: ARCHIVABLE,
    when: "13 Sep 09:0x local",
    ...over,
  });

/** A doc of `filler` preamble lines, a blank, then handoff-9008's block with `bullets` rows above its rulings. */
const sized = ({ filler, bullets }: { filler: number; bullets: number }): string =>
  [
    ...Array.from({ length: filler }, (_unused, index) => `filler ${String(index)}`),
    "",
    "## handoff-9008 boot",
    ...Array.from({ length: bullets }, (_unused, index) => `- row ${String(index)}`),
    "### RULINGS",
    "",
  ].join("\n");

describe("bootHeadingPrefix", () => {
  it("spells the live doc's heading", () => {
    expect(bootHeadingPrefix({ handoff: "9249" })).toBe("## handoff-9249 boot");
  });
});

describe("amendBootBlock", () => {
  it("inserts rows before the rulings, prefixing only the rows that lack a bullet", () => {
    const amended = unwrap(
      amendBootBlock({ afterRulings: false, handoff: "9008", rows: ["08:10 TICK.", "- 08:20 TICK."], text: AMENDABLE }),
    );
    expect(amended.text).toBe(
      "# State\n\n## handoff-9008 boot — Sep 13\n- 08:00 BOOTED.\n- 08:10 TICK.\n- 08:20 TICK.\n### RULINGS\n",
    );
    expect(amended.rows).toBe(2);
    expect(amended.docLines).toBe(7);
    expect(amended.blockLines).toBe(5);
  });

  it("appends under the rulings at the end of the block, dropping trailing blank lines first", () => {
    const text = `${AMENDABLE}- https://x.test/1 — r\n\n`;
    const amended = unwrap(
      amendBootBlock({ afterRulings: true, handoff: "9008", rows: ["https://x.test/2 — s"], text }),
    );
    expect(amended.text).toBe(`${AMENDABLE}- https://x.test/1 — r\n- https://x.test/2 — s\n`);
  });

  it("refuses no rows, an empty row and a row with a line break", () => {
    const refusals = [[], ["- "], ["one\ntwo"]].map((rows) =>
      amendBootBlock({ afterRulings: false, handoff: "9008", rows, text: AMENDABLE })._unsafeUnwrapErr(),
    );
    expect(refusals.map((refusal) => refusal.code)).toEqual(["INPUT_REJECTED", "INPUT_REJECTED", "INPUT_REJECTED"]);
    expect(refusals[1]!.message).toBe("a row is empty");
  });

  it("does not take a longer handoff number or a longer word for the named block", () => {
    const text = "# State\n\n## handoff-90080 boot\n### RULINGS\n## handoff-9008 bootstrap\n";
    const refusal = amendBootBlock({ afterRulings: false, handoff: "9008", rows: ["x"], text })._unsafeUnwrapErr();
    expect(refusal.code).toBe("BLOCK_NOT_FOUND");
    expect(refusal.message).toBe('the doc has 0 line(s) opening "## handoff-9008 boot", not exactly one');
  });

  it("refuses a doc carrying the named block twice", () => {
    const refusal = amendBootBlock({
      afterRulings: false,
      handoff: "9008",
      rows: ["x"],
      text: `${AMENDABLE}${AMENDABLE}`,
    })._unsafeUnwrapErr();
    expect(refusal.code).toBe("BLOCK_NOT_FOUND");
  });

  it("refuses a block that is not the doc's tail", () => {
    const refusal = amendBootBlock({
      afterRulings: false,
      handoff: "9008",
      rows: ["x"],
      text: `${AMENDABLE}## later section\n`,
    })._unsafeUnwrapErr();
    expect(refusal.code).toBe("BLOCK_NOT_TAIL");
  });

  it("refuses a block with no rulings line", () => {
    const refusal = amendBootBlock({
      afterRulings: false,
      handoff: "9008",
      rows: ["x"],
      text: "## handoff-9008 boot\n- a\n",
    })._unsafeUnwrapErr();
    expect(refusal.code).toBe("RULINGS_NOT_FOUND");
  });

  it("refuses to append under the rulings when another subheading follows them", () => {
    const refusal = amendBootBlock({
      afterRulings: true,
      handoff: "9008",
      rows: ["x"],
      text: `${AMENDABLE}### NOTES\n`,
    })._unsafeUnwrapErr();
    expect(refusal.code).toBe("INPUT_REJECTED");
  });

  it("refuses a doc left with two consecutive blank lines", () => {
    const refusal = amendBootBlock({
      afterRulings: false,
      handoff: "9008",
      rows: ["x"],
      text: `# State\n\n\n${AMENDABLE.slice("# State\n\n".length)}`,
    })._unsafeUnwrapErr();
    expect(refusal.message).toBe("the edit would leave two consecutive blank lines");
  });

  it("admits a doc of exactly the cap and refuses one line over it", () => {
    const at = amendBootBlock({
      afterRulings: false,
      handoff: "9008",
      rows: ["x"],
      text: sized({ bullets: 1, filler: 395 }),
    });
    const over = amendBootBlock({
      afterRulings: false,
      handoff: "9008",
      rows: ["x"],
      text: sized({ bullets: 1, filler: 396 }),
    });
    expect(unwrap(at).docLines).toBe(MAX_STATE_DOC_LINES);
    expect(over._unsafeUnwrapErr()).toEqual({
      cap: MAX_STATE_DOC_LINES,
      code: "CAP_EXCEEDED",
      lines: MAX_STATE_DOC_LINES + 1,
      message:
        "the state doc would be 401 lines, over the 400-line cap — nothing was written; fold the live block's older rows out with `slopweaver supervisor state-fold`, or cut a block being installed (skills/supervisor/reference/state-doc.md)",
    });
  });

  it("refuses when a legacy-headed block still in the doc is over the cap, which this module cannot see itself", () => {
    const legacy = ["## SUCCESSOR BOOT BLOCK", ...Array.from({ length: 60 }, () => "old")].join("\n");
    const refusal = amendBootBlock({
      afterRulings: false,
      handoff: "9008",
      rows: ["x"],
      text: `${legacy}\n${AMENDABLE.slice("# State\n\n".length)}`,
    })._unsafeUnwrapErr();
    expect(refusal).toEqual({
      cap: MAX_BOOT_BLOCK_LINES,
      code: "CAP_EXCEEDED",
      lines: 65,
      message:
        'a "## SUCCESSOR BOOT BLOCK" block still in the doc would be 65 lines, over the 60-line cap — nothing was written; fold the live block\'s older rows out with `slopweaver supervisor state-fold`, or cut a block being installed (skills/supervisor/reference/state-doc.md)',
    });
  });

  it("admits a block of exactly the cap and refuses one line over it", () => {
    const at = amendBootBlock({
      afterRulings: false,
      handoff: "9008",
      rows: ["x"],
      text: sized({ bullets: 57, filler: 1 }),
    });
    const over = amendBootBlock({
      afterRulings: false,
      handoff: "9008",
      rows: ["x"],
      text: sized({ bullets: 58, filler: 1 }),
    });
    expect(unwrap(at).blockLines).toBe(MAX_BOOT_BLOCK_LINES);
    expect(over._unsafeUnwrapErr().code).toBe("CAP_EXCEEDED");
  });
});

describe("archiveBootBlock", () => {
  it("moves the predecessor's block out, chains the note after its own, and installs the successor", () => {
    const archived = unwrap(archive());
    expect(archived.docText).toBe(
      "# State\n\nNotes (archived by handoff-9008). Nothing was deleted. The handoff-9008 block (lines 5-8, the eighth seat) " +
        "is in `~/h/archive/x.md` (archived by handoff-9009). Nothing was deleted. RESTORE by handoff-9001: kept.\n\n" +
        SUCCESSOR,
    );
    expect(archived.archiveText).toBe(
      "# Archived from state.md by handoff-9009 at boot (13 Sep 09:0x local): the eighth seat. Nothing was deleted.\n\n" +
        "## handoff-9008 boot — Sep 13\n- 08:00 BOOTED.\n### RULINGS\n- none\n",
    );
    expect(archived.movedFrom).toEqual({ first: 5, last: 8 });
    expect(archived.docLines).toBe(7);
    expect(archived.blockLines).toBe(3);
  });

  it("omits the instant from the archive title when none is given", () => {
    expect(unwrap(archive({ when: undefined })).archiveText.split("\n")[0]).toBe(
      "# Archived from state.md by handoff-9009 at boot: the eighth seat. Nothing was deleted.",
    );
  });

  it("seeds the chain on a doc no seat has archived, as the preamble's last paragraph", () => {
    const archived = unwrap(archive({ text: "# State\n\nA rolling window.\n\n## handoff-9008 boot\n### RULINGS\n" }));
    expect(archived.docText).toBe(
      "# State\n\nA rolling window.\n\nThe handoff-9008 block (lines 5-6, the eighth seat) is in `~/h/archive/x.md` " +
        "(archived by handoff-9009). Nothing was deleted.\n\n" +
        SUCCESSOR,
    );
    expect(archived.movedFrom).toEqual({ first: 5, last: 6 });
    expect([archived.docLines, archived.blockLines]).toEqual([9, 3]);
  });

  it("chains the next archive after the note a seed wrote", () => {
    const seeded = unwrap(archive({ text: "# State\n\n## handoff-9008 boot\n### RULINGS\n" })).docText;
    const next = unwrap(
      archive({
        predecessor: "9009",
        successor: "9010",
        successorBlock: "## handoff-9010 boot\n### RULINGS\n",
        text: seeded,
      }),
    );
    expect(next.docText).toBe(
      "# State\n\nThe handoff-9008 block (lines 3-4, the eighth seat) is in `~/h/archive/x.md` (archived by handoff-9009). " +
        "Nothing was deleted. The handoff-9009 block (lines 5-7, the eighth seat) is in `~/h/archive/x.md` " +
        "(archived by handoff-9010). Nothing was deleted.\n\n## handoff-9010 boot\n### RULINGS\n",
    );
  });

  it("refuses a description that would leave the next archive two anchors, seeded or chained", () => {
    const description = "x (archived by handoff-9009). Nothing was deleted.";
    const seeded = archive({ description, text: "# State\n\n## handoff-9008 boot\n### RULINGS\n" })._unsafeUnwrapErr();
    const chained = archive({ description })._unsafeUnwrapErr();
    const reason =
      'the finished preamble would carry 2 copies of "(archived by handoff-9009). Nothing was deleted.", so the next ' +
      "archive could not chain after it — exactly one is required";
    expect(seeded).toEqual({ code: "INPUT_REJECTED", message: reason });
    expect(chained).toEqual({ code: "INPUT_REJECTED", message: reason });
  });

  it("seeds the note alone when the block is the doc's first line", () => {
    expect(unwrap(archive({ text: "## handoff-9008 boot\n### RULINGS\n" })).docText).toBe(
      "The handoff-9008 block (lines 1-2, the eighth seat) is in `~/h/archive/x.md` (archived by handoff-9009). " +
        `Nothing was deleted.\n\n${SUCCESSOR}`,
    );
  });

  it("refuses when the predecessor's own archive note is absent or appears twice", () => {
    const absent = archive({
      text: ARCHIVABLE.replace("archived by handoff-9008", "archived by handoff-9006"),
    })._unsafeUnwrapErr();
    const twice = archive({
      text: ARCHIVABLE.replace("kept.", "kept. (archived by handoff-9008). Nothing was deleted."),
    })._unsafeUnwrapErr();
    expect([absent.code, twice.code]).toEqual(["ARCHIVE_NOTE_NOT_FOUND", "ARCHIVE_NOTE_NOT_FOUND"]);
    expect([absent, twice]).toMatchObject([{ matches: 0 }, { matches: 2 }]);
    expect(absent.message).toContain("carries 0 copies");
    expect(twice.message).toContain("carries 2 copies");
  });

  it("refuses a successor block with a blank line, the wrong heading, or no rulings", () => {
    const refusals = [
      "## handoff-9009 boot\n- a\n\n### RULINGS\n",
      "## handoff-9010 boot\n### RULINGS\n",
      "## handoff-9009 boot\n- a\n",
    ].map((successorBlock) => archive({ successorBlock })._unsafeUnwrapErr().message);
    expect(refusals).toEqual([
      "the block file carries a blank line",
      'the block file must open with "## handoff-9009 boot"',
      'the block file has no "### RULINGS" line',
    ]);
  });

  it("refuses the same seat on both sides and a description spanning lines", () => {
    expect(archive({ successor: "9008" })._unsafeUnwrapErr().message).toBe(
      "--predecessor and --successor name the same seat",
    );
    expect(archive({ description: "a\nb" })._unsafeUnwrapErr().message).toBe(
      "--description must be one non-empty line",
    );
  });

  it("refuses a backtick in text it interpolates, which would end the note's inline-code path early", () => {
    expect(archive({ description: "a `b" })._unsafeUnwrapErr().message).toBe(
      "--description must not carry a backtick or a NUL",
    );
    expect(archive({ archiveDisplayPath: "~/h/archive/`.md" })._unsafeUnwrapErr().message).toBe(
      "the archive path must not carry a backtick or a NUL",
    );
  });

  it("refuses a predecessor block that is not the doc's tail", () => {
    expect(archive({ text: `${ARCHIVABLE}## after\n` })._unsafeUnwrapErr().code).toBe("BLOCK_NOT_TAIL");
  });

  it("refuses a successor block over the block cap", () => {
    const rows = Array.from({ length: MAX_BOOT_BLOCK_LINES }, (_unused, index) => `- r${String(index)}`).join("\n");
    const refusal = archive({ successorBlock: `## handoff-9009 boot\n${rows}\n### RULINGS\n` })._unsafeUnwrapErr();
    expect(refusal.code).toBe("CAP_EXCEEDED");
  });
});
