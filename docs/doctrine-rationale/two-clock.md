# The two-clock class — a fix that lived in one atlas propagated to none

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

[The whole-file-string section above](whole-file-string.md) ends with a rule: _"When you fix the second instance of anything, the
deliverable is the gate, not the fix."_ This section is the next class to prove it, and the sharpest thing
about it is that the fix had ALREADY BEEN WRITTEN — privately, in one atlas — while three siblings carried
the defect.

**The measurement.** `slopweaver atlas doctor` reported a populated `onepassword ANSWERABLE` generation (`entities readable from
the generation published <manifest updatedAt>`), while that atlas's own `events.jsonl` envelope carried an
`updatedAt` several days later. The manifest clock materially lagged the newest file it vouched for,
and every schema test passed. Vanta had shown the same class at a longer interval. Reproduce the shape on any
generation:

```bash
slopweaver atlas doctor | grep onepassword
for f in ~/.slopweaver/atlas/onepassword/*.jsonl; do echo "$(basename "$f") $(head -1 "$f" | jq -r .updatedAt)"; done
```

**The cause was a shape, not a bug.** Each atlas had a private function taking a manifest and returning it
with different per-kind statuses — `{ ...manifest, kinds: { ... } }` — which preserved the top-level
`updatedAt` by omission. Four copies stood at once: `onepassword/sync.ts`, `vanta/sync.ts`,
`cloudflare/kindFold.ts`'s `stampKindAttempt`, and `vanta/browserSurface.ts`'s `walkManifest`. The kit owned
none of them.

**Three things made it invisible, and each is the finding rather than a detail:**

- **Two of the four looked clean, by luck.** Cloudflare's base literal restamped `updatedAt: at` one call
  earlier, and Slack built its manifest whole. Neither was protected by a rule; both were one edit from
  drifting.
- **Vanta had two publishers and only one of them stamped.** `walkManifest` set the clock; the API sync
  could not. So the generation read coherent for exactly as long as a browser walk had run more recently
  than the API sync, and drifted fifteen days the moment it had not. A reader checking on the right day
  found nothing wrong.
- **The fix existed and could not spread.** `jumpcloud/store.ts` had `stampJumpcloudManifest` and a publish
  guard refusing a manifest clock behind a success it graded — and its file header described this exact
  defect, on its siblings, by name and by measurement. A correct fix in one atlas is a fix in one atlas.

**What the gate found that no audit did.** An AST audit run by hand over `src/atlas` reported three copies.
The gate, run once, reported four: `vanta/browserSurface.ts` was the one nobody had looked at, because it
was the one that appeared to be doing the right thing. That is the whole argument for the mechanism in one
line.

**The answer is derivation, not a guard.** An ad hoc fix on one platform is not the answer; the question is
how to make the mistake impossible to make again, in both directions — a generation reading older than it is,
and one reading newer. A guard leaves the caller holding a value it can still get wrong. So `publishAtlas` now DERIVES
`updatedAt` as the maximum over the kind files the generation vouches for, and no caller can supply one at
all — the same treatment `digest` and `entityCount` already had in that function, for the same stated reason:
a caller filling one in is describing a file it has not written.

**A check that could no longer fail was deleted rather than kept.** JumpCloud's clock guard became
unreachable once the clock was derived, so it is gone, and the invariant it watched is asserted directly in
`unit/atlas/kit/manifestClock.test.ts`. Keeping it would have told the next reader a guard was load-bearing
when it was not.

**The rule this leaves behind, and it is narrower than the last one.** When you find the fix for a class
already written somewhere in the tree, the finding is not the defect — it is that the fix could not
propagate. Ask where the shape is SUPPOSED to live before writing the fix a second time. The gate is
`atlas-manifest-clock` (`src/devLint/atlasManifestClock.ts`), the seam is `src/atlas/kit/manifestClock.ts`,
and the criterion is stated in both.
