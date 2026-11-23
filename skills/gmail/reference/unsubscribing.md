# Unsubscribing — RFC 8058 one-click, and nothing else

Bundled reference for the `gmail` skill. `gmail unsubscribe <message-id>` reads that ONE message's
`List-Unsubscribe` and `List-Unsubscribe-Post` headers and, when the sender promised one-click, sends exactly the
request RFC 8058 defines: one POST of `List-Unsubscribe=One-Click` to the https target the sender itself wrote,
with no credential and no cookie, never retried, a redirect not followed. Any 2xx is success; anything else exits 1
saying the sender may not have unsubscribed. It is door-routed, so the ledger records the host and the message id.
Before its `fetch`, the POST's whole target URL, token included, and its body are judged strict under the verb's
`--home` by the outbound privacy check; a match refuses as `POST_REFUSED` and sends nothing.

| What the sender publishes                      | `gmail triage` says | `gmail unsubscribe`                                       |
| ---------------------------------------------- | ------------------- | --------------------------------------------------------- |
| an https target + `List-Unsubscribe=One-Click` | `one-click`         | performs it                                               |
| an https target, no one-click promise          | `link`              | refuses — the target is a page, the owner's to open       |
| only a `mailto:`                               | `mailto`            | refuses — that would be a send under the owner's name     |
| no `List-Unsubscribe` at all                   | `none`              | refuses — the sender's own settings page, sign-in-guarded |

**Run `--dry-run` first when you have not read the headers**: it prints the target's origin, counts the path
segments and query parameters after it, and sends nothing. `gmail read <id>` prints the pair itself as an
`unsubscribe:` line. The target carries the sender's token for the owner — the whole of the unsubscribe authority, in the
query for Linear, in the path or a bare query key for others — so the verb prints nothing after the origin;
`gmail read` prints all of it, like the rest of the message, which is why its output never goes into a commit, a
card or a PR.

**A target may be written BARE.** RFC 2369 asks for `<https://…>`; Linear's notification mail sends the URL with
no brackets (measured on the owner's inbox), and `src/live/gmail/unsubscribe.ts` reads both. A sender with
several lists (Linear's `type=` query) is unsubscribed from the ONE list that message's target names, not from
the sender — say which when you report it.
