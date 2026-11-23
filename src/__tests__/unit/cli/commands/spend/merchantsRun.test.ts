/**
 * `spend merchants show|set` against a plain in-memory register: what each action prints, which exit each refusal
 * ends on, and that a document which does not read never reaches the write. Values are the synthetic organisation's.
 */
import { describe, expect, it } from "vitest";

import { parseSpendMerchantsArgs } from "../../../../../cli/commands/spend/merchantsCore.js";
import { runSpendMerchants, type SpendMerchantsDeps } from "../../../../../cli/commands/spend/merchantsRun.js";
import { SPEND_MERCHANTS_USAGE } from "../../../../../cli/commands/spend/usage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { SpendMerchantDocument } from "../../../../../spend/merchants/core.js";
import { type SpendMerchantError, SpendMerchantErrors } from "../../../../../spend/merchants/errors.js";
import { NO_MERCHANTS_NOTE } from "../../../../../spend/merchants/read.js";
import { StoreErrors } from "../../../../../store/errors.js";

const ACME: SpendMerchantDocument = {
  merchants: [{ prefixes: ["acme cloud"], receiptDomains: ["acme.example"], slug: "acme" }],
  schemaVersion: 1,
};

const UNREACHABLE = SpendMerchantErrors.queryFailed({
  cause: StoreErrors.queryFailed({ cause: new Error("connection refused"), what: "card merchants replace" }),
});

/** The deps over an in-memory register, and what each edge received. */
const harness = ({
  stored = ACME,
  form = "",
  writeAnswer,
}: {
  stored?: SpendMerchantDocument;
  form?: string;
  writeAnswer?: Result<SpendMerchantDocument, SpendMerchantError>;
} = {}) => {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const written: { home: string; document: SpendMerchantDocument }[] = [];
  const forms: string[] = [];
  let register = stored;
  const deps: SpendMerchantsDeps = {
    defaultHome: () => "/home/default",
    readForm: ({ form: asked }) => {
      forms.push(asked);
      if (asked === "/missing.json") {
        throw new Error("ENOENT: no such file");
      }
      return form;
    },
    readMerchants: async () => ok(register),
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeMerchants: async ({ document, home }) => {
      written.push({ document, home });
      if (writeAnswer !== undefined) {
        return writeAnswer;
      }
      register = document;
      return ok(register);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, forms, out, written };
};

describe("parseSpendMerchantsArgs", () => {
  it("reads show and set", () => {
    expect(unwrap(parseSpendMerchantsArgs({ rest: ["show", "--json"] }))).toEqual({
      action: "show",
      home: undefined,
      json: true,
    });
    expect(unwrap(parseSpendMerchantsArgs({ rest: ["set", "--form", "-", "--home", "/h"] }))).toEqual({
      action: "set",
      form: "-",
      home: "/h",
      json: false,
    });
  });

  it("refuses no action, an unknown one, a set with no form and a show with one", () => {
    expect(unwrapErr(parseSpendMerchantsArgs({ rest: [] })).message).toBe(
      "spend merchants takes exactly one action, show or set, got none",
    );
    expect(unwrapErr(parseSpendMerchantsArgs({ rest: ["add", "acme"] })).message).toBe(
      "spend merchants takes exactly one action, show or set, got add acme",
    );
    expect(unwrapErr(parseSpendMerchantsArgs({ rest: ["set"] })).message).toBe(
      "spend merchants set needs --form <path|-> — the whole register, as one JSON document",
    );
    expect(unwrapErr(parseSpendMerchantsArgs({ rest: ["show", "--form", "x.json"] })).message).toBe(
      "spend merchants show takes no --form — `spend merchants set --form <path|->` replaces the register",
    );
  });
});

describe("runSpendMerchants show", () => {
  it("prints the register as lines, and as the exact document under --json", async () => {
    const lines = harness();
    expect(await runSpendMerchants({ deps: lines.deps, rest: ["show"] })).toBe(EXIT_OK);
    expect(lines.out).toEqual([
      "spend merchants: 1 registered",
      '  acme  prefixes "acme cloud"  receipts from acme.example',
    ]);
    const json = harness();
    expect(await runSpendMerchants({ deps: json.deps, rest: ["show", "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(json.out[0]!)).toEqual(ACME);
  });

  it("prints an empty register with the note on stderr", async () => {
    const { deps, diagnostics, out } = harness({ stored: { merchants: [], schemaVersion: 1 } });
    expect(await runSpendMerchants({ deps, rest: ["show", "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!)).toEqual({ merchants: [], schemaVersion: 1 });
    expect(diagnostics).toEqual([`spend merchants show: ${NO_MERCHANTS_NOTE}`]);
  });

  it("exits 1 when the register cannot be read", async () => {
    const { deps, diagnostics } = harness();
    const refused = { ...deps, readMerchants: async () => err(UNREACHABLE) };
    expect(await runSpendMerchants({ deps: refused, rest: ["show"] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([`spend merchants show: ${UNREACHABLE.message}`]);
  });
});

describe("runSpendMerchants set", () => {
  it("replaces the whole register under --home and prints what the store holds", async () => {
    const offered = {
      merchants: [
        { prefixes: ["Globex Corp"], receiptDomains: [], slug: "globex" },
        { prefixes: ["ACME"], receiptDomains: ["acme.example"], slug: "acme" },
      ],
      schemaVersion: 1,
    };
    const { deps, out, written } = harness({ form: JSON.stringify(offered) });
    expect(await runSpendMerchants({ deps, rest: ["set", "--form", "-", "--home", "/home/other", "--json"] })).toBe(
      EXIT_OK,
    );
    const canonical = {
      merchants: [
        { prefixes: ["acme"], receiptDomains: ["acme.example"], slug: "acme" },
        { prefixes: ["globex corp"], receiptDomains: [], slug: "globex" },
      ],
      schemaVersion: 1,
    };
    expect(written).toEqual([{ document: canonical, home: "/home/other" }]);
    expect(JSON.parse(out[0]!)).toEqual(canonical);
  });

  it("exits 2 on a form that is not JSON, or does not read, and writes nothing", async () => {
    const notJson = harness({ form: "{merchants" });
    expect(await runSpendMerchants({ deps: notJson.deps, rest: ["set", "--form", "m.json"] })).toBe(EXIT_USAGE);
    expect(notJson.diagnostics[0]).toContain("spend merchants set: m.json is not JSON");
    const overlapping = harness({
      form: JSON.stringify({
        merchants: [
          { prefixes: ["acme"], receiptDomains: [], slug: "acme" },
          { prefixes: ["acme cloud"], receiptDomains: [], slug: "cloud" },
        ],
        schemaVersion: 1,
      }),
    });
    expect(await runSpendMerchants({ deps: overlapping.deps, rest: ["set", "--form", "m.json"] })).toBe(EXIT_USAGE);
    expect(overlapping.diagnostics).toEqual([
      'spend merchants set: the card-merchant register does not read: merchant cloud: prefix "acme cloud" ' +
        'overlaps "acme" of acme, so a charge could match both',
    ]);
    expect([...notJson.written, ...overlapping.written]).toEqual([]);
  });

  it("exits 1 on a form it cannot read, and on a store that refuses the write", async () => {
    const missing = harness();
    expect(await runSpendMerchants({ deps: missing.deps, rest: ["set", "--form", "/missing.json"] })).toBe(EXIT_ERROR);
    expect(missing.diagnostics).toEqual(["spend merchants set: could not read /missing.json: ENOENT: no such file"]);
    const refused = harness({ form: JSON.stringify(ACME), writeAnswer: err(UNREACHABLE) });
    expect(await runSpendMerchants({ deps: refused.deps, rest: ["set", "--form", "-"] })).toBe(EXIT_ERROR);
    expect(refused.diagnostics).toEqual([`spend merchants set: ${UNREACHABLE.message}`]);
  });

  it("refuses a usage error with the usage, reading no form, and prints the usage on --help", async () => {
    const refused = harness();
    expect(await runSpendMerchants({ deps: refused.deps, rest: ["set"] })).toBe(EXIT_USAGE);
    expect(refused.diagnostics.at(-1)).toBe(SPEND_MERCHANTS_USAGE);
    expect(refused.forms).toEqual([]);
    const help = harness();
    expect(await runSpendMerchants({ deps: help.deps, rest: ["--help"] })).toBe(EXIT_OK);
    expect(help.out).toEqual([SPEND_MERCHANTS_USAGE]);
  });
});
