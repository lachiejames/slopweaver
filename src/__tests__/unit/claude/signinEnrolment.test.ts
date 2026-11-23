import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LoginHint } from "../../../claude/accountBinding.js";
import { readAssertions } from "../../../claude/assertionStore.js";
import type { ClaudeAccount, ClaudeAccountGauge } from "../../../claude/contracts.js";
import type { StoreLife } from "../../../claude/credentialRepair.js";
import { ClaudeRotationErrors } from "../../../claude/errors.js";
import type { ClaudeIdentityAssertion } from "../../../claude/identityAssertions.js";
import { establishAssertion, parseIdentityAssertions } from "../../../claude/identityAssertions.js";
import type { probePlan } from "../../../claude/probeStore.js";
import { readSignIns } from "../../../claude/signInLog.js";
import { ClaudeCommandErrors } from "../../../cli/commands/claude/errors.js";
import {
  readAssertionsForWrite,
  reenrollMany,
  verifyAndEnroll,
  writeAssertions,
} from "../../../cli/commands/claude/signinEnrolment.js";
import { signinOne, unconfiguredPlanLine } from "../../../cli/commands/claude/signinRun.js";
import { JUDGEMENT_NOTE } from "../../../hatch/render.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

let home = "";

const makeHome = (): string => {
  home = mkdtempSync(join(tmpdir(), "signin-"));
  mkdirSync(join(home, "claude-accounts"), { recursive: true });
  return home;
};

afterEach(() => {
  if (home !== "") {
    rmSync(home, { force: true, recursive: true });
    home = "";
  }
});

/** The shape of `signinOne`'s injected login. */
type LoginFake = (options: { account: ClaudeAccount; hint: LoginHint | undefined }) => boolean;

const ENROLLED = "2026-09-10T02:16:35.000Z";
const NOW = "2026-09-10T22:00:00.000Z";

const account = ({ alias }: { alias: string }): ClaudeAccount => ({
  alias,
  email: `${alias}@example.invalid`,
  storeDir: `/stores/${alias}`,
});
const PLAN_TWO = account({ alias: "plan-two" });

const assertionsPath = ({ dir }: { dir: string }): string => join(dir, "claude-accounts", "identity-assertions.json");

const gauge = ({ alias }: { alias: string }): ClaudeAccountGauge => ({
  alias,
  fiveHour: { resetAtIso: "2026-09-11T03:00:00.000Z", status: "allowed", utilization: 0.2 },
  observedAtIso: NOW,
  sevenDay: { resetAtIso: "2026-09-16T03:00:00.000Z", status: "allowed", utilization: 0.3 },
});

/** A store reading a fake probe carries beside its gauge — live, with weeks of refresh grant left. */
const life = ({ alias }: { alias: string }): StoreLife => ({
  alias,
  expiresAtIso: "2026-09-11T06:00:00.000Z",
  hasCredential: true,
  hasRefreshToken: true,
  refreshExpiresAtIso: "2026-10-09T06:00:00.000Z",
});

/** A store reading for a probe that found no login at all. */
const emptyLife = ({ alias }: { alias: string }): StoreLife => ({
  alias,
  hasCredential: false,
  hasRefreshToken: false,
});

/** A plain fake probe — a seam, not a mock: every store answers with the same fixed account. */
const probeHolding =
  ({ organizationId }: { organizationId: string }): typeof probePlan =>
  async ({ alias }) => ({
    life: life({ alias }),
    organizationId,
    outcome: { alias, gauge: gauge({ alias }) },
    reading: ok(gauge({ alias })),
  });

/** A plain fake probe answering each store with its own account, or no login when the map names none. */
const probeByStore =
  ({ held }: { held: Readonly<Record<string, string>> }): typeof probePlan =>
  async ({ alias }) => {
    const organizationId = held[alias];
    return organizationId === undefined
      ? probeEmpty({ alias, nowIso: NOW, storeDir: `/stores/${alias}` })
      : {
          life: life({ alias }),
          organizationId,
          outcome: { alias, gauge: gauge({ alias }) },
          reading: ok(gauge({ alias })),
        };
  };

/** A probe whose store holds no readable login. */
const probeEmpty: typeof probePlan = async ({ alias }) => ({
  life: emptyLife({ alias }),
  outcome: { alias, problem: "no login in this store" },
  reading: err(ClaudeRotationErrors.storeNotReady({ alias })),
});

const standingThree = [
  { alias: "plan-one", assertedAtIso: ENROLLED, organizationId: "org-a" },
  { alias: "plan-two", assertedAtIso: ENROLLED, organizationId: "org-b" },
  { alias: "plan-three", assertedAtIso: ENROLLED, organizationId: "org-c" },
];

/** Every configured plan's alias, for the reads that refuse or redact a row naming anything else. */
const CONFIGURED = standingThree.map((row) => row.alias);

describe("the enrolment file round-trips", () => {
  it("reads back exactly what it wrote", () => {
    const dir = makeHome();
    const assertions = [
      { alias: "plan-two", assertedAtIso: "2026-09-09T17:00:00.000Z", organizationId: "org-b" },
      { alias: "plan-three", assertedAtIso: "2026-09-09T17:05:00.000Z", organizationId: "org-c" },
    ];

    writeAssertions({ assertions, home: dir });

    expect(readAssertions({ home: dir })).toEqual(assertions);
    expect(JSON.parse(readFileSync(assertionsPath({ dir }), "utf8"))).toEqual({ assertions });
  });

  it("reads empty when nothing has been enrolled", () => {
    expect(readAssertions({ home: makeHome() })).toEqual([]);
  });

  // The witness for the bug this file exists to catch: a BARE array is the shape the writer would produce if
  // the envelope were dropped, and the reader answers empty for it. So an enrolment would report success and
  // read back unbound on the very next pass — a failure byte-identical to a store that was never enrolled.
  it("proves the envelope is load-bearing: a bare array reads back as nothing", () => {
    const dir = makeHome();
    const assertions = [{ alias: "plan-two", assertedAtIso: "2026-09-09T17:00:00.000Z", organizationId: "org-b" }];

    writeFileSync(assertionsPath({ dir }), JSON.stringify(assertions));

    expect(readAssertions({ home: dir })).toEqual([]);
    expect(parseIdentityAssertions({ value: { assertions } })).toEqual(assertions);
  });

  it("survives a re-enrolment attempt without changing what stands", () => {
    const dir = makeHome();
    const first = [{ alias: "plan-two", assertedAtIso: "2026-09-09T17:00:00.000Z", organizationId: "org-b" }];
    writeAssertions({ assertions: first, home: dir });

    const again = establishAssertion({
      alias: "plan-two",
      assertions: readAssertions({ home: dir }),
      nowIso: "2026-09-09T18:00:00.000Z",
      organizationId: "org-DIFFERENT",
    });

    expect(again.established).toBe(false);
    expect(again.assertions).toEqual(first);
  });
});

describe("the strict read every writing path uses", () => {
  it("reads an absent file as nothing enrolled", () => {
    expect(unwrap(readAssertionsForWrite({ configured: CONFIGURED, home: makeHome() }))).toEqual([]);
  });

  it("REFUSES a file that is not JSON rather than reading it as empty", () => {
    const dir = makeHome();
    writeFileSync(assertionsPath({ dir }), "{ truncated");

    const refusal = unwrapErr(readAssertionsForWrite({ configured: CONFIGURED, home: dir }));
    expect(refusal).toStrictEqual(ClaudeCommandErrors.assertionsNotJson());
    expect(refusal.message).toBe("the identity assertions file is not valid JSON; no enrollment was changed");
  });

  it("REFUSES a bare array, which the tolerant read would answer as empty", () => {
    const dir = makeHome();
    writeFileSync(assertionsPath({ dir }), JSON.stringify(standingThree));

    const refusal = unwrapErr(readAssertionsForWrite({ configured: CONFIGURED, home: dir }));
    expect(refusal.code).toBe("ASSERTIONS_WRONG_SHAPE");
    expect(refusal.message).toContain("a bare array");
  });

  it("REFUSES a file with a dropped malformed row, since writing back would erase it", () => {
    const dir = makeHome();
    writeFileSync(assertionsPath({ dir }), JSON.stringify({ assertions: [...standingThree, { alias: "no-org" }] }));

    const refusal = unwrapErr(readAssertionsForWrite({ configured: CONFIGURED, home: dir }));
    expect(refusal.code).toBe("ASSERTIONS_WRONG_SHAPE");
    expect(refusal.message).toContain("1 identity assertion(s) were dropped");
  });

  // The replaced row's assertedAtIso is printed back as its previous enrollment, so a value that is not a date
  // is refused rather than echoed — here it holds an organisation id, the counterexample that found the hole.
  it("REFUSES a row whose assertedAtIso is not a date, since a re-enroll would print it", () => {
    const dir = makeHome();
    const planTwo = { alias: "plan-two", assertedAtIso: "org-b", organizationId: "org-b" };
    writeFileSync(assertionsPath({ dir }), JSON.stringify({ assertions: [standingThree[0], planTwo] }));

    const refusal = unwrapErr(readAssertionsForWrite({ configured: CONFIGURED, home: dir }));
    expect(refusal).toStrictEqual(ClaudeCommandErrors.assertionInstantInvalid());
    expect(refusal.message).toBe("an enrollment assertedAtIso is not a date; no enrollment was changed");
  });

  // Date.parse rolls an impossible calendar date forward rather than rejecting it, so finiteness alone passed it.
  it("REFUSES an impossible calendar date that Date.parse would roll into March", () => {
    const dir = makeHome();
    const planTwo = { alias: "plan-two", assertedAtIso: "2026-02-31T00:00:00.000Z", organizationId: "org-b" };
    writeFileSync(assertionsPath({ dir }), JSON.stringify({ assertions: [standingThree[0], planTwo] }));

    const refusal = unwrapErr(readAssertionsForWrite({ configured: CONFIGURED, home: dir }));
    expect(refusal).toStrictEqual(ClaudeCommandErrors.assertionInstantInvalid());
    expect(refusal.message).toBe("an enrollment assertedAtIso is not a date; no enrollment was changed");
  });

  // A collision refusal prints the other rows' aliases, so an alias naming no configured plan — here an
  // organisation id — is refused before it can reach a printed line.
  it("REFUSES a row whose alias is not a configured plan", () => {
    const dir = makeHome();
    const stray = { alias: "org-c", assertedAtIso: ENROLLED, organizationId: "org-c" };
    writeFileSync(assertionsPath({ dir }), JSON.stringify({ assertions: [standingThree[1], stray] }));

    const refusal = unwrapErr(readAssertionsForWrite({ configured: CONFIGURED, home: dir }));
    expect(refusal).toStrictEqual(ClaudeCommandErrors.assertionStoreUnconfigured());
    expect(refusal.message).toBe("an enrollment names a store that is not configured; no enrollment was changed");
  });

  // The shape check reads null as "no file", so a present file holding null used to read as empty and be
  // overwritten by the next enrollment.
  it("REFUSES a present file holding JSON null rather than reading it as absent", () => {
    const dir = makeHome();
    writeFileSync(assertionsPath({ dir }), "null");

    const refusal = unwrapErr(readAssertionsForWrite({ configured: CONFIGURED, home: dir }));
    expect(refusal).toStrictEqual(ClaudeCommandErrors.assertionsHoldNull());
    expect(refusal.message).toBe(
      'the identity assertions file holds null, not the expected { "assertions": [...] } object; no enrollment was changed',
    );
  });

  // A dangling symlink answers ENOENT on read exactly as a missing file does, but it is present, and the write
  // that followed would replace it.
  it("REFUSES a dangling symlink rather than reading it as an absent file", () => {
    const dir = makeHome();
    symlinkSync(join(dir, "claude-accounts", "missing-target.json"), assertionsPath({ dir }));

    const refusal = unwrapErr(readAssertionsForWrite({ configured: CONFIGURED, home: dir }));
    expect(refusal).toStrictEqual(ClaudeCommandErrors.assertionsUnreadable());
    expect(refusal.message).toBe("the identity assertions file could not be read; no enrollment was changed");
  });

  it("REFUSES an unreadable path rather than reading it as empty", () => {
    const dir = makeHome();
    mkdirSync(assertionsPath({ dir }));

    const refusal = unwrapErr(readAssertionsForWrite({ configured: CONFIGURED, home: dir }));
    expect(refusal).toStrictEqual(ClaudeCommandErrors.assertionsUnreadable());
    expect(refusal.message).toBe("the identity assertions file could not be read; no enrollment was changed");
  });
});

describe("verifyAndEnroll — the path --plan, --enroll and the walk share", () => {
  it("prints the registered refusal on a mismatch, fails, and writes nothing", async () => {
    const dir = makeHome();
    writeAssertions({ assertions: standingThree, home: dir });
    const before = readFileSync(assertionsPath({ dir }), "utf8");

    const outcome = await verifyAndEnroll({
      account: PLAN_TWO,
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeHolding({ organizationId: "org-new" }),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.lines).toEqual([
      `slopweaver claude signin blocked because the account now in this store is not the one enrolled for it, and an ordinary sign-in or enrollment may never overwrite a standing enrollment (plan: plan-two (CACHED plan-two@example.invalid); enrolled at: ${ENROLLED}; attempted at: ${NOW}).`,
      "Legitimate exceptions may include the owner signed this account into this store deliberately, on the mapping the owner was given; the standing enrollment was made from the wrong account and this corrects it.",
      "To override use the designated escape hatch slopweaver claude signin --reenroll <alias,...>.",
      JUDGEMENT_NOTE,
    ]);
    expect(outcome.lines.join(" ")).not.toContain("org-");
    expect(readFileSync(assertionsPath({ dir }), "utf8")).toBe(before);
  });

  // Read tolerantly, a malformed file answered [], plan-two "established", and the write stored one row over
  // every other enrollment — and exited zero. An enrollment writes the whole file, so it reads strictly.
  it("writes nothing over a malformed file rather than reading it as empty and overwriting it", async () => {
    const dir = makeHome();
    const malformed = JSON.stringify({ assertions: [...standingThree.slice(0, 1), { alias: "no-org" }] });
    writeFileSync(assertionsPath({ dir }), malformed);

    const outcome = await verifyAndEnroll({
      account: PLAN_TWO,
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeHolding({ organizationId: "org-b" }),
    });

    expect(outcome).toEqual({
      lines: [
        "plan-two (CACHED plan-two@example.invalid): NOT ENROLLED — 1 identity assertion(s) were dropped as malformed — those stores will read as unbound; no enrollment was changed",
      ],
      ok: false,
    });
    expect(readFileSync(assertionsPath({ dir }), "utf8")).toBe(malformed);
  });

  it("refuses a stored assertedAtIso that is not a date rather than echoing it into the refusal", async () => {
    const dir = makeHome();
    writeAssertions({
      assertions: [{ alias: "plan-two", assertedAtIso: "org-b", organizationId: "org-b" }],
      home: dir,
    });

    const outcome = await verifyAndEnroll({
      account: PLAN_TWO,
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeHolding({ organizationId: "org-new" }),
    });

    expect(outcome).toEqual({
      lines: [
        "plan-two (CACHED plan-two@example.invalid): NOT ENROLLED — an enrollment assertedAtIso is not a date; no enrollment was changed",
      ],
      ok: false,
    });
  });

  // The exit code used to be `line.includes("VERIFIED")`, which `NOT VERIFIED` satisfies, so an unreadable
  // store exited 0. The outcome carries its own verdict now.
  it("fails a store with no readable login, whose line still contains the word VERIFIED", async () => {
    const outcome = await verifyAndEnroll({
      account: PLAN_TWO,
      configured: CONFIGURED,
      home: makeHome(),
      nowIso: NOW,
      probe: probeEmpty,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.lines).toEqual([
      "plan-two (CACHED plan-two@example.invalid): NOT VERIFIED — no login in this store",
    ]);
  });

  it("enrolls an unbound store and succeeds", async () => {
    const dir = makeHome();

    const outcome = await verifyAndEnroll({
      account: PLAN_TWO,
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeHolding({ organizationId: "org-b" }),
    });

    expect(outcome.ok).toBe(true);
    expect(readAssertions({ home: dir })).toEqual([
      { alias: "plan-two", assertedAtIso: NOW, email: "plan-two@example.invalid", organizationId: "org-b" },
    ]);
  });

  it("succeeds without writing when the store holds the enrolled account", async () => {
    const dir = makeHome();
    writeAssertions({ assertions: standingThree, home: dir });

    const outcome = await verifyAndEnroll({
      account: PLAN_TWO,
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeHolding({ organizationId: "org-b" }),
    });

    expect(outcome).toEqual({
      lines: ["plan-two (CACHED plan-two@example.invalid): VERIFIED — same account as enrolled"],
      ok: true,
    });
    expect(readAssertions({ home: dir })).toEqual(standingThree);
  });
});

describe("reenrollMany — the one path that replaces an enrollment", () => {
  it("replaces exactly the named row, in place, and says what it replaced", async () => {
    const dir = makeHome();
    writeAssertions({ assertions: standingThree, home: dir });

    const outcome = await reenrollMany({
      accounts: [PLAN_TWO],
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeHolding({ organizationId: "org-new" }),
    });

    expect(outcome).toEqual({
      lines: [
        `plan-two (plan-two@example.invalid): RE-ENROLLED — previous enrollment: ${ENROLLED}; new enrollment: ${NOW}`,
      ],
      ok: true,
    });
    expect(readAssertions({ home: dir })).toEqual([
      standingThree[0],
      { alias: "plan-two", assertedAtIso: NOW, email: "plan-two@example.invalid", organizationId: "org-new" },
      standingThree[2],
    ]);
  });

  // The live shape: three stores holding a rotation of their enrolled accounts.
  it("re-binds a permutation of three stores in one write", async () => {
    const dir = makeHome();
    writeAssertions({ assertions: standingThree, home: dir });

    const outcome = await reenrollMany({
      accounts: ["plan-one", "plan-two", "plan-three"].map((alias) => account({ alias })),
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeByStore({ held: { "plan-one": "org-b", "plan-three": "org-a", "plan-two": "org-c" } }),
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.lines).toHaveLength(3);
    expect(readAssertions({ home: dir }).map((entry: ClaudeIdentityAssertion) => entry.organizationId)).toEqual([
      "org-b",
      "org-c",
      "org-a",
    ]);
  });

  it("writes nothing when one store in the set cannot be read", async () => {
    const dir = makeHome();
    writeAssertions({ assertions: standingThree, home: dir });
    const before = readFileSync(assertionsPath({ dir }), "utf8");

    const outcome = await reenrollMany({
      accounts: ["plan-one", "plan-two"].map((alias) => account({ alias })),
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeByStore({ held: { "plan-one": "org-b" } }),
    });

    expect(outcome).toEqual({
      lines: [
        "plan-two (CACHED plan-two@example.invalid): NOT VERIFIED — no login in this store",
        "NOT RE-ENROLLED — every named store must be readable, so nothing was changed",
      ],
      ok: false,
    });
    expect(readFileSync(assertionsPath({ dir }), "utf8")).toBe(before);
  });

  it("writes nothing when the account would also be enrolled under another store", async () => {
    const dir = makeHome();
    writeAssertions({ assertions: standingThree, home: dir });
    const before = readFileSync(assertionsPath({ dir }), "utf8");

    const outcome = await reenrollMany({
      accounts: [PLAN_TWO],
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeHolding({ organizationId: "org-a" }),
    });

    expect(outcome).toEqual({
      lines: [
        "plan-two: NOT RE-ENROLLED — this account would also be enrolled under plan-one; sign in a distinct account",
      ],
      ok: false,
    });
    expect(readFileSync(assertionsPath({ dir }), "utf8")).toBe(before);
  });

  it("writes nothing over a malformed file, and never probes a store", async () => {
    const dir = makeHome();
    writeFileSync(assertionsPath({ dir }), "{ truncated");
    let probed = 0;
    const counting: typeof probePlan = async ({ alias }) => {
      probed += 1;
      return {
        life: life({ alias }),
        organizationId: "org-new",
        outcome: { alias, gauge: gauge({ alias }) },
        reading: ok(gauge({ alias })),
      };
    };

    const outcome = await reenrollMany({
      accounts: [PLAN_TWO],
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: counting,
    });

    expect(outcome).toEqual({
      lines: ["NOT RE-ENROLLED — the identity assertions file is not valid JSON; no enrollment was changed"],
      ok: false,
    });
    expect(probed).toBe(0);
    expect(readFileSync(assertionsPath({ dir }), "utf8")).toBe("{ truncated");
  });

  it("refuses a store with nothing enrolled, which is a first enrollment", async () => {
    const outcome = await reenrollMany({
      accounts: [PLAN_TWO],
      configured: CONFIGURED,
      home: makeHome(),
      nowIso: NOW,
      probe: probeHolding({ organizationId: "org-new" }),
    });

    expect(outcome).toEqual({
      lines: [
        "plan-two: NOT RE-ENROLLED — no standing enrollment exists; use `slopweaver claude signin --enroll plan-two` for a first enrollment",
      ],
      ok: false,
    });
  });
});

describe("unconfiguredPlanLine — the unknown-store refusal every flag shares", () => {
  it("answers nothing when every named store is configured", () => {
    expect(
      unconfiguredPlanLine({ aliases: ["plan-two", "plan-one"], configured: CONFIGURED, flag: "--reenroll" }),
    ).toBe(undefined);
  });

  // A mistyped alias can be anything, an organisation id included, so the refusal names the configured plans.
  it("lists the configured plans and never echoes what --reenroll was given", () => {
    expect(unconfiguredPlanLine({ aliases: ["org-a", "plan-two"], configured: CONFIGURED, flag: "--reenroll" })).toBe(
      "claude signin: `--reenroll` names 1 store(s) that are not configured — the configured plans are plan-one, plan-two, plan-three; no enrollment was changed",
    );
  });

  it("does the same for a single store named by --plan", () => {
    expect(unconfiguredPlanLine({ aliases: ["org-a"], configured: CONFIGURED, flag: "--plan" })).toBe(
      "claude signin: `--plan` names 1 store(s) that are not configured — the configured plans are plan-one, plan-two, plan-three; no enrollment was changed",
    );
  });
});

describe("signinOne records the sign-in BEFORE anything verifies it", () => {
  const PLANS = [account({ alias: "plan-one" }), account({ alias: "plan-two" })];

  /**
   * A plain fake login — a seam, not a mock — answering whether the vendor's own command exited cleanly, and
   * recording the address it was asked to pre-fill.
   */
  const login =
    ({ clean, hints = [] }: { clean: boolean; hints?: (LoginHint | undefined)[] }): LoginFake =>
    ({ hint }) => {
      hints.push(hint);
      return clean;
    };

  it("pre-fills the address the ENROLLMENT bound, over the accounts.json cache", async () => {
    const dir = makeHome();
    writeAssertions({
      assertions: [{ ...standingThree[1]!, email: "bound@example.invalid" }],
      home: dir,
    });
    const hints: (LoginHint | undefined)[] = [];

    const code = await signinOne({
      accounts: PLANS,
      alias: "plan-two",
      home: dir,
      launch: login({ clean: true, hints }),
      now: () => NOW,
      probe: probeHolding({ organizationId: "org-b" }),
    });

    expect(code).toBe(0);
    expect(hints).toEqual([{ address: "bound@example.invalid", source: "enrolled" }]);
  });

  it("pre-fills the cache, labelled as the cache, when the enrollment bound no address", async () => {
    const dir = makeHome();
    writeAssertions({ assertions: [standingThree[1]!], home: dir });
    const hints: (LoginHint | undefined)[] = [];

    await signinOne({
      accounts: PLANS,
      alias: "plan-two",
      home: dir,
      launch: login({ clean: true, hints }),
      now: () => NOW,
      probe: probeHolding({ organizationId: "org-b" }),
    });

    expect(hints).toEqual([{ address: "plan-two@example.invalid", source: "cache" }]);
  });

  it("pre-fills the cache for a store nothing has enrolled yet", async () => {
    const dir = makeHome();
    const hints: (LoginHint | undefined)[] = [];

    await signinOne({
      accounts: PLANS,
      alias: "plan-two",
      home: dir,
      launch: login({ clean: true, hints }),
      now: () => NOW,
      probe: probeHolding({ organizationId: "org-b" }),
    });

    expect(hints).toEqual([{ address: "plan-two@example.invalid", source: "cache" }]);
  });

  it("records the sign-in even when verification then FAILS, which is the case the owner most needs to see", async () => {
    const dir = makeHome();

    const code = await signinOne({
      accounts: PLANS,
      alias: "plan-two",
      home: dir,
      launch: login({ clean: true }),
      now: () => NOW,
      probe: probeEmpty,
    });

    expect(code).toBe(1);
    expect(readSignIns({ home: dir })).toEqual([{ alias: "plan-two", signedInAtIso: NOW }]);
  });

  it("records the sign-in when verification succeeds too", async () => {
    const dir = makeHome();

    const code = await signinOne({
      accounts: PLANS,
      alias: "plan-two",
      home: dir,
      launch: login({ clean: true }),
      now: () => NOW,
      probe: probeHolding({ organizationId: "org-b" }),
    });

    expect(code).toBe(0);
    expect(readSignIns({ home: dir })).toEqual([{ alias: "plan-two", signedInAtIso: NOW }]);
  });

  // The record is SUBORDINATE to the sign-in: it sits between a completed browser login and the enrollment,
  // so a write failure that ended the run would discard up to ten minutes of the owner's own login and leave
  // the store signed in with nothing bound to it. Witness: a log file the owner cannot write, and an enrollment that
  // lands anyway. Repro: chmod 0o400 the log, then sign in.
  it("enrolls the store anyway when the log itself cannot be written", async () => {
    const dir = makeHome();
    writeFileSync(join(dir, "claude-accounts", "sign-in-log.jsonl"), "", { mode: 0o400 });

    const code = await signinOne({
      accounts: PLANS,
      alias: "plan-two",
      home: dir,
      launch: login({ clean: true }),
      now: () => NOW,
      probe: probeHolding({ organizationId: "org-b" }),
    });

    expect(code).toBe(0);
    expect(readSignIns({ home: dir })).toEqual([]);
    expect(unwrap(readAssertionsForWrite({ configured: ["plan-two"], home: dir }))[0]!.organizationId).toBe("org-b");
  });

  it("records nothing when the vendor's login never completed, because no sign-in happened", async () => {
    const dir = makeHome();

    const code = await signinOne({
      accounts: PLANS,
      alias: "plan-two",
      home: dir,
      launch: login({ clean: false }),
      now: () => NOW,
      probe: probeEmpty,
    });

    expect(code).toBe(1);
    expect(readSignIns({ home: dir })).toEqual([]);
  });

  it("records nothing for a store that is not configured, since nothing was launched", async () => {
    const dir = makeHome();

    const code = await signinOne({
      accounts: PLANS,
      alias: "plan-nine",
      home: dir,
      launch: login({ clean: true }),
      now: () => NOW,
      probe: probeEmpty,
    });

    expect(code).toBe(2);
    expect(readSignIns({ home: dir })).toEqual([]);
  });

  // `--enroll` binds a store already live and launches nothing, so it may never claim a sign-in — otherwise
  // "last sign-in" quietly becomes "last time anyone ran a flag".
  it("leaves the log untouched when --enroll binds an already-live store", async () => {
    const dir = makeHome();

    const outcome = await verifyAndEnroll({
      account: PLAN_TWO,
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeHolding({ organizationId: "org-b" }),
    });

    expect(outcome.ok).toBe(true);
    expect(readSignIns({ home: dir })).toEqual([]);
  });

  // Same for the deliberate re-enrollment: it rebinds what is already in the store and launches no login.
  it("leaves the log untouched when --reenroll replaces a standing enrollment", async () => {
    const dir = makeHome();
    writeAssertions({ assertions: standingThree, home: dir });

    const outcome = await reenrollMany({
      accounts: [PLAN_TWO],
      configured: CONFIGURED,
      home: dir,
      nowIso: NOW,
      probe: probeHolding({ organizationId: "org-z" }),
    });

    expect(outcome.ok).toBe(true);
    expect(readSignIns({ home: dir })).toEqual([]);
  });
});

// The login blocks in a browser for up to ten minutes, so an instant taken before it is not when the owner signed
// in. The clock is a FUNCTION for this reason, read once after the login returns.
describe("signinOne stamps the instant the login FINISHED, not the instant it started", () => {
  it("reads the clock after the login rather than before it", async () => {
    const dir = makeHome();
    const BEFORE = "2026-09-10T21:50:00.000Z";
    const AFTER = "2026-09-10T22:00:00.000Z";
    let current = BEFORE;

    const code = await signinOne({
      accounts: [account({ alias: "plan-two" })],
      alias: "plan-two",
      home: dir,
      launch: () => {
        current = AFTER;
        return true;
      },
      now: () => current,
      probe: probeHolding({ organizationId: "org-b" }),
    });

    expect(code).toBe(0);
    expect(readSignIns({ home: dir })).toEqual([{ alias: "plan-two", signedInAtIso: AFTER }]);
    expect(unwrap(readAssertionsForWrite({ configured: ["plan-two"], home: dir }))[0]!.assertedAtIso).toBe(AFTER);
  });
});
