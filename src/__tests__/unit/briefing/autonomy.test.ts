import { describe, expect, it } from "vitest";

import { foldAutonomy } from "../../../autonomy/query.js";
import type { AutonomyActionRow, AutonomyRecord } from "../../../autonomy/types.js";
import { NO_AUTONOMY, projectAutonomy } from "../../../briefing/autonomy.js";
import { AUTONOMY_MAX_ROWS } from "../../../briefing/caps.js";
import { unwrap } from "../../../lib/result.js";

/** One act, varying only what a test cares about. */
function act({
  actionId = "16644-enqueue",
  kind = "press-merge-when-ready",
  subject = "https://github.com/acme/acme-admin/pull/16644",
  doneIso = "2026-09-12T02:06:09Z",
  bySession = "workspace:123 act-on-open-acme-admin-prs (fd64a339)",
  why = "CI green, mergeable, no code-owner request outstanding",
  witness = "slopweaver github enqueue --pr 16644 -> queued at position 1",
  said,
  run,
  steer,
}: {
  actionId?: string;
  kind?: string;
  subject?: string;
  doneIso?: string;
  bySession?: string;
  why?: string;
  witness?: string;
  said?: string;
  run?: string;
  steer?: string;
} = {}): AutonomyActionRow {
  const base: AutonomyActionRow = { actionId, bySession, doneIso, kind, subject, why, witness };
  const withSaid = said === undefined ? base : { ...base, said };
  const withRun = run === undefined ? withSaid : { ...withSaid, run };
  return steer === undefined ? withRun : { ...withRun, steer };
}

/** Fold a set of records the way every reader of the register does, then project them. */
function project({
  records,
  top,
}: {
  records: readonly AutonomyRecord[];
  top?: number;
}): ReturnType<typeof projectAutonomy> {
  const actions = unwrap(foldAutonomy({ records }));
  return top === undefined ? projectAutonomy({ actions }) : projectAutonomy({ actions, top });
}

describe("projecting the register onto the page", () => {
  it("derives the three visible labels and keeps the raw values beside them", () => {
    const row = project({ records: [act()] }).rows[0]!;
    expect(row.kindLabel).toBe("press merge when ready");
    expect(row.subjectLabel).toBe("acme/acme-admin#16644");
    expect(row.sessionLabel).toBe("workspace:123");
    expect(row.subject).toBe("https://github.com/acme/acme-admin/pull/16644");
    expect(row.bySession).toBe("workspace:123 act-on-open-acme-admin-prs (fd64a339)");
    expect(row.actionId).toBe("16644-enqueue");
  });

  it("keeps a refused act saying it was refused", () => {
    const row = project({ records: [act({ kind: "press-merge-when-ready-refused" })] }).rows[0]!;
    expect(row.kindLabel).toBe("press merge when ready refused");
  });

  it("carries why and witness through untouched, at full length", () => {
    const why = "x".repeat(1200);
    const row = project({ records: [act({ why })] }).rows[0]!;
    expect(row.why).toBe(why);
    expect(row.witness).toBe("slopweaver github enqueue --pr 16644 -> queued at position 1");
  });

  it("omits said, run and steer rather than writing them as undefined", () => {
    const row = project({ records: [act()] }).rows[0]!;
    expect("said" in row).toBe(false);
    expect("run" in row).toBe(false);
    expect("steer" in row).toBe(false);
  });

  it("carries the plain-words line through whole, beside the fleet's own note", () => {
    const said = "I merged your pull request on the admin app once every check had passed.";
    const row = project({ records: [act({ said })] }).rows[0]!;
    expect(row.said).toBe(said);
    expect(row.why).toBe("CI green, mergeable, no code-owner request outstanding");
  });

  it("attaches the owner's word, whether it arrived inline or as its own row", () => {
    const inline = project({ records: [act({ steer: "they had already said this" })] }).rows[0]!;
    expect(inline.steer).toBe("they had already said this");
    const appended = project({
      records: [
        act(),
        {
          actionId: "16644-enqueue",
          bySession: "supervisor",
          steer: "said afterwards",
          steeredIso: "2026-09-12T04:00:00Z",
        },
      ],
    }).rows[0]!;
    expect(appended.steer).toBe("said afterwards");
  });

  it("keeps the register's own newest-first order rather than re-sorting", () => {
    const projected = project({
      records: [
        act({ actionId: "a-old", doneIso: "2026-09-12T02:06:09Z" }),
        act({ actionId: "a-new", doneIso: "2026-09-12T02:18:27Z" }),
      ],
    });
    expect(projected.rows.map((row) => row.actionId)).toEqual(["a-new", "a-old"]);
  });
});

describe("what the page does not show", () => {
  it("states how many acts it is leaving off", () => {
    const records = Array.from({ length: 13 }, (_unused, index) =>
      act({ actionId: `a-${String(index)}`, doneIso: `2026-09-12T02:0${String(index % 10)}:00Z` }),
    );
    const projected = project({ records });
    expect(projected.rows.length).toBe(AUTONOMY_MAX_ROWS);
    expect(projected.notShown).toBe(3);
  });

  it("says zero when it shows all of them", () => {
    expect(project({ records: [act()] }).notShown).toBe(0);
  });

  it("honours a caller's own smaller top", () => {
    const records = [
      act({ actionId: "a-one", doneIso: "2026-09-12T02:06:09Z" }),
      act({ actionId: "a-two", doneIso: "2026-09-12T02:18:27Z" }),
    ];
    const projected = project({ records, top: 1 });
    expect(projected.rows.map((row) => row.actionId)).toEqual(["a-two"]);
    expect(projected.notShown).toBe(1);
  });
});

describe("the empty section", () => {
  it("renders nothing and claims nothing", () => {
    expect(NO_AUTONOMY).toEqual({ notShown: 0, rows: [] });
  });

  it("is what an empty register projects to", () => {
    expect(project({ records: [] })).toEqual(NO_AUTONOMY);
  });
});
