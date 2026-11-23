# The last step: alignment

Bundled reference for the `onboard` skill's step 13. Alignment is the LAST step of onboarding, after the sync and the
AI passes, and it opens on an indicator that the fleet knows some things roughly and is not yet aligned with them.

## What to say, and where to send them

1. Say what the steps above produced is **rough knowledge**: what the fleet read from their sources, not yet how it
   lines up with how they work. Do not claim it is aligned.
2. Send them to the console's `/alignment` page. It opens on **Start here**, the first question it asks, then the
   indicator, `Rough knowledge · your voice is not yet measured from your sent Slack messages`. Its questions are the
   general rulings they keep having to give and the acts the fleet took for them
   ([what leads](../../../docs/console/alignment.md#what-leads-the-page)); on a fresh install there may be none yet.
3. **Ask nothing about their voice.** Asking questions is the wrong
   way to learn it. How the fleet writes as them is learnt from the Slack messages they sent, so it is no question and no Setup
   step; Setup's steps are local history and mined workstreams.

## Where their voice shows

The page's **Your voice** section reads `slopweaver profile voice --json` (message lengths measured from their sent
Slack) and `slopweaver slack voice-rules --json` (the bans they set, folded below it). With Slack not connected it
offers the Slack connect button and says the voice is learnt from their Slack messages. Connected but unmeasured, it
says so plainly: the first Slack refresh measures those lengths from the messages they typed
(`slopweaver profile voice measure` by hand), and until then the section stays empty. Never invent a default in its
place.

## Where an answer lands

Each answer to a ruling or an act is relayed to the supervisor under its `align:` or `act:` key, which records it as a
ruling or a knowledge row, never a task. The page and the routing in full:
[docs/console/alignment.md](../../../docs/console/alignment.md).
