# The fleet fills its own capacity

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

This one governs the supervisor skill's sweep contract rather than one of the numbered rules, and it is here
because it is a ruling of the owner's whose reasons get re-argued, which is what this file is for. The rule
itself is [`skills/supervisor/SKILL.md` § 7a](../../skills/supervisor/SKILL.md#7a-fill-to-measured-capacity--the-last-step-of-every-tick)
and its measurements are in
[`skills/supervisor/reference/fleet-capacity.md`](../../skills/supervisor/reference/fleet-capacity.md).

**The defect it answers: a quiet machine with a ready queue.** The fleet once sat at 8 workspaces on load 3
while the spawn queue held 8+ ready docs, and moved through perhaps five of some 50 pull requests in a day it
could have moved through about 30. Weekly plan limits, not spend, are the ceiling the owner is actually paying
against, so an idle machine buys nothing back.

**And the refinement, which is the half that gets misread.** The fix is NOT "max out capacity 24/7 no matter
what". It is a judgement heuristic with a priority order: a live tag on the bot outranks everything, because a
person is waiting on it; in work hours, live and team-facing work outranks backlog docs — a daytime pause on
spawning Slopweaver work while live work is flowing is the right call, not a defect; and when it is quiet, evenings
and weekends and no live tags, the fleet fills from the backlog. A flat fill loop would spend the machine's
headroom on backlog PRs at exactly the moment the bot needs it to answer someone.

So the defect the rule fixes is narrow and named: **quiet fleet, ready queue, nobody spawning.** The measured
shape of the day it was found says the same thing — daytime slopweaver merges fell from 20 to 8, but
acme-admin took 10 fleet-authored merges in the same window against 0 the two days before. The fleet was
redirected, not idle. What was missing was the tick that notices the quiet case and acts, and the narration
that makes a deliberate pause distinguishable from an oversight — which is why "say WHY the fleet is under
cap" is part of the rule and not a nicety. An unexplained under-cap tick and a forgotten one read identically.

**A workspace count read off load average is folk wisdom.** Load does not count sessions: 14 live sessions
drew 16.3% of ONE core between them, while two `yarn validate` runs drew 89% and 80% each. Memory bounds the
session count; load bounds concurrent gate runs. So the cap is a READ, never a constant: the fill target is
the N working seats `fleet ceiling` measures the plans carry, and `machine capacity`'s hold refuses a spawn
whatever N says ([fleet capacity](../../skills/supervisor/reference/fleet-capacity.md)).
