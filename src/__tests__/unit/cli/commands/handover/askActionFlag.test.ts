import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { actionFlag, askActionFlagErrorLines } from "../../../../../cli/commands/handover/askActionFlag.js";
import type { ParsedFlags } from "../../../../../cli/parseFlags.js";
import type { AskAction } from "../../../../../handover/askAction.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const COMMAND = "slopweaver handover ask";

/** A well-formed action, as a session would author one. */
const WHOLE: AskAction = {
  actor: "me",
  body: "<@U01ARI> the E2E switch-over is ready for review.",
  destinations: [
    {
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees we are asking",
    },
  ],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

/** The document as a caller would type or pipe it. */
const DOCUMENT = JSON.stringify(WHOLE);

/** One invocation's flags. */
const flags = ({ action }: { action?: string } = {}): ParsedFlags => ({
  positionals: [],
  values: action === undefined ? {} : { action },
});

/** A stdin seam that refuses to be read, so a case proves the spelling never reached for it. */
const NO_STDIN = (): string => {
  throw new Error("stdin was read when the spelling did not name it");
};

/** The lines a refusal prints, throwing when it did not refuse. */
function refusal({ result }: { result: ReturnType<typeof actionFlag> }): readonly string[] {
  return askActionFlagErrorLines({ command: COMMAND, error: unwrapErr(result) });
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A file holding one text, inside a throwaway directory this file removes. */
function fileHolding({ text }: { text: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "askaction-"));
  dirs.push(dir);
  const path = join(dir, "action.json");
  writeFileSync(path, text, "utf8");
  return path;
}

describe("actionFlag", () => {
  it("reads no action at all as an ordinary unoffered ask, not a failure", () => {
    expect(unwrap(actionFlag({ command: COMMAND, parsed: flags(), stdin: NO_STDIN }))).toBeUndefined();
  });

  it("reads the document spelled inline", () => {
    expect(unwrap(actionFlag({ command: COMMAND, parsed: flags({ action: DOCUMENT }), stdin: NO_STDIN }))).toEqual(
      WHOLE,
    );
  });

  it("reads the document from stdin on `-`", () => {
    const read = actionFlag({ command: COMMAND, parsed: flags({ action: "-" }), stdin: () => DOCUMENT });
    expect(unwrap(read)).toEqual(WHOLE);
  });

  it("reads the document from a path", () => {
    const path = fileHolding({ text: DOCUMENT });
    expect(unwrap(actionFlag({ command: COMMAND, parsed: flags({ action: path }), stdin: NO_STDIN }))).toEqual(WHOLE);
  });

  it("refuses a path that is not there, and says nothing was recorded", () => {
    const lines = refusal({
      result: actionFlag({ command: COMMAND, parsed: flags({ action: "/nope/action.json" }), stdin: NO_STDIN }),
    });
    expect(lines[0]).toContain("--action named a file it could not read");
    expect(lines[lines.length - 1]).toBe(
      "NOTHING was recorded and the run is not paused, so fix the action and run the same command again.",
    );
  });

  it("refuses a document that is not JSON", () => {
    const result = actionFlag({ command: COMMAND, parsed: flags({ action: "{not json" }), stdin: NO_STDIN });
    expect(unwrapErr(result).code).toBe("NOT_JSON");
    const lines = refusal({ result });
    expect(lines[0]).toContain("--action is not JSON");
    expect(lines).toHaveLength(2);
  });

  it("refuses an action that parses but breaks its own rules, naming which", () => {
    const broken = JSON.stringify({ ...WHOLE, destinations: [] });
    const lines = refusal({
      result: actionFlag({ command: COMMAND, parsed: flags({ action: broken }), stdin: NO_STDIN }),
    });
    expect(lines[0]).toBe(
      `${COMMAND} blocked because the action does not read: ` +
        "the action offers nowhere to send it — a draft with no destination is not a decision.",
    );
  });

  it("refuses a document that reads as no action at all", () => {
    const lines = refusal({
      result: actionFlag({ command: COMMAND, parsed: flags({ action: "-" }), stdin: () => "null" }),
    });
    expect(lines[0]).toBe(`${COMMAND} blocked because --action carried no action at all — it read as empty.`);
  });
});
