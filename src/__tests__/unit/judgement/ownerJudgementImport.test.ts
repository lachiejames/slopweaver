/**
 * An applied import's owner-judgement writer over a scripted client (`../../scriptedStoreClient.ts`): the statements
 * it issues inside the caller's transaction, the count it reports, and which failure a missing live version or a
 * driver throw becomes. What only a real database proves — the import-origin CHECK, the one-active-version index, the
 * question key — is the opt-in `src/__tests__/integration/storeImportWriters.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { OwnerCorrection, OwnerDirective } from "../../../judgement/ownerDirective.js";
import {
  type ImportedCorrectionVersion,
  type ImportedDirectiveVersion,
  writeImportedOwnerJudgement,
} from "../../../judgement/ownerJudgementImport.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type ScriptedStatement, scriptedStoreClient } from "../../scriptedStoreClient.js";

const SOURCE = { contentHash: `sha256:${"a".repeat(64)}`, file: "acme-rule.md", modified: null } as const;

/** One directive under the synthetic organisation's rule file. */
function directive({ id }: { id: string }): OwnerDirective {
  return { id, source: SOURCE, text: `rule ${id}` };
}

/** One correction under the same file. */
function correction({ id }: { id: string }): OwnerCorrection {
  return {
    id,
    source: SOURCE,
    subject: {
      container: "C0ACME",
      source: "slack",
      sourceId: "1700000000.000100",
      url: "https://acme.example/archives/C0ACME/p1700000000000100",
    },
    text: `correction ${id}`,
  };
}

/**
 * The verb and target of each statement, so a test asserts the order without restating Drizzle's SQL.
 *
 * @param statements what the client was sent
 * @returns one `verb "table"` line each
 */
function shapes({ statements }: { statements: readonly ScriptedStatement[] }): readonly string[] {
  return statements.map(({ query }) => {
    const table = /(?:from|into|update) ("[a-z_]+")/u.exec(query);
    const verb = query.split(" ")[0]!;
    return table === null ? verb : `${verb} ${table[1]!}`;
  });
}

/**
 * Run the writer in a transaction over a database whose every retirement finds `retired` active versions.
 *
 * @param retired how many rows each retiring UPDATE answers
 * @param directives the directive versions to write
 * @param corrections the correction versions to write
 * @returns the writer's outcome and every statement it issued
 */
async function write({
  retired,
  directives,
  corrections,
}: {
  retired: number;
  directives: readonly ImportedDirectiveVersion[];
  corrections: readonly ImportedCorrectionVersion[];
}): Promise<{
  outcome: Awaited<ReturnType<typeof writeImportedOwnerJudgement>>;
  statements: readonly ScriptedStatement[];
}> {
  const { client, statements } = scriptedStoreClient({
    answer: ({ query }) => (query.startsWith("update") ? Array.from({ length: retired }, () => ["row-old"]) : []),
  });
  const outcome = await client.db.transaction(async (writer) =>
    writeImportedOwnerJudgement({ corrections, directives, writer }),
  );
  return { outcome, statements: statements() };
}

describe("writeImportedOwnerJudgement", () => {
  it("retires a taken-over version before inserting its import, inserts an inactive one alone, and counts every row", async () => {
    const { outcome, statements } = await write({
      corrections: [{ questionId: "q-3", retiresCurrent: true, state: "active", value: correction({ id: "c-one" }) }],
      directives: [
        { questionId: "q-1", retiresCurrent: true, state: "active", value: directive({ id: "d-one" }) },
        { questionId: "q-2", retiresCurrent: false, state: "inactive", value: directive({ id: "d-two" }) },
      ],
      retired: 1,
    });
    expect(unwrap(outcome)).toBe(5);
    expect(shapes({ statements })).toEqual([
      'update "owner_directive"',
      'insert "owner_directive"',
      'insert "owner_directive"',
      'update "owner_correction"',
      'insert "owner_correction"',
    ]);
    expect(statements[0]!.params).toEqual(["inactive", "active", "d-one"]);
    expect(statements[1]!.params).toContain("store-import");
    expect(statements[1]!.params).toContain("q-1");
    expect(statements[2]!.params).toContain("q-2");
  });

  it("writes nothing for an import carrying no instruction", async () => {
    const { outcome, statements } = await write({ corrections: [], directives: [], retired: 0 });
    expect(unwrap(outcome)).toBe(0);
    expect(statements).toEqual([]);
  });

  it("refuses a directive takeover whose live version no longer stands, inserting nothing for it", async () => {
    const { outcome, statements } = await write({
      corrections: [],
      directives: [{ questionId: "q-1", retiresCurrent: true, state: "active", value: directive({ id: "d-gone" }) }],
      retired: 0,
    });
    const refused = unwrapErr(outcome);
    expect(refused.code).toBe("OWNER_DIRECTIVE_IMPORT_TARGET_GONE");
    expect(refused.message).toBe(
      "the import takes directive d-gone over a live version, and no active version of it is stored; plan the import again",
    );
    expect(shapes({ statements })).toEqual(['update "owner_directive"']);
  });

  it("refuses a correction takeover whose live version no longer stands, after the directives were written", async () => {
    const { outcome, statements } = await write({
      corrections: [{ questionId: "q-2", retiresCurrent: true, state: "active", value: correction({ id: "c-gone" }) }],
      directives: [{ questionId: "q-1", retiresCurrent: false, state: "active", value: directive({ id: "d-new" }) }],
      retired: 0,
    });
    expect(unwrapErr(outcome).message).toBe(
      "the import takes correction c-gone over a live version, and no active version of it is stored; plan the import again",
    );
    expect(shapes({ statements })).toEqual(['insert "owner_directive"', 'update "owner_correction"']);
  });

  it("refuses a directive retiring the live one while written inactive, before any statement", async () => {
    const { outcome, statements } = await write({
      corrections: [],
      directives: [
        { questionId: "q-1", retiresCurrent: false, state: "active", value: directive({ id: "d-new" }) },
        { questionId: "q-2", retiresCurrent: true, state: "inactive", value: directive({ id: "d-one" }) },
      ],
      retired: 1,
    });
    const refused = unwrapErr(outcome);
    expect(refused.code).toBe("OWNER_DIRECTIVE_IMPORT_ANSWER_CONTRADICTORY");
    expect(refused.message).toBe(
      "the import would retire the live directive d-one while writing its own version inactive, which no answer asks for; nothing was written",
    );
    expect(statements).toEqual([]);
  });

  it("refuses a correction retiring the live one while written inactive, before any statement", async () => {
    const { outcome, statements } = await write({
      corrections: [{ questionId: "q-3", retiresCurrent: true, state: "inactive", value: correction({ id: "c-one" }) }],
      directives: [{ questionId: "q-1", retiresCurrent: false, state: "active", value: directive({ id: "d-new" }) }],
      retired: 1,
    });
    expect(unwrapErr(outcome).message).toBe(
      "the import would retire the live correction c-one while writing its own version inactive, which no answer asks for; nothing was written",
    );
    expect(statements).toEqual([]);
  });

  it("reads a driver throw as OWNER_DIRECTIVE_STORE_UNAVAILABLE by its innermost reason, not Drizzle's wrapper", async () => {
    const { client } = scriptedStoreClient({
      answer: () => {
        throw new Error('duplicate key value violates unique constraint "uq_owner_directive_import_question"');
      },
    });
    const outcome = await client.db.transaction(async (writer) =>
      writeImportedOwnerJudgement({
        corrections: [],
        directives: [{ questionId: "q-1", retiresCurrent: false, state: "active", value: directive({ id: "d-one" }) }],
        writer,
      }),
    );
    const refused = unwrapErr(outcome);
    expect(refused.code).toBe("OWNER_DIRECTIVE_STORE_UNAVAILABLE");
    expect(refused.message).toBe(
      'the store could not take an imported version for owner directives: duplicate key value violates unique constraint "uq_owner_directive_import_question"',
    );
  });
});
