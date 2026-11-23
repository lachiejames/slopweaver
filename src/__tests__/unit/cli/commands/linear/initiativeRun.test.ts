/**
 * `linear initiative <create|update|link>` — the strategy layer this door had no words for at all.
 *
 * The cases pin the four things that make it a different write from a project rather than a copy: `status`
 * is a CLOSED enum the form refuses locally (a project's is opaque, and the difference is Linear's), the
 * `link` sub-verb reserves in the append ledger rather than the reserve-then-confirm one, an `update`
 * refuses without an ownership record, and the dry run leaves nothing behind.
 *
 * Every edge is a plain injected function. No mocks.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterAll, describe, expect, it } from "vitest";

import { linearVerbErrorLines } from "../../../../../cli/commands/linear/errors.js";
import {
  initiativeDryRunLines,
  initiativeInputFor,
  initiativeIntentId,
  initiativeLinkIntentId,
  initiativeOutcomeLines,
  initiativeWriteId,
  parseLinearInitiativeArgs,
  parseLinearInitiativeForm,
  parseLinearInitiativeLinkForm,
} from "../../../../../cli/commands/linear/initiativeCore.js";
import type { LinearInitiativeWriteDeps } from "../../../../../cli/commands/linear/initiativeDeps.js";
import { runLinearInitiative } from "../../../../../cli/commands/linear/initiativeRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { WrittenObject } from "../../../../../corpus/linear/write.js";
import type {
  LinearInitiativeWriteApi,
  ReadInitiative,
  ReadInitiativeLink,
} from "../../../../../corpus/linear/writeInitiative.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readAppendRecord } from "../../../../../outbound/linear/commentLedger.js";
import { readInitiativeRecord, readProjectRecord } from "../../../../../outbound/linear/projectLedger.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

/** Every scratch home this file mints, removed in `afterAll` — see `.claude/rules/testing.md`. */
const homes: string[] = [];

afterAll(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-initiative-"));
  homes.push(home);
  return home;
}

const FORM_TEXT = JSON.stringify({
  fields: { description: "one line", name: "Ship the thing", status: "Planned", targetDate: "2026-12-31" },
});

const LINK_FORM_TEXT = JSON.stringify({
  fields: { initiativeId: "aa831adf-e969-430b-abd3-d72397f6b8e9", projectId: "92f14fe7-e9a9-4f21-a7b1-0305e82c3301" },
});

// What a write echoes under `@linear/sdk`: the bare id, and nothing a report could print.
const WRITTEN: WrittenObject = { id: "i1" };

const READ: ReadInitiative = {
  description: "one line",
  id: "i1",
  name: "Ship the thing",
  slugId: "s1",
  status: "Planned",
  targetDate: "2026-12-31",
  updatedAt: "2026-09-07T00:00:00.000Z",
  url: "https://linear.test/initiative/ship-the-thing-s1",
};

const WRITTEN_LINK: WrittenObject = { id: "l1" };

const READ_LINK: ReadInitiativeLink = {
  id: "l1",
  initiativeId: "aa831adf-e969-430b-abd3-d72397f6b8e9",
  projectId: "92f14fe7-e9a9-4f21-a7b1-0305e82c3301",
};

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.initiativeCreate", provider: "linear" };
}

const NOT_THIS_LANE = (): never => {
  throw new Error("this case never reaches that arm of the initiative lane");
};

function harness({
  create,
  read,
  form = FORM_TEXT,
}: {
  create?: "ok" | "fail";
  read?: "ok" | "missing";
  form?: string;
}): {
  deps: LinearInitiativeWriteDeps;
  calls: string[];
  out: string[];
  err: string[];
} {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const api: LinearInitiativeWriteApi = {
    archiveInitiativeUpdate: NOT_THIS_LANE,
    createInitiative: ({ id }) => {
      calls.push(`create:${id}`);
      return create === "fail" ? errAsync(ingestError({ message: "boom" })) : okAsync(WRITTEN);
    },
    createInitiativeLink: ({ id }) => {
      calls.push(`link:${id}`);
      return create === "fail" ? errAsync(ingestError({ message: "boom" })) : okAsync(WRITTEN_LINK);
    },
    createInitiativeUpdate: NOT_THIS_LANE,
    deleteInitiative: NOT_THIS_LANE,
    deleteInitiativeLink: NOT_THIS_LANE,
    readInitiative: () => {
      calls.push("read");
      return read === "missing" ? okAsync(undefined) : okAsync(READ);
    },
    readInitiativeLink: () => {
      calls.push("read-link");
      return read === "missing" ? okAsync(undefined) : okAsync(READ_LINK);
    },
    readInitiativeUpdate: NOT_THIS_LANE,
    updateInitiative: ({ id }) => {
      calls.push(`update:${id}`);
      return okAsync(WRITTEN);
    },
  };
  return {
    calls,
    deps: {
      bareRefContext: () => ({ repos: [] }),
      doorLedger: memoryDoorLedger().port,
      env: () => undefined,
      err: (line) => err.push(line),
      makeApi: () => api,
      nowIso: () => "2026-09-07T00:00:00.000Z",
      out: (line) => out.push(line),
      readForm: () => form,
      resolveToken: () => "lin_api_fake",
    },
    err,
    out,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "initiative", ...rest];
}

describe("the form", () => {
  it("refuses a status Linear's InitiativeStatus enum does not carry", () => {
    const parsed = parseLinearInitiativeForm({ raw: JSON.stringify({ fields: { name: "n", status: "InProgress" } }) });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual(["fields.status: Invalid input"]);
  });

  it("refuses the lowercased spelling, because the wire format is capitalised", () => {
    const parsed = parseLinearInitiativeForm({ raw: JSON.stringify({ fields: { name: "n", status: "planned" } }) });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual(["fields.status: Invalid input"]);
  });

  it("accepts the minimum an initiative can be: a name", () => {
    expect(unwrap(parseLinearInitiativeForm({ raw: JSON.stringify({ fields: { name: "n" } }) })).fields.name).toBe("n");
  });

  it("refuses a multi-line description, which Linear renders as one line and would silently truncate", () => {
    const parsed = parseLinearInitiativeForm({
      raw: JSON.stringify({ fields: { description: "a\nb", name: "n" } }),
    });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "fields.description: an initiative description renders as ONE line; the newline would be dropped silently",
    ]);
  });

  it("refuses a target date that is not Linear's TimelessDate format", () => {
    const parsed = parseLinearInitiativeForm({
      raw: JSON.stringify({ fields: { name: "n", targetDate: "31/12/26" } }),
    });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "fields.targetDate: a target date is YYYY-MM-DD (Linear's TimelessDate wire format)",
    ]);
  });

  it("refuses an unknown field outright rather than dropping it", () => {
    const parsed = parseLinearInitiativeForm({ raw: JSON.stringify({ fields: { colour: "red", name: "n" } }) });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      'fields: unknown field "colour" — REFUSED, not ignored. No field here is close to it, so it is probably ' +
        "a field from another schema.\n" +
        "this form's fields are: description, leadTeamId, name, ownerId, status, targetDate",
    ]);
  });
});

describe("parsing the invocation", () => {
  it("requires --initiative-id for an update, since the ledger is the only ownership evidence", () => {
    const parsed = parseLinearInitiativeArgs({ argv: ["update", "--form", "-"] });

    expect(parsed.isErr()).toBe(true);
    expect(linearVerbErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toContain(
      "--initiative-id <uuid> is required for update",
    );
  });

  it("refuses an --initiative-id that is not a UUID, because it reaches a ledger filename", () => {
    const parsed = parseLinearInitiativeArgs({ argv: ["update", "--form", "-", "--initiative-id", "../../etc"] });

    expect(parsed.isErr()).toBe(true);
    expect(linearVerbErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toContain("must be a UUID v4");
  });

  it("refuses --initiative-id on a link, whose form already names both endpoints", () => {
    const parsed = parseLinearInitiativeArgs({
      argv: ["link", "--form", "-", "--initiative-id", "aa831adf-e969-430b-abd3-d72397f6b8e9"],
    });

    expect(parsed.isErr()).toBe(true);
    expect(linearVerbErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toContain("not meaningful for link");
  });
});

describe("the provider input", () => {
  it("carries the name and OMITS every unset optional rather than sending null", () => {
    const input = initiativeInputFor({ fields: { name: "Ship the thing" } });

    expect(input).toStrictEqual({ name: "Ship the thing" });
  });

  it("carries every field the form did set", () => {
    const input = initiativeInputFor({ fields: unwrap(parseLinearInitiativeForm({ raw: FORM_TEXT })).fields });

    expect(input["status"]).toBe("Planned");
    expect(input["targetDate"]).toBe("2026-12-31");
    expect(input["description"]).toBe("one line");
  });
});

describe("the intent ids", () => {
  it("is stable for the same initiative, so a retry after a lost response reuses it", () => {
    const form = unwrap(parseLinearInitiativeForm({ raw: FORM_TEXT }));

    expect(initiativeIntentId({ form })).toBe(initiativeIntentId({ form }));
  });

  it("is stable for the same EDGE, so the same project cannot be joined twice", () => {
    const form = unwrap(parseLinearInitiativeLinkForm({ raw: LINK_FORM_TEXT }));

    expect(initiativeLinkIntentId({ form })).toBe(initiativeLinkIntentId({ form }));
  });

  it("differs when the endpoints do", () => {
    const a = unwrap(parseLinearInitiativeLinkForm({ raw: LINK_FORM_TEXT }));
    const b = unwrap(
      parseLinearInitiativeLinkForm({
        raw: JSON.stringify({ fields: { initiativeId: "aa831adf-e969-430b-abd3-d72397f6b8e9", projectId: "other" } }),
      }),
    );

    expect(initiativeLinkIntentId({ form: a })).not.toBe(initiativeLinkIntentId({ form: b }));
  });
});

describe("initiativeWriteId", () => {
  const form = unwrap(parseLinearInitiativeForm({ raw: FORM_TEXT }));

  it("uses the --initiative-id the operator named", () => {
    const args = unwrap(
      parseLinearInitiativeArgs({ argv: ["update", "--form", "-", "--initiative-id", READ_LINK.initiativeId] }),
    );
    expect(initiativeWriteId({ args, form })).toBe("aa831adf-e969-430b-abd3-d72397f6b8e9");
  });

  it("derives a create's id from its intent", () => {
    const args = unwrap(parseLinearInitiativeArgs({ argv: ["create", "--form", "-"] }));
    expect(initiativeWriteId({ args, form })).toBe(initiativeIntentId({ form }));
  });
});

describe("initiativeDryRunLines — what an unset field says the write will do", () => {
  it("previews none for every unset field, and the Linear default for an unset status", () => {
    const form = unwrap(parseLinearInitiativeForm({ raw: JSON.stringify({ fields: { name: "n" } }) }));
    expect(initiativeDryRunLines({ form, id: "id-1" }).slice(1)).toEqual([
      "name:          n",
      "description:   (none)",
      "owner:         (none)",
      "status:        (Linear default)",
      "target:        (none)",
      "lead team:     (none)",
    ]);
  });

  it("previews every field the form sets", () => {
    const form = unwrap(parseLinearInitiativeForm({ raw: FORM_TEXT }));
    expect(initiativeDryRunLines({ form, id: "id-1" }).slice(2, 5)).toEqual([
      "description:   one line",
      "owner:         (none)",
      "status:        Planned",
    ]);
  });
});

describe("the dry run", () => {
  it("prints the resolved fields and performs no effect at all", async () => {
    const home = tempHome();
    const h = harness({});

    const code = await runLinearInitiative({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toStrictEqual([]);
    expect(h.out).toContain("status:        Planned");
    const id = initiativeIntentId({ form: unwrap(parseLinearInitiativeForm({ raw: FORM_TEXT })) });
    expect(readInitiativeRecord({ home, id })).toBe(undefined);
  });

  it("prints both endpoints for a link and reserves nothing", async () => {
    const home = tempHome();
    const h = harness({ form: LINK_FORM_TEXT });

    const code = await runLinearInitiative({
      argv: argv({ rest: ["link", "--form", "-", "--dry-run", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toStrictEqual([]);
    expect(h.out).toContain("project:    92f14fe7-e9a9-4f21-a7b1-0305e82c3301");
  });
});

describe("the live write", () => {
  it("reserves, creates, reads back, confirms and reports the URL", async () => {
    const home = tempHome();
    const h = harness({});

    const code = await runLinearInitiative({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    const id = initiativeIntentId({ form: unwrap(parseLinearInitiativeForm({ raw: FORM_TEXT })) });
    expect(h.calls).toStrictEqual([`create:${id}`, "read"]);
    expect(h.out[1]).toBe("https://linear.test/initiative/ship-the-thing-s1");
    expect(readInitiativeRecord({ home, id })!.confirmedIso).toBe("2026-09-07T00:00:00.000Z");
  });

  it("refuses a SECOND create of the identical intent, because the id is already reserved", async () => {
    const home = tempHome();
    const first = harness({});
    await runLinearInitiative({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps });
    const second = harness({});

    const code = await runLinearInitiative({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.calls).toStrictEqual([]);
    expect(second.out[0]).toContain("already reserved at 2026-09-07T00:00:00.000Z");
  });

  it("refuses an update of an initiative slopweaver has no record of creating", async () => {
    const home = tempHome();
    const h = harness({});

    const code = await runLinearInitiative({
      argv: argv({
        rest: ["update", "--form", "-", "--initiative-id", "aa831adf-e969-430b-abd3-d72397f6b8e9", "--home", home],
      }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).toStrictEqual([]);
    expect(h.err[0]).toContain("no record of creating initiative");
  });

  it("says the write is UNCONFIRMED when the read-back finds nothing, and does not claim it landed", async () => {
    const home = tempHome();
    const h = harness({ read: "missing" });

    const code = await runLinearInitiative({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out[0]).toContain("could NOT be read back");
    const id = initiativeIntentId({ form: unwrap(parseLinearInitiativeForm({ raw: FORM_TEXT })) });
    expect(readInitiativeRecord({ home, id })!.confirmedIso).toBe(undefined);
  });

  it("reports FAILED when the mutation errored and the id holds nothing", async () => {
    const home = tempHome();
    const h = harness({ create: "fail", read: "missing" });

    const code = await runLinearInitiative({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(1);
    expect(h.out[0]).toContain("the write failed: boom");
  });

  it("reports LANDED when the mutation errored but the id holds what we asked for", async () => {
    const home = tempHome();
    const h = harness({ create: "fail" });

    const code = await runLinearInitiative({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.out[0]).toContain("despite a transport error");
  });

  it("asserts a link and records it in the APPEND ledger, not the reserve-then-confirm one", async () => {
    const home = tempHome();
    const h = harness({ form: LINK_FORM_TEXT });

    const code = await runLinearInitiative({
      argv: argv({ rest: ["link", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    const id = initiativeLinkIntentId({ form: unwrap(parseLinearInitiativeLinkForm({ raw: LINK_FORM_TEXT })) });
    expect(h.calls).toStrictEqual([`link:${id}`, "read-link"]);
    expect(readAppendRecord({ home, id, kind: "linear-initiative-links" })!.confirmedIso).toBe(
      "2026-09-07T00:00:00.000Z",
    );
    // The two ledgers are separate directories, so a link is findable ONLY in the append one.
    expect(readInitiativeRecord({ home, id })).toBe(undefined);
    expect(readProjectRecord({ home, id })).toBe(undefined);
  });

  it("refuses the SAME edge twice", async () => {
    const home = tempHome();
    await runLinearInitiative({
      argv: argv({ rest: ["link", "--form", "-", "--home", home] }),
      deps: harness({ form: LINK_FORM_TEXT }).deps,
    });
    const second = harness({ form: LINK_FORM_TEXT });

    const code = await runLinearInitiative({
      argv: argv({ rest: ["link", "--form", "-", "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.calls).toStrictEqual([]);
    expect(second.out[0]).toContain("already reserved");
  });

  it("refuses a malformed link form before any effect", async () => {
    const h = harness({ form: JSON.stringify({ fields: { initiativeId: "i" } }) });

    const code = await runLinearInitiative({
      argv: argv({ rest: ["link", "--form", "-", "--home", tempHome()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.calls).toStrictEqual([]);
  });
});

describe("the report", () => {
  it("names the verb that happened rather than the one that was asked for", () => {
    expect(initiativeOutcomeLines({ outcome: { initiative: READ, kind: "written" }, verb: "update" })[0]).toBe(
      'updated initiative "Ship the thing"',
    );
  });

  it("tells a reader NOT to re-run an indeterminate write", () => {
    const lines = initiativeOutcomeLines({ outcome: { kind: "indeterminate", reason: "boom" }, verb: "create" });

    expect(lines.some((line) => line.includes("Do NOT re-run this"))).toBe(true);
  });
});
