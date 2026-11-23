/*
 * Putting a relay turn's row on the board once: a row carrying the turn's anchor is adopted only when the turn
 * already reads `registering`, and a row at the turn's slug that this turn never registered is refused and left as
 * it was. Real row files in a per-test board directory and a per-test home.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureRow } from "../../../../../cli/commands/talk/relayEnsureRow.js";
import { unwrap } from "../../../../../lib/result.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn, setTurnRegistering } from "../../../../../talk/relayStore.js";

const TURN = "a0000015-0000-4000-8000-000000000016";
const STAGED = "2026-10-04T06:03:54.584Z";
const ARGS = { priority: "normal", workspace: undefined } as const;
const LANDS = { kind: "land" } as const;

let home = "";
let dir = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "relay-ensure-row-"));
  dir = join(home, "handovers");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A typed turn claimed in this test's home, with no offer so adopting a row needs no write to it. */
function claimedTurn() {
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard: "move the atlas to friday",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "",
      turnId: TURN,
      typed: true,
      wordsAlone: false,
    }),
  );
  const claim = unwrap(claimTurn({ draft, home, nowIso: STAGED }));
  return { draft, record: claim.record };
}

describe("ensureRow", () => {
  it("adopts a row carrying the turn's anchor when the turn reads registering", async () => {
    const { draft, record } = claimedTurn();
    const registering = unwrap(setTurnRegistering({ home, record, registering: true }));
    writeFileSync(join(dir, `${draft.slug}.md`), `---\nslug: ${draft.slug}\nanchor: ${draft.anchor}\n---\n`);
    const outcome = await ensureRow({
      args: ARGS,
      dir,
      disposition: LANDS,
      draft,
      home,
      lead: undefined,
      record: registering,
    });
    expect(outcome).toEqual(registering);
    expect(outcome!.state).toBe("registering");
  });

  it("refuses a row at the turn's slug when the turn never registered one, leaving the row as it was", async () => {
    const { draft, record } = claimedTurn();
    const stranger = "---\nslug: someone-elses\nanchor: talk:a0000043-0000-4000-8000-000000000046\n---\n";
    writeFileSync(join(dir, `${draft.slug}.md`), stranger);
    const outcome = await ensureRow({ args: ARGS, dir, disposition: LANDS, draft, home, lead: undefined, record });
    expect(outcome).toBeUndefined();
    expect(readFileSync(join(dir, `${draft.slug}.md`), "utf8")).toBe(stranger);
  });

  // A row carries the anchor on its `anchor:` line, never by quoting it somewhere in its text.
  it("refuses a stranger's row that only quotes the turn's anchor, even when the turn reads registering", async () => {
    const { draft, record } = claimedTurn();
    const registering = unwrap(setTurnRegistering({ home, record, registering: true }));
    const stranger = `---\nslug: ${draft.slug}\n---\n\nsee ${draft.anchor} for the earlier steer\n`;
    writeFileSync(join(dir, `${draft.slug}.md`), stranger);
    const outcome = await ensureRow({
      args: ARGS,
      dir,
      disposition: LANDS,
      draft,
      home,
      lead: undefined,
      record: registering,
    });
    expect(outcome).toBeUndefined();
    expect(readFileSync(join(dir, `${draft.slug}.md`), "utf8")).toBe(stranger);
  });

  it("refuses a row carrying the turn's anchor when the turn is still intended", async () => {
    const { draft, record } = claimedTurn();
    writeFileSync(join(dir, `${draft.slug}.md`), `---\nslug: ${draft.slug}\nanchor: ${draft.anchor}\n---\n`);
    expect(record.state).toBe("intended");
    expect(
      await ensureRow({ args: ARGS, dir, disposition: LANDS, draft, home, lead: undefined, record }),
    ).toBeUndefined();
  });
});
