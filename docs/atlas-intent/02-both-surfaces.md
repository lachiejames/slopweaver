# 2 · BOTH surfaces are mandatory, because they diverge

Part of [What an atlas must be](../atlas-intent.md).

This is the claim that keeps getting lost, and it is the one the owner emphasises hardest. It is not a
preference about thoroughness. It is a measured property of real platforms: some things are reachable
through the API and not the browser, and some through the browser and not the API, which is why the owner
puts so much emphasis on doing both.

The lesson was paid for once already. An atlas built by pulling everything reachable through the API gave
wrong answers about things plainly visible in the browser, and the explanation was that they were never
exposed through the API — only through the browser, or through an undocumented endpoint.

An API-only atlas is not a smaller atlas. It is a defeated one: nothing further gets planned until both
surfaces are walked, because **an atlas that does not know what exists has defeated its own
purpose**.

The owner is explicit that identical surfaces are a fine outcome, not a wasted pass: there will be platforms
where what is reachable through the API and through the browser happen to be identical.

The browser half is also an instrument for unknown unknowns. Chasing why a full Slack history cost 24 hours,
the owner reached for the atlas: building one means knowing **every endpoint, every method, every
parameter** each API contains, and going to the browser to see **what methods are hit when you're in the
browser**, across every page, sub-page and settings page. The worry about unknown unknowns is best solved by
building the platform's atlas, because an atlas is one of the best ways to reveal them.

**An undocumented browser-internal endpoint is a usable source, not merely a catalogued curiosity** — the
owner's ruling: usable in production ingest as long as it actually works. So reach is judged by whether
a call returns, never by whether a vendor documented it, and an endpoint the browser uses and the SDK does
not is exactly the kind of thing the browser half exists to find.
