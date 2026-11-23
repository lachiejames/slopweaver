import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { buildResyncPolicies } from "../../../../live/resync/policy.js";
import { type RegistrationPlan, resyncDefinitionFor } from "../../../../live/resync/registrationPlan.js";
import { applyResyncRegistration } from "../../../../live/resync/registrationStore.js";

const HOUR = 60 * 60 * 1000;

const airtable = buildResyncPolicies({
  atlases: [
    { platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated: true, windowMs: 4 * HOUR },
  ],
  corpus: [],
}).policies[0]!;

const dirs: string[] = [];

/** A throwaway definitions directory and ownership path, removed after each test. */
const sandbox = (): { definitionsDir: string; ownedPath: string; file: string; home: string; nowIso: string } => {
  const root = mkdtempSync(join(tmpdir(), "resync-store-"));
  dirs.push(root);
  const definitionsDir = join(root, "definitions");
  return {
    definitionsDir,
    file: join(definitionsDir, "resync-atlas-airtable.json"),
    home: root,
    nowIso: "2026-09-29T16:00:00.000Z",
    ownedPath: join(root, "owned.json"),
  };
};

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

const createPlan: RegistrationPlan = {
  changes: [
    {
      action: "create",
      definition: resyncDefinitionFor({ policy: airtable }),
      reason: null,
      recipeId: airtable.recipeId,
    },
  ],
};

/** Lay a file down before the pass, exactly as an operator (or another tool) would have. */
const seed = ({ definitionsDir, file, contents }: { definitionsDir: string; file: string; contents: string }): void => {
  writeFileSync(join(definitionsDir, ".keep"), "", { flag: "w" });
  writeFileSync(file, contents);
};

describe("applyResyncRegistration, at the moment of writing", () => {
  it("creates a row into an empty store and records it as owned", () => {
    const box = sandbox();
    const applied = unwrap(applyResyncRegistration({ ...box, owned: [], plan: createPlan }));
    expect(applied.created).toEqual(["resync-atlas-airtable"]);
    expect(applied.refused).toEqual([]);
    expect(existsSync(box.file)).toBe(true);
    expect(readFileSync(box.ownedPath, "utf8")).toContain("resync-atlas-airtable");
  });

  it("refuses a create over a VALID file whose embedded recipeId is somebody else's", () => {
    // Counterexample 1: loaded fine, indexed under `operator-job`, so the planner saw no
    // airtable row and planned a create — which then overwrote this file and claimed it.
    const box = sandbox();
    const theirs = JSON.stringify({ ...resyncDefinitionFor({ policy: airtable }), recipeId: "operator-job" });
    unwrap(applyResyncRegistration({ ...box, owned: [], plan: { changes: [] } }));
    seed({ contents: theirs, definitionsDir: box.definitionsDir, file: box.file });

    const applied = unwrap(applyResyncRegistration({ ...box, owned: [], plan: createPlan }));
    expect(applied.created).toEqual([]);
    expect(applied.refused.map((row) => row.recipeId)).toEqual(["resync-atlas-airtable"]);
    expect(readFileSync(box.file, "utf8")).toBe(theirs);
    expect(readFileSync(box.ownedPath, "utf8")).not.toContain("resync-atlas-airtable");
  });

  it("refuses a create over a file the planner could not see at all — the unlistable-directory shape", () => {
    // Counterexample 2: a directory writable and searchable but not listable made the loader return
    // nothing, so the plan was built from an empty store. The writer reads the one path by name instead.
    const box = sandbox();
    const present = JSON.stringify(resyncDefinitionFor({ policy: airtable }));
    unwrap(applyResyncRegistration({ ...box, owned: [], plan: { changes: [] } }));
    seed({ contents: present, definitionsDir: box.definitionsDir, file: box.file });

    const applied = unwrap(applyResyncRegistration({ ...box, owned: [], plan: createPlan }));
    expect(applied.refused[0]!.reason).toContain("one stands at this path");
    expect(readFileSync(box.file, "utf8")).toBe(present);
  });

  it("refuses a create over a file that is not a definition at all", () => {
    const box = sandbox();
    unwrap(applyResyncRegistration({ ...box, owned: [], plan: { changes: [] } }));
    seed({ contents: "{ not json", definitionsDir: box.definitionsDir, file: box.file });

    const applied = unwrap(applyResyncRegistration({ ...box, owned: [], plan: createPlan }));
    expect(applied.refused.map((row) => row.recipeId)).toEqual(["resync-atlas-airtable"]);
    expect(readFileSync(box.file, "utf8")).toBe("{ not json");
  });

  it("refuses an update when the file now holds a different recipe", () => {
    const box = sandbox();
    const theirs = JSON.stringify({ ...resyncDefinitionFor({ policy: airtable }), recipeId: "operator-job" });
    unwrap(applyResyncRegistration({ ...box, owned: [], plan: { changes: [] } }));
    seed({ contents: theirs, definitionsDir: box.definitionsDir, file: box.file });

    const applied = unwrap(
      applyResyncRegistration({
        ...box,
        owned: ["resync-atlas-airtable"],
        plan: {
          changes: [
            {
              action: "update",
              definition: resyncDefinitionFor({ policy: airtable }),
              reason: null,
              recipeId: airtable.recipeId,
            },
          ],
        },
      }),
    );
    expect(applied.updated).toEqual([]);
    expect(applied.refused[0]!.reason).toContain("holds recipe `operator-job`");
    expect(readFileSync(box.file, "utf8")).toBe(theirs);
  });

  it("refuses a retire when the file at an owned id has been replaced with another recipe", () => {
    const box = sandbox();
    const theirs = JSON.stringify({ ...resyncDefinitionFor({ policy: airtable }), recipeId: "operator-job" });
    unwrap(applyResyncRegistration({ ...box, owned: [], plan: { changes: [] } }));
    seed({ contents: theirs, definitionsDir: box.definitionsDir, file: box.file });

    const applied = unwrap(
      applyResyncRegistration({
        ...box,
        owned: ["resync-atlas-airtable"],
        plan: { changes: [{ action: "retire", definition: null, reason: null, recipeId: airtable.recipeId }] },
      }),
    );
    expect(applied.retired).toEqual([]);
    expect(existsSync(box.file)).toBe(true);
  });

  it("records no ownership for an unchanged row whose own path holds somebody else's row", () => {
    // Counterexample: an exact copy elsewhere made the plan read "unchanged", and this
    // path recorded ownership of the canonical file without ever reading what stood there.
    const box = sandbox();
    const theirs = JSON.stringify({ ...resyncDefinitionFor({ policy: airtable }), recipeId: "operator-job" });
    unwrap(applyResyncRegistration({ ...box, owned: [], plan: { changes: [] } }));
    seed({ contents: theirs, definitionsDir: box.definitionsDir, file: box.file });

    const applied = unwrap(
      applyResyncRegistration({
        ...box,
        owned: [],
        plan: { changes: [{ action: "unchanged", definition: null, reason: null, recipeId: airtable.recipeId }] },
      }),
    );
    expect(applied.refused.map((row) => row.recipeId)).toEqual(["resync-atlas-airtable"]);
    expect(readFileSync(box.ownedPath, "utf8")).not.toContain("resync-atlas-airtable");
    expect(readFileSync(box.file, "utf8")).toBe(theirs);
  });

  it("keeps a hold placed on disk after the plan was read, rather than writing the planned row over it", () => {
    // The registrar planned from an earlier read and wrote the planned row whole, so a failure hold placed
    // in between was lost and the broken row fired again.
    const box = sandbox();
    const hold = {
      askedIso: "2026-09-29T15:37:06.542Z",
      clearedBy: null,
      finding: "recipe-failing-resync-atlas-airtable-x-a1",
      reason: "held by the store: a firing failed",
    };
    unwrap(applyResyncRegistration({ ...box, owned: [], plan: { changes: [] } }));
    seed({
      contents: JSON.stringify({ ...resyncDefinitionFor({ policy: airtable }), cadence: "0 * * * *", hold }),
      definitionsDir: box.definitionsDir,
      file: box.file,
    });

    const applied = unwrap(
      applyResyncRegistration({
        ...box,
        owned: ["resync-atlas-airtable"],
        plan: {
          changes: [
            {
              action: "update",
              definition: resyncDefinitionFor({ policy: airtable }),
              reason: null,
              recipeId: airtable.recipeId,
            },
          ],
        },
      }),
    );
    expect(applied.updated).toEqual(["resync-atlas-airtable"]);
    const written = JSON.parse(readFileSync(box.file, "utf8")) as { cadence: string; hold: unknown };
    expect(written.cadence).toBe(resyncDefinitionFor({ policy: airtable }).cadence);
    expect(written.hold).toEqual(hold);
  });

  it("keeps an `automation disable` landed on disk after the plan was read, rather than the plan's `enabled`", () => {
    // The plan derives `enabled: true`; the switch wrote `false` between the planning read and the locked write.
    const box = sandbox();
    unwrap(applyResyncRegistration({ ...box, owned: [], plan: { changes: [] } }));
    seed({
      contents: JSON.stringify({ ...resyncDefinitionFor({ policy: airtable }), cadence: "0 * * * *", enabled: false }),
      definitionsDir: box.definitionsDir,
      file: box.file,
    });

    const applied = unwrap(
      applyResyncRegistration({
        ...box,
        owned: ["resync-atlas-airtable"],
        plan: {
          changes: [
            {
              action: "update",
              definition: { ...resyncDefinitionFor({ policy: airtable }), enabled: true },
              reason: null,
              recipeId: airtable.recipeId,
            },
          ],
        },
      }),
    );
    expect(applied.updated).toEqual(["resync-atlas-airtable"]);
    const written = JSON.parse(readFileSync(box.file, "utf8")) as { cadence: string; enabled: boolean };
    expect(written.cadence).toBe(resyncDefinitionFor({ policy: airtable }).cadence);
    expect(written.enabled).toBe(false);
  });

  it("retires an owned id whose file is already gone, since there is nothing left to destroy", () => {
    const box = sandbox();
    const applied = unwrap(
      applyResyncRegistration({
        ...box,
        owned: ["resync-atlas-airtable"],
        plan: { changes: [{ action: "retire", definition: null, reason: null, recipeId: airtable.recipeId }] },
      }),
    );
    expect(applied.retired).toEqual(["resync-atlas-airtable"]);
    expect(applied.refused).toEqual([]);
  });
});
