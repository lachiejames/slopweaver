# A test that only says it failed

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The rule comes from the round-3 test-CONTENT survey (`$SLOPWEAVER_HOME/teamready/code-quality-round-3-test-content.md`,
page `test-content-not-just-distribution`). Rounds 1 and 2 had both counted test lines and judged their
DISTRIBUTION across the three lanes, and both said in their own words that CONTENT was not judged. Round 3
was that deferral taken, by two independent lenses — Claude auditing the tree directly, and, because Codex
was hard-capped on a workspace spend limit, a second VISIBLE Claude session taking the review
([rule 9 § capped](rule-9.md#when-codex-is-capped-claude-takes-the-review--as-a-receipt-never-as-a-skip)). Of a
gate with a shrinking debt list, fixing the five worst files only, or leaving it, the choice was **the gate**.

**Why this class and not the bigger one.** The survey's headline was that 11.77% of 52,954 assertion sites
are weak by the testing rule's own definition — and then that 5,954 of the 6,234 are one matcher,
`toContain`, which the rule permits for an error-message fragment. Nothing there is gateable without
encoding a dozen witness shapes the tree legitimately uses; the survey's finding 6 is the whole argument
against trying, recording an instrument recalibrated four times, every time downward, from 3,579 to 41. What
IS gateable is the class where the house rule already prescribes the fix: `error-handling.md` § Tests says a
which-failure check asserts `.error.code` and a display check asserts `.error.message`, and 325 cases
asserted neither. Both lenses found it independently, 325 in 165 files against 328 in 167, and it was the
largest single actionable class either reported.

**What a bare failure assertion actually fails to say.**
`src/__tests__/unit/live/turn/judgement/parseRoutingDecision.test.ts`, re-checked by hand in the survey: a case titled _"refuses a respond decision missing tier"_ whose whole body
is `expect(result.isErr()).toBe(true)`. It passes when the parser refuses for the reason the title names,
and equally when it refuses for a rejected `schemaVersion`, an empty `needs`, or a throw on the way in. The
title is a claim about WHICH failure. The assertion supports only that one happened, so the test cannot fail
in the way it exists to fail.

**The criterion, not a count.** A test CASE — an `it` or `test` call, with any modifier — whose body holds at
least one `expect(...)` and where EVERY one of them is a bare-failure assertion: `expect(<e>.isErr()).toBe(true)`,
`expect(<e>.isOk()).toBe(false)` or `expect(<e>.ok).toBe(false)`, with type-only wrappers stripped first.
**One other assertion anywhere in the body exempts the case**, because that assertion is what carries the
rest of the claim — widening to "every case that asserts a failure without naming it" is a different and much
larger population, and is not what the gate was chosen to buy. `.not`, `.resolves` and `.rejects` chains are outside it too:
the matcher chain must be exactly `.toBe(true)`/`.toBe(false)`. The **third** spelling is in the sentence
because the same survey's finding 11 measured 26 of 33 fixture strings walking through the shipped
`testing-discipline` matcher by respelling — a gate that refused `isErr()`→`true` and not `isOk()`→`false`
would be teaching the rewrite. The stated blind spot is a failure reached through a NAME
(`expect(failed).toBe(true)`, or a Zod `expect(parsed.success).toBe(false)`), which no syntax-only test
separates from an ordinary boolean assertion.

**The standing cases are a debt list, the [`no-silent-fallback`](no-silent-fallback.md) shape.** MEASURED with
the gate's own matcher when it was raised: 385 cases over 195 files, of which `isErr()`→`true` is 346,
`isOk()`→`false` 35 and `.ok`→`false` 4. The survey's published 325 was the narrower two-spelling count read by
regex on an earlier base; the same instrument reads 332 on the gate's base, so what the gate adds is the third spelling plus the wrapped lines a
line-at-a-time matcher loses. `.baselines/unnamed-failure-assertion-baseline.json` names each file by
`{ path, count }`, the gate refuses one that is new or grew, and `--rebaseline` refuses to raise any entry.
**Its residue, stated rather than discovered**: the unit is a per-file count, so a file holding two refused
cases can name one failure and add another bare one and stay green. Keying on the case's own title would
trip on every unrelated rewording, which is how a ratchet stops being read.

**What building it found, which is the part worth keeping.** The gate was written as a fourth copy of the
`file-size-ratchet` debt-list shape, the way `error-shape-threshold` and `no-silent-fallback` each were. Two
gates refused it on the first full lap: `duplicate-windows` matched the new file against `noSilentFallback.ts`
as a 15-line cross-file clone, and `error-shape-threshold` put `src/devLint` at 32 distinct plain error shapes
against a floor of 30, because the copied parse invented two more. That is `error-handling.md`'s DEDUP-refactor
finding happening live — a family regenerating through ordinary, careful work — except that this time the
tree caught it before a reviewer did. The ratchet moved to `src/devLint/countRatchet.ts`, shared with
`error-shape-threshold`, and its own failures went through a typed union rather than two more plain strings,
which is the threshold gate prescribing its own fix. `no-silent-fallback` keys on `{ path, operator }` and
`file-size-ratchet` names its count field `codeLines`, so neither moved; widening the shared key to a tuple
is the follow-up row.
