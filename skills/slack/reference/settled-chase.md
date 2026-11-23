# A chase on a finished pull request never parks

A chase asking whether we may close a pull request that had already closed 40 hours earlier was rejected. Asking
the team to move a finished pull request spends their attention for nothing.

So `slack draft record --act bump|review-ask`, under either identity, reads every github.com pull request the
rendered message links, live, and refuses the row when one is CLOSED, MERGED, not there, or could not be read. An
unread state is never taken as open. Every linked pull request is judged, not only the one the ask is about: a
settled one cited as background comes out of the chase, or the message is a `reply`. A link is judged by the pull
request it names, whether a link element, `<url|label>` markup or an address in plain text with or without a scheme, glued to the prose before it or not (every candidate is read by a browser's URL parser, never matched by shape), so a `/files` subpage, a query, `http://`, `www.` and a trailing-dot host all count; an issue at
that number is not a pull request and refuses as absent. A leading-zero number, a one-slash `https:/` link and a percent-encoded segment read as GitHub serves them, and a
`/pull/` link whose number cannot be read at all refuses rather than being skipped. A `reply` and a row with no act read nothing.

The read runs after the message renders and before `auth.test`, the thread read and any stored media, so a moot
chase writes nothing. The rule is `src/outbound/slack/settledChase.ts`; the read is
`src/cli/commands/slack/draftSettledChase.ts`.

**What it does not do**: re-judge a row parked while its pull request was still open. A batch that closes pull
requests leaves any chase already parked on them live, so read `slack draft list` after one and drop what it made
moot.
