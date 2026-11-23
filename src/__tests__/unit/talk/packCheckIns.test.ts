/*
 * The owner's check-ins as the console voice reads them: each rule its newest act, the act's own reason and
 * evidence, the row it was done under and that row's tags.
 */
import { describe, expect, it } from "vitest";

import { foldAutonomy } from "../../../autonomy/query.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { unwrap } from "../../../lib/result.js";
import { packCheckInsOf } from "../../../talk/packCheckIns.js";

/** A pushback on one acme-admin pull request, done under one board row. */
const pushback = ({ actionId, pr, doneIso }: { actionId: string; pr: number; doneIso: string }): AutonomyActionRow => ({
  actionId,
  bySession: "workspace:1",
  doneIso,
  kind: "push-back-on-coderabbit",
  run: "the-logger-run",
  said: `Pushed back on CodeRabbit's rename on PR ${String(pr)}`,
  subject: `https://github.com/acme/acme-admin/pull/${String(pr)}`,
  why: `the rename would break the import path (${actionId})`,
  witness: `github reply printed 201 (${actionId})`,
});

describe("packCheckInsOf", () => {
  it("reads each rule as its newest act — key, reason, evidence, row and the row's tags", () => {
    const actions = unwrap(
      foldAutonomy({
        records: [
          pushback({ actionId: "ev-1", doneIso: "2026-10-01T09:00:00Z", pr: 1 }),
          pushback({ actionId: "ev-2", doneIso: "2026-10-01T10:00:00Z", pr: 2 }),
          { ...pushback({ actionId: "sw-1", doneIso: "2026-10-01T11:00:00Z", pr: 3 }), run: "elsewhere" },
        ],
      }),
    );
    const tags = new Map([["the-logger-run", ["area:logging"]]]);
    expect(packCheckInsOf({ actions, tagsOf: ({ slug }) => tags.get(slug) })).toEqual([
      {
        acts: 3,
        cards: 3,
        did: "Pushed back on CodeRabbit's rename on PR 3",
        doneIso: "2026-10-01T11:00:00Z",
        evidence: "github reply printed 201 (sw-1)",
        key: "act:sw-1",
        kind: "push-back-on-coderabbit",
        origin: "elsewhere",
        place: "acme/acme-admin",
        reason: "the rename would break the import path (sw-1)",
        tags: undefined,
      },
    ]);
  });

  it("reads no row and no tags off an act that names no run", () => {
    const { run: _run, ...bare } = pushback({ actionId: "ev-9", doneIso: "2026-10-01T09:00:00Z", pr: 9 });
    const [entry] = packCheckInsOf({ actions: unwrap(foldAutonomy({ records: [bare] })), tagsOf: () => ["x:y"] });
    expect([entry!.origin, entry!.tags]).toEqual([undefined, undefined]);
  });
});
