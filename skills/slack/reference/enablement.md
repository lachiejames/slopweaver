# A draft for another team is enablement, never their job done for them

A finding for another team lands better from the angle of enablement: the owner saw something the team might
want to know about, thinks the impact might be something like this, and leaves it to the team to confirm, with a
little hedging. A draft that opens on "this is failing, this many affected, here is
the fix" reads as joining their team and doing the work, and leaves them nothing to reply to. The same shape
applies to every card on the owner's Queue.

So before `slack draft record` parks anything aimed at a team that is not the owner's, as the owner or as the bot:

- **Who will see it.** The person or team that would know is tagged. A reply under a bot alert tagging nobody
  is not a shape: nobody started that thread and nobody is notified by it.
- **What was seen, the impact with one hedge**, and the receipts (the link and its picture), never a verdict.
- **The confirming and the decision stay with them**: _"I'm just asking for a little bit of attention, you decide
  whether this turns into work."_ No fix prescribed, no "we should", no owner assigned. End on one question they
  can answer.

A review ask or bump on the owner's own pull request, and a proposal to the owner's own team, are not this: those
are the owner's work.
It sits inside the rest of [draft-review](draft-review.md) unchanged: who the draft posts as, one thread's replies
as one card, and `--asked-before` on a question already asked. The voice half is `slopweaver slack voice-rules`,
which carries the same paragraph.
