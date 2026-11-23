/**
 * The `briefing check` shell: the parse, the injected file read, and the exit code that IS the gate's
 * contract. The card-shape classification itself is already owned by
 * {@link ../../../../../briefing/reactNowCard}; what is under test here is dispatch and exit code.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { BlockedAskPremise } from "../../../../../briefing/blockedAsks.js";
import { runBriefingCheck } from "../../../../../cli/commands/briefing/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import type { SilentRow } from "../../../../../live/automation/silentRows.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { PrPremise } from "../../../../../live/github/prPremise.js";
import type { ExactVoiceRule } from "../../../../../outbound/voice/exactRules.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";

/** The eyebrow every briefing carries: both instants, in `../../../../../outbound/briefing/stamp.ts`'s format. */
const EYEBROW =
  `<div class="eyebrow">supervisor ws:598 · last refreshed 2026-09-01 19:07:42 AEST · ` +
  `ready for review 2026-09-01 19:12:03 AEST</div>`;

/** The renderer's own age line, which every card carries. */
const AGE_LINE =
  '<div class="age" data-premise-kind="composed" data-premise-iso="2026-09-11T21:18:59Z">premise 2 hours old</div>';

const VALID_ARTIFACT =
  `${EYEBROW}<h2>react now</h2><div class="need"><div class="q">1. Ship it: are you happy?</div>` +
  AGE_LINE +
  `<dl class="f"><dt>what</dt><dd>Two sentences here. Background continues.</dd>` +
  `<dt>why you</dt><dd>It is your call.</dd>` +
  `<dt>options</dt><dd>A: send it as written. B: hold it for now.</dd>` +
  `<dt>lean</dt><dd>A.</dd>` +
  `<dt>if silent</dt><dd>nothing ships.</dd></dl></div>` +
  `<h2>what we are actually working</h2><p class="align">Both live sessions are on the board's top 5.</p>` +
  `<h2>done</h2>`;

/** The same page whose one card names a pull request in its subject line. */
const CARD_ON_A_PULL_REQUEST = VALID_ARTIFACT.replace(
  `</div><dl class="f">`,
  `</div><div class="bg"><a href="https://github.com/acme/acme-admin/pull/11141">the subject</a></div>` +
    `<dl class="f">`,
);

/** The same page with its alignment block removed — a hand-written briefing that skipped the comparison. */
const NO_ALIGNMENT = VALID_ARTIFACT.replace(
  `<h2>what we are actually working</h2><p class="align">Both live sessions are on the board's top 5.</p>`,
  "",
);

/** Run the shell against a fake single-file filesystem, capturing both output lanes. */
async function run({
  rest,
  files = {},
  applyVoice = true,
  applyBareRefs = true,
  applyFraming = true,
  applyPrPremise = true,
  blocked = [],
  premises = [],
  premiseReadFails = false,
  rulesByHome = {},
  realProfile = false,
  silent = [],
}: {
  rest: readonly string[];
  files?: Readonly<Record<string, string>>;
  applyVoice?: boolean;
  applyBareRefs?: boolean;
  applyFraming?: boolean;
  applyPrPremise?: boolean;
  blocked?: readonly BlockedAskPremise[];
  premises?: readonly PrPremise[];
  premiseReadFails?: boolean;
  rulesByHome?: Readonly<Record<string, readonly ExactVoiceRule[]>>;
  /** Read voice rules through the production reader, so the home's own `profile.json` decides them. */
  realProfile?: boolean;
  silent?: readonly SilentRow[];
}): Promise<{
  code: number;
  out: string[];
  diagnostics: string[];
  premiseReads: number;
  hatchHomes: string[];
}> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const hatchHomes: string[] = [];
  let premiseReads = 0;
  const asked =
    ({ answer }: { answer: boolean }) =>
    ({ home }: { home: string }) => {
      hatchHomes.push(home);
      return answer;
    };
  const code = await runBriefingCheck({
    applyBareRefs: asked({ answer: applyBareRefs }),
    applyFraming,
    applyPrPremise: asked({ answer: applyPrPremise }),
    applyVoice: asked({ answer: applyVoice }),
    exists: (path) => path in files,
    readBlockedAsks: () => blocked,
    readFile: (path) => files[path]!,
    readPrPremises: () => {
      premiseReads += 1;
      return Promise.resolve(
        premiseReadFails
          ? err(GithubLiveErrors.readFailed({ message: "the credential could not reach GitHub" }))
          : ok(new Map(premises.map((premise) => [premise.identity, premise]))),
      );
    },
    readSilentRows: () => silent,
    rest,
    voiceRules: ({ home }) => {
      if (realProfile) {
        return readExactVoiceRules({ home });
      }
      const rules = rulesByHome[home];
      if (rules === undefined) {
        return ok([]); // a home the case seeds no rules for has no voice rules on file
      }
      return ok(rules);
    },
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  });
  return { code, diagnostics, hatchHomes, out, premiseReads };
}

describe("runBriefingCheck", () => {
  it("exits zero and reports a clean pass on a well-shaped artifact", async () => {
    const result = await run({ files: { "/a.html": VALID_ARTIFACT }, rest: ["/a.html"] });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toEqual([
      "1 card(s) checked under react-now, no defects",
      "shape: react-now first, the groupings in order, both instants stated",
      "page: 32 words and 0 unfolded block(s) above the fold outside the cards, inside budget",
      "alignment: stated in 9 words above the fold",
      "sections: 1 level(s) outside the cards read, every fleet word glossed where you can see it",
      "autonomy ledger: nothing has been done autonomously, or the page was rendered without --autonomy-ledger",
      "one index: 0 row(s) of yours in 0 words, 0 artifact(s) linked, every anchor lands",
      "corrections: not stamped — a first publish, or a republish that skipped `briefing corrections`",
      "correction block: nothing is waiting on your mark, or the page was rendered without --owner-beliefs",
      "quiz: this sweep asked nothing, or the page was rendered without --knowledge-quiz",
      "bare references: none found",
      "fold residue: none found",
      "blocked on the owner: nothing waiting on them, or the ask-lifecycle log was not read",
      "gone quiet: every standing row is posting on its cadence, or the recipe store was not read",
      "live premises: no card names a pull request, or the freshness leg did not run",
    ]);
  });

  it("refuses a page that states no alignment at all — the one defect that is an absence", async () => {
    const result = await run({ files: { "/a.html": NO_ALIGNMENT }, rest: ["/a.html"] });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out[0]).toBe(
      "alignment (missing): the page carries no alignment block. Every briefing states what the fleet is " +
        "actually working against the board's top rows — run `slopweaver handover reconcile` and put its " +
        "headline here.",
    );
  });

  it("exits non-zero and names the card and field on a card missing `lean`", async () => {
    const broken = VALID_ARTIFACT.replace("<dt>lean</dt><dd>A.</dd>", "");
    const result = await run({ files: { "/a.html": broken }, rest: ["/a.html"] });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([
      'card 1 ("Ship it: are you happy?"): lean — missing',
      "1 defect(s) across 1 card(s) checked, the page's shape, the alignment line, the page budget, the " +
        "one-index budgets, the corrections marks, the autonomy ledger, the correction block, the quiz, " +
        "the bare-reference scan, the fold-residue scan, every section outside the cards, the blocks waiting on " +
        "the owner, the standing rows that have gone quiet and the live pull-request premises",
    ]);
  });

  it("reads the operator's private voice rules from the home the caller named", async () => {
    const result = await run({
      files: { "/a.html": VALID_ARTIFACT },
      rest: ["/a.html", "--home", "/state"],
      rulesByHome: { "/state": [{ kind: "word", value: "happy" }] },
    });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out[0]).toBe(
      'card 1 ("Ship it: are you happy?"): question — question: matches the configured word voice rule ' +
        '"happy". Rewrite the authored prose.',
    );
  });

  it("lets the same artifact through when the break-glass has lifted the voice pass", async () => {
    const result = await run({
      applyVoice: false,
      files: { "/a.html": VALID_ARTIFACT },
      rest: ["/a.html", "--home", "/state"],
      rulesByHome: { "/state": [{ kind: "word", value: "happy" }] },
    });

    expect(result.code).toBe(EXIT_OK);
  });

  it("asks every journalled hatch of the home --home named, where `hatch open --home` wrote the grant", async () => {
    const result = await run({ files: { "/a.html": VALID_ARTIFACT }, rest: ["/a.html", "--home", "/state"] });

    expect(result.hatchHomes).toEqual(["/state", "/state", "/state"]);
  });

  it("refuses a CORRUPT profile.json before any premise read, rather than checking against no voice rules", async () => {
    const home = mkdtempSync(join(tmpdir(), "briefing-check-corrupt-"));
    try {
      writeFileSync(join(home, "profile.json"), "{", "utf8");
      const result = await run({
        files: { "/a.html": CARD_ON_A_PULL_REQUEST },
        realProfile: true,
        rest: ["/a.html", "--home", home],
      });

      expect(result.code).toBe(EXIT_ERROR);
      expect(result.out).toEqual([]);
      expect(result.premiseReads).toBe(0);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toContain(
        `the profile at ${join(home, "profile.json")} is there but cannot be trusted`,
      );
      expect(result.diagnostics[0]).toContain("the page was not checked.");
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("checks against no rules for a home with no profile at all, as an install that configured none", async () => {
    const home = mkdtempSync(join(tmpdir(), "briefing-check-absent-"));
    try {
      const result = await run({
        files: { "/a.html": VALID_ARTIFACT },
        realProfile: true,
        rest: ["/a.html", "--home", home],
      });

      expect(result.code).toBe(EXIT_OK);
      expect(result.out[0]).toBe("1 card(s) checked under react-now, no defects");
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("refuses a page whose done section never folds anything away", async () => {
    const blocks = Array.from({ length: 6 }, () => '<div class="need"><div class="q">landed.</div></div>').join("");
    const result = await run({ files: { "/a.html": `${VALID_ARTIFACT}${blocks}` }, rest: ["/a.html"] });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out[0]).toBe(
      "page (unfolded-blocks): 6 blocks outside the react-now section sit outside a details fold, over the " +
        "cap of 5. Keep the newest few open and put the older ones inside a collapsed details, or drop them.",
    );
  });

  it("refuses with usage when no path is given", async () => {
    const result = await run({ rest: [] });

    expect(result.code).toBe(EXIT_USAGE);
    expect(result.out).toEqual([]);
  });

  it("refuses a bad flag before touching the filesystem", async () => {
    const result = await run({ rest: ["--not-a-real-flag"] });

    expect(result.code).toBe(EXIT_USAGE);
    expect(result.out).toEqual([]);
  });

  it("exits with an error naming the path when the file does not exist", async () => {
    const result = await run({ rest: ["/missing.html"] });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.diagnostics).toEqual(["briefing check: no such file: /missing.html"]);
  });

  it("refuses a card whose pull request has already merged, and names the state", async () => {
    const result = await run({
      files: { "/a.html": CARD_ON_A_PULL_REQUEST },
      premises: [{ identity: "acme/acme-admin#11141", queue: undefined, state: "MERGED" }],
      rest: ["/a.html"],
    });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out[0]).toBe(
      'card 1 ("Ship it: are you happy?"): stale premise — acme/acme-admin#11141 is MERGED on GitHub, so ' +
        "this card asks about work that is already settled. Drop the card, or re-render the page from a fresh " +
        "sweep.",
    );
  });

  it("refuses a card whose pull request is queued, and names the entry", async () => {
    const result = await run({
      files: { "/a.html": CARD_ON_A_PULL_REQUEST },
      premises: [
        { identity: "acme/acme-admin#11141", queue: { position: 2, state: "AWAITING_CHECKS" }, state: "OPEN" },
      ],
      rest: ["/a.html"],
    });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out[0]).toBe(
      'card 1 ("Ship it: are you happy?"): stale premise — acme/acme-admin#11141 is in the merge queue ' +
        "(entry AWAITING_CHECKS, position 2), so it lands without the owner. Drop the card, or re-render the page " +
        "from a fresh sweep.",
    );
  });

  it("passes the same card once GitHub still reports its pull request open", async () => {
    const result = await run({
      files: { "/a.html": CARD_ON_A_PULL_REQUEST },
      premises: [{ identity: "acme/acme-admin#11141", queue: undefined, state: "OPEN" }],
      rest: ["/a.html"],
    });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out[result.out.length - 1]).toBe("live premises: 1 card(s) name a pull request, all still open");
  });

  it("refuses the whole run, naming the break-glass, when the live read fails", async () => {
    const result = await run({
      files: { "/a.html": CARD_ON_A_PULL_REQUEST },
      premiseReadFails: true,
      rest: ["/a.html"],
    });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.diagnostics).toEqual([
      "briefing check: the credential could not reach GitHub",
      "For one deliberate exception run slopweaver hatch open stale-cards " +
        '--reason "<why this one is a legitimate exception>", then re-run; the grant skips the live ' +
        "pull-request read entirely.",
    ]);
    expect(result.out).toEqual([]);
  });

  it("skips the live read entirely when the break-glass is set", async () => {
    const result = await run({
      applyPrPremise: false,
      files: { "/a.html": CARD_ON_A_PULL_REQUEST },
      premiseReadFails: true,
      rest: ["/a.html"],
    });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out[result.out.length - 1]).toBe(
      "live premises: no card names a pull request, or the freshness leg did not run",
    );
  });
});
