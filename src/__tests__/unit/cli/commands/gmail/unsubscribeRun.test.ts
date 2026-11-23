/**
 * Unit: the `gmail unsubscribe` shell. Every edge is a plain function — no vi.fn — and the one POST is routed
 * through `throughDoor`, which records its decision through an in-memory door ledger, exactly as
 * `modifyRun.test.ts` does. `home` stays a real `mkdtempSync` directory. The target's token is synthetic.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type GmailUnsubscribeDeps,
  parseGmailUnsubscribeArgs,
  runGmailUnsubscribe,
} from "../../../../../cli/commands/gmail/unsubscribeRun.js";
import { GMAIL_UNSUBSCRIBE_USAGE } from "../../../../../cli/commands/gmail/unsubscribeUsage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import type { GmailMessage } from "../../../../../live/gmail/parse.js";
import { oneClickPoster } from "../../../../../live/gmail/unsubscribe.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { writePrivateTerms } from "../../../../privateTermsFixture.js";

const TARGET = "https://linear.app/api/unsubscribe?token=synthetic-token&userId=u-1";

const ONE_CLICK: GmailMessage = {
  id: "m-1",
  payload: {
    headers: [
      { name: "List-Unsubscribe", value: TARGET },
      { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
    ],
  },
};

const NO_HEADER: GmailMessage = { id: "m-2", payload: { headers: [{ name: "From", value: "a@example.test" }] } };

/** Everything the fake seams recorded. */
interface Recorded {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly posted: { url: string; body: string }[];
  readonly read: string[];
}

function fresh(): Recorded {
  return { diagnostics: [], out: [], posted: [], read: [] };
}

function depsFor({
  home,
  recorded,
  message = ONE_CLICK,
  readFails = false,
  status = 200,
}: {
  home: string;
  recorded: Recorded;
  message?: GmailMessage;
  readFails?: boolean;
  status?: number;
}): GmailUnsubscribeDeps {
  return {
    doorLedger: memoryDoorLedger().port,
    home: () => home,
    post: async ({ url, body }) => {
      recorded.posted.push({ body, url: url.href });
      return ok({ status });
    },
    read: async ({ address }) => {
      recorded.read.push(address);
      return readFails ? err(GmailErrors.notConnected()) : ok(message);
    },
    writeDiagnostic: (line) => recorded.diagnostics.push(line),
    writeOut: (line) => recorded.out.push(line),
  };
}

async function withHome({ run }: { run: (args: { home: string }) => Promise<number> }): Promise<number> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-gmail-unsubscribe-"));
  try {
    return await run({ home });
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
}

describe("parseGmailUnsubscribeArgs", () => {
  it("reads the id and every flag", () => {
    expect(unwrap(parseGmailUnsubscribeArgs({ rest: ["m-1", "--dry-run", "--json", "--home", "/h"] }))).toStrictEqual({
      address: "m-1",
      dryRun: true,
      home: "/h",
      json: true,
    });
  });

  it("refuses a missing id, carrying the verb's own usage", () => {
    const refused = unwrapErr(parseGmailUnsubscribeArgs({ rest: ["--dry-run"] }));
    expect(refused.message).toBe("missing <message-id>");
    expect(refused.usage).toBe(GMAIL_UNSUBSCRIBE_USAGE);
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseGmailUnsubscribeArgs({ rest: ["m-1", "--thread"] })).code).toBe("FLAGS_INVALID");
  });
});

describe("runGmailUnsubscribe", () => {
  it("POSTs the one-click body to the sender's own target and reports the status", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailUnsubscribe({ deps: depsFor({ home, recorded }), rest: ["m-1"] }),
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.posted).toStrictEqual([{ body: "List-Unsubscribe=One-Click", url: TARGET }]);
    expect(recorded.out).toStrictEqual([
      "unsubscribed: POST List-Unsubscribe=One-Click to https://linear.app (2 path segment(s) and 2 query parameter(s) withheld) → HTTP 200",
    ]);
  });

  it("never prints the sender's token", async () => {
    const recorded = fresh();
    await withHome({
      run: ({ home }) => runGmailUnsubscribe({ deps: depsFor({ home, recorded }), rest: ["m-1", "--json"] }),
    });
    expect(recorded.posted[0]!.url).toContain("synthetic-token");
    expect(recorded.out.join("\n")).not.toContain("synthetic-token");
  });

  it("sends nothing on --dry-run", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailUnsubscribe({ deps: depsFor({ home, recorded }), rest: ["m-1", "--dry-run"] }),
    });
    expect(code).toBe(EXIT_OK);
    expect(recorded.posted).toStrictEqual([]);
    expect(recorded.out).toStrictEqual([
      "would POST List-Unsubscribe=One-Click to https://linear.app (2 path segment(s) and 2 query parameter(s) withheld) — nothing was sent",
    ]);
  });

  it("refuses a sender with no List-Unsubscribe and sends nothing", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) =>
        runGmailUnsubscribe({ deps: depsFor({ home, message: NO_HEADER, recorded }), rest: ["m-2", "--json"] }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded.posted).toStrictEqual([]);
    expect(JSON.parse(recorded.out[0]!)).toStrictEqual({
      address: "m-2",
      code: "NO_ONE_CLICK",
      offered: "none",
      unsubscribed: false,
    });
  });

  it("exits with an error when the sender answers non-2xx", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailUnsubscribe({ deps: depsFor({ home, recorded, status: 404 }), rest: ["m-1"] }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded.posted.length).toBe(1);
    expect(recorded.diagnostics).toStrictEqual([
      "gmail unsubscribe: m-1 — the sender answered the one-click POST with HTTP 404, not success — it may not have unsubscribed",
    ]);
  });

  it("exits with an error when the message cannot be read, sending nothing", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailUnsubscribe({ deps: depsFor({ home, readFails: true, recorded }), rest: ["m-1"] }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(recorded.posted).toStrictEqual([]);
    expect(recorded.diagnostics.length).toBe(1);
  });

  it("judges the POST under the explicit --home, never the default one, and sends nothing it refuses", async () => {
    const refusing = mkdtempSync(join(tmpdir(), "slopweaver-gmail-unsubscribe-refusing-"));
    const clean = mkdtempSync(join(tmpdir(), "slopweaver-gmail-unsubscribe-clean-"));
    writePrivateTerms({ home: refusing, rows: ["person\ti\tquillfeather\tsynthetic"] });
    writePrivateTerms({ home: clean, rows: ["person\ti\tzorvane\tsynthetic"] });
    const target = "https://mail.example.test/unsubscribe/quillfeather?u=1";
    const message: GmailMessage = {
      id: "m-3",
      payload: {
        headers: [
          { name: "List-Unsubscribe", value: `<${target}>` },
          { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
        ],
      },
    };
    /** One press under `--home <named>`, the default home `fallback` judging the POST the other way. */
    const press = async ({
      named,
      fallback,
    }: {
      named: string;
      fallback: string;
    }): Promise<{ code: number; fetched: string[]; said: string }> => {
      const recorded = fresh();
      const fetched: string[] = [];
      const post = oneClickPoster({
        fetch: async (input) => {
          fetched.push(input instanceof Request ? input.url : input.toString());
          return new Response(null, { status: 200 });
        },
      });
      const deps: GmailUnsubscribeDeps = { ...depsFor({ home: fallback, message, recorded }), post };
      const code = await runGmailUnsubscribe({ deps, rest: ["m-3", "--home", named] });
      return { code, fetched, said: recorded.diagnostics.join("\n") };
    };
    try {
      const refused = await press({ fallback: clean, named: refusing });
      expect(refused.code).toBe(EXIT_ERROR);
      expect(refused.fetched).toStrictEqual([]);
      expect(refused.said).toContain("gmail unsubscribe one-click url line 1: a private person term");
      expect(refused.said).not.toMatch(/quillfeather/iu);
      const sent = await press({ fallback: refusing, named: clean });
      expect(sent.code).toBe(EXIT_OK);
      expect(sent.fetched).toStrictEqual([target]);
    } finally {
      for (const made of [refusing, clean]) {
        rmSync(made, { force: true, recursive: true });
      }
    }
  });

  it("exits with a usage error and reads nothing on a missing id", async () => {
    const recorded = fresh();
    const code = await withHome({
      run: ({ home }) => runGmailUnsubscribe({ deps: depsFor({ home, recorded }), rest: [] }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recorded.read).toStrictEqual([]);
  });
});
