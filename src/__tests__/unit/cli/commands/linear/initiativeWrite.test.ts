/*
 * The irreversible half of `linear initiative`, driven directly: what a lost mutation response settles to, and
 * what an acknowledged link leaves in the append ledger.
 *
 * A create's id was freshly reserved, so an initiative found there proves the create landed. An update's
 * initiative existed before, so finding it proves nothing; only the name that was sent does. Every edge is a
 * plain injected function. No mocks.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterAll, describe, expect, it } from "vitest";

import {
  parseLinearInitiativeForm,
  parseLinearInitiativeLinkForm,
} from "../../../../../cli/commands/linear/initiativeCore.js";
import type { LinearInitiativeWriteDeps } from "../../../../../cli/commands/linear/initiativeDeps.js";
import { performLink, performWrite } from "../../../../../cli/commands/linear/initiativeWrite.js";
import type { WrittenObject } from "../../../../../corpus/linear/write.js";
import type {
  LinearInitiativeWriteApi,
  ReadInitiative,
  ReadInitiativeLink,
} from "../../../../../corpus/linear/writeInitiative.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { unwrap } from "../../../../../lib/result.js";
import { readAppendRecord } from "../../../../../outbound/linear/commentLedger.js";
import { readInitiativeRecord } from "../../../../../outbound/linear/projectLedger.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

/** Every scratch home this file mints, removed in `afterAll` — see `.claude/rules/testing.md`. */
const homes: string[] = [];

afterAll(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-initiative-write-"));
  homes.push(home);
  return home;
}

const NOW = "2026-09-07T00:00:00.000Z";
const INITIATIVE_ID = "aa831adf-e969-430b-abd3-d72397f6b8e9";
const PROJECT_ID = "92f14fe7-e9a9-4f21-a7b1-0305e82c3301";
const LINK_ID = "3c1f4a52-7d0e-4b8a-9f61-2e5d8c7b9a04";

const FIELDS = unwrap(
  parseLinearInitiativeForm({ raw: JSON.stringify({ fields: { name: "Ship the thing" } }) }),
).fields;

const LINK_FORM = unwrap(
  parseLinearInitiativeLinkForm({
    raw: JSON.stringify({ fields: { initiativeId: INITIATIVE_ID, projectId: PROJECT_ID } }),
  }),
);

function read({ name }: { name: string }): ReadInitiative {
  return {
    description: undefined,
    id: INITIATIVE_ID,
    name,
    slugId: "s1",
    status: "Planned",
    targetDate: undefined,
    updatedAt: NOW,
    url: "https://linear.test/initiative/ship-the-thing-s1",
  };
}

const WRITTEN_LINK: WrittenObject = { id: LINK_ID };

const READ_LINK: ReadInitiativeLink = { id: LINK_ID, initiativeId: INITIATIVE_ID, projectId: PROJECT_ID };

function boom({ operation }: { operation: string }): IngestError {
  return { kind: "http", message: "boom", operation, provider: "linear" };
}

const NOT_THIS_LANE = (): never => {
  throw new Error("this case never reaches that arm of the initiative write");
};

/** Every mutation loses its response; the read-back answers with the name the case names. */
function api({ storedName }: { storedName: string }): LinearInitiativeWriteApi {
  return {
    archiveInitiativeUpdate: NOT_THIS_LANE,
    createInitiative: () => errAsync(boom({ operation: "linear.initiativeCreate" })),
    createInitiativeLink: () => okAsync(WRITTEN_LINK),
    createInitiativeUpdate: NOT_THIS_LANE,
    deleteInitiative: NOT_THIS_LANE,
    deleteInitiativeLink: NOT_THIS_LANE,
    readInitiative: () => okAsync(read({ name: storedName })),
    readInitiativeLink: () => okAsync(READ_LINK),
    readInitiativeUpdate: NOT_THIS_LANE,
    updateInitiative: () => errAsync(boom({ operation: "linear.initiativeUpdate" })),
  };
}

function deps({ writeApi }: { writeApi: LinearInitiativeWriteApi }): LinearInitiativeWriteDeps {
  return {
    bareRefContext: () => ({ repos: [] }),
    doorLedger: memoryDoorLedger().port,
    env: () => undefined,
    err: () => undefined,
    makeApi: () => writeApi,
    nowIso: () => NOW,
    out: () => undefined,
    readForm: () => "",
    resolveToken: () => "lin_api_fake",
  };
}

describe("performWrite after a lost mutation response", () => {
  it("settles a create LANDED when its freshly-reserved id holds the initiative, and confirms it", async () => {
    const home = tempHome();
    const writeApi = api({ storedName: "Ship the thing" });

    const outcome = await performWrite({
      ctx: { api: writeApi, deps: deps({ writeApi }), fields: FIELDS, home, id: INITIATIVE_ID, verb: "create" },
    });

    expect(outcome).toEqual({ initiative: read({ name: "Ship the thing" }), kind: "landed", reason: "boom" });
    expect(readInitiativeRecord({ home, id: INITIATIVE_ID })!.confirmedIso).toBe(NOW);
  });

  it("settles an update INDETERMINATE when the stored name is not the one sent, and confirms nothing", async () => {
    const home = tempHome();
    const writeApi = api({ storedName: "Somebody renamed it" });

    const outcome = await performWrite({
      ctx: { api: writeApi, deps: deps({ writeApi }), fields: FIELDS, home, id: INITIATIVE_ID, verb: "update" },
    });

    expect(outcome).toEqual({ kind: "indeterminate", reason: "boom" });
    expect(readInitiativeRecord({ home, id: INITIATIVE_ID })).toBe(undefined);
  });
});

describe("performLink", () => {
  it("reports an acknowledged, read-back edge WRITTEN and confirms it in the append ledger", async () => {
    const home = tempHome();
    const writeApi = api({ storedName: "Ship the thing" });

    const outcome = await performLink({ api: writeApi, deps: deps({ writeApi }), form: LINK_FORM, home, id: LINK_ID });

    expect(outcome).toEqual({ kind: "written", link: READ_LINK });
    expect(readAppendRecord({ home, id: LINK_ID, kind: "linear-initiative-links" })!.confirmedIso).toBe(NOW);
  });
});
