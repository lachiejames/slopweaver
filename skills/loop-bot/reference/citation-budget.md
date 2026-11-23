# The citation budget is the answer's OWN item count, floored at twelve

Bundled reference for the `loop-bot` skill, linked from [links-citations-and-shots.md](links-citations-and-shots.md).

Rule 2 is per-ITEM, so a ranked answer over sixteen rows OWES sixteen citations. A flat `CITATIONS_MAX` (12)
on `answerArmSchema.citations` would put the two rules in direct conflict on exactly the answer class that most
needs grounding. MEASURED: a real day's open critical alerts ran past the cap, and the next day's further still.

So the budget is `max(CITATIONS_MAX, this answer's own item count)` — one item is one paragraph, one bullet,
one TABLE ROW or one index line, counted by the same walk rule 2 uses, so the budget and the obligation can
never disagree about what an item is. **One more cited row buys one more citation, and nothing else does.**
The floor holds the density argument for a SHORT answer: twelve footnotes on one paragraph is a wall, and that
answer still gets twelve. A degenerate body cannot game it — a citation no chip points at is refused as an
orphan.

**`citationBudgetCollision` fires in the DENSE case only.** Because the budget counts items rather than
mentions, thirteen controls spread over thirteen rows composes fine, while thirteen named inside one paragraph
is one item earning only the floor — so the collision line, and the journalled `hatch open uncited-controls`
way through it, is what a composer meets there. Give each control its own row before reaching for the hatch.

`slack post --as bot` has no citation cap at all; `updateArtifactSchema` puts no maximum on the field.
