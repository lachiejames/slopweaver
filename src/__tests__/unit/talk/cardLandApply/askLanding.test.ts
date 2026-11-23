/**
 * Landing the owner's words on an ask: the draft ids it named, the ruling it records, the steer it relates to the ask's
 * row, and the refusals that leave the ask's journal as it was — the REAL `landCard` over a throwaway home and
 * board, an ask's standing read through the same `ownerWaitOf` the queue reads.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { readLandedDraftBindings } from "../../../../cli/commands/supervisor/landedCardReads.js";
import { landCard } from "../../../../cli/commands/talk/cardLandApply.js";
import { restoreCard } from "../../../../cli/commands/talk/cardRestoreApply.js";
import { parseHandoverDoc } from "../../../../handover/doc.js";
import { readRunJournal } from "../../../../handover/runStore.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { draftItem } from "../../supervisor/draftItemFixture.js";
import { ANCHOR, active, board, callOnDisk, home, input, stageAsk, useCardLandHome, waitOf } from "./harness.js";

useCardLandHome();

/** The bindings of a landing read already asserted `read`. */
function unwrapBindings({
  bindings,
}: {
  bindings: ReturnType<typeof readLandedDraftBindings>;
}): Extract<ReturnType<typeof readLandedDraftBindings>, { kind: "read" }>["bindings"] {
  if (bindings.kind !== "read") {
    throw new Error(bindings.why);
  }
  return bindings.bindings;
}

describe("landing on an ask", () => {
  it("keeps the draft ids the ask named as the owner's yes landed, so settling the doc after it still binds that yes", async () => {
    await stageAsk({ slug: "an-ask" });
    const path = join(board, "an-ask.md");
    const staged = readFileSync(path, "utf8");
    writeFileSync(path, staged.replace("a parked ask", "send sd-11112222 to Seth?"));
    const landed = unwrap(await landCard({ input: input({ cardKey: "ask:an-ask", words: "yes send it" }) }));
    // Settling the ask rewrites its doc, and the rewrite no longer names the draft.
    writeFileSync(path, staged);
    const bindings = readLandedDraftBindings({
      home,
      items: [draftItem({ id: "sd-11112222", tsIso: "2026-09-25T15:00:00.000Z" })],
      skipped: [],
    });

    expect(landed.landing.draftIds).toEqual(["sd-11112222"]);
    expect(bindings.kind).toBe("read");
    expect(unwrapBindings({ bindings }).bound.map((one) => one.item.id)).toEqual(["sd-11112222"]);
  });

  it("keeps no draft ids for an ask that names none", async () => {
    await stageAsk({ slug: "an-ask" });
    const landed = unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));

    expect(Object.keys(landed.landing)).not.toContain("draftIds");
  });

  it("records the owner's words as the ask's ruling, so it waits on a session, not on them", async () => {
    await stageAsk({ slug: "an-ask" });
    expect(waitOf({ slug: "an-ask" }).kind).toBe("owner");
    const landed = unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
    expect(landed.landing.workSlug).toBe("an-ask");
    expect(waitOf({ slug: "an-ask" })).toEqual({ kind: "already-ruled", words: "what is a voice mark" });
  });

  // A card shows every steer of the owner's that bears on it, so the words ruling on an ask are
  // related to its row and quoted once the landing is on the ledger — and the same words landing again add nothing.
  it("relates the owner's words to the ask's row as one more steer, quoted off the landing, once", async () => {
    await stageAsk({ slug: "an-ask", anchor: "talk:a0000015-0000-4000-8000-000000000016" });
    callOnDisk({ card: "ask:an-ask", words: "what is" });
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask", words: "what is" }) }));
    callOnDisk({ card: "ask:an-ask", words: "what is a voice mark" });
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
    const path = join(board, "an-ask.md");
    expect(parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWordsSteers).toEqual([
      {
        group: {
          hisWords: {
            anchor: ANCHOR,
            atIso: "2026-09-25T15:40:00.000Z",
            cut: "none",
            where: "call-landing",
            words: "what is a voice mark",
          },
          kind: "held",
        },
        index: 1,
      },
    ]);
  });

  // A steer that will not reach the row is reported on the landing rather than only logged,
  // the ruling still lands, and landing the same words again relates it once the row will take it.
  it("reports a steer the ask's row would not take, and relates it when the same words land again", async () => {
    await stageAsk({ slug: "an-ask", anchor: "talk:a0000015-0000-4000-8000-000000000016" });
    const path = join(board, "an-ask.md");
    const good = readFileSync(path, "utf8");
    writeFileSync(path, good.replace("---\n", "---\nslug: an-ask\n"));
    const first = unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
    expect(first.outcome).toBe("landed");
    expect(first.unquoted.length).toBe(1);
    expect(first.unquoted[0]).toContain(`${ANCHOR} not related to an-ask`);
    expect(waitOf({ slug: "an-ask" })).toEqual({ kind: "already-ruled", words: "what is a voice mark" });
    writeFileSync(path, good);
    const again = unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
    expect([again.outcome, again.unquoted]).toEqual(["already", []]);
    expect(parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWordsSteers.length).toBe(1);
  });

  // An archived row draws no card, so its ruling lands and no steer is written into the archive.
  it("records the ruling on an archived ask and writes no steer into its archived row", async () => {
    await stageAsk({ slug: "an-ask", anchor: "talk:a0000015-0000-4000-8000-000000000016" });
    mkdirSync(join(board, "archive"), { recursive: true });
    renameSync(join(board, "an-ask.md"), join(board, "archive", "an-ask.md"));
    const archived = readFileSync(join(board, "archive", "an-ask.md"), "utf8");
    expect(unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) })).landing.workSlug).toBe("an-ask");
    expect(readFileSync(join(board, "archive", "an-ask.md"), "utf8")).toBe(archived);
  });

  it("refuses an ask no board holds", async () => {
    expect(unwrapErr(await landCard({ input: input({ cardKey: "ask:gone" }) })).code).toBe("ASK_MISSING");
  });

  // The ledger caps an anchor at 300 characters, so a longer one is refused before the ask is touched.
  it("refuses a restore or a landing the ledger would not take, and leaves the ask's journal as it was", async () => {
    await stageAsk({ slug: "an-ask" });
    const journal = (): string[] =>
      unwrap(readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug: "an-ask" })).events.map(
        (event) => event.kind,
      );
    const tooLong = `call:${"x".repeat(300)}`;
    const landing = unwrapErr(await landCard({ input: input({ anchor: tooLong, cardKey: "ask:an-ask" }) }));
    expect([landing.code, journal()]).toEqual(["LEDGER_IO", ["started", "question"]]);
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
    const restore = unwrapErr(
      restoreCard({
        input: {
          anchor: tooLong,
          cardKey: "ask:an-ask",
          home,
          nowIso: "2026-09-25T16:00:00.000Z",
          why: "not about it",
        },
      }),
    );
    expect([restore.code, journal(), active().length]).toEqual(["LEDGER_IO", ["started", "question", "ruling"], 1]);
  });
});
