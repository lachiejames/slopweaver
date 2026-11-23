# 1 · What a tag should do, end to end

Part of [What the owner wants from the corpus — harvested from the owner's own voice](../corpus-intent.md).

## The picture, stated most completely

The owner tags the bot in Slack with a question such as what a colleague's top five pain points are. The bot
first searches broadly, perhaps splitting the question into several keyword searches and seeing what each pulls back.
It may then lay out a dynamic workflow that investigates a few different lines, stress-tests assumptions and
adversarially verifies everything before it posts the final response — much like the bot's Datadog investigations,
except those have no org world model step at the start.

This is not new. The owner has described the same shape four times.

## The workflow is chosen per question, before anything is retrieved

Rather than a fixed pipeline running from stage A to B to C and then an output, the bot takes the question and,
**before it does any research or touches the corpus or the indexes**, first works out the best way to solve that
problem.

Deciding the workflow up front has a second benefit the owner names: different phases can then go to different
sub-agents.

For the bot to be good it has to plan a dynamic workflow for itself and execute it, because **different tasks call
for different amounts of effort and research, token spend and model capability**.

**Not every question deserves the big pipeline.** The owner is explicit that the tier is a judgment. Asking the bot to
raise a ticket from a thread needs some intelligence but not the whole pipeline; other questions want a really big
one. Which lanes are worth their cost depends on the question, and that is why the workflow is dynamic.

## Fan-out is how unknown unknowns get controlled

This is the load-bearing reason for the fan-out, and it is a recall argument, not a thoroughness one. The owner wants
the pipeline structured to minimise unknown unknowns despite working over a large data set — possibly by fanning
out several tasks, one keyword-first then semantic, another meaning-first then keyword, a third doing something else
again, then bringing it all together into one response.

Note the shape of that: **several differently-ordered retrieval strategies run in parallel and are merged**,
rather than one pipeline with a fixed stage order. The owner offers it as a hypothesis, not a ruling, but it is the
only mechanism the owner has ever named for the unknown-unknown problem in retrieval.

## The self-check must come from a different agent

Stated four separate times, and it is the most consistent single opinion in the whole harvest.

- Anyone reviewing their own work is biased towards saying it looks good. **It is hard to tell when you are wrong,
  and easy to tell when someone else is.**
- An AI monitoring another AI works best when the judge is a **different** model, because of how reward works.
- Checking the proof belongs to a separate agent, because grading your own work is bad and cannot be got around —
  which is why the Codex orchestration docs exist.
- Admitting it does not know is part of the same requirement: the self-checker is a different agent.

## The model tiering the owner actually asked for

Much of the work could run on Sonnet rather than Opus: Opus as the supervisor running the loop, spinning up Sonnet
sub-agents.

The supervisor model is Fable, which the owner finds good at deciding how to answer a given task. The principle is a
supervisor that routes, with expensive work pushed out of it.

## Why sessions — it is a context argument, not a parallelism one

The first form of the argument was about sub-agents. The supervisor has to stay context-efficient because it may be
fielding many requests; with two big investigations running at once it got confused and **dropped one of them
halfway through**. Delegating most tasks to sub-agents lets it get much further before it stops or goes the wrong
way, because it is reviewing the work rather than doing it, and reviewing takes far less effort.

That then became the cmux/one-session-per-workstream architecture: many Claude Code sessions using sub-agents
sparingly, rather than a few sessions with several sub-agents each. The owner then put the context argument at the
session level, because a session spawns programmatically with no friction: sub-agents cannot spawn more sub-agents,
but sessions can, and every session starts with zero context.

## The Datadog investigation is the explicit template

The owner names it as the model to copy, and says why it works. A deep Datadog investigation can run for an hour or
two, and **it does not stop until it has a root cause with the minimal chance of being wrong or pushed back on** —
something unequivocally true.

It is good at these investigations for two reasons: it has access to a great deal of data, and it was moulded over
time, corrected every time it did something dumb, until it got steadily smarter. The owner wants that applied more
generally.

The three ingredients the owner identifies:

1. being aware of gotchas and traps so you can avoid falling into them;
2. being aware of what telemetry even exists in the first place;
3. a self-check, almost an agent harness, that will not let the investigation be called done until it meets a
   certain threshold.

**None of the three is retrieval.** Two of them are the atlas, and one is a refusal-to-stop gate.

---
