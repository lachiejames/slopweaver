# The org-owned mailbox an assistant plan signs up on

The question: can anyone do it on their own work laptop by installing the plugin and running
`/slopweaver:onboard`, with it provisioning uniform emails for them?

**Yes — with one distinction that decides which half of it is true.** What follows is the answer, and it is
also what the step prints, so run `slopweaver onboard --identity <name> --mailbox-zone <zone>` rather than
paraphrasing this page at somebody.

## What is already uniform, and needs nothing from anybody

`src/alias/address.ts` holds every address to `<identity>-<provider>-<label>@<zone>` — the identity leads,
the provider is one of `claude`/`codex`, and an identity or label carrying a provider segment
is REFUSED rather than minted, because that address could never be read back. `onboard` derives from that
one function, so two people on two laptops cannot produce two shapes.

The step is for somebody's **next** seat: you are reading it inside a session running on a plan you already
hold, so it cannot be about that one. The first provisioned seat is labelled `one`, later ones `two`.

## The distinction: a catch-all has ONE destination for the WHOLE zone

|                          | **Catch-all**                                                                 | **Per seat**                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Write                    | one, per zone, ever                                                           | one per address                                                                                                      |
| Credential on the laptop | **none**                                                                      | Cloudflare token, `Zone · Email Routing Rules · Edit`                                                                |
| Where mail lands         | one shared mailbox, for every address on the zone                             | each person's own mailbox                                                                                            |
| Command                  | `slopweaver alias catch-all --domain <zone> --enable --destination <mailbox>` | `slopweaver alias provision --domain <zone> --identity <name> --provider claude --label one --destination <mailbox>` |

So **"anyone, on their own work laptop, with no credential" is the catch-all row, and it buys a shared
inbox.** Per-person delivery is the other row and it cannot be had without the Edit scope — a token that
reaches every zone on the account, which is an admin credential rather than a per-seat one. Expect an admin
to run that command, not to hand one out.

Turning a zone-wide catch-all on while expecting per-person delivery is the mistake this page exists to
prevent: the write is wide (it replaces the zone's standing rule wholesale) and it does not do what the
person turning it on thinks.

## What gates both, and refuses rather than half-writing

- **Email Routing must be ON for the zone** — Cloudflare dashboard → the zone → Email → Email Routing.
  `alias provision` refuses `ROUTING_DISABLED` until it is, and writes nothing.
- **The destination must be VERIFIED** — Cloudflare mails a code there once and a person follows it.
  `alias provision` refuses `DESTINATION_UNVERIFIED` until then, and writes nothing. Under per-person
  delivery that is one click per teammate, so say it before somebody runs the command.
- `slopweaver alias list --domain <zone>` is the cheapest read of whether the token sees the zone at all.
  A 403 there is the missing Edit scope, not a defect — Cloudflare answers 403 to a token
  that carries no routing permission, and the write leg therefore cannot run.

## Why `onboard` derives and never writes

`src/cli/manifests/onboard.ts` declares this verb as reading no state home, holding no token, touching no
network and writing no file — which is why it is `dryParseSafe`, needs no door, and is safe to re-run.
Performing the Cloudflare write here would break all of that AND require a Cloudflare token on every
laptop, which is the one credential the whole step argues against carrying. So the verb does for the
mailbox exactly what it does for the Slack app and the Google OAuth client: names the step, derives what it
can, prints the one command.

The signup itself is a separate refusal and a deliberate one: Anthropic's Usage Policy names "utilize
automation in account creation" under _Do Not Abuse our Platform_, so no verb here drives it
([terms-and-limits](../../alias/reference/terms-and-limits.md)).

## Where the rest lives

The zone setup once, per zone: [cloudflare-setup](../../alias/reference/cloudflare-setup.md). Standing a
whole plan up end to end, including the hand steps:
[claude-account-runbook](../../alias/reference/claude-account-runbook.md). The verbs themselves:
[the alias skill](../../alias/SKILL.md).
