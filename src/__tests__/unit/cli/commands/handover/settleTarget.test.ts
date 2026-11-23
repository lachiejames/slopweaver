import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readSettleRow, settleTarget } from "../../../../../cli/commands/handover/settleTarget.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";

const askText = ({ slug = "some-ask", extra = [] }: { slug?: string; extra?: readonly string[] } = {}) =>
  [
    "---",
    `slug: ${slug}`,
    "kind: ask",
    'summary: "an ask"',
    "status: ready",
    "askedIso: 2026-09-07T00:00:00Z",
    ...extra,
    "blockedBy: []",
    "artifact: null",
    "doneWhen: []",
    "---",
    "",
  ].join("\n");

const ask = ({ extra = [] }: { extra?: readonly string[] } = {}) =>
  parseHandoverDoc({ path: "/h/some-ask.md", text: askText({ extra }) });

describe("readSettleRow", () => {
  const dirs: string[] = [];
  afterEach(() => {
    dirs.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true }));
  });
  const board = ({ archived }: { archived: string }): string => {
    const home = mkdtempSync(join(tmpdir(), "settle-row-"));
    dirs.push(home);
    const dir = join(home, "handovers");
    mkdirSync(join(dir, "archive"), { recursive: true });
    writeFileSync(join(dir, "some-ask.md"), askText());
    writeFileSync(join(dir, "archive", "archived-doc.md"), archived);
    return home;
  };
  const read = ({ home, witness = "archived-doc" }: { home: string; witness?: string }) =>
    readSettleRow({
      dir: join(home, "handovers"),
      home,
      settlement: "filed",
      slug: "some-ask",
      witness,
    });

  it("accepts a well-formed archived doc as a filed witness", () => {
    const home = board({ archived: askText({ slug: "archived-doc" }) });
    expect(read({ home })).toEqual(expect.objectContaining({ row: expect.objectContaining({ slug: "some-ask" }) }));
  });

  it("refuses an archived witness whose front matter has problems, which the board trusts none of", () => {
    const home = board({ archived: askText({ extra: ["status: ready"], slug: "archived-doc" }) });
    expect(read({ home })).toBe(EXIT_ERROR);
  });

  it("refuses a witness that climbs out of the archive to a doc whose own slug matches the climb", () => {
    const home = board({ archived: askText({ slug: "archived-doc" }) });
    writeFileSync(join(home, "outside.md"), askText({ slug: "../../outside" }));
    expect(read({ home, witness: "archived-doc" })).toEqual(
      expect.objectContaining({ row: expect.objectContaining({ slug: "some-ask" }) }),
    );
    expect(read({ home, witness: "../../outside" })).toBe(EXIT_ERROR);
  });
});

describe("settleTarget", () => {
  it("answers the row when nothing refuses it", () => {
    const row = ask();
    expect(
      settleTarget({ docs: [row], settlement: "answered", slug: "some-ask", witness: "w", witnessArchived: false }),
    ).toEqual({ row });
  });

  it("refuses a row already settled, naming the run as a separate ending", () => {
    const docs = [ask({ extra: ["settlement: answered", "settlementWitness: w"] })];
    expect(
      settleTarget({ docs, settlement: "answered", slug: "some-ask", witness: "w", witnessArchived: false }),
    ).toEqual({
      refusal: [
        "some-ask already carries `settlement: answered` (witness: w)",
        "  — a settlement is written once, and this is the ASK ROW's settlement, not the run's `answered` event.",
        "  The RUN is a separate ending that the first settle may already have closed — `slopweaver handover resume some-ask` shows whether it is still open.",
      ],
    });
  });

  it("refuses a slug no row claims", () => {
    expect(
      settleTarget({ docs: [], settlement: "answered", slug: "nope", witness: "w", witnessArchived: false }),
    ).toEqual({
      refusal: ['no row on the board claims the slug "nope"'],
    });
  });

  it("refuses a filed settlement whose witness names no doc", () => {
    expect(
      settleTarget({
        docs: [ask()],
        settlement: "filed",
        slug: "some-ask",
        witness: "missing-doc",
        witnessArchived: false,
      }),
    ).toEqual({
      refusal: ['--witness "missing-doc" names no doc on the board or in its archive — file the doc first'],
    });
  });

  it("answers the row for a filed settlement whose witness is an archived doc", () => {
    const row = ask();
    expect(
      settleTarget({
        docs: [row],
        settlement: "filed",
        slug: "some-ask",
        witness: "archived-doc",
        witnessArchived: true,
      }),
    ).toEqual({ row });
  });
});
