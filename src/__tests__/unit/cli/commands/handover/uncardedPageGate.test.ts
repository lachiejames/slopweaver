/**
 * The uncarded-page gate refuses to close a row whose page never reached the owner's Queue, and stays out of the way of
 * every close that is not about a page. The measured case: a dispatch ask settled `answered` with a `page:` witness
 * and no question, which this file builds as `acme-plan-usage-to-17-nov`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type PageReachReaders,
  uncardedPageGateRefuses,
  uncardedPageLines,
} from "../../../../../cli/commands/handover/uncardedPageGate.js";
import type { HandStep } from "../../../../../hand/step.js";
import type { HandoverDoc } from "../../../../../handover/doc.js";
import { applyRowEvent } from "../../../../../handover/rowEvent.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { err, ok } from "../../../../../lib/result.js";

const PAGE = "acme-plan-page-17-nov";
const ROW = "acme-plan-usage-to-17-nov";

const doc = {
  artifact: undefined,
  kind: "ask",
  lean: undefined,
  options: [],
  problem: undefined,
  ruling: undefined,
  rulingAnchor: undefined,
  slug: ROW,
  summary: "Work out the plan-usage strategy",
} as unknown as HandoverDoc;

const EMPTY: PageReachReaders = { handSteps: () => ok([]), ruledIdentities: () => ok(new Set()) };

describe("uncardedPageGateRefuses", () => {
  let home = "";
  let runsDir = "";
  const saved = process.env["SLOPWEAVER_ALLOW_UNCARDED_PAGE"];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-ucp-"));
    runsDir = join(home, "runs");
    delete process.env["SLOPWEAVER_ALLOW_UNCARDED_PAGE"];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    if (saved === undefined) {
      delete process.env["SLOPWEAVER_ALLOW_UNCARDED_PAGE"];
    } else {
      process.env["SLOPWEAVER_ALLOW_UNCARDED_PAGE"] = saved;
    }
  });

  function gate({ witness, readers = EMPTY }: { witness: string | undefined; readers?: PageReachReaders }): {
    refused: boolean;
    lines: string[];
  } {
    const lines: string[] = [];
    const candidate =
      witness === undefined ? ({ kind: "artifact" } as const) : ({ kind: "settlement", witness } as const);
    const refused = uncardedPageGateRefuses({
      candidate,
      doc,
      home,
      readers,
      runsDir,
      verb: "settle",
      writeDiagnostic: (line) => lines.push(line),
    });
    return { lines, refused };
  }

  it("refuses the measured page witness, naming the page and the ask that fixes it", () => {
    const { refused, lines } = gate({ witness: `page:${PAGE}` });
    expect(refused).toBe(true);
    expect(lines.slice(0, 4)).toStrictEqual(uncardedPageLines({ pages: [PAGE], rowSlug: ROW, verb: "settle" }));
    expect(
      lines.some((line) =>
        line.startsWith("To override use the designated escape hatch SLOPWEAVER_ALLOW_UNCARDED_PAGE=1"),
      ),
    ).toBe(true);
  });

  it("refuses the page's in-app viewer URL as a witness, as it refuses `page:<slug>`", () => {
    // The viewer carries the page in its encoded `src=`, and read as no page the gate never ran.
    const witness = `http://localhost:3000/view?src=%2Fapi%2Fpage%2F${PAGE}%2Findex.html&back=%2Fqueue`;
    const { refused, lines } = gate({ witness });
    expect(refused).toBe(true);
    expect(lines.slice(0, 4)).toStrictEqual(uncardedPageLines({ pages: [PAGE], rowSlug: ROW, verb: "settle" }));
  });

  it("passes a pull request witness without reading either register", () => {
    const unreadable: PageReachReaders = { handSteps: () => err(["boom"]), ruledIdentities: () => err(["boom"]) };
    expect(gate({ readers: unreadable, witness: "https://github.com/acme/repo/pull/1" }).refused).toBe(false);
  });

  it("refuses when a register will not read, rather than guessing", () => {
    const unreadable: PageReachReaders = {
      handSteps: () => err(["hand register unreadable"]),
      ruledIdentities: () => ok(new Set()),
    };
    const { refused, lines } = gate({ readers: unreadable, witness: `page:${PAGE}` });
    expect(refused).toBe(true);
    expect(lines[0]).toBe(
      "handover settle: could not tell whether the page reached the owner — hand register unreadable",
    );
  });

  it("passes when a hand step or the owner's lock-in ruling carried the page", () => {
    const step = { id: "read-plan", url: `http://localhost:3000/api/page/${PAGE}/index.html` } as unknown as HandStep;
    expect(gate({ readers: { ...EMPTY, handSteps: () => ok([step]) }, witness: `page:${PAGE}` }).refused).toBe(false);
    const ruled = { ...EMPTY, ruledIdentities: () => ok(new Set([`page:${PAGE}`])) };
    expect(gate({ readers: ruled, witness: `page:${PAGE}` }).refused).toBe(false);
  });

  it("passes when the run asked a question naming the page this cycle", () => {
    const started = appendRunEvent({
      event: { atIso: "2026-11-02T09:00:00.000Z", branch: ROW, docHash: "h", kind: "started" },
      runsDir,
      slug: ROW,
    });
    expect(started.isOk()).toBe(true);
    const asked = appendRunEvent({
      event: { atIso: "2026-11-02T10:00:00.000Z", kind: "question", question: `Which plan? page:${PAGE}` },
      runsDir,
      slug: ROW,
    });
    expect(asked.isOk()).toBe(true);
    expect(gate({ witness: `page:${PAGE}` }).refused).toBe(false);
  });

  it("reads finish's candidate off the artifact event page publish journals", () => {
    expect(gate({ witness: undefined }).refused).toBe(false);
    const published = applyRowEvent({
      event: { atIso: "2026-11-02T10:00:00.000Z", kind: "artifact", url: `page:${PAGE}` },
      runsDir,
      slug: ROW,
    });
    expect(published.isOk()).toBe(true);
    expect(gate({ witness: undefined }).refused).toBe(true);
  });

  it("refuses a settle whose witness is no page while the run's published page never reached the owner", () => {
    // Settle checked only its witness, so a pull request witness closed a run whose deliverable was a page.
    const published = applyRowEvent({
      event: { atIso: "2026-11-02T10:00:00.000Z", kind: "artifact", url: `page:${PAGE}` },
      runsDir,
      slug: ROW,
    });
    expect(published.isOk()).toBe(true);
    const { refused, lines } = gate({ witness: "https://github.com/acme/repo/pull/1" });
    expect(refused).toBe(true);
    expect(lines.slice(0, 4)).toStrictEqual(uncardedPageLines({ pages: [PAGE], rowSlug: ROW, verb: "settle" }));
  });

  it("lets the hatch through and says so", () => {
    process.env["SLOPWEAVER_ALLOW_UNCARDED_PAGE"] = "1";
    const { refused, lines } = gate({ witness: `page:${PAGE}` });
    expect(refused).toBe(false);
    expect(lines).toStrictEqual([
      "handover settle: FORCED past the uncarded-page gate by SLOPWEAVER_ALLOW_UNCARDED_PAGE=1 — the page is not on the owner's Queue",
    ]);
  });
});
