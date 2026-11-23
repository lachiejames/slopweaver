/**
 * `handover register --anchor talk:<id>` refuses an id that is a console CALL rather than a relay turn, before any
 * row exists — the row it would write could never be settled (`talk/relayAnchorCall.ts`).
 *
 * Per `testing.md`, every write goes to a `home` this file minted — never the ambient one.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerAskRow } from "../../../../../cli/commands/handover/askRowRun.js";
import { callAnchorRefusal } from "../../../../../cli/commands/handover/registerCallAnchor.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { callIndexPath } from "../../../../../talk/callStore.js";

const CALL = "7b8bdb47-ae28-4ec4-a01e-780b7a5458a8";
const OTHER = "a0000071-0000-4000-8000-000000000077";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "register-call-anchor-"));
  mkdirSync(join(home, "handovers"), { recursive: true });
  mkdirSync(dirname(callIndexPath({ home })), { recursive: true });
  writeFileSync(callIndexPath({ home }), `${CALL}\n`);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("callAnchorRefusal", () => {
  it("names the call anchors to use instead of talk: over a call id", () => {
    expect(unwrap(callAnchorRefusal({ anchor: `talk:${CALL}`, home }))).toBe(
      `--anchor talk:${CALL} names a console CALL, not a relay turn — \`talk:\` is a relay turn's anchor. Anchor ` +
        `the owner's words on the call as talk-call:${CALL}#<segmentId> (\`slopweaver talk unread\` prints them), or ` +
        `call:${CALL}#<segment> for a landed card`,
    );
  });

  it("lets every other anchor through: none, a talk-call stretch, or a talk: id no call carries", () => {
    expect([
      unwrap(callAnchorRefusal({ anchor: undefined, home })),
      unwrap(callAnchorRefusal({ anchor: `talk-call:${CALL}#turn_000000000000000000011`, home })),
      unwrap(callAnchorRefusal({ anchor: `talk:${OTHER}`, home })),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("handover register over a call id", () => {
  const register = ({ anchor }: { anchor: string }): Promise<number> =>
    registerAskRow({
      argv: [
        "node",
        "slopweaver",
        "handover",
        "register",
        "--ask",
        "build the email draft flow",
        "--dispatch",
        "--slug",
        "a-row",
        "--anchor",
        anchor,
        "--asked-iso",
        "2026-10-04T09:00:00.000Z",
        "--home",
        home,
      ],
      origin: "automation",
      out: () => {},
    });

  it("refuses talk:<callId> and writes no row", async () => {
    expect([await register({ anchor: `talk:${CALL}` }), existsSync(join(home, "handovers", "a-row.md"))]).toEqual([
      EXIT_USAGE,
      false,
    ]);
  });

  it("fails as an error, not a usage refusal, when the call index will not read — and writes no row", async () => {
    writeFileSync(callIndexPath({ home }), "not-a-call-id\n");
    expect([await register({ anchor: `talk:${OTHER}` }), existsSync(join(home, "handovers", "a-row.md"))]).toEqual([
      EXIT_ERROR,
      false,
    ]);
  });

  it("still registers a talk: id no call carries, so a relay registered before its turn file lands is untouched", async () => {
    expect([await register({ anchor: `talk:${OTHER}` }), existsSync(join(home, "handovers", "a-row.md"))]).toEqual([
      EXIT_OK,
      true,
    ]);
  });

  it("registers the same ask anchored on the call's own scheme", async () => {
    const anchor = `talk-call:${CALL}#turn_000000000000000000011`;
    expect([await register({ anchor }), existsSync(join(home, "handovers", "a-row.md"))]).toEqual([EXIT_OK, true]);
  });
});
