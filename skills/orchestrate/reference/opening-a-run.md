# Opening a run — what `start` refuses, and the probes you owe before building

The six steps in full, including what `handover start` refuses and why, the probe shapes, and the only two
ways a session's state reaches the owner while it works. The rules are in [SKILL.md](../SKILL.md).

1. **Verify the plugin.** Whatever the doc says to check, check it. A stale copy has cost hours repeatedly.

2. **Open the run through the door**, using the doc's `slug:`:

   ```bash
   slopweaver handover start <slug> --branch <branch-you-will-work-on>
   ```

   This is not bookkeeping. It **refuses** a doc whose `doneWhen:` probes already pass with no `notDoneReason:`
   explaining the gap — the shipped-but-still-`ready` case, which otherwise costs a whole session re-planning
   finished work — and it refuses one the board blocks (including a `cancelled`/`rejected` doc; see below). It
   records the branch and the doc's content hash to `$SLOPWEAVER_HOME/runs/<slug>.jsonl`, which is what lets a
   later context rebuild this run after a compaction. **`start` uses the same composed precedence `handover
list` does**, so the two never disagree about whether a doc is startable.

   If it refuses, read the refusal — it prints every probe and what to do.

3. **If the doc declares no `doneWhen:`, add them now, before building.** `start` will have told you. Two or
   four probes naming what the repository will look like when this has landed:

   ```yaml
   doneWhen:
     - present: src/thing/newFile.ts#exportedName # a symbol that will exist
     - absent: src/old/path.ts#deletedConstant # something the fix removes
     - path: docs/new-doc.md # a file that will exist
   ```

   A doc with no probes is one nothing can ever verify, and the board says so on every print. A probe that
   cannot fail is worse than none — it manufactures confidence.

   **If the doc's `summary:` records something the OWNER asked for, one of them must be BEHAVIOURAL** — a
   `command:` that RUNS the thing the owner complained about and exits non-zero if it comes back. The three shapes
   above all assert a shape somebody built, and measured once, five owner-ask docs regressed on the
   exact complaint while every one of their probes stayed green. `handover finish`, `handover lint` and
   `handover check` refuse the `done` transition without one. If no such command can exist — the work lands
   where this checkout cannot see it, or the seam has no test lane — record `probeWaiver: "<why>"` on the doc
   instead; it is reported, never silent. The rule, the marker list and both escapes are in the
   [handover skill](../../handover/SKILL.md#the-behavioural-probe--what-donewhen-must-actually-assert).

4. **Measure the baseline yourself.** Never quote a number the doc supplies; run the command.

5. **If a run was already open**, you are resuming, not starting:

   ```bash
   slopweaver handover resume <slug>
   ```

   Run this FIRST, before reading anything else, whenever a session begins or a compaction has happened. It
   rebuilds the doc, branch, probe state, any recorded question and the single next step from the journal —
   from disk, not from memory.

6. **Reach the owner through a Queue card or a floating note, nothing else.** The owner's console ruling:
   the owner is leaning towards just getting rid of the sidebar checklist and status entirely. So a seat
   publishes no checklist and no status lane; `start` puts up only the row's `workspace:N` ref pill. A question
   only the owner can settle is a `handover ask`, which the Queue draws as a card; a step only the owner's hands
   can take is a floating
   note ([hand](../../hand/SKILL.md)); a CI or clock wait is a `handover park`.

---
