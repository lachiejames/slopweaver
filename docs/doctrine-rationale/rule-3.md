# Rule 3 · One door

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

**3 · One door.** Every Slack, GitHub and Linear **read and write** goes through the `slopweaver` verbs and the
`/slopweaver:*` commands. Not `curl`, not raw `gh` for a mutation, not an MCP tool, not a "just this once"
HTTP call. The door, the ownership check, the send reservation and the pacing all live there, and a raw call
looks identical when it works.

The `PreToolUse` hook is **not** what enforces this, and each hole it has had is itself the argument for keeping
the rule a discipline rather than trusting the fence.

**A compound prefix does not escape it (measured).** `shellSegments` splits the line quote-aware on
`&&`/`||`/`|`/`;`/newline and classifies each segment on its own tokens, so `cd x && curl …` is blocked.

The same measurement found two escapes that were real, and both are closed: a loop or branch BODY
(`for f in …; do <tool> …; done`) whose segment began with the keyword `do`, so the command behind it was
never classified; and a `sh -c '<line>'` wrapper, whose quoted payload the splitter deliberately never cuts
and nothing ever read — the single most obvious way to spell "run this anyway" was the one shape that worked.
Statement keywords are stripped before classification, and a shell wrapper's payload is fed back through the
same segment walk, bounded at three wrappers deep.

**MEASURED: "a script" was a hole, and so was the tool.** It is natural to believe every GitHub interaction in
every session is forced through the door, because the plugin loads everywhere. It does — a spawned session into
the private work repository loads Slopweaver from the marketplace install (`install-stays-current.md`), and its
transcript shows the admit hook blocking raw `curl`, `gh` and `git push` there. Yet those sessions armed a
checked-in ship-watcher script, a `while :` loop over `gh api graphql`, four times, on two pull requests, until
each died on an unchosen signal. Two escapes, both real, both closed: the classifier resolved the script's path to
a tool named after the file, matched nothing, and allowed it (the same script behind `nohup bash`, and behind
`bash -c` with an `exec`, passed the same way); and the `Monitor` tool ran the identical script under a
`PreToolUse` matcher of `Bash` alone, so no hook fired at all. So `hooks/hooks.json` matches `Bash|Monitor`, and a
segment that runs a script has the script's own text opened one level deep and judged with a rule stricter than a
direct command's — ANY `gh` inside it is a reach, read or write, because a script is exactly where a one-shot read
becomes a loop nobody reviewed (`src/admit/scriptWrapper.ts`, reproduction in its header).

None of that makes it a fence. It still cannot follow a variable, a `$(…)` substitution, an alias, a script a
script calls, or a relative script path after a `cd` in the same command; it is a workflow safety net, not a
security boundary. **Treat a block as confirmation you were about
to do something wrong, and the absence of one as meaning nothing at all.** Branch pushes have a real
path — `slopweaver github push` — so a visible Codex or Claude Code driver never needs the raw escape to land
its own work. A pull request that builds on another open one has a real path too — `slopweaver github stack
push`/`sync` ride GitHub's own native Stacked-PRs feature (GitHub's computed stack is the membership/order
authority, never a Slopweaver-owned ledger), so raising or rebasing a stacked PR by hand through `gh` or a
manual base/head branch chain is never the way in.

Separately from the door above, three main-checkout checks (`main-checkout-dirty-guard`,
`main-checkout-edit-guard`, `main-checkout-guard` — folded into `hooks/pretooluse.ts`, listed
in [hooks.md](../hooks.md)) protect the one pinned main checkout from a dirty write, a stray edit, or a branch
switch out from under every other worktree and session reading it — a different concern from the write-door
rule this section is about; read the checks themselves for what each one actually checks.

## The browser half, off a post that went out under the owner's own name

A dispatched ask worker was gathering the screenshot evidence that had just become part of a good answer. It
opened the Slack web client in the owner's own signed-in Chrome, aimed a click at the top-bar search box at
`[760, 21]`, missed, typed its search string into the CHANNEL COMPOSER and pressed Return. The message posted
top-level under the owner's identity — no door, no send reservation, no form schema, no preview, no
consecutive-run check. It was deleted afterwards; every step in the worker's transcript is logged, intentional and
correct-looking.

**Nothing in canon forbade it, which is why it is a class.** Rule 3 named `curl`, raw `gh` and MCP tools, and
the reason the worker was in a browser at all is that the door had no screenshot verb. A rule that blocks the
only available path to something the work requires gets routed around by the next session too.

The property that generalises: **a browser signed in as the owner has no read-only mode.** `screenshot` and
`type` are the SAME tool (`computer`), so the read intent and the write capability are inseparable at the
tool boundary. That is why the prohibition covers READS, and why it is not "don't post from the browser".

**A `slopweaver` verb that drives a browser IS the door, and that sentence is checkable.** Every dedicated browser
profile is retired ([browser-route](../browser-route.md);
[what it retired](../browser-route/screenshot-reading-and-retirement.md#what-was-retired-and-what-it-cost)), and so
is Claude in Chrome, so such a verb drives the owner's own Chrome through Playwright
([retirement](../browser-route/retirement-and-aim.md)). Its reads pass, and **no write-capable action runs
blind**: one runs only when it cites a look at the page it is still on (`actionNeedsObservation`,
`src/browser/actionExecutor.ts`). Read the prohibition as being about the agent's hands, never about the
pixels.

**Two categories.** A blanket refusal stands for platforms the owner has no intent to write to, and
`read-before-write` governs the ones the bot genuinely writes to, on the grounds that a capable agent using good
judgement needs good data to judge — so the guardrail is having looked at the page rather than never reaching it.
A write there needs a current look at the page it is still on.

**Every doored provider is `read-before-write`**: Vanta, Slack, GitHub, Linear and Notion. That whole decision is
four words in the write-policy register plus the canon that names them — which is the test the two-category shape
is built to pass. A provider whose policy the owner has not stated keeps the stricter behaviour, because
change-nothing is the only reading that does not guess. `refuse-every-write` is kept even with no doored provider
in it: the platforms the owner left there are not doored, so this guard never sees them, and the arm is what makes
the first of them to gain a door one word rather than a redesign.

**And the DEFAULT is ruled too.** `refuse-every-write` is the answer for every host the register does not name,
after the measurement that a session had already acted inside Google Admin with nothing refusing it. What makes it
doctrine rather than a value is the second half: a platform may not be added with NO policy at all, so the atlas
descriptor's `writePolicy` is required by the schema and by the type. The reason is the general one: something
that silently falls back or proceeds causes far more pain later, because those mistakes compound and are hard to
pin down. That is why the list is `WRITE_POLICY_REGISTER` rather than `DOORED_PROVIDERS`: it is a permission list,
not a coverage list, and its absences are decisions.

**What the move costs, since the honest version is not "nothing".** The incident's sequence — screenshot a Slack
page, then miss the click on it — is exactly what `read-before-write` allows, because the read it asks for
is the one that session had already taken. What still refuses that session is the door: a hand-driven
Claude in Chrome call is refused outright. So the category is not the thing that closes the incident and the
door is, which is rule 3's own sentence rather than a new position. The owner has priced this: a tripwire fence
would be too heavy-handed, so the risk is accepted and the guard does not block.

**What replaces a provider screenshot, measured rather than asserted.** Re-running the visual-evidence pipeline over
one whole day's 15 answers: **28 visual-evidence links, of which 23 are doorless — Datadog logs, metrics, monitors,
dashboards — and 5 are on a doored provider**, all GitHub (4 Actions runs, 1 pull-request diff). Zero Slack,
Linear or Notion. So the prohibition costs 18% of the visual-evidence surface and nothing at all on the surfaces
where the pictures actually live, and for the class it does cost, the door already returns the same evidence as
text: `github checks` for a run, `github read` for a pull request — evidence that IS code or a status, which the
visual-evidence guidance already says does not want an image. Reproduce with the pipeline in
`src/live/turn/visualEvidenceGuidance.ts`'s header, splitting its `vis` links on host.

**The tripwire, and its blind spots stated rather than discovered.** A `mcp__claude-in-chrome__.*`
`PreToolUse` matcher refuses every such call outright, Claude in Chrome being retired
(`src/admit/chromeRetirement.ts`), with nothing that waives it. The `Bash` guard cannot see this on its own:
`hookPayload.ts` returns allow for every non-`Bash` tool ("we only police Bash"), so the browser surface needs its
own matcher. It was verified against the real host before building — a `PreToolUse` matcher DOES fire on an
`mcp__` tool name and its refusal reaches the model. Two things are deliberate:

- **It fails CLOSED even on a broken toolchain, alone among the `PreToolUse` guards here.** Theirs match
  `Bash`, where failing closed on a persistent failure would wedge every command (a spent budget refuses
  those too, since a retry clears it); this one's matcher is browser-only, so the whole cost is that browser calls stop.
- **Every refusal is journalled.** MEASURED: the door ledger held 191,753 rows and not one was a
  browser call, and a write-capable call on record against a Google Admin tab could not be accounted for at
  all. Each refusal appends one `chrome-retired` line to `ledgers/browser-verdicts.jsonl` naming the session and
  the tool (`slopweaver browser verdicts`).
