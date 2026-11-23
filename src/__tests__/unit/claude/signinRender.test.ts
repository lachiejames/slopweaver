import { describe, expect, it } from "vitest";

import type { SigninPlan } from "../../../claude/signinPlan.js";
import {
  renderSigninLines,
  renderSigninPage,
  signinCommandLine,
  signinLaunchLine,
} from "../../../claude/signinRender.js";

const NOW = "2026-09-09T16:01:05.488Z";

const plan = ({
  complete = false,
  remaining = ["plan-two"],
}: {
  complete?: boolean;
  remaining?: readonly string[];
} = {}): SigninPlan => ({
  rows: [
    {
      account: { address: "admin@example.invalid", trust: "bound" },
      alias: "plan-one",
      detail: "live, windows read, and the account matches its enrollment",
      state: "verified",
      windows: { fiveHourPercent: 47, sevenDayPercent: 33, sevenDayFablePercent: 39 },
    },
    {
      account: { address: "security@example.invalid", trust: "cached" },
      alias: "plan-two",
      detail: "no login in this store — one browser sign-in repairs it",
      state: "needs-sign-in",
    },
  ],
  summary: { complete, configured: 2, distinctAccounts: 1, live: 1, remaining, tokenOnly: 0, verified: 1 },
});

/** The shape: one plan live on its setup token over a store holding no login. */
const tokenOnlyPlan = (): SigninPlan => ({
  rows: [
    {
      account: { address: "security@example.invalid", trust: "bound" },
      alias: "plan-one",
      detail:
        "live on its setup token, but its own store is SIGNED OUT — no refresh repairs that, only one browser sign-in",
      state: "token-only",
      windows: { fiveHourPercent: 7, sevenDayPercent: 50 },
    },
  ],
  summary: {
    complete: false,
    configured: 1,
    distinctAccounts: 1,
    live: 1,
    remaining: ["plan-one"],
    tokenOnly: 1,
    verified: 0,
  },
});

/** The eight-hour access expiry — carried on the row, and deliberately absent from both human faces. */
const ACCESS_EXPIRY = "2026-09-10T00:01:05.488Z";

/**
 * Two plans against {@link NOW}: one with a recorded sign-in 2d8h back and a grant 26 days out, one with
 * neither — the day-one shape of every store signed in before the log existed.
 */
const recencyPlan = (): SigninPlan => ({
  rows: [
    {
      accessExpiresAtIso: ACCESS_EXPIRY,
      account: { address: "admin@example.invalid", trust: "bound" },
      alias: "plan-one",
      detail: "live on its own store, windows read, and the account matches its enrollment",
      grantExpiresAtIso: "2026-10-05T16:01:05.488Z",
      lastSignInAtIso: "2026-09-07T08:01:05.488Z",
      state: "verified",
      windows: { fiveHourPercent: 47, sevenDayPercent: 33 },
    },
    {
      account: { trust: "unenrolled" },
      alias: "plan-two",
      detail: "no login in this store — one browser sign-in repairs it",
      state: "needs-sign-in",
    },
  ],
  summary: {
    complete: false,
    configured: 2,
    distinctAccounts: 1,
    live: 1,
    remaining: ["plan-two"],
    tokenOnly: 0,
    verified: 1,
  },
});

/** One plan whose refresh grant expired three days before {@link NOW}. */
const overduePlan = (): SigninPlan => ({
  rows: [
    {
      account: { trust: "unenrolled" },
      alias: "plan-one",
      detail: "no login in this store — one browser sign-in repairs it",
      grantExpiresAtIso: "2026-09-06T16:01:05.488Z",
      state: "needs-sign-in",
    },
  ],
  summary: {
    complete: false,
    configured: 1,
    distinctAccounts: 0,
    live: 0,
    remaining: ["plan-one"],
    tokenOnly: 0,
    verified: 0,
  },
});

describe("signinCommandLine", () => {
  it("always carries the store prefix inline, so an inherited store cannot win", () => {
    expect(signinCommandLine({ storeDir: "/stores/plan-two" })).toBe(
      "CLAUDE_SECURESTORAGE_CONFIG_DIR=/stores/plan-two claude auth login",
    );
  });

  it("pre-populates the chooser when an address is configured", () => {
    expect(signinCommandLine({ email: "someone@example.invalid", storeDir: "/stores/plan-two" })).toBe(
      "CLAUDE_SECURESTORAGE_CONFIG_DIR=/stores/plan-two claude auth login --email someone@example.invalid",
    );
  });
});

describe("signinLaunchLine", () => {
  it("names an enrolled pre-fill as enrolled", () => {
    const hint = { address: "bound@example.invalid", source: "enrolled" } as const;
    expect(signinLaunchLine({ hint, storeDir: "/stores/plan-two" })).toBe(
      "launching: CLAUDE_SECURESTORAGE_CONFIG_DIR=/stores/plan-two claude auth login --email bound@example.invalid (enrolled)",
    );
  });

  it("names a cache pre-fill as the unverified cache", () => {
    const hint = { address: "typed@example.invalid", source: "cache" } as const;
    expect(signinLaunchLine({ hint, storeDir: "/stores/plan-two" })).toBe(
      "launching: CLAUDE_SECURESTORAGE_CONFIG_DIR=/stores/plan-two claude auth login --email typed@example.invalid (accounts.json cache — unverified)",
    );
  });

  it("prints the bare command, with no source, when nothing is pre-filled", () => {
    expect(signinLaunchLine({ hint: undefined, storeDir: "/stores/plan-two" })).toBe(
      "launching: CLAUDE_SECURESTORAGE_CONFIG_DIR=/stores/plan-two claude auth login",
    );
  });
});

describe("renderSigninLines", () => {
  it("stamps the reading instant and counts live against configured", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: plan() });

    expect(lines[0]).toBe(`sign-in status as at ${NOW} — 1 of 2 live, 1 distinct account(s)`);
  });

  it("renders each row's tag, detail and readings", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: plan() });

    expect(lines[1]).toContain("plan-one");
    expect(lines[1]).toContain("VERIFIED");
    expect(lines[1]).toContain("5h 47% · wk 33% · fable 39%");
    expect(lines[3]).toContain("NEEDS SIGN-IN");
  });

  it("names what is still to do when the walk is unfinished", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: plan() });

    expect(lines[5]).toBe("  still to do: plan-two (CACHED security@example.invalid)");
  });

  it("names the BOUND account beside the alias, and calls an unbound one a cache", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: plan() });

    expect(lines[1]!.startsWith("  plan-one (admin@example.invalid)  ")).toBe(true);
    expect(lines[1]).toContain("VERIFIED");
    expect(lines[3]).toContain("  plan-two (CACHED security@example.invalid)");
  });

  it("says so plainly when every plan is live, distinct and enrolled", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: plan({ complete: true, remaining: [] }) });

    expect(lines[5]).toBe("  every configured plan is live, distinct and enrolled");
  });

  it("names the token-only count in the header, where a reader takes the sentence away", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: tokenOnlyPlan() });

    expect(lines[0]).toBe(
      `sign-in status as at ${NOW} — 1 of 1 live, 1 distinct account(s), 1 on a setup token over a store holding no login`,
    );
  });

  it("tags a token-only row so the word VERIFIED never appears over a signed-out store", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: tokenOnlyPlan() });

    expect(lines[1]).toContain("TOKEN ONLY");
    expect(lines[1]).not.toContain("VERIFIED");
  });

  it("leaves the header clause out entirely when no plan is token-only", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: plan() });

    expect(lines[0]).not.toContain("setup token");
  });

  it("gives every plan a continuation line carrying recency and the next forced sign-in", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: recencyPlan() });

    expect(lines[2]!.trim()).toBe(
      "last sign-in 2.3d ago (2026-09-07T08:01:05.488Z) · forced sign-in by 2026-10-05T16:01:05.488Z (26.0d)",
    );
  });

  it("says a store with no recorded sign-in has none in the LOG, never that the owner has not signed in", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: recencyPlan() });

    expect(lines[4]!.trim()).toBe(
      "no sign-in recorded here yet — this log holds only sign-ins this verb performed · " +
        "forced sign-in date unknown — this store's refresh grant expiry could not be read",
    );
    expect(lines[4]).not.toContain("never");
  });

  it("names an expired grant as overdue rather than as a date in the future", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: overduePlan() });

    expect(lines[2]!.trim()).toBe(
      "no sign-in recorded here yet — this log holds only sign-ins this verb performed · " +
        "forced sign-in OVERDUE — the refresh grant expired 3.0d ago at 2026-09-06T16:01:05.488Z",
    );
  });

  it("prints the deadline caveat ONCE, under the whole table, when any row names a deadline", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: recencyPlan() });
    const caveats = lines.filter((line) => line.includes("an invalid_grant can force one sooner"));

    expect(caveats).toEqual([
      "  a forced-sign-in date is the deadline a refresh cannot beat, not a promise the credential lives that long — an invalid_grant can force one sooner",
    ]);
    expect(lines.indexOf(caveats[0]!)).toBe(lines.length - 1);
  });

  it("leaves the caveat out when no row names a deadline at all", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: plan() });

    expect(lines.filter((line) => line.includes("invalid_grant"))).toEqual([]);
  });

  it("never prints the eight-hour access expiry beside the grant deadline", () => {
    const lines = renderSigninLines({ nowIso: NOW, plan: recencyPlan() });

    expect(lines.filter((line) => line.includes(ACCESS_EXPIRY))).toEqual([]);
  });
});

describe("renderSigninPage", () => {
  it("stamps its own read instant so a frozen snapshot announces its age", () => {
    const html = renderSigninPage({ nowIso: NOW, plan: plan(), refreshSeconds: 10 });

    expect(html).toContain(`as at ${NOW}`);
    expect(html).toContain('<meta http-equiv="refresh" content="10">');
  });

  it("carries every configured plan as a row", () => {
    const html = renderSigninPage({ nowIso: NOW, plan: plan(), refreshSeconds: 10 });

    expect(html).toContain("plan-one");
    expect(html).toContain("plan-two");
    expect(html).toContain("NEEDS SIGN-IN");
  });

  it("names each plan's account in its row and in what is still to do", () => {
    const html = renderSigninPage({ nowIso: NOW, plan: plan(), refreshSeconds: 10 });

    expect(html).toContain(String.raw`<td class="a">plan-two (CACHED security@example.invalid)</td>`);
    expect(html).toContain(String.raw`<p class="verdict">Still to do: plan-two (CACHED security@example.invalid).</p>`);
  });

  it("escapes a detail so it cannot inject markup", () => {
    const injected: SigninPlan = {
      rows: [
        { account: { trust: "unmapped" }, alias: "plan-two", detail: '<script>x</script>"', state: "needs-sign-in" },
      ],
      summary: {
        complete: false,
        configured: 1,
        distinctAccounts: 0,
        live: 0,
        remaining: ["plan-two"],
        tokenOnly: 0,
        verified: 0,
      },
    };

    const html = renderSigninPage({ nowIso: NOW, plan: injected, refreshSeconds: 10 });

    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;&quot;");
    expect(html).not.toContain("<script>x</script>");
  });

  // `claude watch` has no page write path, so a footer crediting a "running watcher" told a reader a stale
  // page would heal itself. Only another `--page` run writes fresh readings.
  it("names the only writer of fresh readings, and it is not a watcher", () => {
    const html = renderSigninPage({ nowIso: NOW, plan: plan(), refreshSeconds: 10 });

    expect(html).toContain("only another <code>--page</code> run writes fresh readings");
    expect(html).not.toContain("running watcher");
  });

  // The exhaustive STATE_TAG/STATE_TONE maps hold a new STATE to both faces; nothing holds a new optional
  // FIELD to both, so this is the guard that the page and the lines describe one plan identically.
  it("carries the same recency and deadline clauses the terminal lines print", () => {
    const html = renderSigninPage({ nowIso: NOW, plan: recencyPlan(), refreshSeconds: 10 });
    const lines = renderSigninLines({ nowIso: NOW, plan: recencyPlan() });

    expect(html).toContain("last sign-in 2.3d ago (2026-09-07T08:01:05.488Z)");
    expect(html).toContain("forced sign-in by 2026-10-05T16:01:05.488Z (26.0d)");
    expect(html).toContain(lines[2]!.trim());
    expect(html).toContain(lines[4]!.trim());
  });

  it("prints the deadline caveat once on the page too, and never the access expiry", () => {
    const html = renderSigninPage({ nowIso: NOW, plan: recencyPlan(), refreshSeconds: 10 });

    expect(html.split("an invalid_grant can force one sooner").length).toBe(2);
    expect(html).not.toContain(ACCESS_EXPIRY);
  });

  it("leaves the caveat off a page where no row names a deadline", () => {
    const html = renderSigninPage({ nowIso: NOW, plan: plan(), refreshSeconds: 10 });

    expect(html).not.toContain("invalid_grant");
  });
});
