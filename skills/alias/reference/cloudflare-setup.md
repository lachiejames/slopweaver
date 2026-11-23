# The one-time Cloudflare setup, per zone and per install

Everything here is done once. After it, a new seat is one `slopweaver alias provision` command.

## 1 · The zone must be one the account holds

`slopweaver alias` resolves `--domain` against the zones the configured token can see, and refuses a zone it
does not, naming the ones it does. That refusal is the rail: the token reaches every zone on the account, so
a mistyped domain would otherwise land an address on a domain nobody looked at.

An account usually holds several zones, and the zone a seat's alias belongs on can sit on a different
account altogether, which is why the verb takes the zone explicitly rather than defaulting to one.

## 2 · The zone must not be under the Claude org's domain capture

The plans live on **acme-owned identities in the work Cloudflare**, so the data is not on
personal accounts. The **work Claude org has domain capture on**, so a Max plan cannot live on an address the
org claims; the two coexist only on a zone the org does **not** capture, which is why `acme.com` is the
zone used. Check capture before adding a new zone to this path; a captured one silently absorbs the signup
into the org.

## 3 · Email Routing on, per zone

Cloudflare dashboard → the zone → **Email** → **Email Routing** → enable. This adds the MX and TXT records
Cloudflare needs. No verb here switches it on: it changes the zone's mail delivery for every address on it,
which is not a thing to do as a side effect of provisioning one alias.

`slopweaver alias provision` refuses with `ROUTING_DISABLED` until this is done.

## 4 · The destination mailbox, verified

Cloudflare only forwards to a **verified** destination. Add the work mailbox under **Destination addresses**,
follow the code it mails there once, and it is usable from then on for every alias on the account.

`slopweaver alias provision` refuses with `DESTINATION_UNVERIFIED` until then — and writes nothing, so a run
against an unverified mailbox leaves the zone exactly as it found it.

## 5 · The token scope

The verb reads the **Cloudflare atlas's own token**: `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN`, else
`$SLOPWEAVER_HOME/secrets/cloudflare-token` (`src/config.ts`). That token was minted for the atlas, which
only reads, so it needs one permission added:

> **Zone · Email Routing Rules · Edit**

A `403` on a routing endpoint before that edit lands is the missing scope, not a defect. `alias list` is the
cheapest probe of whether it is there.

Installing a token from scratch:

```bash
slopweaver secrets set cloudflare-token
```

## 6 · Catch-all, or a rule per seat

```bash
slopweaver alias catch-all --domain acme.com --enable --destination ops@acme.com
```

A catch-all forwards **every** address on the zone, provisioned or not — which is what makes a per-seat step
unnecessary altogether, and also what makes it the widest write on this verb. It is its own verb rather than
a flag on `provision` for that reason.

The trade, stated: with a catch-all on, any address at all on that zone delivers, including ones nobody
minted, which is a larger spam surface and makes `alias list` a less complete picture of what is reachable.
Without it, each seat is one `provision` — which is already one command. Prefer per-seat rules unless
somebody is standing up seats faster than they can run a command.

`--disable` sets the catch-all to **drop** and switches it off; Cloudflare requires an action on every
catch-all write, so "off" is spelled as dropping rather than as a forward to a mailbox that is not receiving.

**Either instruction reads the standing rule first.** A catch-all update replaces the zone's rule wholesale,
so the verb prints the rule it is about to replace before writing, and refuses with exit `3` when the
standing rule is already what you asked for. Re-running is a no-op; re-pointing is never silent.

## 7 · The onboard step, for a fresh install

**`slopweaver onboard` step 11 is this, said to someone who has just installed the plugin** — it derives
both uniform addresses from `--identity` and `--mailbox-zone` and prints the command for each delivery
shape. It writes nothing and holds no token, deliberately: the verb's whole contract is that it reads no
state home and touches no network, and putting a Cloudflare write in it would also put a Cloudflare token
on every laptop. [skills/onboard/reference/the-mailbox.md](../../onboard/reference/the-mailbox.md) is the
page that step points at.

**What a fresh laptop actually needs depends on which row of § 6 you are on, and this is the answer to
"can anyone do it themselves".** Under a **catch-all** the answer is nothing at all — no Cloudflare token,
no write, no per-seat step; the derived address already delivers, into the one shared mailbox the zone's
rule names. Under **per-seat** provisioning each address needs its own rule, so somebody has to hold a token
carrying Zone · Email Routing Rules · Edit — and that token reaches every zone on the account, which makes
it an admin credential rather than a per-seat one. Nothing in `alias` is specific to this install: the zone
and the destination are both flags, and `slopweaver secrets set cloudflare-token` installs the token like
any other. Steps 1–6 above are the walk for whoever does hold one.
