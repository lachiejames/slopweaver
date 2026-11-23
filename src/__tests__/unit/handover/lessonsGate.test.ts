/**
 * The lesson gate, once the register became the memories table.
 *
 * The register read is a SEAM here, not a mock: `lessonsGateRefuses` takes `readLessons` precisely so every
 * branch below is reachable without a database, and `.claude/rules/testing.md` bans the mock that faking one
 * would need. The journal is a real file in a temp directory, because the gate's other half is what it
 * reads and writes there.
 *
 * Four properties, and each one is a line in the brief this was built from:
 *
 * - a store outage FAILS a settle loudly, and never silently passes it;
 * - `--lessons none` stays honest — a run that recorded something is told so rather than journalling a
 *   `none` over the top of it;
 * - the break-glass still works, including through an outage, and journals that it was forced;
 * - a dry run journals nothing, on every path.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type LessonsGateVerdict,
  type LessonsReader,
  lessonsGateRefuses,
  lessonsGateVerdict,
  recordForcedLessons,
} from "../../../cli/commands/handover/lessonsGate.js";
import { appendRunEvent } from "../../../handover/runStore.js";
import { ALLOW_NO_LESSONS } from "../../../knowledge/declared.js";
import { KnowledgeErrors } from "../../../knowledge/errors.js";
import type { LessonRow } from "../../../knowledge/types.js";
import { err, ok } from "../../../lib/result.js";

const SLUG = "a-row";
const STARTED_AT = "2026-09-15T01:00:00.000Z";
const NOW = "2026-09-15T02:00:00.000Z";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
  delete process.env[ALLOW_NO_LESSONS];
});

/** A runs directory holding one journal whose cycle is open. */
function runsDir({ started = true }: { started?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "sw-gate-"));
  const dir = join(root, "runs");
  mkdirSync(dir, { recursive: true });
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  if (started) {
    appendRunEvent({
      event: { atIso: STARTED_AT, branch: "work", docHash: "h", kind: "started" },
      runsDir: dir,
      slug: SLUG,
    });
  }
  return dir;
}

/** What the journal holds now, as a list of event kinds. */
function kinds({ dir }: { dir: string }): readonly string[] {
  return readFileSync(join(dir, `${SLUG}.jsonl`), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => String((JSON.parse(line) as { kind: unknown }).kind));
}

/** One fleet lesson this run recorded after it started. */
const recorded = (over: Partial<LessonRow> = {}): LessonRow => ({
  claim: "a grouped count over an id-like facet truncates",
  domain: "datadog",
  evidence: "5 of 5 buckets plus meta.page.after",
  id: "l-0000000000000001",
  learner: "fleet",
  recordedAtIso: NOW,
  run: SLUG,
  surface: "api",
  tier: 2,
  verdict: "confirmed",
  ...over,
});

/** A register holding nothing for this run. */
const NOTHING: LessonsReader = () => Promise.resolve(ok([]));

/** A register that cannot be reached at all — the outage case. */
const OUTAGE: LessonsReader = () =>
  Promise.resolve(err(KnowledgeErrors.databaseFailed({ cause: "ECONNREFUSED", doing: "reach the memories table" })));

/** One rows-in-the-register reader. */
function holding({ rows }: { rows: readonly LessonRow[] }): LessonsReader {
  return () => Promise.resolve(ok(rows));
}

/** The gate, with everything but the reader and the flag held fixed. */
async function gate({
  dir,
  readLessons,
  lessons,
  dryRun = false,
}: {
  dir: string;
  readLessons: LessonsReader;
  lessons?: string | undefined;
  dryRun?: boolean;
}): Promise<boolean> {
  return lessonsGateRefuses({
    dryRun,
    home: "/nowhere",
    lessons,
    nowIso: NOW,
    readLessons,
    runsDir: dir,
    slug: SLUG,
    verb: "settle",
  });
}

describe("a run that was never started is not asked", () => {
  it("passes without reading the register at all", async () => {
    const dir = runsDir({ started: false });
    // The reader would throw if it were called, which is what makes "not asked" falsifiable rather than
    // inferred from the return value.
    const explodes: LessonsReader = () => {
      throw new Error("the register must not be read for a run that never opened a cycle");
    };

    expect(await gate({ dir, readLessons: explodes })).toBe(false);
  });
});

describe("an unreachable store fails the settle loudly", () => {
  it("REFUSES rather than treating an outage as a run that learned nothing", async () => {
    expect(await gate({ dir: runsDir(), readLessons: OUTAGE })).toBe(true);
  });

  it("refuses an explicit --lessons none too, because nothing could check that claim", async () => {
    const dir = runsDir();

    expect(await gate({ dir, lessons: "none", readLessons: OUTAGE })).toBe(true);
    expect(kinds({ dir })).toEqual(["started"]);
  });

  it("still lets the break-glass through, and journals that it was FORCED", async () => {
    // A refusal whose own escape stops working during the failure it exists for is the wedge
    // `.claude/rules/error-handling.md` names.
    const dir = runsDir();
    process.env[ALLOW_NO_LESSONS] = "1";

    expect(await gate({ dir, readLessons: OUTAGE })).toBe(false);
    expect(kinds({ dir })).toEqual(["started", "lessons"]);
  });
});

describe("a caller that defers the forced write", () => {
  /** The verdict gate as `handover finish` asks it, forced writes left to the caller. */
  const deferred = ({ dir, lessons }: { dir: string; lessons?: string }): Promise<LessonsGateVerdict> =>
    lessonsGateVerdict({
      deferForced: true,
      home: "/nowhere",
      lessons,
      nowIso: NOW,
      readLessons: NOTHING,
      runsDir: dir,
      slug: SLUG,
      verb: "finish",
    });

  it("reports a break-glass pass as forced and journals nothing, leaving the write to the caller", async () => {
    const dir = runsDir();
    process.env[ALLOW_NO_LESSONS] = "1";

    expect(await deferred({ dir })).toBe("forced");
    expect(kinds({ dir })).toEqual(["started"]);
  });

  it("still journals an explicit none at once, since it is an answer whatever the later gates say", async () => {
    const dir = runsDir();

    expect(await deferred({ dir, lessons: "none" })).toBe("passed");
    expect(kinds({ dir })).toEqual(["started", "lessons"]);
  });

  it("journals the deferred forced answer when the caller records it", async () => {
    const dir = runsDir();

    recordForcedLessons({ nowIso: NOW, runsDir: dir, slug: SLUG });

    expect(kinds({ dir })).toEqual(["started", "lessons"]);
  });
});

describe("the register decides before --lessons none does", () => {
  it("passes on a row this run recorded, and journals NOTHING", async () => {
    const dir = runsDir();

    expect(await gate({ dir, readLessons: holding({ rows: [recorded()] }) })).toBe(false);
    expect(kinds({ dir })).toEqual(["started"]);
  });

  it("does not journal a `none` over a run that DID record something", async () => {
    const dir = runsDir();

    expect(await gate({ dir, lessons: "none", readLessons: holding({ rows: [recorded()] }) })).toBe(false);
    expect(kinds({ dir })).toEqual(["started"]);
  });

  it("refuses a run that recorded nothing and said nothing", async () => {
    const dir = runsDir();

    expect(await gate({ dir, readLessons: NOTHING })).toBe(true);
    expect(kinds({ dir })).toEqual(["started"]);
  });

  it("records an explicit none when the register really is empty for this run", async () => {
    const dir = runsDir();

    expect(await gate({ dir, lessons: "none", readLessons: NOTHING })).toBe(false);
    expect(kinds({ dir })).toEqual(["started", "lessons"]);
  });

  // A settle a hook runs in process owns no stdout, so every report line goes to the channel it names.
  it("writes its report lines to the channel it is handed, for a found lesson and a recorded none alike", async () => {
    const lines: string[] = [];
    const out = ({ line }: { line: string }): void => {
      lines.push(line);
    };
    const common = { home: "/nowhere", nowIso: NOW, out, slug: SLUG, verb: "settle" };

    await lessonsGateRefuses({
      ...common,
      lessons: undefined,
      readLessons: holding({ rows: [recorded()] }),
      runsDir: runsDir(),
    });
    await lessonsGateRefuses({ ...common, lessons: "none", readLessons: NOTHING, runsDir: runsDir() });

    expect(lines).toEqual([
      "handover settle: 1 lesson(s) recorded on this run — `slopweaver knowledge list --run` to read them back",
      "handover settle: recorded that this run learned nothing worth registering",
    ]);
  });
});

describe("what does not count as this run answering", () => {
  it("ignores a belief of the owner's that a session happened to record while the run was open", async () => {
    // Counting one would let a run close by writing down something they said, which is the filler the gate
    // exists to refuse.
    const dir = runsDir();

    expect(await gate({ dir, readLessons: holding({ rows: [recorded({ learner: "owner" })] }) })).toBe(true);
  });

  it("ignores a row from BEFORE this cycle started, so a second run answers for itself", async () => {
    const dir = runsDir();
    const old = recorded({ recordedAtIso: "2026-09-14T00:00:00.000Z" });

    expect(await gate({ dir, readLessons: holding({ rows: [old] }) })).toBe(true);
  });

  it("ignores a row another run recorded", async () => {
    const dir = runsDir();

    expect(await gate({ dir, readLessons: holding({ rows: [recorded({ run: "some-other-row" })] }) })).toBe(true);
  });
});

describe("a dry run journals nothing", () => {
  it("previews the recorded none without writing it", async () => {
    const dir = runsDir();

    expect(await gate({ dir, dryRun: true, lessons: "none", readLessons: NOTHING })).toBe(false);
    expect(kinds({ dir })).toEqual(["started"]);
  });

  it("still REFUSES an unanswered run, because a dry run previews a success that would happen", async () => {
    const dir = runsDir();

    expect(await gate({ dir, dryRun: true, readLessons: NOTHING })).toBe(true);
  });

  it("asks the store door not to catch a behind database up, which a real settle does", async () => {
    const asked: boolean[] = [];
    const recording: LessonsReader = ({ catchUp }) => {
      asked.push(catchUp);
      return Promise.resolve(ok([]));
    };

    await gate({ dir: runsDir(), dryRun: true, readLessons: recording });
    await gate({ dir: runsDir(), readLessons: recording });

    expect(asked).toEqual([false, true]);
  });
});
