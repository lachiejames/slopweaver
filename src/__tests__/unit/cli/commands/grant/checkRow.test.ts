import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type CheckedGrant, checkRow } from "../../../../../cli/commands/grant/checkRow.js";
import { GrantCheckErrors } from "../../../../../grants/errors.js";
import type { GrantEntry, GrantRow, GrantTarget } from "../../../../../grants/grant.js";
import type { GrantJournalPort } from "../../../../../grants/port.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { OWNER_SPEAKER } from "../../../../../talk/callRecord.js";
import type { CardLandedRow } from "../../../../../talk/cardLanding.js";
import { appendCardLanding } from "../../../../../talk/cardLandingStore.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn } from "../../../../../talk/relayStore.js";
import {
  GRANT_FIXTURE_OUTAGE,
  memoryGrantJournalPort,
  unavailableGrantJournalPort,
} from "../../../../grantJournalFixture.js";

/**
 * One complete grant row; there is no grant-row factory in the domain, so the literal is the fixture.
 *
 * @returns the row
 */
function grantRow({ id, target, anchor }: { id: string; target: GrantTarget; anchor: string }): GrantRow {
  return {
    anchor,
    change: "line-alpha",
    changeKind: "literal",
    id,
    pinnedAtRecord: true,
    recordedAtIso: "2026-10-01T00:00:00.000Z",
    recordedBySessionId: "session-bravo",
    target,
  };
}

describe("checkRow", () => {
  let home: string;
  let journal: GrantJournalPort;

  /** Write one entry through the real port, failing the test if the store refuses it. */
  async function seed({ entry }: { entry: GrantEntry }): Promise<void> {
    unwrap(await journal.appendEntry({ entry, home }));
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "grant-check-row-"));
    journal = memoryGrantJournalPort();
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("returns the journal and the verified row when the anchor is well-shaped, the file is there and the change matches", async () => {
    const targetPath = join(home, "target-charlie.txt");
    writeFileSync(targetPath, "before\n");
    const row = grantRow({ anchor: "transcript:abc#def", id: "grant-1", target: { kind: "file", path: targetPath } });
    const entry: GrantEntry = { grant: row, kind: "grant" };
    await seed({ entry });
    const checked = unwrap(await checkRow({ grantId: "grant-1", home, journal, proposedChange: "line-alpha" }));
    expect(checked.entries).toEqual([entry]);
    expect(checked.verified.isOk()).toBe(true);
    expect(unwrap(checked.verified)).toEqual(row);
  });

  it("refuses STATE_ABSENT when the file the row names is not on disk", async () => {
    const targetPath = join(home, "missing-delta.txt");
    await seed({
      entry: {
        grant: grantRow({ anchor: "transcript:abc#def", id: "grant-2", target: { kind: "file", path: targetPath } }),
        kind: "grant",
      },
    });
    const checked = unwrap(await checkRow({ grantId: "grant-2", home, journal, proposedChange: undefined }));
    expect(checked.verified.isErr()).toBe(true);
    expect(unwrapErr(checked.verified)).toEqual(GrantCheckErrors.stateAbsent({ target: `file ${targetPath}` }));
    expect(unwrapErr(checked.verified).code).toBe("STATE_ABSENT");
  });

  it("does not read a system target as absent, because it has no path to look at", async () => {
    const row = grantRow({
      anchor: "https://example.test/ruling",
      id: "grant-3",
      target: { kind: "system", name: "datadog" },
    });
    await seed({ entry: { grant: row, kind: "grant" } });
    const checked = unwrap(await checkRow({ grantId: "grant-3", home, journal, proposedChange: undefined }));
    expect(checked.verified.isOk()).toBe(true);
    expect(unwrap(checked.verified)).toEqual(row);
  });

  it("refuses CHANGE_MISMATCH when what the session would write is not the row's exact change", async () => {
    await seed({
      entry: {
        grant: grantRow({ anchor: "transcript:abc#def", id: "grant-4", target: { kind: "system", name: "slack" } }),
        kind: "grant",
      },
    });
    const checked = unwrap(await checkRow({ grantId: "grant-4", home, journal, proposedChange: "line-alpha " }));
    expect(checked.verified.isErr()).toBe(true);
    expect(unwrapErr(checked.verified)).toEqual(GrantCheckErrors.changeMismatch({ grantId: "grant-4" }));
    expect(unwrapErr(checked.verified).code).toBe("CHANGE_MISMATCH");
  });

  it("refuses ANCHOR_UNRESOLVED for an anchor that is neither a transcript pointer nor a URL", async () => {
    await seed({
      entry: {
        grant: grantRow({ anchor: "the owner said so", id: "grant-5", target: { kind: "system", name: "linear" } }),
        kind: "grant",
      },
    });
    const checked = unwrap(await checkRow({ grantId: "grant-5", home, journal, proposedChange: "line-alpha" }));
    expect(checked.verified.isErr()).toBe(true);
    expect(unwrapErr(checked.verified)).toEqual(
      GrantCheckErrors.anchorUnresolved({
        anchor: "the owner said so",
        why: "it is neither a console record (talk:, talk-call:), a transcript pointer nor a URL",
      }),
    );
    expect(unwrapErr(checked.verified).code).toBe("ANCHOR_UNRESOLVED");
  });

  it("judges a transcript anchor on its shape alone, never opening the transcript it names", async () => {
    const row = grantRow({
      anchor: "transcript:no-such-session#no-such-turn",
      id: "grant-6",
      target: { kind: "system", name: "github" },
    });
    await seed({ entry: { grant: row, kind: "grant" } });
    const checked = unwrap(await checkRow({ grantId: "grant-6", home, journal, proposedChange: undefined }));
    expect(checked.verified.isOk()).toBe(true);
    expect(unwrap(checked.verified)).toEqual(row);
  });

  it("refuses ROW_MISSING for an id no row carries, while still returning every journal entry in written order", async () => {
    const first: GrantEntry = {
      grant: grantRow({ anchor: "transcript:abc#def", id: "grant-7", target: { kind: "system", name: "vanta" } }),
      kind: "grant",
    };
    const second: GrantEntry = {
      kind: "performance",
      performance: {
        grantId: "grant-7",
        performedAtIso: "2026-10-02T00:00:00.000Z",
        performedBySessionId: "session-echo",
        wrote: "line-alpha",
      },
    };
    await seed({ entry: first });
    await seed({ entry: second });
    const checked = unwrap(await checkRow({ grantId: "grant-unknown", home, journal, proposedChange: undefined }));
    expect(checked.entries).toEqual([first, second]);
    expect(checked.verified.isErr()).toBe(true);
    expect(unwrapErr(checked.verified)).toEqual(GrantCheckErrors.rowMissing({ grantId: "grant-unknown" }));
    expect(unwrapErr(checked.verified).code).toBe("ROW_MISSING");
  });

  it("refuses ROW_MISSING over an empty store, reading it as an empty journal", async () => {
    const checked = unwrap(await checkRow({ grantId: "grant-8", home, journal, proposedChange: undefined }));
    expect(checked.entries).toEqual([]);
    expect(checked.verified.isErr()).toBe(true);
    expect(unwrapErr(checked.verified)).toEqual(GrantCheckErrors.rowMissing({ grantId: "grant-8" }));
    expect(unwrapErr(checked.verified).code).toBe("ROW_MISSING");
  });

  /*
   * A console record — an owner ruling typed or spoken to the console — is READ, never judged on its prefix. Three
   * rows anchored on one refused ANCHOR_UNRESOLVED while `profile words` read the same anchor fine.
   */
  describe("an anchor on an owner ruling made at the console", () => {
    const TURN = "a0000015-0000-4000-8000-000000000016";
    const CALL = "a0000037-0000-4000-8000-000000000040";
    const SEGMENT = "typed-owner-11112222-3333-4444-8555-666677778888";

    /** Stage a relay turn through the console's own writer. */
    function relayTurn({ typed }: { typed: boolean }): void {
      const draft = unwrap(
        formRelayDraft({
          about: "",
          heard: "yes, retire the half-full reminder",
          heardTailCut: undefined,
          picture: { kind: "none", reason: "screen-not-shared" },
          readsAfter: [],
          say: typed ? "" : "the voice's paraphrase, never quoted",
          triageRuling: undefined,
          turnId: TURN,
          typed,
          wordsAlone: false,
        }),
      );
      unwrap(claimTurn({ draft, home, nowIso: "2026-11-19T13:07:00.000Z" }));
    }

    /** One call file holding the given stretches, closed. */
    function callOnDisk({ stretches }: { stretches: readonly { id: string; who: string; text: string }[] }): void {
      mkdirSync(join(home, "talk", "calls"), { recursive: true });
      const lines = stretches.map(({ id, who, text }, at) =>
        JSON.stringify({ atIso: `2026-11-19T13:0${String(at)}:00.000Z`, final: true, id, kind: "segment", text, who }),
      );
      const closed = JSON.stringify({ atIso: "2026-11-19T13:09:00.000Z", kind: "closed", why: null });
      writeFileSync(join(home, "talk", "calls", `${CALL}.jsonl`), `${[...lines, closed].join("\n")}\n`);
    }

    /** Seed one row on the anchor and read it back through the edge. */
    async function checkedAt({ anchor }: { anchor: string }): Promise<CheckedGrant> {
      await seed({
        entry: {
          grant: grantRow({ anchor, id: "grant-c", target: { kind: "system", name: "claude" } }),
          kind: "grant",
        },
      });
      return unwrap(await checkRow({ grantId: "grant-c", home, journal, proposedChange: undefined }));
    }

    it("passes a talk: anchor whose relay turn the owner typed", async () => {
      relayTurn({ typed: true });
      const checked = await checkedAt({ anchor: `talk:${TURN}` });
      expect(unwrap(checked.verified).anchor).toBe(`talk:${TURN}`);
    });

    it("passes a talk-call: anchor on the owner's own typed stretch", async () => {
      callOnDisk({ stretches: [{ id: SEGMENT, text: "lets include codex in this too", who: OWNER_SPEAKER }] });
      const checked = await checkedAt({ anchor: `talk-call:${CALL}#${SEGMENT}` });
      expect(unwrap(checked.verified).anchor).toBe(`talk-call:${CALL}#${SEGMENT}`);
    });

    // Its reader checks the landing and the call file, never which console recorded the stretch (r1 review).
    it("refuses a call: card-landing anchor even when its landing reads, routing to the stretch's talk-call: anchor", async () => {
      const anchor = `call:${CALL}#s-1`;
      const landed: CardLandedRow = {
        anchor,
        atIso: "2026-11-19T13:05:00.000Z",
        cardKey: "ask:ship-it",
        decidedIso: "2026-11-19T13:04:00.000Z",
        kind: "landed",
        source: "transcript",
        words: "ship it",
        workSlug: "ship-it",
      };
      unwrap(appendCardLanding({ home, row: landed }));
      mkdirSync(join(home, "talk", "calls"), { recursive: true });
      const said = JSON.stringify({
        atIso: "2026-11-19T13:00:00.000Z",
        final: true,
        id: "s-1",
        kind: "segment",
        open: "ask:ship-it",
        text: "ship it",
        who: OWNER_SPEAKER,
      });
      const closed = JSON.stringify({ atIso: "2026-11-19T13:09:00.000Z", kind: "closed", why: null });
      writeFileSync(join(home, "talk", "calls", `${CALL}.jsonl`), `${said}\n${closed}\n`);
      const checked = await checkedAt({ anchor });
      expect(unwrapErr(checked.verified)).toEqual(
        GrantCheckErrors.anchorUnresolved({
          anchor,
          why:
            "a card landing (call:) does not say which console recorded the words — anchor on the stretch itself, " +
            "talk-call:<call>#<segment>",
        }),
      );
    });

    it("refuses a talk-call: anchor on owner speech a seat's console recorded, and passes the owner's console's", async () => {
      const open = ({ port }: { port: number }): string =>
        JSON.stringify({
          atIso: "2026-11-19T12:59:00.000Z",
          kind: "open",
          model: "m",
          origin: { checkoutRoot: "/repo", defaultPort: 3000, mainWorktree: true, port },
          sessionId: "s",
          voice: "v",
        });
      const said = ({ id }: { id: string }): string =>
        JSON.stringify({
          atIso: "2026-11-19T13:00:00.000Z",
          final: true,
          id,
          kind: "segment",
          text: "yes",
          who: OWNER_SPEAKER,
        });
      mkdirSync(join(home, "talk", "calls"), { recursive: true });
      const lines = [open({ port: 3000 }), said({ id: "owners" }), open({ port: 3001 }), said({ id: "seat" })];
      writeFileSync(join(home, "talk", "calls", `${CALL}.jsonl`), `${lines.join("\n")}\n`);
      const seat = unwrapErr((await checkedAt({ anchor: `talk-call:${CALL}#seat` })).verified);
      expect(seat.code).toBe("ANCHOR_UNRESOLVED");
      expect(seat).toEqual(
        GrantCheckErrors.anchorUnresolved({
          anchor: `talk-call:${CALL}#seat`,
          why: `talk-call:${CALL}#seat was recorded on the owner's main checkout at /repo on :3001 (the owner's console is :3000), so its speech is not read as the owner's`,
        }),
      );
      await seed({
        entry: {
          grant: grantRow({
            anchor: `talk-call:${CALL}#owners`,
            id: "grant-o",
            target: { kind: "system", name: "claude" },
          }),
          kind: "grant",
        },
      });
      const passed = unwrap(await checkRow({ grantId: "grant-o", home, journal, proposedChange: undefined }));
      expect(unwrap(passed.verified).anchor).toBe(`talk-call:${CALL}#owners`);
    });

    it("refuses a talk: anchor whose relay turn is not on disk, carrying the relay reader's own reason", async () => {
      const checked = await checkedAt({ anchor: `talk:${TURN}` });
      const refused = unwrapErr(checked.verified);
      expect(refused.code).toBe("ANCHOR_UNRESOLVED");
      expect(refused).toEqual(
        GrantCheckErrors.anchorUnresolved({
          anchor: `talk:${TURN}`,
          why: `talk:${TURN}: no relay turn file carries it`,
        }),
      );
    });

    it("refuses a talk-call: anchor on the voice's stretch, because it is not the owner's words", async () => {
      callOnDisk({ stretches: [{ id: "v-1", text: "noted", who: "voice" }] });
      const refused = unwrapErr((await checkedAt({ anchor: `talk-call:${CALL}#v-1` })).verified);
      expect(refused.code).toBe("ANCHOR_UNRESOLVED");
      expect(refused.message).toContain("not the owner");
    });

    it("refuses a malformed talk: anchor on the resolver's word, never passing it on its prefix", async () => {
      const refused = unwrapErr((await checkedAt({ anchor: "talk:" })).verified);
      expect(refused.code).toBe("ANCHOR_UNRESOLVED");
      expect(refused).toEqual(
        GrantCheckErrors.anchorUnresolved({ anchor: "talk:", why: "talk: is not a well-formed pointer of its scheme" }),
      );
    });
  });

  it("answers the store outage as the OUTER failure, never as an empty journal that would read ROW_MISSING", async () => {
    const refused = await checkRow({
      grantId: "grant-9",
      home,
      journal: unavailableGrantJournalPort(),
      proposedChange: undefined,
    });
    expect(unwrapErr(refused)).toEqual(GRANT_FIXTURE_OUTAGE);
    expect(unwrapErr(refused).code).toBe("GRANT_STORE_UNAVAILABLE");
  });
});
