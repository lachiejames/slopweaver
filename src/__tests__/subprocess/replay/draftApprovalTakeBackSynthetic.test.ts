/**
 * REPLAY LANE, SYNTHETIC — a yes on one triage card, taken back once the voice had opened the next. Fleet finding:
 * on one call the voice relayed the owner's ruling and opened the next triage card 1.1s later, so an
 * "oh wait, no" said after that was relayed about the NEXT card, and `slack draft approve` read only the yes's own relay.
 *
 * No turn of that shape was frozen, and `turn freeze` does not cut the draft register, so the stopped world is built
 * from the SHIPPED writers: the held row by `appendSlackDraftEvent`, both relay turns by `claimTurn`, and the call by
 * `appendCallEntries`, in the line shapes the page writes. Then the real `bin/slopweaver slack draft approve` runs
 * against it.
 *
 * **The falsifiable witness** is the refusal naming the later turn, its words and the card it was relayed over, and the
 * register gaining no approval. Its control is the same world without the take-back, where the same command records
 * the yes — so the refusal is the take-back's, never a world the verb could not read.
 */
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "#lib/result.js";

import { appendSlackDraftEvent, readSlackDraftLines } from "../../../admit/slackDraftStore.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../outbound/slack/draftRegister.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { appendCallEntries } from "../../../talk/callStore.js";
import { claimRelayTurn, openLine, relayLine, triageNextLine } from "../../takeBackCallFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const CALL = "a0000044-0000-4000-8000-0000000000aa";
const YES_TURN = "7c1d2e3f-0000-4000-8000-000000000001";
const TAKE_BACK_TURN = "7c1d2e3f-0000-4000-8000-000000000002";
const DRAFT_ID = "sd-0a4bc0b0";
const NEXT_CARD = "post:sd-0b4bc0b0";
const TAKE_BACK = "oh wait, no, not that one";

let scratch = "";
let home = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "slop-take-back-"));
  home = join(scratch, "home");
  mkdirSync(home);
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/** The held as-me row the owner's yes was about, top-level in a channel. */
function heldDraft(): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel: "CFIXTURETB",
    mentions: [],
    payload: { form: "plain" as const, text: "the pool is back to 40", unfurl_links: false, unfurl_media: false },
  };
  return {
    ...content,
    advisory: [],
    channelName: "eng-help",
    digest: parkedDraftDigest({ draft: content }),
    form: '{"sections":[{"kind":"prose","text":"the pool is back to 40"}]}',
    id: DRAFT_ID,
    shape: "top-level",
    tsIso: "2026-10-14T23:00:00.000Z",
    why: "the triage card the owner said yes to",
  };
}

/**
 * Park the row, claim the owner's yes on its card, and write the call up to the voice opening the next card.
 *
 * @param after the call's lines once the next card is up
 */
function stopTheWorld({ after }: { after: readonly CallEntry[] }): void {
  const draft = heldDraft();
  unwrap(appendSlackDraftEvent({ event: { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso }, home }));
  claimRelayTurn({
    about: `post:${DRAFT_ID}`,
    heard: "yes, send it",
    home,
    nowIso: "2026-10-14T23:38:49.280Z",
    triageRuling: { label: undefined, verdict: "send-it" },
    turnId: YES_TURN,
  });
  const entries: CallEntry[] = [
    openLine({ atIso: "2026-10-14T23:30:00.000Z" }),
    relayLine({
      about: `post:${DRAFT_ID}`,
      atIso: "2026-10-14T23:38:49.276Z",
      heard: "yes, send it",
      turnId: YES_TURN,
    }),
    triageNextLine({ atIso: "2026-10-14T23:38:50.391Z", card: NEXT_CARD, outcome: "opened" }),
    ...after,
  ];
  unwrap(appendCallEntries({ callId: CALL, entries, home }));
}

/** The shipped binary's `slack draft approve` of the row, on the owner's yes. */
function approve(): SpawnSyncReturns<string> {
  return spawnSync(BIN, ["slack", "draft", "approve", DRAFT_ID, "--anchor", `talk:${YES_TURN}`, "--home", home], {
    cwd: scratch,
    encoding: "utf8",
    env: { HOME: scratch, PATH: process.env["PATH"]! },
  });
}

/** The register's event kinds for the row, in order. */
function rowEvents(): readonly string[] {
  return parseSlackDraftLog({ lines: readSlackDraftLines({ home }) })
    .events.filter((event) => event.id === DRAFT_ID)
    .map((event) => event.kind);
}

describe("replay (synthetic): a yes on one triage card, taken back after the voice opened the next", () => {
  it("refuses the approval, naming the later turn, the owner's words and the card they were relayed over", () => {
    stopTheWorld({
      after: [
        relayLine({ about: NEXT_CARD, atIso: "2026-10-14T23:38:52.000Z", heard: TAKE_BACK, turnId: TAKE_BACK_TURN }),
      ],
    });
    claimRelayTurn({
      about: NEXT_CARD,
      heard: TAKE_BACK,
      home,
      nowIso: "2026-10-14T23:38:52.010Z",
      triageRuling: undefined,
      turnId: TAKE_BACK_TURN,
    });

    const refused = approve();
    expect([refused.status, refused.error]).toEqual([EXIT_USAGE, undefined]);
    expect(refused.stderr).toContain(
      `--anchor talk:${YES_TURN}: talk:${TAKE_BACK_TURN}, relayed one card later on the same call, said "${TAKE_BACK}" over ${NEXT_CARD}`,
    );
    expect(rowEvents()).toEqual(["parked"]);
  });

  it("records the same yes when nothing the owner said after it takes it back", () => {
    stopTheWorld({ after: [] });

    const approved = approve();
    expect([approved.status, approved.stderr]).toEqual([EXIT_OK, expect.any(String)]);
    expect(approved.stdout).toContain(`approved ${DRAFT_ID} at talk:${YES_TURN}: "yes, send it"`);
    expect(rowEvents()).toEqual(["parked", "approved"]);
  });
});
