/**
 * Every verb's `--help` must describe the verb that exists — across the WHOLE CLI, not one noun.
 *
 * The first cut of this ratchet guarded `linear issue` alone, by hard-coding it. That left seventeen other
 * verbs unguarded, including `refresh` — the ORIGINAL instance of the bug, whose usage omitted ten shipped
 * flags including `--sample`, and which the linear-only ratchet went on not noticing.
 *
 * It also compared with `USAGE.includes(flag)`, a SUBSTRING test: a usage string mentioning only `--homedir`
 * "advertised" `--home`, so the check could pass vacuously. Both directions here compare whole flag tokens.
 *
 * ## Declarations are not behaviour
 *
 * Comparing two DECLARATIONS — an exported name array against a usage string — is the same mistake one level
 * up: it proves the two lists agree, not that the parser agrees with either. So every advertised flag is
 * also pushed through the REAL parser below, and a bogus flag is pushed through to prove the verb is strict.
 *
 * ## The residual, stated precisely rather than buried
 *
 * This catches every flag advertised-but-not-accepted, and every flag accepted-and-declared-but-unadvertised.
 * What it cannot catch is a flag ACCEPTED BUT DECLARED NOWHERE, in either of two ways:
 *
 *  1. an alias rewritten in `argv` before the shared parser sees it;
 *  2. a verb whose handler is repointed at a different parser — {@link GUARDED} names the parser to probe
 *     next to the verb, so the probe would go on testing the old one.
 *
 * Neither is closable by testing: nothing can enumerate what an arbitrary parser accepts. What holds them
 * shut is structural and visible in review — every guarded verb passes its exported spec straight to
 * `parseFlags`/`parseFlagTail` with no argv rewriting, and the parser each verb is probed against is named
 * in one place rather than discovered.
 *
 * A verb is guarded when its command module exports its flag names. A verb that cannot be checked yet must
 * be named in {@link UNGUARDED} with a reason — an unlisted verb FAILS rather than being skipped, so adding
 * a noun cannot quietly opt out of the ratchet.
 *
 * ## Where the tables live
 *
 * {@link GUARDED}, {@link PROBES} and {@link PARSERS} are assembled in `./helpTruth/allTables.ts` from one
 * slice file per verb family under `./helpTruth/` — adding a verb means opening the family file its noun
 * sits in, never this one. {@link UNGUARDED} stays here because the `help-flag-opt-out` gate reads it here.
 */

import { describe, expect, it } from "vitest";
import { atlasPlatforms } from "../../../atlas/registry.js";
import { ATLAS_SLACK_FLAG_NAMES } from "../../../cli/commands/atlas/slackCore.js";
import { ATLAS_SLACK_USAGE } from "../../../cli/commands/atlas/slackUsage.js";
import { parseRefreshOptions, selectRefreshSources } from "../../../cli/commands/refresh/core.js";
import { REFRESH_SELF_FLAGS, REFRESH_USAGE } from "../../../cli/commands/refresh/flags.js";
import { slackArgumentErrorLines } from "../../../cli/commands/slack/argumentErrors.js";
import { parseSlackWriteArgs } from "../../../cli/commands/slack/coreArgs.js";
import { DEFAULT_VERB } from "../../../cli/manifest.js";
import { MANIFEST_MODULES } from "../../../cli/manifests/index.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { DUPLICATE_ADDRESSES, GUARDED, PARSERS, PROBES } from "./helpTruth/allTables.js";
import { mergeSlices } from "./helpTruth/mergeSlices.js";
import { PROBE_HOME, SLACK_BOT_POST_PROBE, SLACK_ME_REPLY_PROBE } from "./helpTruth/sharedProbes.js";

/** A verb's address as it is spoken: `"<noun> <verb>"`, or just `"<noun>"` for the bare-noun default. */
function addressOf({ noun, verb }: { noun: string; verb: string }): string {
  return verb === DEFAULT_VERB ? noun : `${noun} ${verb}`;
}

/** Every `<address, usage>` pair the CLI publishes, in barrel order. */
function everyVerb(): readonly { address: string; usage: string }[] {
  return MANIFEST_MODULES.flatMap((module) =>
    Object.entries(module.verbs).map(([verb, entry]) => ({
      address: addressOf({ noun: module.noun, verb }),
      usage: entry.meta.usage,
    })),
  );
}

/** Every `--flag` TOKEN named in a usage string. Token-wise, so `--homedir` never satisfies `--home`. */
function advertisedFlags({ usage }: { usage: string }): readonly string[] {
  const tokens = usage.match(/--[a-z][a-z0-9-]*/g);
  if (tokens === null) {
    return []; // a usage naming no `--flag` token advertises none
  }
  return [...new Set(tokens)].toSorted();
}

/**
 * Verbs not yet guarded, each with the reason. Named rather than skipped: the completeness test below fails
 * for any verb absent from BOTH maps, so this list is the only way to opt out and it is visible in review.
 */
const UNGUARDED: Readonly<Record<string, string>> = {
  // Every `atlas <platform>` row is BUILT from the registry (`cli/manifests/atlasPlatformMeta.ts`) and parses
  // no flags of its own: it names which atlas, and dispatches to the kit's verbs or the platform's own, each
  // of which advertises and parses its own tail. `unit/atlas/registryVerbUsage.test.ts` holds each verb's
  // usage constant against the manifest row; `registryVerbs.test.ts` proves every row loads. So the opt-out
  // is one line per registration rather than one hand-typed line per atlas — a new atlas cannot arrive
  // here unlisted, and a removed one cannot linger. Slack's row is hand-written and is one of these too: it
  // advertises the map's flags AND its kit `reset`/`restore` tails, which three different parsers own, so
  // the whole-row sweep cannot hold it. The map's own line is held to the map's parser in "the Slack map's
  // usage line tells the truth" below instead.
  ...Object.fromEntries(
    atlasPlatforms().map((platform) => [
      `atlas ${platform}`,
      "a registry-built platform row; dispatches to the kit's verbs and its own, and the flags belong to those verbs",
    ]),
  ),
  // `hatch` is the ESCAPE, and an escape whose own invocation can be refused is a wedge rather than a gate
  // (src/cli/commands/hatch/run.ts states the property). It parses --reason and --home by hand and guards
  // nothing, deliberately.
  // `profile hook` is invoked by the harness, never by a person, and it takes no flags of its own. It
  // must exit zero on EVERY path — a session start a profile read can break is a session start somebody
  // turns off — so refusing an argv it did not expect is exactly the behaviour it must not have.
  "profile hook": "a harness-invoked hook that takes no flags and must never refuse anything",
  "codex rules-context": "a harness-invoked Codex SessionStart hook that takes no flags and must never refuse anything",
  "hatch list": "the escape lane itself; it reads a journal and guards nothing",
  "hatch open": "the escape lane itself; refusing it would swallow the command every outbound refusal names",
  // Vanta answers its own verbs alongside the two kit ones, and `write vanta` answers the mutation that
  // an atlas must not. Both dispatch; the flags belong to the verbs they dispatch to, whose own
  // usage-advertises-every-flag property is asserted in the Vanta command tests instead.
  "write vanta": "dispatches to its own verbs; the flags belong to those verbs",
  audit: "hand-rolled parser; no exported flag spec yet",
  "audit run": "hand-rolled parser; no exported flag spec yet",
  catalog: "hand-rolled parser; no exported flag spec yet",
  "catalog list": "hand-rolled parser; no exported flag spec yet",
  "cloudflare reset": "hand-rolled parser; no exported flag spec yet",
  "cloudflare sync": "hand-rolled parser; no exported flag spec yet",
  "codex plan": "hand-rolled parser; no exported flag spec yet",
  "codex review": "hand-rolled parser; no exported flag spec yet",
  // The three budget verbs take no VALUE-bearing flag at all — only `--json`, and `--status` on signin —
  // so there is no spec to advertise. Each refuses an unknown flag by name before any read, which
  // `unit/codex/gaugeRun/parsePhase.test.ts` asserts directly rather than through a flag spec.
  "codex gauge": "only --json; refuses an unknown flag by name, with no flag spec to share",
  "codex signin": "only --status and --json; refuses an unknown flag by name, with no flag spec to share",
  compact: "hand-rolled parser; no exported flag spec yet",
  "compact run": "hand-rolled parser; no exported flag spec yet",
  connect: "hand-rolled parser; no exported flag spec yet",
  "console batch": "takes no flags; its items arrive on stdin and any argument is refused with its usage",
  "connect check": "hand-rolled parser; no exported flag spec yet",
  "datadog metrics": "hand-rolled parser; no exported flag spec yet",
  "datadog probe": "hand-rolled parser; no exported flag spec yet",
  "datadog raw": "hand-rolled parser; no exported flag spec yet",
  "datadog verify": "hand-rolled parser; no exported flag spec yet",
  derive: "hand-rolled parser; no exported flag spec yet",
  "derive run": "hand-rolled parser; no exported flag spec yet",
  "desktop install":
    "one flag, --home, parsed strictly by desktopInstallArgs (unit/desktop/installPlan.test.ts); no exported flag spec yet",
  "dev door": "hand-rolled parser; no exported flag spec yet",
  "dev door-coverage": "hand-rolled parser; no exported flag spec yet",
  "dev gate": "hand-rolled parser; no exported flag spec yet",
  "dev lint": "hand-rolled parser; no exported flag spec yet",
  "dev manifest": "hand-rolled parser; no exported flag spec yet",
  doctor: "hand-rolled parser; no exported flag spec yet",
  "doctor run": "hand-rolled parser; no exported flag spec yet",
  identity: "hand-rolled parser; no exported flag spec yet",
  "identity resolve": "hand-rolled parser; no exported flag spec yet",
  "identity show": "hand-rolled parser; no exported flag spec yet",
  init: "hand-rolled parser; no exported flag spec yet",
  "init run": "hand-rolled parser; no exported flag spec yet",
  "secrets set": "hand-rolled parser; no exported flag spec yet",
  seed: "hand-rolled parser; no exported flag spec yet",
  "seed run": "hand-rolled parser; no exported flag spec yet",
  slice: "hand-rolled parser; no exported flag spec yet",
  "slice capture": "hand-rolled parser; no exported flag spec yet",
  "slice verify": "hand-rolled parser; no exported flag spec yet",
};

/**
 * Addresses that SHARE another address's probe table: a default-verb noun and its explicit `run` spelling
 * are one verb with two names, so stating the flags twice could only ever produce two lists that disagree.
 */
const PROBE_ALIASES: Readonly<Record<string, string>> = {
  cycle: "cycle reconcile",
  "session-start run": "session-start",
  distil: "distil brief",
  subset: "subset status",
  "listen run": "listen",
  "onboard run": "onboard",
  "refresh run": "refresh",
};

/** The probe table for a verb, keyed by its address (following any alias above). */
function probesFor({ address }: { address: string }): Readonly<Record<string, readonly string[]>> {
  const aliased = PROBE_ALIASES[address];
  // An address no alias names is its own table's key.
  if (aliased === undefined) {
    return tableAt({ key: address });
  }
  return tableAt({ key: aliased });
}

/** The probe table at a key — a verb no table names probes no flags. */
function tableAt({ key }: { key: string }): Readonly<Record<string, readonly string[]>> {
  const table = PROBES[key];
  if (table === undefined) {
    return {};
  }
  return table;
}

/** Parse a valid invocation of one flag through the verb's REAL parser; `[]` means it parsed cleanly. */
function parseErrorsFor({ address, fragment }: { address: string; fragment: readonly string[] }): readonly string[] {
  const parsed = PARSERS[address]!({ fragment });
  return parsed.isOk() ? [] : parsed.error;
}

/**
 * The invocation a case states for one advertised flag, refusing a flag with none. The case before the one that
 * reads this already names every unprobed flag; parsing an unprobed one as an empty invocation instead would
 * report a parser defect that is really the missing probe.
 */
function statedProbe({
  address,
  flag,
  probes,
}: {
  address: string;
  flag: string;
  probes: Readonly<Record<string, readonly string[]>>;
}): readonly string[] {
  const fragment = probes[flag];
  if (fragment === undefined) {
    throw new Error(`no probe states a valid invocation for ${address} ${flag}`);
  }
  return fragment;
}

describe("the guarded parsers actually behave as their help claims", () => {
  it("states a valid invocation for every advertised flag", () => {
    const unprobed = everyVerb()
      .filter((verb) => GUARDED[verb.address] !== undefined)
      .flatMap((verb) =>
        advertisedFlags({ usage: verb.usage })
          .filter((flag) => probesFor({ address: verb.address })[flag] === undefined)
          .map((flag) => `${verb.address} ${flag}`),
      )
      .toSorted();

    expect(unprobed).toEqual([]);
  });

  it("accepts every flag its help advertises, given a valid value", () => {
    const rejected = everyVerb()
      .filter((verb) => GUARDED[verb.address] !== undefined)
      .flatMap((verb) => {
        const probes = probesFor({ address: verb.address });
        return advertisedFlags({ usage: verb.usage })
          .filter(
            (flag) =>
              parseErrorsFor({ address: verb.address, fragment: statedProbe({ address: verb.address, flag, probes }) })
                .length > 0,
          )
          .map((flag) => `${verb.address} ${flag}`);
      })
      .toSorted();

    expect(rejected).toEqual([]);
  });

  it("is strict, so a flag it does not know is refused rather than ignored", () => {
    const accepted = everyVerb()
      .filter((verb) => GUARDED[verb.address] !== undefined)
      .filter(
        (verb) => parseErrorsFor({ address: verb.address, fragment: ["--definitely-not-a-real-flag"] }).length === 0,
      )
      .map((verb) => verb.address)
      .toSorted();

    expect(accepted).toEqual([]);
  });
});

/**
 * The `self` source's opt-in flags, pinned BY NAME rather than left to the generic sweep above.
 *
 * The sweep proves the advertised set and the accepted set agree, which is a property of two lists. This is a
 * property of ONE flag: `--self` is how the fifth source is reached at all, `--source self` is deliberately
 * refused, and `refresh --help` once hid ten shipped flags — so if this one stops being advertised there is no
 * documented way in. Naming it here means the failure says which flag went missing.
 */
describe("refresh advertises the self source's opt-in flags", () => {
  it("has at least one entry in REFRESH_SELF_FLAGS, so the guards below are not vacuously green", () => {
    expect(REFRESH_SELF_FLAGS.length).toBeGreaterThan(0);
  });

  it("names both in the usage a caller reads", () => {
    const advertised = advertisedFlags({ usage: REFRESH_USAGE });

    expect(REFRESH_SELF_FLAGS.filter((flag) => !advertised.includes(flag))).toEqual([]);
  });

  it("accepts both through the real parser", () => {
    const rejected = REFRESH_SELF_FLAGS.filter(
      (flag) => parseErrorsFor({ address: "refresh", fragment: PROBES["refresh"]![flag]! }).length > 0,
    );

    expect(rejected).toEqual([]);
  });

  it("refuses self as a --source value, because it is not fetched and has no cursor", () => {
    const parsed = parseRefreshOptions({ rest: ["--source", "self"] });

    expect(parsed.isOk()).toBe(true);
    expect(selectRefreshSources({ allSources: false, sources: unwrap(parsed).sources }).isOk()).toBe(false);
  });

  it("does not turn the self source on for a bare refresh", () => {
    const parsed = parseRefreshOptions({ rest: [] });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).self).toBe(false);
  });
});

/**
 * The two flags `slack post`/`slack reply` exclude from their shared spec, pinned BY NAME.
 *
 * The sweep above compares two lists and cannot see these: {@link SLACK_POST_FLAG_NAMES} subtracts
 * `--thread-ts` and {@link SLACK_REPLY_FLAG_NAMES} subtracts `--shape`, so if either verb started ACCEPTING
 * the flag it excludes, the derived list would simply stop mentioning it and every sweep would stay green.
 * These two assertions are what make the subtraction a claim about behaviour rather than about arithmetic.
 * `--draft` is no longer an exclusion: both verbs parse it, and the ROW decides which one releases it
 * (`releasePlacementRefusal`, `src/cli/commands/slack/releaseRun.ts`).
 */
describe("post and reply exclude exactly the flag the other verb owns", () => {
  it("refuses `slack post --thread-ts`, pointing at reply", () => {
    const parsed = parseSlackWriteArgs({
      defaultHome: PROBE_HOME,
      rest: [...SLACK_BOT_POST_PROBE, "--thread-ts", "1712345678.000100"],
      verb: "post",
    });

    expect(parsed.isOk()).toBe(false);
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })).toContain(
      "`slack post` does not take --thread-ts; use `slack reply`",
    );
  });

  it("parses `slack reply --draft` as a release carrying the reply verb, which the row then checks", () => {
    const parsed = parseSlackWriteArgs({
      defaultHome: PROBE_HOME,
      rest: ["--as", "me", "--draft", "sd-1a2b3c4d", "--approve", "3f2a9c11d4e5b6a7"],
      verb: "reply",
    });

    expect(unwrap(parsed)).toMatchObject({
      release: { approve: "3f2a9c11d4e5b6a7", draftId: "sd-1a2b3c4d" },
      verb: "reply",
    });
  });

  it("refuses `slack reply --as me --shape`, because every message goes into the named thread", () => {
    const parsed = parseSlackWriteArgs({
      defaultHome: PROBE_HOME,
      rest: [...SLACK_ME_REPLY_PROBE, "--shape", "thread"],
      verb: "reply",
    });

    expect(parsed.isOk()).toBe(false);
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) }).join(" ")).toContain("does not take --shape");
  });
});

describe("every verb's --help tells the truth", () => {
  it("classifies every published verb as guarded or explicitly unguarded", () => {
    const unclassified = everyVerb()
      .map((verb) => verb.address)
      .filter((address) => GUARDED[address] === undefined && UNGUARDED[address] === undefined)
      .toSorted();

    expect(unclassified).toEqual([]);
  });

  it("names no verb that no longer exists", () => {
    const live = new Set(everyVerb().map((verb) => verb.address));
    const dead = [...Object.keys(GUARDED), ...Object.keys(UNGUARDED)]
      .filter((address) => !live.has(address))
      .toSorted();

    expect(dead).toEqual([]);
  });

  it("exempts no verb that is in fact guarded", () => {
    const both = Object.keys(UNGUARDED)
      .filter((address) => GUARDED[address] !== undefined)
      .toSorted();

    expect(both).toEqual([]);
  });

  it("advertises no flag the parser would reject", () => {
    const rejected = everyVerb()
      .filter((verb) => GUARDED[verb.address] !== undefined)
      .flatMap((verb) =>
        advertisedFlags({ usage: verb.usage })
          .filter((flag) => !GUARDED[verb.address]!.includes(flag))
          .map((flag) => `${verb.address} ${flag}`),
      )
      .toSorted();

    expect(rejected).toEqual([]);
  });

  it("advertises every flag the parser accepts", () => {
    const missing = everyVerb()
      .filter((verb) => GUARDED[verb.address] !== undefined)
      .flatMap((verb) => {
        const advertised = advertisedFlags({ usage: verb.usage });
        return GUARDED[verb.address]!.filter((flag) => !advertised.includes(flag)).map(
          (flag) => `${verb.address} ${flag}`,
        );
      })
      .toSorted();

    expect(missing).toEqual([]);
  });
});

/**
 * `atlas slack`'s row advertises three parsers' flags — the map's on its first line, then the kit's `reset`
 * and `restore` tails — so it sits in UNGUARDED with every other platform row, and the map's own line is held
 * to the map's parser HERE, by the same three properties the sweep above checks for a guarded verb.
 */
describe("the Slack map's usage line tells the truth", () => {
  const mapLine = ATLAS_SLACK_USAGE.split("\n")[0]!;
  const probes = probesFor({ address: "atlas slack" });

  it("advertises exactly the flags the map parser accepts", () => {
    expect(advertisedFlags({ usage: mapLine })).toEqual([...ATLAS_SLACK_FLAG_NAMES].toSorted());
  });

  it("parses a valid invocation of every flag it advertises", () => {
    const flags = advertisedFlags({ usage: mapLine });
    expect(flags.length).toBeGreaterThan(0);
    const rejected = flags.filter(
      (flag) =>
        parseErrorsFor({ address: "atlas slack", fragment: statedProbe({ address: "atlas slack", flag, probes }) })
          .length > 0,
    );
    expect(rejected).toEqual([]);
  });

  it("refuses a flag it does not know, and the kit verbs' flags are not the map's", () => {
    expect(parseErrorsFor({ address: "atlas slack", fragment: ["--definitely-not-a-real-flag"] }).join("\n")).toContain(
      "--definitely-not-a-real-flag",
    );
    expect(parseErrorsFor({ address: "atlas slack", fragment: ["--confirm", "archive"] }).join("\n")).toContain(
      "--confirm",
    );
  });
});

/**
 * The tables are assembled from one slice per noun, and a merge — unlike the single object literal each table
 * used to be — would let a later slice's row silently replace an earlier one's. These hold that shut.
 */
describe("the tables are split one slice per noun without losing a row", () => {
  it("defines every address once per table across the slices", () => {
    expect(Object.keys(GUARDED).length).toBeGreaterThan(0);
    expect(DUPLICATE_ADDRESSES).toEqual([]);
  });

  it("records an address two slices both define, rather than letting the later one win", () => {
    const merged = mergeSlices({
      pick: (slice) => slice.guarded,
      slices: [{ guarded: { "acme sync": ["--first"] } }, { guarded: { "acme sync": ["--second"] } }],
    });

    expect(merged.duplicates).toEqual(["acme sync"]);
    expect(merged.table).toEqual({ "acme sync": ["--first"] });
  });

  it("reports a duplicated __proto__ address rather than letting it reach a prototype setter", () => {
    const merged = mergeSlices({
      pick: (slice) => slice.guarded,
      slices: [
        { guarded: Object.fromEntries([["__proto__", ["--first"]]]) },
        { guarded: Object.fromEntries([["__proto__", ["--second"]]]) },
      ],
    });

    expect(merged.duplicates).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(merged.table, "__proto__")!.value).toEqual(["--first"]);
  });
});
