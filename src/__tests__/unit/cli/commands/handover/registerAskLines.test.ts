/**
 * Which registered asks keep their line breaks. A row heading the owner's card is flattened to one line, so the
 * card's heading and the alignment gate read the same text, and so is an ordinary dispatch row, whose summary heads
 * a steer on the Now page. Only `--dispatch --keep-lines` keeps them: `vulnfix topup` registers its batch one member
 * per line, which the merge-release gate reads back off `summary:`.
 * Flattened, recipe bumpfix-topup-acme-admin failed because the brief listed no batch lines at all.
 *
 * Per `testing.md`, every write goes to a `home` this file minted — never the ambient one.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerAskRow } from "../../../../../cli/commands/handover/askRowRun.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";

const BRIEF = [
  "Raise 1 general dependency-bump pull request(s).",
  "",
  "The batch:",
  "  - eslint — renovate #9875",
].join("\n");

describe("handover register's summary line breaks", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "register-lines-"));
    mkdirSync(join(home, "handovers"), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Register one row through the verb and read its `summary:` back the way the board does. */
  async function registeredSummary({ flags, slug }: { flags: readonly string[]; slug: string }): Promise<string> {
    const code = await registerAskRow({
      argv: ["node", "slopweaver", "handover", "register", "--ask", BRIEF, ...flags, "--slug", slug, "--home", home],
      origin: "automation",
      out: () => undefined,
    });
    expect(code).toBe(EXIT_OK);
    const path = join(home, "handovers", `${slug}.md`);
    return parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).summary!;
  }

  it("keeps a --keep-lines dispatch row's lines, read back as the real line breaks the top-up gate splits on", async () => {
    expect(await registeredSummary({ flags: ["--dispatch", "--keep-lines"], slug: "a-brief" })).toBe(
      "Raise 1 general dependency-bump pull request(s).\n\nThe batch:\n  - eslint — renovate #9875",
    );
  });

  // r1 review: a talk card-landing row is a dispatch too, and the Now page heads a steer with its summary.
  it("still flattens a dispatch row that did not ask to keep its lines", async () => {
    expect(await registeredSummary({ flags: ["--dispatch"], slug: "a-dispatch" })).toBe(
      "Raise 1 general dependency-bump pull request(s). The batch: - eslint — renovate #9875",
    );
  });

  it("still flattens a finding row, which can reach the owner's Queue", async () => {
    // `--observed-by` named, since its default is the session id in the environment and CI has none.
    const flags = ["--finding", "--evidence", "a log", "--observed-by", "session-1"];
    expect(await registeredSummary({ flags, slug: "a-finding" })).toBe(
      "Raise 1 general dependency-bump pull request(s). The batch: - eslint — renovate #9875",
    );
  });
});
