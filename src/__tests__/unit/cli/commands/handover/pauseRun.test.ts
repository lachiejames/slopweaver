import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runHandoverPause, runHandoverUnpause } from "../../../../../cli/commands/handover/pauseRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { pausedStateOf } from "../../../../../handover/paused.js";

/**
 * The real verbs against a real board in a throwaway home — the round trip a unit test over the pure layer
 * cannot make, because the defect this feature closes was a doc that PARSED and meant the wrong thing.
 */
describe("handover pause / unpause against a real temp board", () => {
  const homes: string[] = [];
  afterEach(() => {
    while (homes.length > 0) {
      rmSync(homes.pop()!, { force: true, recursive: true });
    }
  });

  function board({ status = "in-progress", extra = "" }: { status?: string; extra?: string } = {}): {
    home: string;
    path: string;
  } {
    const home = mkdtempSync(join(tmpdir(), "handover-pause-home-"));
    homes.push(home);
    const dir = join(home, "handovers");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "a-daily-post.md");
    writeFileSync(
      path,
      [
        "---",
        "slug: a-daily-post",
        "kind: doc",
        "summary: a daily reconciliation post",
        `status: ${status}`,
        "artifact: null",
        "repo: /repo",
        extra,
        "---",
        "",
        "# body",
        "",
      ]
        .filter((line) => line.length > 0 || line === "")
        .join("\n"),
      "utf8",
    );
    return { home, path };
  }

  const argv = ({ home, verb, rest }: { home: string; verb: string; rest: readonly string[] }): readonly string[] => [
    "node",
    "slopweaver",
    "handover",
    verb,
    ...rest,
    "--home",
    home,
  ];

  const read = ({ path }: { path: string }) => parseHandoverDoc({ path, text: readFileSync(path, "utf8") });

  it("writes all three facts, so the board reads a well-formed pause", async () => {
    const { home, path } = board();
    const code = await runHandoverPause(
      argv({
        home,
        rest: ["a-daily-post", "--on", "the reviewer it was sent to", "--since", "2026-09-04T02:00:00.000Z"],
        verb: "pause",
      }),
    );

    expect(code).toBe(EXIT_OK);
    const doc = read({ path });
    expect(doc.problems).toEqual([]);
    expect(doc.status).toBe("paused");
    expect(pausedStateOf({ doc })!.who).toBe("the reviewer it was sent to");
    expect(doc.pausedSince).toBe("2026-09-04T02:00:00.000Z");
  });

  it("writes --why into statusSummary so the row says what is being waited for", async () => {
    const { home, path } = board();
    await runHandoverPause(
      argv({ home, rest: ["a-daily-post", "--on", "a reviewer", "--why", "sample sent, no reply"], verb: "pause" }),
    );

    expect(read({ path }).statusSummary).toBe("sample sent, no reply");
  });

  /** `paused` with nobody named is the parking this state exists to replace. */
  it("refuses a pause with no --on", async () => {
    const { home, path } = board();
    expect(await runHandoverPause(argv({ home, rest: ["a-daily-post"], verb: "pause" }))).toBe(EXIT_USAGE);
    expect(read({ path }).status).toBe("in-progress");
  });

  it("refuses a --since that is not an instant", async () => {
    const { home, path } = board();
    const code = await runHandoverPause(
      argv({ home, rest: ["a-daily-post", "--on", "a reviewer", "--since", "last tuesday"], verb: "pause" }),
    );

    expect(code).toBe(EXIT_USAGE);
    expect(read({ path }).status).toBe("in-progress");
  });

  /** The flat front-matter reader is line-based, so a newline would silently become a new key. */
  it("refuses a line break inside a value rather than corrupting the front-matter", async () => {
    const { home, path } = board();
    const code = await runHandoverPause(
      argv({ home, rest: ["a-daily-post", "--on", "a reviewer\nstatus: done"], verb: "pause" }),
    );

    expect(code).toBe(EXIT_USAGE);
    expect(read({ path }).status).toBe("in-progress");
  });

  it("refuses a second pause on a row already paused", async () => {
    const { home } = board();
    const rest = ["a-daily-post", "--on", "a reviewer"];
    expect(await runHandoverPause(argv({ home, rest, verb: "pause" }))).toBe(EXIT_OK);
    expect(await runHandoverPause(argv({ home, rest, verb: "pause" }))).toBe(EXIT_ERROR);
  });

  /** Cancelled work is not waiting on anybody, and a pause must not quietly revive it. */
  it("refuses to pause a terminal row", async () => {
    const { home, path } = board({ status: "cancelled" });
    const code = await runHandoverPause(argv({ home, rest: ["a-daily-post", "--on", "a reviewer"], verb: "pause" }));

    expect(code).toBe(EXIT_ERROR);
    expect(read({ path }).status).toBe("cancelled");
  });

  it("refuses a slug no row on the board claims", async () => {
    const { home } = board();
    const code = await runHandoverPause(argv({ home, rest: ["not-a-row", "--on", "a reviewer"], verb: "pause" }));

    expect(code).toBe(EXIT_ERROR);
  });

  it("unpauses back to ready, clearing both pause fields", async () => {
    const { home, path } = board();
    await runHandoverPause(argv({ home, rest: ["a-daily-post", "--on", "a reviewer"], verb: "pause" }));
    const code = await runHandoverUnpause(argv({ home, rest: ["a-daily-post"], verb: "unpause" }));

    expect(code).toBe(EXIT_OK);
    const doc = read({ path });
    expect(doc.problems).toEqual([]);
    expect(doc.status).toBe("ready");
    expect(doc.pausedOn).toBe(undefined);
    expect(doc.pausedSince).toBe(undefined);
  });

  it("unpauses into in-progress when a session is still inside the work", async () => {
    const { home, path } = board();
    await runHandoverPause(argv({ home, rest: ["a-daily-post", "--on", "a reviewer"], verb: "pause" }));
    await runHandoverUnpause(argv({ home, rest: ["a-daily-post", "--status", "in-progress"], verb: "unpause" }));

    expect(read({ path }).status).toBe("in-progress");
  });

  it("refuses an unpause target status outside the two live ones", async () => {
    const { home, path } = board();
    await runHandoverPause(argv({ home, rest: ["a-daily-post", "--on", "a reviewer"], verb: "pause" }));
    const code = await runHandoverUnpause(argv({ home, rest: ["a-daily-post", "--status", "done"], verb: "unpause" }));

    expect(code).toBe(EXIT_USAGE);
    expect(read({ path }).status).toBe("paused");
  });

  it("refuses to unpause a row that is not paused", async () => {
    const { home } = board();
    expect(await runHandoverUnpause(argv({ home, rest: ["a-daily-post"], verb: "unpause" }))).toBe(EXIT_ERROR);
  });
});
