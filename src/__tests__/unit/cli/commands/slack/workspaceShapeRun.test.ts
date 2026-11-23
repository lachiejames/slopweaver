/**
 * The `--markdown <file|->` read the workspace-shape verbs share: a file's bytes come back exactly, and a
 * path that cannot be read is a MARKDOWN_UNREADABLE rejection naming the path and the io reason, never an
 * empty document that would mint a blank canvas. The stdin branch is not driven here, because a unit test
 * reads no real stdin.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SlackReadErrors } from "../../../../../cli/commands/slack/readErrors.js";
import { readMarkdownSource } from "../../../../../cli/commands/slack/workspaceShapeRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "workspace-shape-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("readMarkdownSource", () => {
  it("reads a file's bytes back exactly, an empty-looking line and trailing newline included", async () => {
    const path = join(dir, "canvas.md");
    writeFileSync(path, "# Plan\n\n- one\n- two\n", "utf8");

    expect(unwrap(await readMarkdownSource({ source: path, stdinSentinel: "-" }))).toBe("# Plan\n\n- one\n- two\n");
  });

  it("is MARKDOWN_UNREADABLE naming the path and the io reason for a path that does not exist", async () => {
    const missing = join(dir, "missing.md");
    const reason = `ENOENT: no such file or directory, open '${missing}'`;

    const error = unwrapErr(await readMarkdownSource({ source: missing, stdinSentinel: "-" }));

    expect(error.code).toBe("MARKDOWN_UNREADABLE");
    expect(error.message).toBe(`cannot read --markdown ${JSON.stringify(missing)}: ${reason}`);
    expect(error).toEqual(SlackReadErrors.markdownUnreadable({ reason, source: missing }));
  });
});
