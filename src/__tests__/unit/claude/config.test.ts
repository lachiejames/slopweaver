import { describe, expect, it } from "vitest";

import {
  aliasForStoreDir,
  conventionalStoreDir,
  parseClaudeAccounts,
  pinnedAccountAlias,
  planLabel,
  planLabelFor,
  storeDirDepartures,
} from "../../../claude/config.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** What every parsed account carries when its row names no usage limit: the whole of its weekly window. */
const WHOLE_WEEK = { allowance: { kind: "weekly-window" }, usageLimitPercent: 100 } as const;

describe("parseClaudeAccounts", () => {
  it("accepts two plans in configured order", () => {
    const accounts = unwrap(
      parseClaudeAccounts({
        value: [
          { alias: "plan-one", storeDir: "/tmp/one" },
          { alias: "plan-two", storeDir: "/tmp/two" },
        ],
      }),
    );
    expect(accounts).toStrictEqual([
      { alias: "plan-one", storeDir: "/tmp/one", ...WHOLE_WEEK },
      { alias: "plan-two", storeDir: "/tmp/two", ...WHOLE_WEEK },
    ]);
  });

  it("accepts a fourth plan with no change — the owner's N-plan ruling", () => {
    const accounts = unwrap(
      parseClaudeAccounts({
        value: [1, 2, 3, 4].map((n) => ({ alias: `plan-${n}`, storeDir: `/tmp/${n}` })),
      }),
    );
    expect(accounts.length).toBe(4);
    expect(accounts[3]?.alias).toBe("plan-4");
  });

  // Rotation does not need two plans. One plan is a whole fleet, not a register on its way.
  it("accepts a single plan as the whole fleet", () => {
    expect(unwrap(parseClaudeAccounts({ value: [{ alias: "plan-one", storeDir: "/tmp/one" }] }))).toStrictEqual([
      { alias: "plan-one", storeDir: "/tmp/one", ...WHOLE_WEEK },
    ]);
  });

  it("accepts no plans at all — whether empty means emptied is the reader's call, not the parser's", () => {
    expect(unwrap(parseClaudeAccounts({ value: [] }))).toStrictEqual([]);
  });

  it("reports a malformed single row as a structural problem", () => {
    const error = unwrapErr(parseClaudeAccounts({ value: [{ alias: "UPPER", storeDir: "/tmp/one" }] }));
    expect(error.code).toBe("ACCOUNT_CONFIG_INVALID");
  });

  it("accepts a single paused plan, a deliberate stop rather than a broken register", () => {
    const accounts = unwrap(
      parseClaudeAccounts({
        value: [
          { alias: "plan-one", paused: { reason: "lapsed", sinceIso: "2026-10-30T00:00:00Z" }, storeDir: "/tmp/one" },
        ],
      }),
    );
    expect(accounts.map((account) => [account.alias, account.paused?.reason])).toStrictEqual([["plan-one", "lapsed"]]);
  });

  it("accepts one live plan out of two, and every plan paused", () => {
    const paused = { reason: "lapsed", sinceIso: "2026-10-30T00:00:00Z" };
    const oneLive = unwrap(
      parseClaudeAccounts({
        value: [
          { alias: "plan-one", storeDir: "/tmp/one" },
          { alias: "plan-two", paused, storeDir: "/tmp/two" },
        ],
      }),
    );
    const nonePaused = unwrap(
      parseClaudeAccounts({
        value: [
          { alias: "plan-one", paused, storeDir: "/tmp/one" },
          { alias: "plan-two", paused, storeDir: "/tmp/two" },
        ],
      }),
    );
    expect(oneLive.map((account) => account.paused === undefined)).toStrictEqual([true, false]);
    expect(nonePaused.map((account) => account.paused === undefined)).toStrictEqual([false, false]);
  });

  it("still refuses pausing the pinned plan", () => {
    const error = unwrapErr(
      parseClaudeAccounts({
        value: [
          {
            alias: "plan-one",
            paused: { reason: "lapsed", sinceIso: "2026-10-30T00:00:00Z" },
            pinned: true,
            storeDir: "/tmp/one",
          },
        ],
      }),
    );
    expect(error.code).toBe("ACCOUNT_CONFIG_INVALID");
    expect(error.message).toContain("the pinned plan `plan-one` is paused");
  });

  it("still refuses a duplicate store directory", () => {
    const error = unwrapErr(
      parseClaudeAccounts({
        value: [
          { alias: "plan-one", storeDir: "/tmp/one" },
          { alias: "plan-two", storeDir: "/tmp/one" },
        ],
      }),
    );
    expect(error.message).toContain("two accounts share the same storeDir `/tmp/one`");
  });
});

describe("parseClaudeAccounts, continued", () => {
  it("refuses a pause instant Date.parse guesses at, such as a bare zero, while keeping an offset one", () => {
    const pausedAt = ({ sinceIso }: { sinceIso: string }) =>
      parseClaudeAccounts({
        value: [
          { alias: "plan-one", paused: { reason: "billing", sinceIso }, storeDir: "/tmp/one" },
          { alias: "plan-two", storeDir: "/tmp/two" },
          { alias: "plan-three", storeDir: "/tmp/three" },
        ],
      });
    expect(unwrapErr(pausedAt({ sinceIso: "0" })).message).toContain("`paused.sinceIso` must be an ISO-8601 instant");
    expect(unwrap(pausedAt({ sinceIso: "2026-09-21T09:00:00+10:00" })).map((account) => account.alias)).toStrictEqual([
      "plan-one",
      "plan-two",
      "plan-three",
    ]);
  });

  it("refuses an alias that is an email address, which is a private identifier", () => {
    const result = parseClaudeAccounts({
      value: [
        { alias: "someone@example.com", storeDir: "/tmp/one" },
        { alias: "plan-two", storeDir: "/tmp/two" },
      ],
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("entry 1 needs an `alias`");
  });

  it("refuses duplicate aliases and duplicate store directories together", () => {
    const result = parseClaudeAccounts({
      value: [
        { alias: "same", storeDir: "/tmp/shared" },
        { alias: "same", storeDir: "/tmp/shared" },
      ],
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("share the same alias `same`");
    expect(unwrapErr(result).message).toContain("share the same storeDir `/tmp/shared`");
  });

  it("refuses two store directories that are one keychain credential once NFC-normalised", () => {
    const result = parseClaudeAccounts({
      value: [
        { alias: "plan-one", storeDir: "/tmp/café" },
        { alias: "plan-two", storeDir: "/tmp/café" },
      ],
    });
    expect(unwrapErr(result).message).toContain("share the same storeDir `/tmp/café`");
  });

  // The service hashes the path to 8 hex, so two different paths can be one keychain credential.
  it("refuses two different store directories whose truncated keychain service collides", () => {
    const result = parseClaudeAccounts({
      value: [
        { alias: "plan-one", storeDir: "/stores/collision-77665" },
        { alias: "plan-two", storeDir: "/stores/collision-99732" },
      ],
    });
    expect(unwrapErr(result).message).toBe(
      "the configured Claude accounts are not usable: " +
        "two accounts share the same keychain service `Claude Code-credentials-363c5003`",
    );
  });

  it("names one shared path once, as a storeDir, never again as its keychain service", () => {
    const result = parseClaudeAccounts({
      value: [
        { alias: "plan-one", storeDir: "/tmp/shared" },
        { alias: "plan-two", storeDir: "/tmp/shared" },
      ],
    });
    expect(unwrapErr(result).message).toBe(
      "the configured Claude accounts are not usable: two accounts share the same storeDir `/tmp/shared`",
    );
  });

  it("reports every entry problem at once rather than one per run", () => {
    const result = parseClaudeAccounts({ value: [{ alias: "UPPER" }, { storeDir: "" }] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("ACCOUNT_CONFIG_INVALID");
    const problems = unwrapErr(result).message;
    expect(problems).toContain("entry 1 needs an `alias`");
    expect(problems).toContain("entry 1 needs a `storeDir`");
    expect(problems).toContain("entry 2 needs an `alias`");
  });

  it("refuses a value that is not an array", () => {
    const result = parseClaudeAccounts({ value: { alias: "plan-one" } });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("not an array");
  });
});

describe("the pinned account", () => {
  it("reads the account pinned seats boot against", () => {
    const accounts = unwrap(
      parseClaudeAccounts({
        value: [
          { alias: "plan-one", storeDir: "/tmp/one" },
          { alias: "plan-three", pinned: true, storeDir: "/tmp/three" },
        ],
      }),
    );
    expect(pinnedAccountAlias({ accounts })).toBe("plan-three");
  });

  it("returns undefined when none is marked, rather than guessing one", () => {
    const accounts = unwrap(
      parseClaudeAccounts({
        value: [
          { alias: "plan-one", storeDir: "/tmp/one" },
          { alias: "plan-two", storeDir: "/tmp/two" },
        ],
      }),
    );
    expect(pinnedAccountAlias({ accounts })).toBe(undefined);
  });

  it("REFUSES two pinned accounts, since the react-now surface lives in exactly one gallery", () => {
    const result = parseClaudeAccounts({
      value: [
        { alias: "plan-one", pinned: true, storeDir: "/tmp/one" },
        { alias: "plan-three", pinned: true, storeDir: "/tmp/three" },
      ],
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("2 accounts are marked pinned");
  });
});

describe("aliasForStoreDir — which plan a process is pinned to", () => {
  const ACCOUNTS: readonly ClaudeAccount[] = [
    { alias: "plan-one", storeDir: "/stores/one" },
    { alias: "plan-two", storeDir: "/stores/two" },
  ];

  it("names the plan whose store directory this is", () => {
    expect(aliasForStoreDir({ accounts: ACCOUNTS, storeDir: "/stores/two" })).toBe("plan-two");
  });

  it("answers nothing for a directory no configured plan holds, rather than guessing the nearest", () => {
    expect(aliasForStoreDir({ accounts: ACCOUNTS, storeDir: "/stores/three" })).toBe(undefined);
  });

  // The keychain service name hashes the path AS GIVEN (`storeService.ts`), so a trailing slash is a
  // different keychain item holding a different credential. Calling it the same store would have the
  // keep-alive loop skip a store that genuinely needs a touch.
  it("refuses a spelling the keychain would hash differently, because that is a different store", () => {
    expect(aliasForStoreDir({ accounts: ACCOUNTS, storeDir: "/stores/two/" })).toBe(undefined);
  });

  it("matches across Unicode normalisation forms, which the keychain also normalises away", () => {
    const accounts: readonly ClaudeAccount[] = [{ alias: "plan-one", storeDir: "/stores/café" }];
    expect(aliasForStoreDir({ accounts, storeDir: "/stores/café" })).toBe("plan-one");
  });

  it("answers nothing when no plan is configured at all", () => {
    expect(aliasForStoreDir({ accounts: [], storeDir: "/stores/one" })).toBe(undefined);
  });
});

describe("the store-path convention", () => {
  const HOME = "/home/state";

  it("puts a plan's store under claude-accounts, named for its alias", () => {
    expect(conventionalStoreDir({ alias: "plan-four", home: HOME })).toBe("/home/state/claude-accounts/plan-four");
  });

  it("reports nothing when every configured plan sits where the convention says", () => {
    // The install's real shape, measured 2026-09-11T23:5xZ: all four at the conventional path.
    const accounts: readonly ClaudeAccount[] = ["plan-one", "plan-two", "plan-three", "plan-four"].map((alias) => ({
      alias,
      storeDir: `${HOME}/claude-accounts/${alias}`,
    }));

    expect(storeDirDepartures({ accounts, home: HOME })).toEqual([]);
  });

  it("names only the plans that depart, in configured order", () => {
    const accounts: readonly ClaudeAccount[] = [
      { alias: "conventional", storeDir: `${HOME}/claude-accounts/conventional` },
      { alias: "elsewhere", storeDir: "/somewhere/else" },
      { alias: "also-off", storeDir: `${HOME}/claude-accounts/wrong-name` },
    ];

    expect(storeDirDepartures({ accounts, home: HOME })).toEqual(["elsewhere", "also-off"]);
  });

  it("treats a store named for a DIFFERENT alias as a departure, which is the rename trap", () => {
    // Renaming a plan without moving its directory leaves the credential under the old path's hash, so the
    // new name addresses an empty keychain item. A rename is a re-enrollment.
    const accounts: readonly ClaudeAccount[] = [{ alias: "spare", storeDir: `${HOME}/claude-accounts/plan-four` }];

    expect(storeDirDepartures({ accounts, home: HOME })).toEqual(["spare"]);
  });

  it("reports rather than refuses, so an unconventional install still parses", () => {
    const parsed = parseClaudeAccounts({
      value: [
        { alias: "plan-one", storeDir: "/somewhere/odd" },
        { alias: "plan-two", storeDir: "/somewhere/odder" },
      ],
    });

    expect(parsed.isOk()).toBe(true);
    expect(storeDirDepartures({ accounts: unwrap(parsed), home: HOME })).toEqual(["plan-one", "plan-two"]);
  });
});

describe("the account a plan holds", () => {
  it("parses a mapped email onto the account, and leaves an unmapped one without the key", () => {
    const accounts = unwrap(
      parseClaudeAccounts({
        value: [
          { alias: "plan-one", email: "admin@example.invalid", storeDir: "/tmp/one" },
          { alias: "plan-two", storeDir: "/tmp/two" },
        ],
      }),
    );
    expect(accounts).toStrictEqual([
      { alias: "plan-one", email: "admin@example.invalid", storeDir: "/tmp/one", ...WHOLE_WEEK },
      { alias: "plan-two", storeDir: "/tmp/two", ...WHOLE_WEEK },
    ]);
  });

  it("parses a recorded subscription lapse onto the account, and leaves an unrecorded one without the key", () => {
    const accounts = unwrap(
      parseClaudeAccounts({
        value: [
          { alias: "plan-one", lapsesAtIso: "2026-11-17T00:00:00.000Z", storeDir: "/tmp/one" },
          { alias: "plan-two", storeDir: "/tmp/two" },
        ],
      }),
    );
    const policy = { allowance: { kind: "weekly-window" }, usageLimitPercent: 100 };
    expect(accounts).toStrictEqual([
      { alias: "plan-one", lapsesAtIso: "2026-11-17T00:00:00.000Z", storeDir: "/tmp/one", ...policy },
      { alias: "plan-two", storeDir: "/tmp/two", ...policy },
    ]);
  });

  it("refuses a lapse that is not an ISO-8601 instant", () => {
    const result = parseClaudeAccounts({
      value: [
        { alias: "plan-one", lapsesAtIso: "3 Mar", storeDir: "/tmp/one" },
        { alias: "plan-two", storeDir: "/tmp/two" },
      ],
    });
    expect(unwrapErr(result).message).toContain("entry 1's `lapsesAtIso`, when present, must be an ISO-8601 instant");
  });

  it("refuses an email that is not an address", () => {
    const result = parseClaudeAccounts({
      value: [
        { alias: "plan-one", email: "plan-two", storeDir: "/tmp/one" },
        { alias: "plan-two", storeDir: "/tmp/two" },
      ],
    });
    expect(unwrapErr(result).message).toContain(
      "entry 1's `email`, when present, must be the one-line address of the account its store holds",
    );
  });

  it("refuses an address spanning two lines, which would print a forged PLAN line beside the alias", () => {
    const result = parseClaudeAccounts({
      value: [
        { alias: "plan-one", email: "cached@example.invalid\nPLAN plan-two: forged", storeDir: "/tmp/one" },
        { alias: "plan-two", storeDir: "/tmp/two" },
      ],
    });
    expect(unwrapErr(result).message).toContain(
      "entry 1's `email`, when present, must be the one-line address of the account its store holds",
    );
  });

  it("labels a plan with the address its enrollment BOUND, and says out loud when none is mapped", () => {
    expect(planLabel({ alias: "plan-two", cell: { address: "security@example.invalid", trust: "bound" } })).toBe(
      "plan-two (security@example.invalid)",
    );
    expect(planLabel({ alias: "plan-two", cell: { trust: "unmapped" } })).toBe(
      "plan-two (UNMAPPED — add its email to accounts.json)",
    );
  });

  it("never renders a trusted-looking address for a store whose token is not the enrolled account", () => {
    expect(planLabel({ alias: "plan-two", cell: { trust: "wrong-account" } })).toBe("plan-two (WRONG ACCOUNT)");
  });

  it("names the drifted cache beside the bound address rather than preferring it", () => {
    expect(
      planLabel({
        alias: "plan-two",
        cell: { address: "bound@example.invalid", staleCache: "drifted@example.invalid", trust: "bound-cache-stale" },
      }),
    ).toBe("plan-two (bound@example.invalid; accounts.json says drifted@example.invalid)");
  });

  it("looks the account up among the configured plans, and can only ever call it a CACHE", () => {
    const accounts = [
      { alias: "plan-one", storeDir: "/tmp/one" },
      { alias: "plan-two", email: "security@example.invalid", storeDir: "/tmp/two" },
    ];
    // A caller that read no token cannot claim a token-derived account, and this is the label that says so.
    expect(planLabelFor({ accounts, alias: "plan-two" })).toBe("plan-two (CACHED security@example.invalid)");
    expect(planLabelFor({ accounts, alias: "plan-nine" })).toBe(
      "plan-nine (UNMAPPED — add its email to accounts.json)",
    );
  });
});
