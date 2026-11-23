# How compliance work reaches the owner, and where a policy change goes

Bundled reference for the `compliance` skill. Three owner rulings on the SHAPE of ISO work once it is found.

## One item at a time, counted in failing controls

On a ten-ranked ISO page the owner asked how many of the controls still needed each item solves. The unit is what
closes a failing control, not failing tests or failing documents: the definition of when the ISO audit can move to
the next stage is 90% of controls passing.

- **One item per card, never a ranked list.** A list of ten is a wall the owner can neither act on nor share.
- **Every item says which failing control(s) it closes, as N of the M still needed for the 90% gate.** Read M live
  (`atlas vanta controls-evidence`), never from memory; tests and documents are the route, not the count.
- **Proof travels with it**: which test each control owns, evidence the test now passes, evidence the control is
  not yet marked complete, and a Vanta screenshot (`atlas vanta shot`) where one exists. A claim such as "one
  reminder clears N" shows the chain to the control and checks N is everyone who owes that document.
- **Sharing is a Queue card the owner approves, then the bot posts.** The card carries the Slack draft for the channel
  it would go to (`slack draft record`), in plain mrkdwn, short above the fold with the proof in a thread reply.
  Never a DM for the owner to forward: Slack's forward of a bot post shows "This content could not be displayed".

## Where policy text goes

- **Updating an existing policy, SLA or SOP** is reviewed as a briefing and an HTML page, never in GitHub.
  Nobody reviews these policies in GitHub; policy work uses briefings and HTML files. `policy diff` draws the change as the owner's
  review page, the team's page and the team post from one record; `page publish` gives each page a linkable URL. A card
  that opens a policy pull request, or links one as the place to review, is a defect. A teammate reading the
  team page is a witness, never a gate (next section).
- **Proposing a new engineering policy** for discussion is a Notion page beside the team's other proposals, plus
  a post in the engineering channel, drafted and parked for the owner's yes like any unasked post (rule 10).

## A policy change ships on the owner's review, then the team witnesses it

Change policies to get certified and improve security as we go, with no big process. Waiting for replies is the bottleneck in ISO work, and nobody controls
whether replies arrive or help: fix the policy, upload it, then put a page in front of the team saying the owner
pushed these changes after reviewing them, inviting disagreement, with the key changes as dot points.

So a policy change runs in this order, and **no step waits on anyone's reply but the owner's**:

1. **Fix it** — edit the policy markdown, then draw the change with `policy diff` (above).
2. **The owner reviews the diff personally**, on the owner's review page. The owner's yes is the gate; it is also the approval the upload's
   digest binds.
3. **Upload it** — `write vanta upload-policy-version`, always a DRAFT version ([the write side](the-write-side.md));
   publishing in Vanta stays the owner's own hand.
4. **Put it in front of the team** — one post in the owner's voice: the owner pushed these changes after
   reviewing them, the
   three key changes as dot points, the team page linked, and an invitation to say if they disagree. It is
   drafted with `slack draft record` and goes out on the owner's yes to its exact text (rule 10).

Someone else still reads and witnesses every change, for knowledge sharing, and a disagreement that arrives is
a new change through the same four steps. But a card, plan or board row that holds a policy on a teammate's
review, approval or reply is a defect.
