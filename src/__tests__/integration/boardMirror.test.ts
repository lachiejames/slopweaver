/**
 * The board mirror's witness: a file and its `board_row` made to DISAGREE, then converged by a real handover verb.
 *
 * Asserting `doc_hash` equals the file's hash proves nothing on its own — a row that was never touched equals
 * the file too, as long as the file never moved. So every case captures the row BEFORE a write, asserts the
 * write moved the file away from that row (the state a fleet would sit in with no mirror), and only then
 * asserts the row caught up with no `store import-fleet` in between.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres board_mirror_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/board_mirror_proof slopweaver store push
 *   BOARD_MIRROR_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/board_mirror_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/boardMirror.test.ts
 *
 * Every row it writes carries a per-run slug and is deleted afterwards.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runHandoverRegister } from "../../cli/commands/handover/askRowRun.js";
import { runHandoverLint } from "../../cli/commands/handover/lintRun.js";
import { runHandoverPause, runHandoverUnpause } from "../../cli/commands/handover/pauseRun.js";
import { runHandoverSettle } from "../../cli/commands/handover/settleRowRun.js";
import { EXIT_OK } from "../../cli/exitCodes.js";
import { docHash } from "../../handover/runStore.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { boardRowTable } from "../../store/schema/board.js";

const PROOF_URL = process.env["BOARD_MIRROR_PROOF_URL"];

describe.skipIf(PROOF_URL === undefined)("a handover write lands in board_row beside the file (live store)", () => {
  const run = randomUUID().slice(0, 8);
  const home = mkdtempSync(join(tmpdir(), "board-mirror-proof-"));
  const board = join(home, "handovers");
  let client: StoreClient;
  let savedUrl: string | undefined;

  beforeAll(() => {
    mkdirSync(board, { recursive: true });
    savedUrl = process.env[STORE_URL_ENV];
    process.env[STORE_URL_ENV] = PROOF_URL!;
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await client.db.delete(boardRowTable).where(like(boardRowTable.slug, `mirror-proof-${run}-%`));
    await client.close();
    if (savedUrl === undefined) {
      delete process.env[STORE_URL_ENV];
    } else {
      process.env[STORE_URL_ENV] = savedUrl;
    }
    rmSync(home, { force: true, recursive: true });
  });

  const verb = ({ noun, name, rest }: { noun: string; name: string; rest: readonly string[] }): readonly string[] => [
    "node",
    "slopweaver",
    noun,
    name,
    ...rest,
    "--home",
    home,
  ];

  const rowHash = async ({ slug }: { slug: string }): Promise<string | undefined> => {
    const rows = await client.db
      .select({ docHash: boardRowTable.docHash })
      .from(boardRowTable)
      .where(eq(boardRowTable.slug, slug));
    return rows[0]?.docHash;
  };

  const fileHash = ({ slug }: { slug: string }): string =>
    docHash({ text: readFileSync(join(board, `${slug}.md`), "utf8") });

  it("register, pause, unpause and settle each leave the row equal to the file they just moved", async () => {
    const slug = `mirror-proof-${run}-ask`;
    expect(
      await runHandoverRegister(
        verb({ name: "register", noun: "handover", rest: ["--ask", "a proof ask", "--slug", slug] }),
      ),
    ).toBe(EXIT_OK);
    expect(await rowHash({ slug })).toBe(fileHash({ slug }));

    const steps: readonly (() => Promise<number>)[] = [
      () => runHandoverPause(verb({ name: "pause", noun: "handover", rest: [slug, "--on", "a reviewer"] })),
      () => runHandoverUnpause(verb({ name: "unpause", noun: "handover", rest: [slug] })),
      () =>
        runHandoverSettle(
          verb({
            name: "settle",
            noun: "handover",
            rest: [slug, "--as", "answered", "--witness", "the proof", "--lessons", "none"],
          }),
        ),
    ];
    for (const step of steps) {
      const before = await rowHash({ slug });
      expect(await step()).toBe(EXIT_OK);
      expect(fileHash({ slug })).not.toBe(before);
      expect(await rowHash({ slug })).toBe(fileHash({ slug }));
    }
  });

  it("lint --fix mirrors a hand-written document it rewrote", async () => {
    const slug = `mirror-proof-${run}-lint`;
    writeFileSync(
      join(board, `${slug}.md`),
      [
        "---",
        `slug: ${slug}`,
        "kind: doc",
        "summary: a hand-written doc",
        "status: ready",
        "---",
        "",
        "# prose",
        "",
      ].join("\n"),
      "utf8",
    );
    expect(await rowHash({ slug })).toBe(undefined);

    expect(await runHandoverLint(verb({ name: "lint", noun: "handover", rest: ["--fix"] }))).toBe(EXIT_OK);

    expect(readFileSync(join(board, `${slug}.md`), "utf8")).toContain("artifact: null");
    expect(await rowHash({ slug })).toBe(fileHash({ slug }));
  });
});
