/**
 * `handover settle --as answered` on a bare pull request URL, run for real through `settleAskRow` against a temp home
 * this file mints, with the live body read injected. The board sits OUTSIDE `home/handovers`, so the store mirror
 * stays out of it (`testing.md`). Every Datadog host in this file reads the synthetic `ap1` site rather than the
 * install's own.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PullBodyRead } from "../../../../../cli/commands/handover/proofWitnessGate.js";
import type { SettlePrecondition } from "../../../../../cli/commands/handover/settleResidueRun.js";
import { settleAskRow } from "../../../../../cli/commands/handover/settleRowRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { ok } from "../../../../../lib/result.js";

const SLUG = "acme-admin-17564-gets-before-and-after-proof";
const ANCHOR = "transcript:a0000032-0000-4000-8000-000000000035#0633bdef-34d9-48a7-92cf-8e02bd019433";
const PR = "https://github.com/acme/acme-admin/pull/17564";
const WORDS =
  "it needs before and after proof: screenshots, plus links to the CI runs in github, and it should carry links and screenshots from datadog CI, since that shows the test logs";

/** A body carrying a before and an after of each item the owner's words ask for. */
const FULL_BODY = [
  "https://github.com/acme/acme-admin/actions/runs/36080719230/job/107901830804",
  "https://github.com/acme/acme-admin/actions/runs/35822152721",
  "https://github.com/user-attachments/assets/a0000006-0000-4000-8000-000000000007",
  "https://github.com/user-attachments/assets/a0000008-0000-4000-8000-000000000009",
  "https://ap1.datadoghq.com/ci/pipeline-executions",
].join("\n");

let home = "";
let dir = "";
let path = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "proof-settle-"));
  dir = join(home, "board");
  mkdirSync(dir, { recursive: true });
  path = join(dir, `${SLUG}.md`);
  writeFileSync(
    path,
    [
      "---",
      `slug: ${SLUG}`,
      "kind: ask",
      'summary: "17564 gets before and after proof"',
      "status: ready",
      "askedIso: 2026-09-25T02:41:26Z",
      `anchor: ${ANCHOR}`,
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      `ownerWords: ${JSON.stringify(WORDS)}`,
      `ownerWordsAnchor: "${ANCHOR}"`,
      'ownerWordsIso: "2026-09-25T02:41:26.704Z"',
      "ownerWordsWhere: session",
      "ownerWordsCut: none",
      "---",
      "",
      "# 17564 gets before and after proof",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Settle the row, collecting the receipt and every address the body read was asked for. */
const settle = async ({ body, precondition }: { body: string; precondition?: SettlePrecondition }) => {
  const asked: string[] = [];
  const lines: string[] = [];
  const readPullBody: PullBodyRead = ({ address }) => {
    asked.push(address);
    return Promise.resolve(ok(body));
  };
  const code = await settleAskRow({
    argv: [
      "node",
      "slopweaver",
      "handover",
      "settle",
      SLUG,
      "--as",
      "answered",
      "--witness",
      PR,
      "--home",
      home,
      "--dir",
      dir,
    ],
    out: ({ line }) => {
      lines.push(line);
    },
    readPullBody,
    ...(precondition === undefined ? {} : { precondition }),
  });
  return { asked, code, lines };
};

describe("handover settle --as answered on a bare pull request URL", () => {
  it("refuses the 17564 settlement over a body with no proof, leaving the row's bytes as they were", async () => {
    const before = readFileSync(path, "utf8");
    const { asked, code, lines } = await settle({ body: "one line changed" });
    expect(code).toBe(EXIT_ERROR);
    expect(asked).toEqual([PR]);
    expect(lines).toEqual([]);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("reads before the caller's precondition, which still refuses a proven settle over the row as it stands", async () => {
    const before = readFileSync(path, "utf8");
    const { asked, code } = await settle({ body: FULL_BODY, precondition: () => "the caller says no" });
    expect(code).toBe(EXIT_ERROR);
    expect(asked).toEqual([PR]);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("settles over a body carrying each item, the receipt naming what it found", async () => {
    const { code, lines } = await settle({ body: FULL_BODY });
    expect(code).toBe(EXIT_OK);
    expect(lines.slice(0, 5)).toEqual([
      `handover settle: ${SLUG} is settled answered (witness: ${PR})`,
      `proof-witness: read ${PR} live — each item the owner's words ask for is PRESENT (present, not judged):`,
      "  screenshot (a GitHub attachment): 2 found, 2 needed — https://github.com/user-attachments/assets/a0000006-0000-4000-8000-000000000007, https://github.com/user-attachments/assets/a0000008-0000-4000-8000-000000000009",
      "  GitHub run link: 2 found, 2 needed — acme/acme-admin run 36080719230, acme/acme-admin run 35822152721",
      "  Datadog link: 1 found, 1 needed — https://ap1.datadoghq.com/ci/pipeline-executions",
    ]);
    const settled = parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
    expect(settled.settlement).toBe("answered");
  });
});
