/*
 * Putting a relay's copy-tray offer on its row: written once under the row lock, a second call finding it already
 * there, and a row that is not this turn's, carries another offer or has no closing section refused with nothing
 * written. Real row files in a per-test board directory.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { attachRelayOffer } from "../../../../../cli/commands/talk/relayOfferAttach.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { RelayOffer } from "../../../../../talk/relayOffer.js";
import { relayOfferSection } from "../../../../../talk/relayOfferRow.js";

const ANCHOR = "talk:a0000017-0000-4000-8000-000000000019";

const OFFER: RelayOffer = {
  belowFold: "```\nthe rest\n```",
  id: "offer-4",
  label: undefined,
  made: "4",
  text: "Merged, thanks",
};

const rowOf = ({ anchor }: { anchor: string }): string =>
  [
    "---",
    "slug: talk-a00000170000",
    `anchor: ${anchor}`,
    "---",
    "",
    "# yeah send that",
    "",
    "## How this ends",
    "",
    "settle it.",
    "",
  ].join("\n");

let board: string;
let path: string;

beforeEach(() => {
  board = mkdtempSync(join(tmpdir(), "relay-offer-attach-"));
  path = join(board, "talk-a00000170000.md");
});

afterEach(() => {
  rmSync(board, { force: true, recursive: true });
});

describe("attachRelayOffer", () => {
  it("writes the section once, and a second call finds it there and writes nothing", () => {
    writeFileSync(path, rowOf({ anchor: ANCHOR }));
    expect(unwrap(attachRelayOffer({ anchor: ANCHOR, offered: OFFER, path }))).toBe("written");
    const once = readFileSync(path, "utf8");
    expect(unwrap(attachRelayOffer({ anchor: ANCHOR, offered: OFFER, path }))).toBe("present");
    expect(readFileSync(path, "utf8")).toBe(once);
    expect(once).toBe(
      rowOf({ anchor: ANCHOR }).replace(
        "## How this ends",
        `${relayOfferSection({ anchor: ANCHOR, offered: OFFER })}\n## How this ends`,
      ),
    );
  });

  it("refuses a different offer on a row that already carries one, leaving the row as it was", () => {
    writeFileSync(path, rowOf({ anchor: ANCHOR }));
    unwrap(attachRelayOffer({ anchor: ANCHOR, offered: OFFER, path }));
    const before = readFileSync(path, "utf8");
    const failure = unwrapErr(attachRelayOffer({ anchor: ANCHOR, offered: { ...OFFER, text: "Merged!" }, path }));
    expect(failure.code).toBe("OFFER_CONFLICT");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("refuses a row whose front matter names another turn, and one with no closing section", () => {
    writeFileSync(path, rowOf({ anchor: "talk:a0000043-0000-4000-8000-000000000046" }));
    expect(unwrapErr(attachRelayOffer({ anchor: ANCHOR, offered: OFFER, path })).code).toBe("ROW_NOT_THIS_TURN");
    const bare = `---\nslug: talk-a00000170000\nanchor: ${ANCHOR}\n---\n\n# yeah send that\n`;
    writeFileSync(path, bare);
    expect(unwrapErr(attachRelayOffer({ anchor: ANCHOR, offered: OFFER, path })).code).toBe("ROW_SHAPE_UNKNOWN");
    expect(readFileSync(path, "utf8")).toBe(bare);
  });

  it("refuses a row that is not there", () => {
    expect(unwrapErr(attachRelayOffer({ anchor: ANCHOR, offered: OFFER, path })).code).toBe("ROW_UNREADABLE");
  });
});
