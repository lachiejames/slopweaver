# The error-shape threshold

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The rule came out of a code-quality audit whose every lean became a board row; this is the verb-house-shape
one. The audit's finding: 12 directories carried five or more distinct error message shapes with no typed
union — `slack` 66 shapes across 127 calls in 34 files, `turn` 40, `briefing` 26 — and it was the one axis no
gate measured. Its lean: a domain past N distinct error message shapes must declare a typed union, enforced
mechanically so it holds without review, the same standard as any rule worth keeping only if it can be
enforced; the trade is that someone picks N and the first run converts `slack` and `turn`. The alternative —
leave it, because `error-handling.md` already permits a plain string list when nothing branches on the
failures — was declined in favour of the gate.

**What the rule already said, and what it could not do.** `error-handling.md` § When NOT to introduce a union
draws the line at "one or two simple messages that no caller ever branches on". Nothing enforced the far side
of that line. A busy verb directory grew its string list one locally-reasonable message at a time — `${flag}
is required`, `--since requires a value`, `expected one permalink, got N` — and no single addition was the
one that crossed from "a couple of displayed messages" into "a domain with forty failure kinds and no name
for any of them". That is the same shape `no-nested-ternaries`, `epoch-arithmetic` and `hand-rolled-result`
each closed: a rule in prose that every author agreed with and the tree drifted past anyway.

**The criterion, not a count.** A plain error shape is a string authored INTO an `err`/`errAsync` call — each
element of an array-literal argument, or the bare argument, that is a string literal, a template, or a `+`
chain of them — with every `${…}` hole and every non-literal operand normalised to one placeholder, a
type-only wrapper stripped first; a domain is a directory, counted by its DISTINCT shapes across non-test
files; past four (`MAX_PLAIN_SHAPES`, `src/devLint/errorShapeThreshold.ts`) the directory is refused
unless the debt list carries it at a count no smaller. Three exclusions are the sentence's own edges rather
than an allowlist: a **forwarded** message (`err(inner.error)`, `err([e.message])`) was authored elsewhere
and is counted there; a **typed-union site** is the compliant form, which is what makes this a threshold
rather than a ban — routing a directory's failures through its `<Domain>Errors` factory is exactly what
lowers its count; a **template with no literal text** is a forwarded value in template syntax. The `+` chain is in
the sentence because the first cut of this gate stopped at the literal, and the first fallback review found
Prettier splitting a long message into `"… " + "…"` — reading the chain moved 27 directories' counts.

**A string reached through a name is a shape too, followed to a fixed point.** The first cut called
`err([USAGE])` its blind spot, reasoning that following one same-file `const` would catch one hop and miss an
import, and a matcher that catches "some" indirections reads as catching all of them. The blind spot was
occupied: MEASURED, nine directories it passed stood over four once names were followed —
`src/cli/commands/drive` at 7, the rest at 5 or 6, each a usage string, a shared trailer, a named problem list
or a conditional's fallback. So the gate now reads each conditional arm and array item, a `...spread` item as
the expression it spreads, and follows a bare name
through a `const` in any enclosing block, a `for` header or the module, a named or default import (relative or
`#lib/…`) and a named re-export, across the whole scanned pool rather than one hop — charging the shape where it
ENTERS `err`, because that domain is the one whose failures it names. The answer to "some indirections" was to
follow all the ones syntax can pin and NAME the rest: `export *`, a specifier without `.js` or outside the pool,
a property read (`...parsed.error` included), a `let`, a parameter, a call's result and a `const` array mutated
after it is bound (a `push`, an index write). All nine were converted onto their own unions in the same landing,
so the debt list stayed empty. The spread came one landing later because following it was a conversion of its
own: MEASURED, reading `...(ok ? [] : ["text"])` problem lists put seven more directories past
four (`src/cli/commands/claude` at 11, `store` 10, `src/proof/yarnWhy` and `src/review` 7, `datadog` 6, `fleet`
and `vulnerabilityFix` 5). Each moved onto its union with every message authored in a factory — a list of literal
strings wrapped in an aggregate variant would have lowered the count without meeting the rule — and the debt list
stayed empty again.

**Why N is four.** The audit drew its line at five or more; the rule's prose tolerates "one or two". Four is
the largest count the prose still covers, so a directory at five has, by the rule's own words, stopped being
the exception the plain list was kept for. It is one constant, and changing it is a change to the rule made
in `error-handling.md` and the gate together.

**Why the standing directories are a debt list rather than converted in the first run.** The audit's trade
line forecast that the first run converts `slack` and `turn`. MEASURED with the gate's own matcher when it
was raised: 1,423 authored sites over 145 directories, 70 of them over four — `src/cli/commands/github` at
98 distinct shapes, `src/datadog` 74, `slack` 57, `src/atlas/vanta` 52, `src/atlas/kit` 50, `turn` 36 (the
audit measured the verb directories alone and by a different hand, so its 66 and this 57 are two matchers,
not a drift). The same situation — a new gate over thousands of standing sites — is settled the same way
everywhere ([`no-silent-fallback`](no-silent-fallback.md)): no allowlist, a debt list for standing sites. So
`.baselines/error-shape-threshold-baseline.json` names each over-threshold directory by `{ path, count }`, the
gate refuses a directory that is new or whose count grew, and `--rebaseline` refuses to raise any entry.
`turn` forwards a `readonly string[]` unchanged at 13 sites (repro: `grep -rnE '\berr\([a-zA-Z]+\.error\)'
src/cli/commands/turn`), so converting its own 41 would re-type every producer behind those forwards in the
same pull request as the gate; the ratchet holds either way, and each conversion is its
own landing that tightens the list. **Its residue, stated rather than discovered**: the unit is a count of
distinct shapes, so a directory can retire one message and mint another and stay green, and one under the
threshold can grow to it without an entry. What was bought is that a domain's plain-string surface can only
fall, and a new domain cannot grow one past four.

**The list is cut against the base it lands on, and a landing in flight moves it.** Twice while this gate was
being raised, `main` advanced under it — one landing added `src/store/backup` at 22, another raised
`src/cli/commands/store` from 18 to 25 — and each time the compare branch refused on the merge ref before
the list was re-cut. That is the gate reading the tree it will actually govern, the same lap
`file-size-ratchet` charges; the answer is a rebase and a re-cut, never an entry raised by hand.
