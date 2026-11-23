/**
 * The turn transaction, proven against a real home in a temp directory.
 *
 * Per `testing.md`, every write here goes to an explicit `home` this file minted — never the ambient one.
 */
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { JournalEvidence } from "../../../handover/assemble.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { readConsoleTurns } from "../../../talk/consoleTurns.js";
import { claimDelivery, deliveryClaimed } from "../../../talk/relayDeliveryClaim.js";
import { formRelayDraft } from "../../../talk/relayDraft.js";
import { readVoiceRelayIntake, relayRowEvidence } from "../../../talk/relayIntakeRead.js";
import {
  claimTurn,
  markDelivered,
  markDeliveryLead,
  markRegistered,
  readRelayLedger,
  readRelayReceipts,
  readRelayTurns,
  readTurn,
  setTurnRegistering,
  withDraftPicture,
} from "../../../talk/relayStore.js";

const TURN = "a0000017-0000-4000-8000-000000000019";
const OTHER_TURN = "a0000043-0000-4000-8000-000000000046";
const STAGED = "2026-09-22T13:40:00.000Z";
const CONFIRMED = "2026-09-22T13:40:02.000Z";
/** A ceiling past every instant here, for a read that is not about the window's end. */
const CEILING = "2026-12-31T00:00:00.000Z";

let home: string;

const draftOf = ({ say, turnId = TURN }: { say: string; turnId?: string }) =>
  unwrap(
    formRelayDraft({
      about: "",
      heard: "",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say,
      turnId,
      typed: false,
      wordsAlone: false,
    }),
  );

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-relay-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A board with nothing on it, an empty archive and a chair holding nothing — what a relay with no row is swept against. */
const EMPTY_BOARD = {
  archivedDoc: (): undefined => undefined,
  chairHas: (): boolean => false,
  docs: [],
  journals: new Map<string, JournalEvidence>(),
};

describe("claimTurn", () => {
  it("claims a fresh turn and stages it as intended", () => {
    const claim = unwrap(claimTurn({ draft: draftOf({ say: "land the tab" }), home, nowIso: STAGED }));
    expect(claim.outcome).toBe("claimed");
    expect(claim.record.state).toBe("intended");
    expect(claim.record.registeredAtIso).toBe(null);
    expect(claim.record.slug).toBe("talk-a00000170000");
    expect(claim.record.words).toBe("land the tab");
  });

  it("gives the SECOND claimant of one turn `resume`, never a second claim", () => {
    const draft = draftOf({ say: "land the tab" });
    const first = unwrap(claimTurn({ draft, home, nowIso: STAGED }));
    const second = unwrap(claimTurn({ draft, home, nowIso: CONFIRMED }));
    expect(first.outcome).toBe("claimed");
    expect(second.outcome).toBe("resume");
    // The loser reads the WINNER's record, stamp included — it did not restage under its own clock.
    expect(second.record.stagedAtIso).toBe(STAGED);
  });

  it("reports an already-registered turn without writing a second row", () => {
    const draft = draftOf({ say: "land the tab" });
    const claimed = unwrap(claimTurn({ draft, home, nowIso: STAGED }));
    unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    const again = unwrap(claimTurn({ draft, home, nowIso: "2026-09-22T13:50:00.000Z" }));
    expect(again.outcome).toBe("already-registered");
    expect(again.record.registeredAtIso).toBe(CONFIRMED);
    expect(unwrap(readRelayReceipts({ home, limit: 10 })).length).toBe(1);
  });

  it("REFUSES a spent turn carrying different words, rather than returning the old receipt", () => {
    const original = draftOf({ say: "merge it today" });
    const claimed = unwrap(claimTurn({ draft: original, home, nowIso: STAGED }));
    unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    const swapped = draftOf({ say: "merge it tomorrow" });
    const failure = unwrapErr(claimTurn({ draft: swapped, home, nowIso: CONFIRMED }));
    expect(failure.code).toBe("RELAY_CONFLICT");
    expect(failure.message).toContain(
      "was already relayed, carrying different words, a different picture, a different ruling on a candidate or a " +
        "different copy-tray offer",
    );
  });

  it("refuses a CHANGED re-press of an unfinished turn too, and says STAGED rather than relayed", () => {
    // The two states word the same refusal differently on purpose. A turn whose registration never landed
    // has staged words and no row, so telling its presser it was "already relayed" is false about the one
    // fact they would act on — and this is the state a failed `handover register` really leaves behind.
    unwrap(claimTurn({ draft: draftOf({ say: "merge it today" }), home, nowIso: STAGED }));
    const failure = unwrapErr(claimTurn({ draft: draftOf({ say: "merge it tomorrow" }), home, nowIso: CONFIRMED }));
    expect(failure.code).toBe("RELAY_CONFLICT");
    expect(failure.message).toContain(
      "was already staged, carrying different words, a different picture, a different ruling on a candidate or a " +
        "different copy-tray offer",
    );
  });

  it("treats a re-press whose words differ only in whitespace as the SAME turn", () => {
    unwrap(claimTurn({ draft: draftOf({ say: "merge it today" }), home, nowIso: STAGED }));
    const respelled = unwrap(claimTurn({ draft: draftOf({ say: "merge  it\ntoday" }), home, nowIso: CONFIRMED }));
    expect(respelled.outcome).toBe("resume");
  });

  // A stretch of 15,357 characters, which the record once cut to its last 1,500.
  it("keeps every word of a long stretch on the turn file, and refuses a re-press that changed only its head", () => {
    const tail = "and that is the steer ".repeat(100);
    const said = `${"start of this stretch ".repeat(600)}${tail}`.trim();
    const spoken = ({ heard }: { heard: string }) =>
      unwrap(
        formRelayDraft({
          about: "",
          heard,
          picture: { kind: "none", reason: "screen-not-shared" },
          readsAfter: ["context_pack"],
          say: "",
          turnId: TURN,
          typed: false,
          wordsAlone: false,
        }),
      );
    unwrap(claimTurn({ draft: spoken({ heard: said }), home, nowIso: STAGED }));
    const kept = unwrap(readTurn({ home, turnId: TURN }));
    expect(kept.heard.length).toBe(15_399);
    expect(kept.heard).toBe(said);
    expect(kept.heardTruncated).toBe(false);
    expect(unwrap(claimTurn({ draft: spoken({ heard: said }), home, nowIso: CONFIRMED })).outcome).toBe("resume");
    const reheaded = `${"close it instead please ".repeat(550)}${tail}`.trim();
    const failure = unwrapErr(claimTurn({ draft: spoken({ heard: reheaded }), home, nowIso: CONFIRMED }));
    expect(failure.code).toBe("RELAY_CONFLICT");
  });

  it("keeps two turns carrying identical words independent, which a word slug could not", () => {
    const first = unwrap(claimTurn({ draft: draftOf({ say: "same words" }), home, nowIso: STAGED }));
    const second = unwrap(
      claimTurn({ draft: draftOf({ say: "same words", turnId: OTHER_TURN }), home, nowIso: STAGED }),
    );
    expect(second.outcome).toBe("claimed");
    expect(second.record.slug).not.toBe(first.record.slug);
  });
});

describe("readConsoleTurns", () => {
  const typedDraft = ({ heard, turnId }: { heard: string; turnId: string }) =>
    unwrap(
      formRelayDraft({
        about: "",
        heard,
        picture: { kind: "none", reason: "screen-not-shared" },
        readsAfter: [],
        say: "",
        turnId,
        typed: true,
        wordsAlone: false,
      }),
    );

  it("returns every steer since the floor, typed or spoken, registered or not, oldest first", () => {
    const typed = unwrap(claimTurn({ draft: typedDraft({ heard: "ship it", turnId: TURN }), home, nowIso: STAGED }));
    unwrap(markRegistered({ home, nowIso: CONFIRMED, record: typed.record }));
    const third = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    const spokenAt = "2026-09-22T13:40:05.000Z";
    unwrap(claimTurn({ draft: draftOf({ say: "spoken", turnId: OTHER_TURN }), home, nowIso: spokenAt }));
    unwrap(claimTurn({ draft: typedDraft({ heard: "hold it", turnId: third }), home, nowIso: CONFIRMED }));

    const read = unwrap(readConsoleTurns({ home, sinceIso: STAGED, untilIso: CEILING }));

    expect(read.turns.map((turn) => [turn.turnId, turn.heard, turn.state, turn.typed])).toEqual([
      [TURN, "ship it", "registered", true],
      [third, "hold it", "intended", true],
      [OTHER_TURN, "", "intended", false],
    ]);
    expect(read.unreadable).toEqual([]);
  });

  it("drops a steer staged before the floor", () => {
    unwrap(claimTurn({ draft: typedDraft({ heard: "ship it", turnId: TURN }), home, nowIso: STAGED }));

    expect(unwrap(readConsoleTurns({ home, sinceIso: CONFIRMED, untilIso: CEILING }))).toEqual({
      turns: [],
      unreadable: [],
    });
  });

  it("names a steer whose staging instant will not parse, rather than dropping it as outside the window", () => {
    unwrap(claimTurn({ draft: typedDraft({ heard: "ship it", turnId: TURN }), home, nowIso: STAGED }));
    const path = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
    writeFileSync(path, readFileSync(path, "utf8").replace(STAGED, "not a time"), "utf8");

    expect(unwrap(readConsoleTurns({ home, sinceIso: STAGED, untilIso: CEILING }))).toEqual({
      turns: [],
      unreadable: [`talk:${TURN} carries no readable staging instant (not a time)`],
    });
  });

  it("names a turn file that will not read and still returns every one that does", () => {
    unwrap(claimTurn({ draft: typedDraft({ heard: "ship it", turnId: TURN }), home, nowIso: STAGED }));
    writeFileSync(join(stateHomePaths({ home }).talkTurns, `${OTHER_TURN}.json`), "{", "utf8");

    const read = unwrap(readConsoleTurns({ home, sinceIso: STAGED, untilIso: CEILING }));

    expect(read.turns.map((turn) => turn.heard)).toEqual(["ship it"]);
    expect(read.unreadable.length).toBe(1);
    expect(read.unreadable[0]).toContain(OTHER_TURN);
  });
});

describe("markRegistered", () => {
  it("promotes the turn and appends exactly one receipt", () => {
    const claimed = unwrap(claimTurn({ draft: draftOf({ say: "land the tab" }), home, nowIso: STAGED }));
    const registered = unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    expect(registered.state).toBe("registered");
    expect(registered.registeredAtIso).toBe(CONFIRMED);
    expect(unwrap(readTurn({ home, turnId: TURN })).state).toBe("registered");
    const receipts = unwrap(readRelayReceipts({ home, limit: 10 }));
    expect(receipts.length).toBe(1);
    expect(receipts[0]!.slug).toBe("talk-a00000170000");
    expect(receipts[0]!.anchor).toBe(`talk:${TURN}`);
  });
});

describe("readRelayReceipts", () => {
  it("returns an empty list for an install that has never relayed, rather than failing", () => {
    expect(unwrap(readRelayReceipts({ home, limit: 10 }))).toEqual([]);
  });

  it("keeps the most recent receipts when the limit bites", () => {
    const turns = [TURN, OTHER_TURN, "a0000075-0000-4000-8000-000000000082"];
    turns.forEach((turnId, index) => {
      const claimed = unwrap(
        claimTurn({ draft: draftOf({ say: `relay ${String(index)}`, turnId }), home, nowIso: STAGED }),
      );
      unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    });
    const receipts = unwrap(readRelayReceipts({ home, limit: 2 }));
    expect(receipts.map((row) => row.words)).toEqual(["relay 1", "relay 2"]);
  });

  it("returns nothing at all for a zero limit", () => {
    const claimed = unwrap(claimTurn({ draft: draftOf({ say: "land the tab" }), home, nowIso: STAGED }));
    unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    expect(unwrap(readRelayReceipts({ home, limit: 0 }))).toEqual([]);
  });
});

describe("readRelayLedger", () => {
  it("counts a line that is not a receipt rather than dropping it unsaid", () => {
    const claimed = unwrap(claimTurn({ draft: draftOf({ say: "land the tab" }), home, nowIso: STAGED }));
    unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    appendFileSync(stateHomePaths({ home }).talkRelaysJsonl, "{}\n");

    const ledger = unwrap(readRelayLedger({ home }));

    expect(ledger.rows.map((row) => row.turnId)).toEqual([TURN]);
    expect(ledger.undecoded).toBe(1);
  });

  it("counts a line holding a byte that is not UTF-8 as undecoded, never reading it repaired", () => {
    const claimed = unwrap(claimTurn({ draft: draftOf({ say: "land my tab" }), home, nowIso: STAGED }));
    unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    const path = stateHomePaths({ home }).talkRelaysJsonl;
    const bytes = readFileSync(path);
    bytes[bytes.indexOf("land my tab") + 5] = 0xff;
    writeFileSync(path, bytes);
    const repaired = JSON.parse(bytes.toString("utf8").trim()) as { turnId: string; words: string };

    const ledger = unwrap(readRelayLedger({ home }));

    expect(repaired.words).toBe("land �y tab");
    expect(ledger).toEqual({ rows: [], undecoded: 1 });
  });

  it("counts a blank line with a receipt after it as undecoded, and passes over the blank lines at the end", () => {
    const path = stateHomePaths({ home }).talkRelaysJsonl;
    const first = unwrap(claimTurn({ draft: draftOf({ say: "land the tab" }), home, nowIso: STAGED }));
    unwrap(markRegistered({ home, nowIso: CONFIRMED, record: first.record }));
    appendFileSync(path, "   \n");
    const second = unwrap(
      claimTurn({ draft: draftOf({ say: "close the tab", turnId: OTHER_TURN }), home, nowIso: STAGED }),
    );
    unwrap(markRegistered({ home, nowIso: CONFIRMED, record: second.record }));
    appendFileSync(path, "\n  \n");

    const ledger = unwrap(readRelayLedger({ home }));

    expect(ledger.rows.map((row) => row.turnId)).toEqual([TURN, OTHER_TURN]);
    expect(ledger.undecoded).toBe(1);
  });

  it("reads an install that has never relayed as no rows and nothing undecoded", () => {
    expect(unwrap(readRelayLedger({ home }))).toEqual({ rows: [], undecoded: 0 });
  });
});

describe("readTurn", () => {
  it("fails, naming the path, for a turn that was never staged", () => {
    const failure = unwrapErr(readTurn({ home, turnId: TURN }));
    expect(failure.code).toBe("PATH_UNREADABLE");
    expect(failure.message).toContain(TURN);
  });
});

describe("claimDelivery", () => {
  it("gives the one delivery of a turn to the first run and tells the second", () => {
    expect(unwrap(claimDelivery({ home, turnId: "a0000086-0000-4000-8000-000000000093" }))).toBe(true);
    expect(unwrap(claimDelivery({ home, turnId: "a0000086-0000-4000-8000-000000000093" }))).toBe(false);
  });
});

describe("markDelivered", () => {
  it("records the supervisor delivery on the turn, and a retried claim carries it back", () => {
    const draft = draftOf({ say: "land the tab" });
    const claimed = unwrap(claimTurn({ draft, home, nowIso: STAGED }));
    const registered = unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    expect(registered.delivery).toBe(null);
    const delivery = {
      atIso: CONFIRMED,
      detail: "typed into the supervisor's chat (workspace:1)",
      kind: "typed",
      via: "courier",
    } as const;
    unwrap(markDelivered({ delivery, home, record: registered }));
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual(delivery);
    expect(unwrap(claimTurn({ draft, home, nowIso: CONFIRMED })).record.delivery).toEqual(delivery);
  });

  it("leaves the receipt log alone — it records the row, not the chat", () => {
    const claimed = unwrap(claimTurn({ draft: draftOf({ say: "land the tab" }), home, nowIso: STAGED }));
    const registered = unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    unwrap(
      markDelivered({
        delivery: { atIso: CONFIRMED, detail: "typing", kind: "attempting", via: "direct" },
        home,
        record: registered,
      }),
    );
    const receipts = unwrap(readRelayReceipts({ home, limit: 10 }));
    expect(receipts.length).toBe(1);
    expect(receipts[0]!.delivery).toBe(null);
  });
});

describe("a delivery written before it named its process and refusal", () => {
  /** Register one turn, then overwrite its delivery with a raw stored value. */
  const withStoredDelivery = ({ delivery }: { delivery: unknown }): void => {
    const claimed = unwrap(claimTurn({ draft: draftOf({ say: "land the tab" }), home, nowIso: STAGED }));
    const registered = unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    const path = join(home, "talk", "turns", `${TURN}.json`);
    writeFileSync(path, `${JSON.stringify({ ...registered, delivery })}\n`);
  };

  it("reads a failed one as the relay's own, its refusal unclassified", () => {
    withStoredDelivery({ delivery: { atIso: CONFIRMED, detail: "cmux refused the connection", kind: "failed" } });
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual({
      atIso: CONFIRMED,
      detail: "cmux refused the connection",
      kind: "failed",
      refusal: "unclassified",
      via: "direct",
    });
  });

  it("reads a typed one as the relay's own", () => {
    withStoredDelivery({ delivery: { atIso: CONFIRMED, detail: "typed", kind: "typed" } });
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual({
      atIso: CONFIRMED,
      detail: "typed",
      kind: "typed",
      via: "direct",
    });
  });

  it("reads a process or refusal it does not know as no delivery, never as an older record", () => {
    withStoredDelivery({ delivery: { atIso: CONFIRMED, detail: "d", kind: "typed", via: "pigeon" } });
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toBe(null);
    withStoredDelivery({
      delivery: { atIso: CONFIRMED, detail: "d", kind: "failed", refusal: "bad luck", via: "direct" },
    });
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toBe(null);
  });
});

describe("markDeliveryLead", () => {
  it("stores the line's lead so the courier rebuilds the same line", () => {
    const claimed = unwrap(claimTurn({ draft: draftOf({ say: "land the tab" }), home, nowIso: STAGED }));
    const registered = unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    unwrap(markDeliveryLead({ deliveryLead: "on the #dev-alerts draft:", home, record: registered }));
    expect(unwrap(readTurn({ home, turnId: TURN })).deliveryLead).toBe("on the #dev-alerts draft:");
  });

  it("writes nothing for a relay with no lead, which reads back as none", () => {
    const claimed = unwrap(claimTurn({ draft: draftOf({ say: "land the tab" }), home, nowIso: STAGED }));
    const registered = unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
    expect(unwrap(markDeliveryLead({ deliveryLead: undefined, home, record: registered }))).toBe(registered);
    expect(unwrap(readTurn({ home, turnId: TURN })).deliveryLead).toBe(undefined);
  });
});

describe("deliveryClaimed", () => {
  it("says whether a run took the turn's delivery claim", () => {
    expect(unwrap(deliveryClaimed({ home, turnId: TURN }))).toBe(false);
    unwrap(claimDelivery({ home, turnId: TURN }));
    expect(unwrap(deliveryClaimed({ home, turnId: TURN }))).toBe(true);
  });
});

describe("readRelayTurns — the delivery as it stands, not as the receipt froze it", () => {
  const FAILED = {
    atIso: CONFIRMED,
    detail: "cmux could not list workspaces: cmux control socket unavailable at /x.sock: the connection closed",
    kind: "failed",
    refusal: "cmux-unreachable",
    via: "direct",
  } as const;

  const registerOne = ({ turnId, nowIso }: { turnId: string; nowIso: string }) => {
    const claimed = unwrap(claimTurn({ draft: draftOf({ say: "land the tab", turnId }), home, nowIso: STAGED }));
    return unwrap(markRegistered({ home, nowIso, record: claimed.record }));
  };

  it("reads the failed delivery off the turn file while the receipt still says null — the defect", () => {
    unwrap(markDelivered({ delivery: FAILED, home, record: registerOne({ nowIso: CONFIRMED, turnId: TURN }) }));

    expect(unwrap(readRelayReceipts({ home, limit: 10 }))[0]!.delivery).toBe(null);
    expect(unwrap(readRelayTurns({ home, keep: { limit: 10 } })).map((turn) => turn.delivery)).toEqual([FAILED]);
  });

  it("keeps only relays registered at or after the floor", () => {
    registerOne({ nowIso: "2026-09-22T10:00:00.000Z", turnId: TURN });
    registerOne({ nowIso: "2026-09-23T10:00:00.000Z", turnId: OTHER_TURN });

    const kept = unwrap(readRelayTurns({ home, keep: { sinceIso: "2026-09-23T10:00:00.000Z" } }));

    expect(kept.map((turn) => turn.turnId)).toEqual([OTHER_TURN]);
  });

  it("is empty on an install that has never relayed", () => {
    expect(unwrap(readRelayTurns({ home, keep: { sinceIso: STAGED } }))).toEqual([]);
  });

  it("fails rather than show a relay with no delivery when its turn file is gone", () => {
    registerOne({ nowIso: CONFIRMED, turnId: TURN });
    unlinkSync(join(home, "talk", "turns", `${TURN}.json`));

    expect(unwrapErr(readRelayTurns({ home, keep: { limit: 10 } })).code).toBe("PATH_UNREADABLE");
  });

  it("hands the sweep a failed relay no board row carries, and clears it on a mark naming its talk: anchor", () => {
    const record = registerOne({ nowIso: CONFIRMED, turnId: TURN });
    unwrap(markDelivered({ delivery: FAILED, home, record }));

    const unmarked = readVoiceRelayIntake({ ...EMPTY_BOARD, nowIso: CEILING, home, marks: [], sinceIso: STAGED });
    const mark = {
      byClaudeSessionId: "s",
      kind: "answered",
      markedAtIso: CONFIRMED,
      pointer: record.anchor,
      witness: "w",
    } as const;
    const marked = readVoiceRelayIntake({ ...EMPTY_BOARD, nowIso: CEILING, home, marks: [mark], sinceIso: STAGED });

    expect(unmarked).toEqual({
      kind: "read",
      relays: [
        {
          about: "",
          anchor: record.anchor,
          delivery: FAILED,
          heard: "",
          registeredAtIso: CONFIRMED,
          rowPresent: false,
          slug: record.slug,
        },
      ],
    });
    expect(marked).toEqual({ kind: "read", relays: [] });
  });

  it("clears a relay whose settled row was already moved into the archive, with nothing live left for it", () => {
    const record = registerOne({ nowIso: CONFIRMED, turnId: TURN });
    unwrap(markDelivered({ delivery: FAILED, home, record }));
    const settled = parseHandoverDoc({
      path: `/h/archive/${record.slug}.md`,
      text: `---\nslug: ${record.slug}\nanchor: ${record.anchor}\nstatus: ready\nsettlement: answered\nsettlementWitness: https://example.test/p1\n---\n`,
    });
    const archivedDoc = ({ slug }: { slug: string }): HandoverDoc | undefined =>
      slug === record.slug ? settled : undefined;

    expect(
      readVoiceRelayIntake({ ...EMPTY_BOARD, nowIso: CEILING, archivedDoc, home, marks: [], sinceIso: STAGED }),
    ).toEqual({
      kind: "read",
      relays: [],
    });
  });

  it("reports the sweep's read as unavailable, never as zero relays, when a turn file will not read", () => {
    registerOne({ nowIso: CONFIRMED, turnId: TURN });
    writeFileSync(join(home, "talk", "turns", `${TURN}.json`), "{ not json");

    expect(readVoiceRelayIntake({ ...EMPTY_BOARD, nowIso: CEILING, home, marks: [], sinceIso: STAGED }).kind).toBe(
      "unavailable",
    );
  });

  it("sweeps a registered turn whose receipt a crash never appended", () => {
    registerOne({ nowIso: CONFIRMED, turnId: TURN });
    writeFileSync(join(home, "talk", "relays.jsonl"), "");

    expect(unwrap(readRelayTurns({ home, keep: { limit: 10 } }))).toEqual([]);
    expect(unwrap(readRelayTurns({ home, keep: { sinceIso: STAGED } })).map((turn) => turn.turnId)).toEqual([TURN]);
  });

  it("still sweeps a turn file whose name was written in capitals", () => {
    const record = registerOne({ nowIso: CONFIRMED, turnId: TURN });
    const turns = join(home, "talk", "turns");
    renameSync(join(turns, `${TURN}.json`), join(turns, `${TURN.toUpperCase()}.json`));

    expect(readVoiceRelayIntake({ ...EMPTY_BOARD, nowIso: CEILING, home, marks: [], sinceIso: STAGED })).toEqual({
      kind: "read",
      relays: [
        {
          about: "",
          anchor: record.anchor,
          delivery: record.delivery,
          heard: "",
          registeredAtIso: CONFIRMED,
          rowPresent: false,
          slug: record.slug,
        },
      ],
    });
  });

  it("reads no turn from a capitalised extension, which it could not reopen", () => {
    registerOne({ nowIso: CONFIRMED, turnId: TURN });
    const turns = join(home, "talk", "turns");
    renameSync(join(turns, `${TURN}.json`), join(turns, `${TURN}.JSON`));

    expect(readVoiceRelayIntake({ ...EMPTY_BOARD, nowIso: CEILING, home, marks: [], sinceIso: STAGED })).toEqual({
      kind: "read",
      relays: [],
    });
  });

  it("fails the sweep on a turn-named entry that is not a regular file, rather than reading it", () => {
    registerOne({ nowIso: CONFIRMED, turnId: TURN });
    mkdirSync(join(home, "talk", "turns", "00000000-0000-4000-8000-000000000000.json"));

    expect(unwrapErr(readRelayTurns({ home, keep: { sinceIso: STAGED } })).message).toContain("not a regular file");
  });

  it("leaves a turn that never reached the board out of the sweep", () => {
    unwrap(claimTurn({ draft: draftOf({ say: "land the tab" }), home, nowIso: STAGED }));

    expect(unwrap(readRelayTurns({ home, keep: { sinceIso: STAGED } }))).toEqual([]);
  });
});

describe("the turn a run carries forward", () => {
  // A replay named the stored record's picture path, which an edit between runs could point anywhere.
  it("names the draft's picture, never the path the stored record was edited to", () => {
    const picture = {
      bytes: 40,
      kind: "attached",
      path: join(home, "talk", "turns", `${TURN}.webp`),
      sha256: "ab",
    } as const;
    const draft = unwrap(
      formRelayDraft({
        about: "",
        heard: "",
        picture,
        readsAfter: [],
        say: "look",
        turnId: TURN,
        typed: false,
        wordsAlone: false,
      }),
    );
    const claimed = unwrap(claimTurn({ draft, home, nowIso: STAGED }));
    const edited = { ...claimed.record, picture: { ...picture, path: "/tmp/bad.webp" } };
    expect(withDraftPicture({ draft, record: edited }).picture).toEqual(picture);
  });

  describe("the copy-tray offer a relay carries", () => {
    const OFFER = { belowFold: "```\nrest\n```", id: "offer-4", label: "reply", made: "4", text: "  Merged  " };
    const offeredDraft = ({ offered }: { offered: typeof OFFER | undefined }) =>
      unwrap(
        formRelayDraft({
          about: "",
          heard: "yeah send that",
          offered,
          picture: { kind: "none", reason: "screen-not-shared" },
          readsAfter: [],
          say: "approved it",
          turnId: TURN,
          typed: false,
          wordsAlone: false,
        }),
      );

    it("keeps every byte of the offer on the turn file and the receipt", () => {
      const claimed = unwrap(claimTurn({ draft: offeredDraft({ offered: OFFER }), home, nowIso: STAGED }));
      unwrap(markRegistered({ home, nowIso: CONFIRMED, record: claimed.record }));
      expect(unwrap(readTurn({ home, turnId: TURN })).offered).toStrictEqual(OFFER);
      expect(unwrap(readRelayReceipts({ home, limit: 1 }))[0]!.offered).toStrictEqual(OFFER);
    });

    it("refuses a retry of the turn carrying another offer, or none, as a conflict", () => {
      unwrap(claimTurn({ draft: offeredDraft({ offered: OFFER }), home, nowIso: STAGED }));
      const changed = offeredDraft({ offered: { ...OFFER, text: "  Merged! " } });
      const missing = offeredDraft({ offered: undefined });
      expect([
        unwrapErr(claimTurn({ draft: changed, home, nowIso: CONFIRMED })).code,
        unwrapErr(claimTurn({ draft: missing, home, nowIso: CONFIRMED })).code,
        unwrap(claimTurn({ draft: offeredDraft({ offered: OFFER }), home, nowIso: CONFIRMED })).outcome,
      ]).toEqual(["RELAY_CONFLICT", "RELAY_CONFLICT", "resume"]);
    });

    it("reads a turn written before relays carried an offer as carrying none", () => {
      const claimed = unwrap(claimTurn({ draft: draftOf({ say: "look" }), home, nowIso: STAGED }));
      const raw = readFileSync(join(stateHomePaths({ home }).talkTurns, `${TURN}.json`), "utf8");
      expect(raw).not.toContain("offered");
      expect(unwrap(readTurn({ home, turnId: TURN })).offered).toBe(undefined);
      expect(claimed.record.offered).toBe(undefined);
    });

    it("refuses a turn file whose offer is there and malformed, rather than reading it as carrying none", () => {
      const claimed = unwrap(claimTurn({ draft: offeredDraft({ offered: OFFER }), home, nowIso: STAGED }));
      const path = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
      writeFileSync(path, `${JSON.stringify({ ...claimed.record, offered: { ...OFFER, id: "offer-5" } })}\n`);
      expect(unwrapErr(readTurn({ home, turnId: TURN })).code).toBe("PATH_UNREADABLE");
    });

    it("names the draft's offer, never the one the stored record was edited to", () => {
      const draft = offeredDraft({ offered: OFFER });
      const claimed = unwrap(claimTurn({ draft, home, nowIso: STAGED }));
      const edited = { ...claimed.record, offered: { ...OFFER, text: "something else" } };
      expect(withDraftPicture({ draft, record: edited }).offered).toStrictEqual(OFFER);
    });
  });

  it("marks a turn registering and puts it back to intended, and both read back", () => {
    const claimed = unwrap(claimTurn({ draft: draftOf({ say: "look" }), home, nowIso: STAGED }));
    unwrap(setTurnRegistering({ home, record: claimed.record, registering: true }));
    const marked = unwrap(readTurn({ home, turnId: TURN })).state;
    unwrap(setTurnRegistering({ home, record: claimed.record, registering: false }));
    expect([marked, unwrap(readTurn({ home, turnId: TURN })).state]).toEqual(["registering", "intended"]);
  });
});

describe("relayRowEvidence", () => {
  /** A board doc carrying one slug and one anchor. */
  const doc = ({ slug, anchor }: { slug: string; anchor: string }) =>
    parseHandoverDoc({ path: `/h/${anchor}.md`, text: `---\nslug: ${slug}\nanchor: ${anchor}\nstatus: ready\n---\n` });
  const OWN = "talk:a0000017-0000-4000-8000-000000000019";
  const OTHER = "talk:a0000043-0000-4000-8000-000000000046";
  const journals = new Map([
    [
      "talk-a00000170000",
      {
        events: [{ atIso: "2026-09-24T11:05:00.000Z", by: "chair", kind: "dispatched" as const, target: "ws-7" }],
        unreadableLines: [],
      },
    ],
  ]);

  it("lends a slug's journal to the one doc carrying that slug", () => {
    const rows = relayRowEvidence({
      archived: [],
      docs: [doc({ anchor: OWN, slug: "talk-a00000170000" })],
      journals,
    });

    expect(rows.map((row) => row.events.length)).toEqual([1]);
  });

  it("lends a shared slug's journal to neither doc, since it cannot say whose action it holds", () => {
    const docs = [doc({ anchor: OWN, slug: "talk-a00000170000" }), doc({ anchor: OTHER, slug: "talk-a00000170000" })];

    expect(relayRowEvidence({ archived: [], docs, journals }).map((row) => row.events.length)).toEqual([0, 0]);
  });

  it("lends it to neither when an ARCHIVED doc carries the same slug, which the board scan never reads", () => {
    const docs = [doc({ anchor: OWN, slug: "talk-a00000170000" })];
    const archived = [doc({ anchor: OTHER, slug: "talk-a00000170000" })];

    expect(relayRowEvidence({ archived, docs, journals }).map((row) => row.events.length)).toEqual([0, 0]);
  });

  it("carries a settled archived row with the relay's own anchor as a settled witness", () => {
    const docs = [doc({ anchor: OWN, slug: "talk-a00000170000" })];
    const settled = parseHandoverDoc({
      path: "/h/archive/talk-a00000170000.md",
      text: `---\nslug: talk-a00000170000\nanchor: ${OWN}\nstatus: ready\nsettlement: answered\nsettlementWitness: https://example.test/p1\n---\n`,
    });

    expect(relayRowEvidence({ archived: [settled], docs, journals }).map((row) => [row.anchor, row.settled])).toEqual([
      [OWN, false],
      [OWN, true],
    ]);
  });
});
