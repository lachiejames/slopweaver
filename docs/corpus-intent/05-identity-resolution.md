# 5 · Identity resolution

Part of [What the owner wants from the corpus — harvested from the owner's own voice](../corpus-intent.md).

## It belongs in onboarding, not in a later step

The owner is emphatic that onboarding builds the whole identity map. **It must not be a separate step that happens
later.** Knowing who everyone is, with their identity across platforms, is part of the world model.

## The owner's stated model of how it resolves

Every display name maps to a Slack profile, which maps to an email address, which maps to one identity shared across
platforms. The owner stated this in reaction to Slack bronze still minting phantom people from display names.

The owner also believes the email lookup was solved once before: a large identity JSON file, around 2,000 lines,
built inside the earlier work console, holding each user's identity across GitHub, Slack, Linear and others with
their email address, and built by looking email addresses up through the Slack API.

## Fuzzy matching: the AI disambiguates, the verb does not

A ruling made about channel names that transfers exactly to the roster question. A deterministic mapping of channel
names to channel ids is needed, but the AI is capable enough to know which channel a loose name means. **The guessing
never goes into the verb; it is the AI's job.** Claude does the disambiguation, and if three channel names contain
the word, it asks which one was meant, and the owner answers.

## The misattributed-security-lead episode — a wrong fact is not a one-fact fix

The most-developed thing the owner has said about what the world model is _for_, and it is a rejection of
patch-by-patch correction.

Once an org world model is seen making a false claim like that, nothing it says can be fully trusted, and fixing
the one fact is the dumb fix: there are infinitely many ways to be wrong, and **patching one leaves infinity to go**.
A person given new information — such as someone not being the head of security after all — updates their whole
**mental state**, because that crumb makes them question what else they have wrong.

A smart bot does not come from hard-coding facts here and there. **The approach has to scale**, making the bot
smarter by processing the available data better. There is no shortage of data; the problem is how it is managed and
used to answer questions.

---
