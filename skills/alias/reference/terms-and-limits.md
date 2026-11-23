# What Anthropic's terms actually say about several accounts per person

Read before proposing to automate anything further up the signup path than a mailbox. Both documents
are live pages, so re-read them rather than trusting this summary if a decision turns on a word.

## The finding, first

**Neither document caps how many accounts one person may hold.** The Consumer Terms of Service has no clause
on the number of accounts at all. What they do forbid is a different thing, and it is worth being exact
about which:

> "You may not share your Account login information, Anthropic API key, or Account credentials with anyone
> else. You also may not make your Account available to anyone else."
> — Consumer Terms of Service, § Account creation and access

> "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly
> permit it, to access the Services through automated or non-human means, whether through a bot, script, or
> otherwise."
> — Consumer Terms of Service, § Use of our Services

And the Usage Policy, under **Do Not Abuse our Platform**:

> "Utilize automation in account creation or to engage in spammy behavior"

> "Coordinate malicious activity across multiple accounts to avoid detection or circumvent product
> guardrails"

> "Circumvent a ban through the use of a different account, such as the creation of a new account, use of an
> existing account, or providing access to a person or entity that was previously banned"

## What follows, and what does not

**Holding several plans is not, on its face, prohibited.** The multiple-accounts clause is qualified by
_malicious activity_ and _to avoid detection or circumvent product guardrails_, and the ban clause is about
evading a ban. Neither describes buying several plans and using each one honestly.

**Automating the account creation itself IS named.** "Utilize automation in account creation" carries no
malice qualifier. That single clause is why this repository's `alias` verb stops at the mailbox: a verb that
drove the claude.ai signup form would be the thing the sentence describes, however benign the intent. The
signup, the card, the captcha and any phone verification are the owner's own hand — see
[claude-account-runbook](claude-account-runbook.md), which names each of them.

**Reading the sign-in code out of the mailbox afterwards is a different act.** That is reading mail the
owner already received, through the gmail door, on the owner's own mailbox. It is not access to Anthropic's Services
by automated means and it is not account creation.

## The control Anthropic actually enforces, measured — and where it is not enforced

At the **Max 20x** checkout for a fifth account, phone verification on the owner's
own mobile answered:

> "That phone number has been used too many times. Try a different phone number."

At the **Max 5x** checkout half an hour later, no phone verification was asked for. That plan is standing. So a 5x purchase measured as **an alias address and
a card**, with no phone step at all, and the guardrail above appeared only where one was asked for.

Read the refusal narrowly. It names the NUMBER's history, not the tier, so what is established is that a
mobile can be exhausted — not that a phone is asked for once per plan, and not that it is never asked for on
a 5x. Both are single observations on a live product that can change without notice; expect a checkout that
asks, and be unsurprised when one does not.

**So the Twilio route is a contingency, not a standing per-seat cost.** It is what to reach for if a checkout
asks and the mobile is refused. Buying a distinct Twilio AU mobile per plan works around a
control Anthropic put there deliberately, and that stays true whenever it is reached for: it is not a hidden
consequence to be discovered later, it belongs written down, and it is Ansel's call rather than a session's.
Beside it, and at company scale the better answer: **Team or Enterprise seats**, which include Claude Code
usage, are bought once against one organisation, and raise none of this — at **US$100 per premium seat per
month against US$100 for a Max 5x plan**, like for like on price.

One further gate found the same day: an AU Twilio mobile needs an approved **"Australia Mobile Individual"**
regulatory bundle — an Australian individual's name, address and ID document, reviewed by Twilio. So the
route binds a named person's identity to each number, which sits awkwardly beside the whole point of the
exercise, which was that the identities be organisation-owned rather than personal.

## What this repository therefore builds, and stops at

| Step                                   | Who                                        | Why                                                     |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Provision `<identity>-claude-N@<zone>` | `slopweaver alias provision`               | Cloudflare, not Anthropic. No terms question.           |
| The claude.ai signup form              | **The owner**                              | Usage Policy: "Utilize automation in account creation". |
| Card entry                             | **The owner**                              | Payment instrument; never automatable here.             |
| Captcha, if one appears                | **The owner**                              | It exists to establish a person is present.             |
| Phone verification, if asked           | **The owner**                              | The 5x purchase was never asked; a 20x checkout was.    |
| Read the sign-in code                  | `slopweaver gmail`                         | Reading the owner's own mail, through the door.         |
| Enrol the plan                         | `slopweaver claude signin --enroll plan-N` | Local credential wiring.                                |
