import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseSpendImportArgs, parseSpendReadArgs } from "../../../../../cli/commands/spend/core.js";
import { runSpendImport, runSpendRead, type SpendRegisterDeps } from "../../../../../cli/commands/spend/run.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { SpendMerchantDocument } from "../../../../../spend/merchants/core.js";
import { type SpendMerchantError, SpendMerchantErrors } from "../../../../../spend/merchants/errors.js";
import { NO_MERCHANTS_NOTE } from "../../../../../spend/merchants/read.js";
import { StoreErrors } from "../../../../../store/errors.js";
import { exportText } from "../../../spend/exportFixture.js";
import { FIXTURE_MERCHANTS } from "../../../spend/merchantFixture.js";

const homes: string[] = [];

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** The fixture register, as the store would answer it. */
const REGISTERED: Result<SpendMerchantDocument, SpendMerchantError> = ok({
  merchants: FIXTURE_MERCHANTS,
  schemaVersion: 1,
});

/** A home, the lines each stream received, and edges that read the fixture export and register from memory. */
const harness = ({
  text = exportText(),
  register = REGISTERED,
}: { text?: string; register?: Result<SpendMerchantDocument, SpendMerchantError> } = {}) => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-spend-cli-"));
  homes.push(home);
  const out: string[] = [];
  const diagnostics: string[] = [];
  const registerHomes: string[] = [];
  const deps: SpendRegisterDeps = {
    defaultHome: () => home,
    now: () => "2026-03-28T01:00:00.000Z",
    readFile: () => text,
    readMerchants: async ({ home: asked }) => {
      registerHomes.push(asked);
      return register;
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, home, out, registerHomes };
};

const IMPORT = ["/tmp/card.md", "--as-of", "2026-03-28"];

describe("parseSpendImportArgs", () => {
  it("reads a path, the capture day and the switches", () => {
    expect(unwrap(parseSpendImportArgs({ rest: ["/tmp/card.md", "--as-of", "2026-03-28", "--json"] }))).toEqual({
      asOf: "2026-03-28",
      home: undefined,
      json: true,
      path: "/tmp/card.md",
    });
  });

  it("refuses an import with no capture day, rather than guessing one", () => {
    expect(unwrapErr(parseSpendImportArgs({ rest: ["/tmp/card.md"] }))).toEqual([
      "--as-of <YYYY-MM-DD> is required — the day the page was captured, never guessed",
    ]);
  });

  it("refuses a capture day in another shape", () => {
    expect(unwrapErr(parseSpendImportArgs({ rest: ["/tmp/card.md", "--as-of", "28 Sep"] }))).toEqual([
      "--as-of must be a YYYY-MM-DD day, got 28 Sep",
    ]);
  });

  it("refuses two paths", () => {
    expect(unwrapErr(parseSpendImportArgs({ rest: ["a.md", "b.md", "--as-of", "2026-03-28"] }))).toEqual([
      "spend import takes exactly one path to a saved card-page export, got 2",
    ]);
  });
});

describe("parseSpendReadArgs", () => {
  it("defaults to every card, totalled by merchant", () => {
    expect(unwrap(parseSpendReadArgs({ rest: [] }))).toEqual({
      by: "merchant",
      card: undefined,
      home: undefined,
      json: false,
    });
  });

  it("refuses an axis it does not total on", () => {
    expect(unwrapErr(parseSpendReadArgs({ rest: ["--by", "vendor"] }))).toEqual([
      "--by must be merchant or month, got vendor",
    ]);
  });

  it("refuses a card that is not four digits", () => {
    expect(unwrapErr(parseSpendReadArgs({ rest: ["--card", "42"] }))).toEqual([
      "--card must be the card's last four digits, got 42",
    ]);
  });
});

describe("spend import", () => {
  it("stores the export and names any merchant the register does not cover", async () => {
    const { deps, home, out, registerHomes } = harness();
    expect(await runSpendImport({ deps, rest: IMPORT })).toBe(0);
    expect(out).toEqual([
      `spend import: airwallex card 0042 as of 2026-03-28 — 10 row(s) → ${join(home, "spend", "cards", "airwallex-0042", "2026-03-28.json")}`,
      "  no registered merchant, kept under its own name: Google Chrome",
    ]);
    expect(registerHomes).toEqual([home]);
  });

  it("prints the empty-register note once on stderr, and lists nothing as unregistered", async () => {
    const { deps, diagnostics, out } = harness({ register: ok({ merchants: [], schemaVersion: 1 }) });
    expect(await runSpendImport({ deps, rest: IMPORT })).toBe(0);
    expect(out.length).toBe(1);
    expect(diagnostics).toEqual([`spend import: ${NO_MERCHANTS_NOTE}`]);
  });

  it("refuses before writing anything when the register cannot be read", async () => {
    const refusal = SpendMerchantErrors.queryFailed({
      cause: StoreErrors.queryFailed({ cause: new Error("connection refused"), what: "card merchants read" }),
    });
    const { deps, diagnostics, out } = harness({ register: err(refusal) });
    expect(await runSpendImport({ deps, rest: IMPORT })).toBe(1);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual([`spend import: ${refusal.message}`]);
  });

  it("exits 1 on an export missing a line it needs, naming the line", async () => {
    const { deps, diagnostics } = harness({ text: exportText({ replace: { "- Monthly:": null } }) });
    expect(await runSpendImport({ deps, rest: IMPORT })).toBe(1);
    expect(diagnostics).toEqual([
      "spend import: the export carries no Monthly limit line — was the whole card page pasted?",
    ]);
  });

  it("exits 2 on a usage error, before reading the register", async () => {
    const { deps, registerHomes } = harness();
    expect(await runSpendImport({ deps, rest: ["/tmp/card.md"] })).toBe(2);
    expect(registerHomes).toEqual([]);
  });

  it("refuses an --as-of that is not a real day", async () => {
    const { deps } = harness();
    expect(await runSpendImport({ deps, rest: ["/tmp/card.md", "--as-of", "2026-13-45"] })).toBe(2);
  });
});

describe("spend read", () => {
  it("exits 3 when nothing has been imported", async () => {
    const { deps, diagnostics } = harness();
    expect(await runSpendRead({ deps, rest: [] })).toBe(3);
    expect(diagnostics[0]).toContain("no card has been imported");
  });

  it("exits 3 for a card never imported", async () => {
    const { deps } = harness();
    await runSpendImport({ deps, rest: IMPORT });
    expect(await runSpendRead({ deps, rest: ["--card", "9999"] })).toBe(3);
  });

  it("renders headroom, the latest declines and what the page proves about them", async () => {
    const { deps, out } = harness();
    await runSpendImport({ deps, rest: IMPORT });
    out.length = 0;
    expect(await runSpendRead({ deps, rest: [] })).toBe(0);
    const lines = out[0]!.split("\n");
    expect(lines.slice(0, 8)).toEqual([
      'airwallex card 0042 "Subs | AI | Test" — EXAMPLE TRADING PTY LTD, as of 2026-03-28 (a pasted export)',
      "  monthly: 1,900.00 AUD of 2,000.00 AUD used — 100.00 AUD left, resets 2026-03-31 (reset at 10:00 AM UTC+10 the following day)",
      "  per charge: up to 500.00 AUD · merchants allowed: Anthropic, OpenAI, ChatGPT",
      "  declines: 4 on the page; the latest, 2026-03-25:",
      "    120.00 AUD ChatGPT San Francisco (openai) — over today's headroom",
      "    120.00 AUD ChatGPT San Francisco (openai) — over today's headroom",
      "    charged after them: 10.00 USD, 200.00 AUD",
      "    so the headroom they had was at least 300.00 AUD",
    ]);
    expect(lines[8]).toBe(
      "    so the monthly limit was NOT what declined them; the page gives no reason — balance or issuer, still open",
    );
    expect(lines.slice(9, 12)).toEqual([
      "  by merchant (charged only; currencies are kept apart — a USD charge counts against the AUD limit at a rate the page does not show):",
      "    anthropic  2 charge(s)  1,350.00 AUD  — Anthropic",
      "    openai     2 charge(s)  120.00 AUD + 10.00 USD  — OpenAI",
    ]);
  });

  it("groups by each merchant string and says why when the install registers none", async () => {
    const { deps, diagnostics, out } = harness({ register: ok({ merchants: [], schemaVersion: 1 }) });
    await runSpendImport({ deps, rest: IMPORT });
    out.length = 0;
    diagnostics.length = 0;
    expect(await runSpendRead({ deps, rest: [] })).toBe(0);
    const lines = out[0]!.split("\n");
    expect(lines[4]).toBe("    120.00 AUD ChatGPT San Francisco (no registered merchant) — over today's headroom");
    expect(lines.slice(10, 12)).toEqual([
      "    Anthropic  2 charge(s)  1,350.00 AUD  — Anthropic",
      "    OpenAI     2 charge(s)  120.00 AUD + 10.00 USD  — OpenAI",
    ]);
    expect(diagnostics).toEqual([`spend read: ${NO_MERCHANTS_NOTE}`]);
  });

  it("refuses rather than reading an unreadable register as an empty one", async () => {
    const refusal = SpendMerchantErrors.invalid({ issues: ["prefix acme overlaps acme cloud"] });
    const { deps, diagnostics, out } = harness();
    await runSpendImport({ deps, rest: IMPORT });
    out.length = 0;
    const refused = { ...deps, readMerchants: async () => err(refusal) };
    expect(await runSpendRead({ deps: refused, rest: [] })).toBe(1);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual([`spend read: ${refusal.message}`]);
  });

  it("refuses an unreachable store before saying nothing is imported", async () => {
    const refusal = SpendMerchantErrors.queryFailed({
      cause: StoreErrors.queryFailed({ cause: new Error("connection refused"), what: "card merchants read" }),
    });
    const { deps, diagnostics } = harness({ register: err(refusal) });
    expect(await runSpendRead({ deps, rest: [] })).toBe(1);
    expect(diagnostics).toEqual([`spend read: ${refusal.message}`]);
  });

  it("says a decline over the floor is possible, never proven, to be the monthly limit", async () => {
    const rows = ["| 2026-03-25 | OpenAI | 150.00 AUD | Declined |"];
    const { deps, out } = harness({ text: exportText({ rows }) });
    await runSpendImport({ deps, rest: IMPORT });
    out.length = 0;
    await runSpendRead({ deps, rest: [] });
    expect(out[0]).toContain(
      "the page gives no decline reason, so the monthly limit is possible, not proven — that floor is below 1 of them",
    );
  });

  it("prints the holds that lowered the floor", async () => {
    const rows = ["| 2026-03-25 | OpenAI | 50.00 AUD | Declined |", "| 2026-03-24 | OpenAI | 80.00 AUD | Cancelled |"];
    const { deps, out } = harness({ text: exportText({ rows }) });
    await runSpendImport({ deps, rest: IMPORT });
    out.length = 0;
    await runSpendRead({ deps, rest: [] });
    const lines = out[0]!.split("\n");
    expect(lines.slice(5, 8)).toEqual([
      "    cancelled or verification holds before them, which may have been holding headroom: 80.00 AUD",
      "    so the headroom they had was at least 20.00 AUD",
      "    the page gives no decline reason, so the monthly limit is possible, not proven — that floor is below 1 of them",
    ]);
  });

  it("totals by month when asked", async () => {
    const { deps, out } = harness();
    await runSpendImport({ deps, rest: IMPORT });
    out.length = 0;
    await runSpendRead({ deps, rest: ["--by", "month"] });
    expect(out[0]).toContain("    2026-02  anthropic  1,150.00 AUD");
  });

  it("emits one JSON document carrying every card", async () => {
    const { deps, out } = harness();
    await runSpendImport({ deps, rest: IMPORT });
    out.length = 0;
    await runSpendRead({ deps, rest: ["--json"] });
    const parsed = JSON.parse(out[0]!) as { cards: { last4: string; monthly: { headroom: unknown } }[] };
    expect(parsed.cards.map((card) => card.last4)).toEqual(["0042"]);
    expect(parsed.cards[0]!.monthly.headroom).toEqual({ currency: "AUD", minor: 10000 });
  });
});
