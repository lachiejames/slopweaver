---
paths:
  - "src/devLint/**"
---

# Working in `src/devLint/`

The repository's static-analysis bar: every bespoke gate `yarn lint` runs, the runner behind it, the refusal
copy each gate ends in, and the debt lists the ratchets hold. Scoped to this tree; the per-linter reference is
[toolchain](../../docs/toolchain.md), lanes and rebaselining are
[rebaseline and lanes](../../docs/toolchain/rebaseline-and-lanes.md), and editing near a pattern gate is
[working beside a gate](../../docs/toolchain/working-beside-a-gate.md).

**It states the norm and what new code does, not an inventory.** A file that predates a rule, and each gate's
blind spot, is named in that module's own header, which wins where the two disagree; a deviation you meet is
debt to record, never a licence to copy it.

## A gate is three things, and the third is the one that gets forgotten

A bespoke gate is the logic module, a tiny `<gate>.entry.ts` that runs it, and one row in `gateGroups.ts`
(the registry; `devLint.ts` is the runner and `lintChecks` concatenates the registry's two exports). Miss the
row and the gate never runs, and before `gate-registration` existed every suite stayed green — so it proves every
`*.entry.ts` is in the plan, every planned bespoke gate carries a refusal declaration, and every entry is
`await runGateEntry({ run })` and nothing else (`gateEntry.ts`): only that wrapper exits, so every gate closes
its TypeScript clients first. Run order is pinned by the list in
`src/__tests__/unit/devLint/devLint/lintChecks.test.ts`, so a new gate adds a row there too.

It proves wiring and nothing about correctness. A gate's own unit test lives at
`src/__tests__/unit/devLint/<module>.test.ts`, drives the pure core on inline fixtures, and — when it reads
the real tree — opens with a non-empty assertion, because a filter over an empty input passes
([testing](testing.md)).

## A gate refuses in four lines, and declares them first

Every bespoke gate's refusal is a `LintGateDeclaration` (`refusal/types.ts`: the gate, what caught it, a
non-empty list of legitimate exceptions, the correction) rendered by `lintGateRefusal`. The rows live in the
`refusal/*Declarations.ts` category files composed by `refusal/declarations.ts`; `refusal/registry.ts` is the
lookup. Line three refuses a RUN-TIME override only — a gate with a reviewed SOURCE marker names it in its
correction — and `gateOutcome` decides `clean`, `incomplete` or `refused`: an input the gate never SAW is a
fact, not four lines claiming a rule caught it. A body that is a fact rather than a refusal carries
`devlint: not-a-refusal -- <why>`. The full shape, and why a lint gate has no hatch, is
[error handling](error-handling.md) § "A POLICY refusal is not a domain error".

A new gate has **no exemption marker by default**. Most here have none, deliberately; a marker is a
silent allowlist with nicer prose, and the legitimate shapes belong outside the criterion instead.

## A debt list is a ratchet, and it is judged against main

A ratchet is a committed baseline under `.baselines/` naming today's offenders, a gate that refuses an entry
that is new or grew, and a `--rebaseline` that refuses an existing entry's growth while it may ADD a new one
(`countRatchetCore.ts` says why); `file-size-ratchet` lets no file raise its own ceiling, and exempts a
hand-maintained file only on a signed row in `.baselines/file-size-tradeoffs.json` (`fileSizeTradeoffs.ts` says
why). Some gates refuse a row that **stopped firing**, so their list cannot carry dead entries
(`whole-file-json`, `file-size-ratchet`); `countRatchet.ts` does not, and reads an absent former offender as
clean. Build a new one on `countRatchet.ts` and `decodeDebtList.ts` rather than a copy: the fourth hand-rolled copy tripped `duplicate-windows` and `error-shape-threshold` on its
first lap. `countRatchet.ts`'s header names the two that keep their own (`no-silent-fallback`,
`file-size-ratchet`), because their shapes do not fit its entry.

Every ratcheted baseline file is a row in `baselineRegistry.ts` (two are out BY NAME, in its
`UNRATCHETED_BASELINES`, each for a stated reason), which asks what a change LOOSENED against MAIN's copy
— the owner's rule is that whoever implements a pull request never decides to bump its ratchet. A rise is a separate, witnessed act (`baselineBump.ts`), declared as a bump record in the state
home (or a manifest the change commits under `.baselines/bumps/`) and checked by the landing verbs; a file under `.baselines/` that no registry row or
`UNRATCHETED_BASELINES` entry accounts for is refused at run time. After any rebaseline, revert every entry your branch did not move.

## One whole-repo type pass, and its budget is not yours

Almost every gate reads source one file at a time, syntax only. Exactly one, `named-object-params`, builds a
whole-repo `ts.Program`, and that cost is a floor, not a leak. **Never build a second Program**: a rule that
needs resolved types rides `namedObjectParams.ts`'s existing pass. **`HEAP_BUDGET_MIB`
(`namedObjectParamsHeap.ts`) is never raised by a session** (an owner ruling): a gate past it means the
repository grew, not that a diff broke a rule — measure with the command its refusal prints, cut what the gate
holds, and if nothing more can be cut, Queue-card the measurement to the owner.

## A lane is a filter on CI's reach, never a second list

`offRepoState: true` puts a gate in the local `pre-push` lane, and the criterion is never cost: **a gate is
local if, and only if, CI cannot see its subject.** Everything else is CI's whatever it costs, and
`ci-offload-contract` proves CI still runs the full lane. `--only <gate>[,<gate>...]` filters the same
registry and REFUSES an unknown name, an empty value or a selection the lane runs none of, and a narrow run
says it is not the whole bar. Re-check one gate with `yarn lint --only <gate>`; before handback a seat runs
`slopweaver dev lint --lane seat` and no other lane (`AGENTS.md` § Toolchain). That lane is a projection over the
same registry (`seatLint.ts`): it resolves its own merge-base and refuses past a fifteen-minute-old fetch, narrows
oxlint to the changed files and runs it last and alone, withholding it (`INCOMPLETE`, exit 4) while a lap holds
the machine, and NAMES every whole-project gate it leaves out.

## A gate that names an escape hatch must have its row

`escape-hatch` refuses any `ALLOW`/`OVERRIDE` name it can resolve, or door override token, with no row in
`src/hatch/*Hatches.ts`, and a door finding rendered as text outside the one renderer. A name assembled from
run-time values is its stated blind spot (`escapeHatch.ts`). `hatch-release` refuses
a hatch read written as a parameter default, because a caller's argument silently skips it. Both are in
[error handling](error-handling.md); read the verb that renders a refusal before proposing a new hatch.
