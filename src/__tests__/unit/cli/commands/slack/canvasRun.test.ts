/**
 * `slack canvas`'s SHELL, driven end to end through `runCanvasWithDeps` with plain fakes — no mocks, no
 * network. The clock is injected, so the duplicate window is exercised without waiting.
 *
 * The property only the shell can be asked is the one the live API forced into existence: a repeated
 * channel-canvas create mints a SECOND document, so a second identical run inside the duplicate window must
 * be REFUSED. That is a door decision plus a reservation, and neither is reachable from the pure core.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { canvasDoorRequest } from "../../../../../cli/commands/slack/canvasCore.js";
import { runCanvasWithDeps } from "../../../../../cli/commands/slack/canvasRun.js";
import type { CanvasDeps } from "../../../../../cli/commands/slack/canvasWiring.js";
import { SlackReadErrors } from "../../../../../cli/commands/slack/readErrors.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import type { ExactVoiceRule } from "../../../../../outbound/voice/exactRules.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

let home = "";
let bodyPath = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-canvas-run-"));
  bodyPath = join(home, "body.md");
  writeFileSync(bodyPath, "# Runbook\n\nA body.\n", "utf8");
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

interface Recorder {
  readonly calls: string[];
  readonly lines: string[];
}

function deps({
  body = "# Runbook\n",
  doorLedger = memoryDoorLedger().port,
  rec,
  createThrows,
  tokens = { bot: "xoxb-fake" },
  voiceRules = ok([]),
}: {
  body?: string;
  doorLedger?: DoorLedgerPort;
  rec: Recorder;
  createThrows?: string;
  tokens?: { bot: string | undefined };
  voiceRules?: ReturnType<CanvasDeps["voiceRules"]>;
}): CanvasDeps {
  return {
    botToken: () => tokens.bot,
    doorLedger,
    env: () => ({}),
    recordVoicePainPoints: ({ findings, lane }) => {
      for (const finding of findings) {
        rec.calls.push(`painPoint:${lane}:${finding.path}`);
      }
    },
    voiceRules: () => voiceRules,
    createCanvas: async ({ title }) => {
      rec.calls.push(`createCanvas:${title}`);
      if (createThrows !== undefined) {
        throw new Error(createThrows);
      }
      return "F0NEW";
    },
    createChannelCanvas: async ({ channel, title }) => {
      rec.calls.push(`createChannelCanvas:${channel}:${title}`);
      if (createThrows !== undefined) {
        throw new Error(createThrows);
      }
      return "F0CHAN";
    },
    deleteCanvas: async ({ canvasId }) => {
      rec.calls.push(`deleteCanvas:${canvasId}`);
      return true;
    },
    emit: (line) => rec.lines.push(line),
    nowIso: () => "2026-09-07T12:00:00.000Z",
    readMarkdown: async ({ source }) =>
      source === "missing.md"
        ? err(SlackReadErrors.markdownUnreadable({ reason: "cannot read it", source }))
        : ok(body),
    replaceCanvas: async ({ canvasId }) => {
      rec.calls.push(`replaceCanvas:${canvasId}`);
    },
    userToken: () => "xoxp-fake",
  };
}

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "slack", "canvas", ...tail, "--home", home];
}

describe("runCanvasWithDeps", () => {
  it("mints a STANDALONE canvas when no --channel is given", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["create", "--title", "Runbook", "--markdown", bodyPath] }),
      deps: deps({ rec }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["createCanvas:Runbook"]);
    expect(rec.lines[0]).toBe("created a standalone canvas: F0NEW");
  });

  it("mints a CHANNEL canvas and says both the disclosure and the duplicate risk out loud", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    await runCanvasWithDeps({
      argv: argv({ tail: ["create", "--title", "Runbook", "--markdown", bodyPath, "--channel", "C1"] }),
      deps: deps({ rec }),
    });

    expect(rec.lines).toContain("  everyone in C1 can read it now.");
    expect(rec.lines).toContain("  running this again would add a SECOND canvas there — rewrite this one instead.");
  });

  it("puts `duplicateKey` on the CREATE request, which is the only field the duplicate gate matches on", () => {
    // Asserted directly, because a gate that matches nothing is invisible from the outside: the create was
    // still refused by the reservation one layer in, so the two-layer design looked like it worked while
    // the outer layer was inert. This is the witness that it is wired.
    const request = canvasDoorRequest({
      actor: "bot",
      bodyLength: 12,
      duplicateKey: "slack-canvas-create:C1:Runbook",
      home,
      operation: "create",
      target: "C1",
    });

    expect(request.artifact["duplicateKey"]).toBe("slack-canvas-create:C1:Runbook");
  });

  it("carries NO duplicateKey on replace or delete, which have no duplicate to prevent", () => {
    const replace = canvasDoorRequest({
      actor: "bot",
      bodyLength: 12,
      duplicateKey: undefined,
      home,
      operation: "replace",
      target: "F0NEW",
    });

    expect(replace.artifact["duplicateKey"]).toBeUndefined();
  });

  it("REFUSES an identical second create inside the window — a repeat is a second real document", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const tail = ["create", "--title", "Runbook", "--markdown", bodyPath, "--channel", "C1"];

    expect(await runCanvasWithDeps({ argv: argv({ tail }), deps: deps({ rec }) })).toBe(EXIT_OK);
    // The SAME home, so the reservation the first run confirmed is what the second one meets.
    expect(await runCanvasWithDeps({ argv: argv({ tail }), deps: deps({ rec }) })).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual(["createChannelCanvas:C1:Runbook"]);
  });

  it("a DIFFERENT destination is not a duplicate, even with the same title", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const base = ["create", "--title", "Runbook", "--markdown", bodyPath];

    await runCanvasWithDeps({ argv: argv({ tail: [...base, "--channel", "C1"] }), deps: deps({ rec }) });
    const second = await runCanvasWithDeps({
      argv: argv({ tail: [...base, "--channel", "C2"] }),
      deps: deps({ rec }),
    });

    expect(second).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["createChannelCanvas:C1:Runbook", "createChannelCanvas:C2:Runbook"]);
  });

  it("an unreadable --markdown is a REJECTION, never a blank document", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["create", "--title", "Runbook", "--markdown", "missing.md"] }),
      deps: deps({ rec }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });

  it("a dry run creates nothing and takes no reservation, so the real run after it still works", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const tail = ["create", "--title", "Runbook", "--markdown", bodyPath];

    expect(await runCanvasWithDeps({ argv: argv({ tail: [...tail, "--dry-run"] }), deps: deps({ rec }) })).toBe(
      EXIT_OK,
    );
    expect(rec.calls).toEqual([]);
    expect(await runCanvasWithDeps({ argv: argv({ tail }), deps: deps({ rec }) })).toBe(EXIT_OK);
  });

  it("reports a create Slack refused, and creates nothing", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["create", "--title", "Runbook", "--markdown", bodyPath] }),
      deps: deps({ createThrows: "missing_scope", rec }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.lines).toEqual([]);
  });

  it("rewrites a whole canvas", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["replace", "--canvas", "F0NEW", "--markdown", bodyPath] }),
      deps: deps({ rec }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["replaceCanvas:F0NEW"]);
  });

  it("hands every canvas write the verb's --home, whose privacy policy judges it, never the ambient one", async () => {
    const written: string[] = [];
    const recording: CanvasDeps = {
      ...deps({ rec: { calls: [], lines: [] } }),
      createCanvas: async ({ home: at }) => {
        written.push(`create:${at}`);
        return "F0NEW";
      },
      deleteCanvas: async ({ home: at }) => {
        written.push(`delete:${at}`);
        return true;
      },
      replaceCanvas: async ({ home: at }) => {
        written.push(`replace:${at}`);
      },
    };
    await runCanvasWithDeps({
      argv: argv({ tail: ["create", "--title", "Runbook", "--markdown", bodyPath] }),
      deps: recording,
    });
    await runCanvasWithDeps({
      argv: argv({ tail: ["replace", "--canvas", "F0NEW", "--markdown", bodyPath] }),
      deps: recording,
    });
    await runCanvasWithDeps({ argv: argv({ tail: ["delete", "--canvas", "F0NEW"] }), deps: recording });

    expect(written).toEqual([`create:${home}`, `replace:${home}`, `delete:${home}`]);
  });

  it("deletes a canvas", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["delete", "--canvas", "F0NEW"] }),
      deps: deps({ rec }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["deleteCanvas:F0NEW"]);
  });

  it("refuses when the chosen lane has no token, and creates nothing", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["create", "--title", "Runbook", "--markdown", bodyPath] }),
      deps: deps({ rec, tokens: { bot: undefined } }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.calls).toEqual([]);
  });
});

describe("runCanvasWithDeps — the voice gate reaches the canvas lane", () => {
  // A canvas is the one outbound surface whose prose a reader opens LATER, and it went through the door
  // with no voice gate at all until this lane was wired: an unchecked document outlives an unchecked
  // message. The rule VALUE here is a test fixture, never the operator's own — those stay in `profile.json`.
  const BANNED: readonly ExactVoiceRule[] = [{ kind: "literal", value: "leverage" }];

  it("refuses a create whose TITLE breaks a rule, and records the pain point on the lane it ran on", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["create", "--title", "the leverage guide", "--markdown", bodyPath] }),
      deps: deps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual(["painPoint:as-bot:title"]);
    expect(rec.lines).toEqual([]);
  });

  it("admits the same create once the title is in voice, and records nothing", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["create", "--title", "On-call guide", "--markdown", bodyPath] }),
      deps: deps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["createCanvas:On-call guide"]);
  });

  it("judges a REPLACE by its new body — the one authored string a replace carries", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["replace", "--canvas", "F0OLD", "--markdown", bodyPath] }),
      // A multi-line body, so the finding names the LINE it was on — `authoredProseOf` indexes a walked
      // string by line exactly when there is more than one, which is what a rewriter needs to find it.
      deps: deps({ body: "# On call\n\nWe leverage the window.\n", rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual(["painPoint:as-bot:markdown.line[2]"]);
  });

  it("lets a DELETE through — it authors nothing, and says so rather than dropping the gate", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["delete", "--canvas", "F0OLD"] }),
      deps: deps({ rec, voiceRules: ok(BANNED) }),
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.calls).toEqual(["deleteCanvas:F0OLD"]);
  });

  it("stops a create and a replace on a CORRUPT profile before the door, rather than reading it as no rules", async () => {
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const rec: Recorder = { calls: [], lines: [] };
    const voiceRules = readExactVoiceRules({ home });
    const door = memoryDoorLedger();
    const created = await runCanvasWithDeps({
      argv: argv({ tail: ["create", "--title", "the leverage guide", "--markdown", bodyPath] }),
      deps: deps({ doorLedger: door.port, rec, voiceRules }),
    });
    const replaced = await runCanvasWithDeps({
      argv: argv({ tail: ["replace", "--canvas", "F0OLD", "--markdown", bodyPath] }),
      deps: deps({ doorLedger: door.port, rec, voiceRules }),
    });

    expect(voiceRules.isErr()).toBe(true);
    expect([created, replaced]).toEqual([EXIT_ERROR, EXIT_ERROR]);
    expect(rec.calls).toEqual([]);
    expect(door.records()).toEqual([]);
  });

  it("performs nothing and exits with the error code when the door record cannot be written", async () => {
    const rec: Recorder = { calls: [], lines: [] };
    const code = await runCanvasWithDeps({
      argv: argv({ tail: ["create", "--title", "On-call guide", "--markdown", bodyPath] }),
      deps: deps({ doorLedger: unreachableDoorLedger(), rec }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(rec.calls).toEqual([]);
  });
});
