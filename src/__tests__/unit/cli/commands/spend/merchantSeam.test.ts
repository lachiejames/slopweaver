/**
 * The seam every `spend` reader takes the card-merchant register through: a registered register runs silently, an
 * empty one runs with its note on the diagnostic channel, and one that will not read refuses the verb.
 */
import { describe, expect, it } from "vitest";

import { type ReadSpendMerchants, registeredMerchants } from "../../../../../cli/commands/spend/merchantSeam.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { SpendMerchantErrors } from "../../../../../spend/merchants/errors.js";
import { NO_MERCHANTS_NOTE } from "../../../../../spend/merchants/read.js";
import { StoreErrors } from "../../../../../store/errors.js";
import { FIXTURE_MERCHANTS } from "../../../spend/merchantFixture.js";

/** Run the seam against one fixed register read, recording the home it was asked for and every note. */
async function run({ register }: { register: Awaited<ReturnType<ReadSpendMerchants>> }) {
  const homes: string[] = [];
  const notes: string[] = [];
  const result = await registeredMerchants({
    deps: {
      readMerchants: ({ home }) => {
        homes.push(home);
        return Promise.resolve(register);
      },
      writeDiagnostic: (line) => notes.push(line),
    },
    home: "/home/fixture",
    verb: "spend read",
  });
  return { homes, notes, result };
}

describe("registeredMerchants", () => {
  it("returns the registered merchants and writes no note", async () => {
    const { homes, notes, result } = await run({ register: ok({ merchants: FIXTURE_MERCHANTS, schemaVersion: 1 }) });
    expect(unwrap(result)).toEqual(FIXTURE_MERCHANTS);
    expect(homes).toEqual(["/home/fixture"]);
    expect(notes).toEqual([]);
  });

  it("returns no merchant and writes the note once, prefixed with the verb, on an empty register", async () => {
    const { notes, result } = await run({ register: ok({ merchants: [], schemaVersion: 1 }) });
    expect(unwrap(result)).toEqual([]);
    expect(notes).toEqual([`spend read: ${NO_MERCHANTS_NOTE}`]);
  });

  it("refuses an unreachable store and writes its reason, prefixed with the verb, in place of the note", async () => {
    const unreachable = SpendMerchantErrors.queryFailed({
      cause: StoreErrors.queryFailed({ cause: new Error("connection refused"), what: "card merchants read" }),
    });
    const { notes, result } = await run({ register: err(unreachable) });
    expect(unwrapErr(result)).toEqual(unreachable);
    expect(notes).toEqual([`spend read: ${unreachable.message}`]);
  });
});
