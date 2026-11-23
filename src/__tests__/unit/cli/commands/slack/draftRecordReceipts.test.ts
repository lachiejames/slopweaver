/**
 * `draftRecordReceipts.ts` — the one effectful step a recording's receipts need. The register and the relay ledger
 * are read only for a `--self-evident` re-cut, so every other case passes fakes that throw, and a stray read fails it.
 * The refusals end to end are `./draftVerb/`'s.
 */
import { describe, expect, it } from "vitest";

import type { DraftRecordOptions } from "../../../../../cli/commands/slack/draftCore.js";
import { NOTHING_PARKED } from "../../../../../cli/commands/slack/draftMedia.js";
import { recordingReceipts } from "../../../../../cli/commands/slack/draftRecordReceipts.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { SlackDripMessagePayload } from "../../../../../outbound/slack/types.js";

const LINK = "https://github.com/acme/acme-admin/pull/18249";

const RECORD: DraftRecordOptions = {
  actor: "me",
  askedBefore: { kind: "none" },
  channel: "C0SYN000003",
  formSource: "{}",
  home: "/home",
  json: false,
  media: [],
  mode: "record",
  receipts: { kind: "undeclared" },
  supersedes: [],
  why: "a recording under test",
};

/** A message carrying `text`, as the recorder rendered it. */
function payload({ text }: { text: string }): SlackDripMessagePayload {
  return { form: "plain", text, unfurl_links: false, unfurl_media: false };
}

/** A read the case under test must never reach. */
function unreachable(): never {
  throw new Error("a recording read the register or the relay ledger without a --self-evident re-cut");
}

const NO_READS = { readLog: unreachable, readSteerReceipts: unreachable };

describe("recordingReceipts", () => {
  it("reads the link off the message itself, and reads nothing else", () => {
    const receipts = recordingReceipts({
      deps: NO_READS,
      options: RECORD,
      payload: payload({ text: `the PR: <${LINK}|#18249>` }),
    });

    expect(unwrap(receipts)).toEqual({ kind: "attached", links: [LINK], media: 0 });
  });

  it("takes a fresh --self-evident at its word without reading the relay ledger", () => {
    const receipts = recordingReceipts({
      deps: NO_READS,
      options: { ...RECORD, receipts: { kind: "self-evident", why: "a question, it claims nothing" } },
      payload: payload({ text: "which env does the staging pool run in?" }),
    });

    expect(unwrap(receipts)).toEqual({ kind: "self-evident", why: "a question, it claims nothing" });
  });

  it("refuses a claim with no receipt and says nothing was parked", () => {
    const receipts = recordingReceipts({
      deps: NO_READS,
      options: RECORD,
      payload: payload({ text: "the LangSmith bill went up this month" }),
    });

    expect(unwrapErr(receipts).at(-1)).toBe(NOTHING_PARKED);
  });

  it("refuses a --self-evident re-cut whose relay ledger did not read, naming why", () => {
    const receipts = recordingReceipts({
      deps: { readLog: unreachable, readSteerReceipts: () => err({ message: "steer-receipts.jsonl is not JSON" }) },
      options: {
        ...RECORD,
        receipts: { kind: "self-evident", why: "a question, it claims nothing" },
        supersedes: ["sd-b9230a1c"],
      },
      payload: payload({ text: "which env does the staging pool run in?" }),
    });

    expect(unwrapErr(receipts)).toEqual([
      "--self-evident on a re-cut needs the relay ledger, to see whether the owner sent an earlier cut back for its " +
        "receipts, and it did not read: steer-receipts.jsonl is not JSON",
      NOTHING_PARKED,
    ]);
  });

  it("refuses a --self-evident re-cut carrying a link for the link, never reading the relay ledger", () => {
    const receipts = recordingReceipts({
      deps: NO_READS,
      options: {
        ...RECORD,
        receipts: { kind: "self-evident", why: "obvious" },
        supersedes: ["sd-b9230a1c"],
      },
      payload: payload({ text: `the PR: <${LINK}|#18249>` }),
    });

    expect(unwrapErr(receipts)[0]).toBe(
      "--self-evident says no receipt is needed, and this card carries 1 link(s) and 0 file(s): it already brings " +
        "its receipts. Drop --self-evident.",
    );
  });

  it("refuses a --self-evident re-cut when a ledger line did not read, since its ruling may be the send-back", () => {
    const receipts = recordingReceipts({
      deps: { readLog: unreachable, readSteerReceipts: () => ok({ rows: [], undecoded: 1 }) },
      options: {
        ...RECORD,
        receipts: { kind: "self-evident", why: "a question, it claims nothing" },
        supersedes: ["sd-b9230a1c"],
      },
      payload: payload({ text: "which env does the staging pool run in?" }),
    });

    expect(unwrapErr(receipts)).toEqual([
      "--self-evident on a re-cut needs the relay ledger, to see whether the owner sent an earlier cut back for its " +
        "receipts, and it did not read: 1 of its line(s) are not receipts this build can read, and any of them may " +
        "be their ruling",
      NOTHING_PARKED,
    ]);
  });
});
