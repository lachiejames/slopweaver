import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SlackReadFileDeps } from "../../../../../cli/commands/slack/readFileRun.js";
import { runSlackReadFile } from "../../../../../cli/commands/slack/readFileRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";
import type { SlackFileReadDocument } from "../../../../../live/slack/readFile.js";
import { parseOwnJson } from "../../../../parseOwnJson.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A resolved document, as `readSlackFile` would return one for a measured huddle. */
function document(over: Partial<SlackFileReadDocument> = {}): SlackFileReadDocument {
  return {
    body: undefined,
    file: {
      channels: ["D0BB"],
      createdIso: "2026-08-28T02:56:15.000Z",
      fileAccess: "visible",
      filetype: "quip",
      huddleEndIso: "2026-08-28T02:55:03.000Z",
      huddleStartIso: "2026-08-28T02:28:34.000Z",
      huddleSummaryId: "As0BT6",
      huddleTranscript: undefined,
      huddleTranscriptFileId: "F0BT8F",
      id: "F0BTAC",
      isHuddleCanvas: true,
      mimetype: "application/vnd.slack-docs",
      mode: "quip",
      permalink: "https://example.slack.com/docs/T1/F0BTAC",
      size: 5565,
      title: "Huddle notes",
      urlPrivate: undefined,
      urlPrivateDownload: undefined,
      user: "UAAA",
    },
    readAtIso: "2026-08-28T12:00:00.000Z",
    residue: [],
    transcript: undefined,
    ...over,
  };
}

/**
 * The injected edges, with collectors for what the verb wrote and what it asked for.
 *
 * `tokens` is ONE object rather than two defaulted fields: a destructuring default fires on `undefined`, so
 * `harness({ userToken: undefined })` would have silently restored the user token it was written to remove.
 */
function harness({
  tokens = { user: "xoxp-user" },
  result = document(),
}: { tokens?: { user?: string; bot?: string }; result?: SlackFileReadDocument } = {}) {
  const out: string[] = [];
  const diag: string[] = [];
  const asked: { reference: string; followTranscript: boolean; token: string }[] = [];
  const deps: SlackReadFileDeps = {
    botToken: () => tokens.bot,
    filesRoot: () => {
      const dir = mkdtempSync(join(tmpdir(), "slopweaver-read-file-"));
      fixtureDirs.push(dir);
      return dir;
    },
    readFile: async ({ reference, followTranscript, token }) => {
      asked.push({ followTranscript, reference, token });
      return ok(result);
    },
    userToken: () => tokens.user,
    writeDiagnostic: (line) => {
      diag.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { asked, deps, diag, out };
}

describe("runSlackReadFile", () => {
  it("reads the file the caller named, following the transcript by default", async () => {
    const h = harness();
    expect(await runSlackReadFile({ deps: h.deps, rest: ["F0BTAC"] })).toBe(EXIT_OK);
    expect(h.asked).toEqual([{ followTranscript: true, reference: "F0BTAC", token: "xoxp-user" }]);
  });

  it("--no-transcript reads the notes alone", async () => {
    const h = harness();
    await runSlackReadFile({ deps: h.deps, rest: ["F0BTAC", "--no-transcript"] });
    expect(h.asked[0]!.followTranscript).toBe(false);
  });

  it("--json puts exactly one document on stdout, so a pipe to jq works", async () => {
    const h = harness();
    await runSlackReadFile({ deps: h.deps, rest: ["F0BTAC", "--json"] });
    expect(h.out).toHaveLength(1);
    const parsed = parseOwnJson<SlackFileReadDocument>({ text: h.out[0]! });
    expect(parsed.file.huddleTranscriptFileId).toBe("F0BT8F");
  });

  it("prints the huddle window and the transcript pointer in the text rendering", async () => {
    const h = harness();
    await runSlackReadFile({ deps: h.deps, rest: ["F0BTAC"] });
    expect(h.out[0]!).toContain("huddle started: 2026-08-28T02:28:34.000Z");
    expect(h.out[0]!).toContain("kind: huddle notes (canvas)");
  });

  it("says so out loud when the read fetched everything it set out to", async () => {
    const h = harness();
    await runSlackReadFile({ deps: h.deps, rest: ["F0BTAC"] });
    expect(h.out[0]!).toContain("Residue: none");
  });

  it("prints every residue line rather than presenting a partial read as a whole one", async () => {
    const h = harness({ result: document({ residue: ["F0BT8F.body: Slack served HTML rather than file bytes"] }) });
    await runSlackReadFile({ deps: h.deps, rest: ["F0BTAC"] });
    expect(h.out[0]!).toContain("Slack served HTML rather than file bytes");
  });

  it("refuses with a usage code when no reference is given", async () => {
    const h = harness();
    expect(await runSlackReadFile({ deps: h.deps, rest: [] })).toBe(EXIT_USAGE);
    expect(h.diag[0]!).toContain("file id or file link is required");
  });

  it("refuses two references rather than silently reading the first", async () => {
    const h = harness();
    expect(await runSlackReadFile({ deps: h.deps, rest: ["F0AAA1234", "F0BBB1234"] })).toBe(EXIT_USAGE);
    expect(h.diag[0]!).toContain("expected one file reference, got 2");
  });

  it("refuses when there is no token at all, naming the verb that configures one", async () => {
    const h = harness({ tokens: {} });
    expect(await runSlackReadFile({ deps: h.deps, rest: ["F0BTAC"] })).toBe(EXIT_ERROR);
    expect(h.diag[0]!).toContain("connect slack");
  });

  it("warns when it falls back to the bot token, whose file visibility is narrower", async () => {
    const h = harness({ tokens: { bot: "xoxb-bot" } });
    expect(await runSlackReadFile({ deps: h.deps, rest: ["F0BTAC"] })).toBe(EXIT_OK);
    expect(h.diag[0]!).toContain("using a bot token");
    expect(h.asked[0]!.token).toBe("xoxb-bot");
  });
});
