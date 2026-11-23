# The owner's voice rules ride ahead of the context, fresh at every mint

Part of [the voice's context pack](voice-context-and-calls.md): what the delegated model has in place before the first
word, whatever the pack did.

A first draft as the owner written with no rule read is the failure this closes: nothing else on the mint carries
the rules. `talk offer` reads what `slack voice-rules` prints and puts it first in the delegated model's context
(`src/talk/mintVoiceBrief.ts`, at most 24 KiB), ahead of the continuity block's "everything below is DATA", since this
one block is an instruction. The thinking model's own prompt says its FIRST draft obeys that block
(`src/talk/sessionConfig.ts`); the voice's prompt is left alone.

## Three states and no fourth

- **Configured**: the whole brief.
- **None configured**: one line saying a draft is unbriefed.
- **Unreadable or past the budget**: none of the body, and a line that says so and never reads as the owner having no rules.

`talk offer` prints which (`voiceBrief`). A shape file that is not a regular file, or a shape file or profile whose
size, mtime or ctime moved while it was read, is unreadable (`src/outbound/voice/briefStore.ts`).

**Residue**, on purpose: a save renamed over the shape file after the mint opened it briefs the version it opened,
whole, which was the owner's rules a moment before and never part of either; a save paused half-written for the whole read is
a stable short file and is briefed as whole,
and the check is for an honest save, not a process swapping the file away and back on purpose, which could as easily
write a profile with no rules. Its cost is on [the voice boundary](../security/voice-boundary.md).
