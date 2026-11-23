/**
 * Measured: a doc whose four `doneWhen:` entries each carried `name:` alongside `command:` (two
 * keys, so `probe.ts`'s `parseEntry` rejects every one of them) parsed to ZERO probes and zero problems ever
 * consulted by `resume`/`finish`/`list` — so all three read the doc as an ordinary no-probe doc instead of the
 * malformed one it was, and `resume` printed "every probe passes". This file locks in the fix: an unparseable
 * `doneWhen:` entry is a FAILING doc on every surface that reads it, never a silently dropped one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { finishRun, isContextError, resumeRun, runContext } from "../../../cli/commands/handover/lifecycle.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import { appendRunEvent, docHash } from "../../../handover/runStore.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => {
    cleanup();
  });
});

/** A doc whose every `doneWhen:` entry carries both `name:` and `command:` — two keys, so none of them parses. */
const MALFORMED_DONE_WHEN = `doneWhen:
  - name: first slice lands
    command: yarn test:unit -- first
  - name: second slice lands
    command: yarn test:unit -- second`;

/** A temp handovers dir holding one doc, plus an empty runs dir alongside it. */
function fixture({ frontMatter }: { frontMatter: string }): {
  handoverDir: string;
  runsDir: string;
  slug: string;
  text: string;
  path: string;
  home: string;
} {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-probe-parse-failure-"));
  const handoverDir = join(root, "handovers");
  const runsDir = join(root, "runs");
  const slug = "probe-parse-repro";
  mkdirSync(handoverDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  const path = join(handoverDir, `${slug}.md`);
  const text = `---\nslug: ${slug}\nstatus: ready\n${frontMatter}\n---\n# doc\n`;
  writeFileSync(path, text);
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return { handoverDir, home: root, path, runsDir, slug, text };
}

describe("an unparseable doneWhen entry", () => {
  it("is reported on the doc rather than silently dropped, leaving doneWhen empty", () => {
    const { path, text } = fixture({ frontMatter: MALFORMED_DONE_WHEN });
    const doc = parseHandoverDoc({ path, text });

    expect(doc.doneWhen).toEqual([]);
    expect(doc.problems).toEqual([
      "doneWhen[0] must declare exactly one of present/absent/path/command, but declares 2",
      "doneWhen[1] must declare exactly one of present/absent/path/command, but declares 2",
    ]);
  });

  it("makes handover list compute CONTRADICTION instead of an ordinary no-probe RUN NOW", () => {
    const { path, text } = fixture({ frontMatter: MALFORMED_DONE_WHEN });
    const doc = parseHandoverDoc({ path, text });

    const models = composeBoardModels({
      journals: new Map(),
      probeStates: new Map(),
      resolutionDocs: [doc],
      roots: [doc],
    });

    expect(models[0]?.section).toBe("CONTRADICTION");
    expect(models[0]?.reason).toContain("doneWhen[0]");
  });

  it("makes handover resume refuse instead of reporting every probe passes", () => {
    const { handoverDir, runsDir, slug, text } = fixture({ frontMatter: MALFORMED_DONE_WHEN });
    appendRunEvent({
      event: { atIso: "2026-08-29T00:00:00.000Z", branch: "work", docHash: docHash({ text }), kind: "started" },
      runsDir,
      slug,
    });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }

    const code = resumeRun({ context, events: [], ownershipLine: undefined, unknownKind: [], unreadable: [] });

    expect(code).not.toBe(EXIT_OK);
  });

  it("makes handover finish refuse to close, even under the unreviewed force flag", () => {
    const { handoverDir, home, runsDir, slug, text } = fixture({ frontMatter: MALFORMED_DONE_WHEN });
    appendRunEvent({
      event: { atIso: "2026-08-29T00:00:00.000Z", branch: "work", docHash: docHash({ text }), kind: "started" },
      runsDir,
      slug,
    });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }

    const code = finishRun({
      context,
      forced: true,
      home,
      lessons: "none",
      mode: "refuse",
      nowIso: "2026-08-29T01:00:00.000Z",
      runsDir,
      structuralAllowed: true,
    });

    expect(code).not.toBe(EXIT_OK);
  });
});

describe("control: a well-formed doneWhen still evaluates as before", () => {
  it("leaves doc.problems empty and computes RUN NOW on the board", () => {
    const { path, text } = fixture({ frontMatter: 'doneWhen:\n  - path: "docs/probes.md"' });
    const doc = parseHandoverDoc({ path, text });

    expect(doc.problems).toEqual([]);
    expect(doc.doneWhen).toEqual([{ kind: "path", path: "docs/probes.md" }]);

    const models = composeBoardModels({
      journals: new Map(),
      probeStates: new Map(),
      resolutionDocs: [doc],
      roots: [doc],
    });
    expect(models[0]?.section).toBe("RUN NOW");
  });
});
