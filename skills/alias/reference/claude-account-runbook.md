# Standing up a new assistant plan, end to end

The whole walk for one seat. The steps that are the owner's own hand are marked **THE OWNER'S** — the signup and the
card always, phone verification whenever a checkout asks for it, plus any captcha inside the signup; the rest
are verbs. Works the same for `claude` and for `codex` — the provider is a flag, not a fork.

Read [terms-and-limits](terms-and-limits.md) first if you are tempted to automate a step marked **THE OWNER'S**. Each one
is the owner's for a stated reason, not for want of a verb.

## Before the first seat, once per zone

See [cloudflare-setup](cloudflare-setup.md). Email Routing on, destination mailbox verified, token scoped.
Do it once; every later seat is then one command.

## The walk

### 1 · Pick the owner and the seat's label

The identity is whose plan it is, `ada-owner`, and it leads the address. The label is the
seat: `one`, `two`, `five`. Both are lower-case, digits and inner hyphens, and neither may carry a provider
name as its own segment — the verb refuses `--identity claude-smith` and `--label claude-five` alike, because
the provider is what separates the two halves when the address is read back.

### 2 · Provision the mailbox

```bash
slopweaver alias list --domain acme.com                     # what is already there
slopweaver alias provision --domain acme.com \
  --identity ada-owner --provider claude --label five --destination ops@acme.com
```

Re-running this is safe: an address already routed is reported, never duplicated.

Send yourself a test message at `ada-owner-claude-five@acme.com` and confirm it lands in the destination mailbox
before going near a signup form. A signup against an address that does not deliver strands the account at the
sign-in code with no way to read it, and burns whatever verification the checkout did ask for (step 5).

### 3 · THE OWNER'S — the signup

The owner opens claude.ai, signs up with `ada-owner-claude-five@acme.com` using the one-time code rather than
"Continue with Google", and enters the card. Anthropic's Usage Policy
names "Utilize automation in account creation", so no verb drives this form and none should be written.

A captcha may appear. It exists to establish a person is present; that is the owner's hand too.

### 4 · Read the sign-in code

```bash
slopweaver gmail list --query "from:anthropic newer_than:1h"
slopweaver gmail read <message-id>
```

This is reading the owner's own mailbox through the gmail door. The alias forwards there, so the code arrives in the
destination mailbox rather than anywhere new.

### 5 · THE OWNER'S, when the checkout asks — phone verification

Two observations, both from the fifth account, and they point opposite ways. Carry both.

At the **Max 20x** checkout, on the owner's own mobile, the refusal read:

> "That phone number has been used too many times. Try a different phone number."

At the **Max 5x** checkout half an hour later, no phone verification was asked for at all.

So the 5x purchase measured as an alias address plus a card, and nothing else. The refusal names the
NUMBER's history rather than the tier, so the defensible reading is that the mobile was exhausted and the
20x checkout is simply where a phone was asked for — not that the tier causes the check. Both are single
observations on a live product, so plan for a checkout that asks anyway and be unsurprised either way.

**If a checkout does ask and the mobile is refused**, there are two routes, and the choice is the owner's
and whoever approves the spend, never a session's:

- **A Twilio mobile per plan**: one AU mobile-typed number per plan on the acme Twilio
  account, about **$8.25/month each**, bought through the Twilio API with the verification text read back
  the same way. It needs an approved **"Australia Mobile Individual"** regulatory bundle — a named
  individual's address and ID, reviewed by Twilio — and it steps around a control Anthropic put there
  deliberately. Both facts belong in front of whoever decides.
- **Team or Enterprise seats.** Bought once against the organisation, include Claude Code usage, and raise
  none of the above. At **US$100 per premium seat per month against US$100 for a Max 5x plan** the
  comparison is like for like on price, which is the argument to have past a handful of plans.

### 6 · THE OWNER'S — the card

Whatever the plan costs, on whichever card is approved for it. For Codex the purchase additionally waits on
the card being allowed for OpenAI at all.

### 7 · Capture the setup token, and enrol

```bash
slopweaver claude signin --enroll plan-five
```

**Add the new plan's address to `accounts.json` BEFORE this step, not after.** The enrollment is the one act
that binds an address to a live token, so it captures whatever the row says at that instant; enrol first and
the plan reads `CACHED <address>` on every surface until somebody re-enrols it.

Then prove the plan answers before trusting it:

```bash
slopweaver claude gauge --plan plan-five
```

Its account column must read the bare address. `CACHED <address>` means the enrolment ran before the row
existed — `slopweaver claude signin --reenroll plan-five` binds it.

For Codex, `slopweaver codex signin` is the same step on the same identity.

### 8 · Record what it cost and what was learned

```bash
slopweaver knowledge record ...    # anything this seat taught that the last one did not
```

A phone number that was accepted, or refused, is exactly the kind of fact the next seat needs and nobody
remembers. Whether Anthropic accepts a Twilio AU mobile at all is **UNVERIFIED** — record
the result the first time one is tried.

## When a standing seat's plan stops being payable

A seat whose subscription the provider paused — a bounced card, an expired one, a spend limit — is not a
sign-in problem and no repair reaches it. Take it out of the fleet by name, with what it is waiting on:

```bash
slopweaver claude pause plan-one --reason "claude.ai subscription paused on a bounced Airwallex charge"
slopweaver claude resume plan-one   # once the owner says it is paid
```

The row, its store and its enrollment all stay exactly where they are — a pause is not a deletion, because a
plan's alias IS its store directory name and re-adding one is a re-enrollment. What changes is that the
routing gate, the fleet-wide gauge and the watch loop stop probing it and print its reason once instead.
Why, and what it is refused for:
[plan-rows-and-stores](../../supervisor/reference/plan-rows-and-stores.md).

## What is automated, in one table

| Step                 | Automated                               |
| -------------------- | --------------------------------------- |
| 1 Label              | — (a choice)                            |
| 2 Mailbox            | `slopweaver alias provision`            |
| 3 Signup + captcha   | **THE OWNER'S**                         |
| 4 Sign-in code       | `slopweaver gmail read`                 |
| 5 Phone verification | **THE OWNER'S**, when the checkout asks |
| 6 Card               | **THE OWNER'S**                         |
| 7 Token + enrolment  | `slopweaver claude signin --enroll`     |
| 8 What it taught     | `slopweaver knowledge record`           |

Two of the eight are always the owner's, a third when the checkout asks for a phone, plus the captcha inside step 3.
The measured 5x purchase took the two. That is the honest shape of "mostly hands off":
the mailbox and the sign-in code are verbs; the steps that exist to prove a person is present stay the
owner's, and should.
