# No silent fallback

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The nullish coalescing operator, and the operators like it, enable a specific bug: they let a value that should
exist be silently replaced, and they say nothing explicit about what the code is meant to do when it is absent. A
lint rule banning them is the fix, because the example is concrete rather than hypothetical.

**The line that made the case was `src/store/ingest.ts`: `displayName: author.handle ?? author.nativeId`.** That
line should not exist at all. Both sides are `string`, so nothing in the type system had anything to say while a
person's display name silently became a raw platform id — which is how many people ended up duplicated into separate person rows.
The operator did not cause the bug; it made writing it a keystroke shorter than writing down that a substitution
was happening.

**It is easy to believe it is already banned, because a narrower rule is.** `house-rules` refuses a coalesce to an
empty string, and to an empty template — `no-empty-string-coalesce` and `no-empty-template-coalesce`. Nothing
refused the operator itself, in this repo or any canon file, until this gate.

**The criterion, not a count.** A binary expression whose operator is `??`, `??=` or `||=`, or whose operator
is `||` and whose right operand — parentheses stripped — is a value LITERAL (string, template, numeric,
bigint, array or object). State that sentence whenever this class is quoted; a number is only ever the
matcher's output on one commit.

**Why `||` is not banned outright.** MEASURED by the gate's own matcher over the tree it landed on: `??` 4,379 sites
over 1,502 files, `??=` 15 over 9, `||=` 0, `||-literal` 49 over 38 — against 4,503 `||` tokens over the same
trees. The RATIO is what argues here, not a live count. About 99 in 100 of those `||` have a comparison, a `!` or a
predicate call on the right: `a === undefined || b === undefined` is a boolean connective, and refusing it would
make the gate cry wolf on ordinary conditions until nobody read it. A `||` falling back to a literal is
unambiguously the same class, and worse than `??`, because it swallows a legitimate `0` and an intentional empty
string too. **The stated blind spot**: a `||` falling back to an identifier or a property access
(`name || fallbackName`) is invisible to a syntax-only test, because nothing separates it from
`word === undefined || word.dynamic`. Closing that half needs resolved types and a second whole-repo
`ts.Program`, whose cost `src/devLint/namedObjectParams.ts` records.

**Why `?.` is out of scope.** It propagates the absence rather than substituting a value — the reader still
receives `undefined` and still has to handle it — and `.claude/rules/testing.md` explicitly permits it inside
a predicate. A different class, and folding it in would blunt this one.

**Why a count ratchet rather than a hand-kept row per site.** The rule is no allowlist, and a debt list for
standing sites; `whole-file-json`'s one row per site, each owing a named fix, works at thirty entries and not at
four thousand. So the debt list is the `file-size-ratchet` shape: `.baselines/no-silent-fallback-baseline.json` names every standing
`{ path, operator, count }`, the gate refuses a pair that is new or whose count grew, and `--rebaseline` refuses
to raise any existing entry. A list that cannot be widened by hand is not an allowlist — nothing an author writes
can excuse a new site, and the tree's total can only fall. **Its residue, stated rather than discovered**: the unit
is a count, so a file holding two sites can delete one and add another and stay green. Keying on each expression's
own text would trip on every unrelated rename, which is how a ratchet stops being read.

**Why the two narrower `house-rules` rules stay.** They are strict subsets, so an empty-string coalesce
reports twice. That is deliberate: they refuse OUTRIGHT, with a better-targeted message, in a file whose debt
entry would still permit another site. Deleting them to avoid a double report would weaken the tree.

**What the gate does not fix.** The identity resolution behind the example — display names from each platform's
own member directory, email as the key — is its own registered ask. This is the gate.

**The second gate pointing the other way, and the one spelling that satisfies both.** oxlint runs with
`--deny-warnings`, so its `typescript/prefer-nullish-coalescing` — declared `warn` in `.oxlintrc.jsonc`, which
is why reading the config alone says it is advisory — fails CI on the two obvious ways to remove a `??`. It
fires on the ternary (`x === undefined ? FALLBACK : x`) and on the REASSIGNMENT form of the `if`
(`let x = …; if (x === undefined) { x = FALLBACK; }`). The rule file says "an `if` naming the absent case",
and only one of that phrase's two readings passes. **What passes both is a statement that RETURNS**: a
destructured parameter default, or an `if` with an early return inside a named function when the value is
reached more than once — `resolveHome` (`src/cli/optionParsers.ts`) is the shape to copy, and its JSDoc says
so at the definition where somebody deleting the `if` will read it.

Written here because four separate runs have each paid for this collision and none of them could find the
previous one. The knowledge register held three rows saying the same thing in different words — and
`knowledge list --repeats` counts by id, so three wordings of one lesson register as three lessons learned once
rather than one learned three times. A fourth run paid for it again: the reassignment `if` was written precisely
BECAUSE the rule file sanctions "an `if`", and oxlint refused it at `run.ts:171`. That is the argument for the
sentence living in canon rather than in a fifth row.

## Renaming the operator is not paying it

Replacing `?? null` with `absentAsNull({ value: parsed.value.values["root"] })`, or `?? defaultHome` with
`absentAs({ value: values["home"], whenAbsent: defaultHome })`, answers nothing: why would the value be absent at
all, and does absence mean something has gone wrong? The ratchet's purpose is not to eliminate the operator on
style; it is to fail hard and early whenever something expected to be defined is not, because a fallback lets a
bug run silently. Failing loudly and early is always desirable when agents build the codebase autonomously, and a
workaround that satisfies the rule's letter without its intent is the opposite of that.

**What the batches actually did.** MEASURED: on the parent of the change that created `src/lib/absent.ts`, the debt
list stood at 1,344 entries and 3,849 sites; after the batches it stood at 493 and 1,537. Most of the 2,312 sites
that left were renamed, not paid: the helper clause counts 1,759 calls to a pass-through fallback helper on that
base, in 725 files — 1,652 to the four in `absent.ts` (after six were moved there) and 107 to helpers of the same
shape under 22 other names across the tree, `presentOr` and six generic `orNull`s among them. The oldest,
`src/store/fleet/boardRow.ts`'s `orNull`, predates `absent.ts` by eleven days. So the list rose by exactly those
1,759 sites in 725 new `fallback-helper` pairs, and no existing entry grew: it had been under-reporting its own
debt. Repro, the list totals at a commit:

```bash
git show <sha>:.baselines/no-silent-fallback-baseline.json | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const s=JSON.parse(t).sites;console.log(s.length,s.reduce((a,x)=>a+x.count,0))})'
```

The helper half is the same sum over the entries whose `operator` is `fallback-helper`.

**Why the clause is structural.** A gate that knew `src/lib/absent.ts` by name would leave every copy above
open, and the next renamed one too. So `src/devLint/fallbackHelperShape.ts` recognises the SHAPE — a two-statement
body, an `if` with no `else` testing one identifier against `null`/`undefined` and only returning, then
`return v`, in a function that is generic and substitutes a fixed value (`null`, `undefined`, `void 0`, a
literal — a negated number and a bigint included — an empty list or record) or that returns one of its own
parameters, or a call to one; a wrapper that changes only a type (`as`, `satisfies`, `<T>`, `!`) is read
through, and a generator is never one — and counts every call to
one: same file, a named or aliased import, or a namespace member. `resolveHome` (its substitute is a call) and
a domain function returning a fresh literal fall outside by construction; no name is listed anywhere.

**The type fence, and why it is the forward spelling.** `unsetFieldAsNull({ record, key })` reads a field its
record's own type declares optional or nullable, and a REQUIRED key does not compile — the error names the
refusal. A value that must exist therefore cannot hide behind the operator, the old helpers, a renamed copy
or the new helper: it is read directly, refused with a typed error at the read, or, for an invariant, an
honest `x!`. The four old helpers stay until the standing calls are paid down domain by domain; the clause
stays after, because it is what stops the next copy.

**Its blind spots, stated rather than discovered:**

1. a helper whose body is not the two-statement shape — a `const` first, or the test flipped
   (`if (v !== undefined) return v; return d;`), as `namedSeat` in `src/cli/commands/cmux/stop.ts` is;
2. a re-export chain: a barrel re-exporting a helper hides it from an importer of the barrel;
3. a non-generic helper that substitutes a literal — the `orNull` on `string` in
   `src/cli/commands/vanta/groupPeopleCore.ts` and `src/store/fleet/codexPass.ts` are two;
4. a call that is not a plain call to a named or namespace import: a default import, a method, a `const`
   alias, or the helper passed by reference (`.map(orNull)`); and of the `export default` spellings only
   `export default function name` is registered, so `export default orZ;`, an anonymous or arrow default,
   and a `var` hoisted out of a nested block or loop header are not exported helpers;
5. names, not bindings: a call is matched by the name it is written with, so a local non-helper that shadows a
   helper of the same name — a nested function, a parameter shadowing a namespace import, an imported one or a
   top-level one — is counted;
6. an index-signature record read with a `string`-typed key passes the fence (a literal key is refused);
7. loosening a declared type so a required field passes the fence — the move behind many of the required
   values found hiding behind the helpers, which only review of the type diff can catch;
8. syntax only, never behaviour: what a caller-supplied factory does is unseen, so a factory that THROWS on
   absence still counts its helper, and a `let` helper later reassigned is judged by its first value.
