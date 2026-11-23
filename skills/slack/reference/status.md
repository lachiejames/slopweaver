# Your own status and presence — `slack status`

`slopweaver slack status` changes the OWNER's own Slack profile on the owner's user token (`xoxp-`). The bot
has no profile of the owner's to set, so there is no `--as`. Every write goes through the door and is reported from what Slack
READS BACK, never from its `ok`: a read-back that differs from what was sent exits non-zero naming the field,
and one that FAILS after Slack accepted the write says the change most likely landed and names what to do
next: `clear` to remove a status, or the undo of a manual away.

```bash
slopweaver slack status show --zone Australia/Melbourne
slopweaver slack status set --text "Public holiday, back Monday" --emoji :palm_tree: \
  --until end-of-day --zone Australia/Melbourne --dry-run
slopweaver slack status clear
slopweaver slack status presence --to away    # and --to auto to undo it
```

## The sub-commands

- **`show`** reads status and presence and changes nothing, so it passes no door. It needs only
  `users.profile:read` and `users:read`, which the user token already holds.
- **`set`** takes `--text`, `--emoji` or both. The text is at most 100 characters and is refused, never cut,
  above that. The emoji is one name between colons (`:palm_tree:`, `:wave::skin-tone-3:`). Only the SHAPE is
  checked locally: Slack is the authority on which emoji exist, and its `invalid_emoji_not_allowed` comes back
  naming the emoji.
- **`clear`** sends text, emoji and expiry empty together, because Slack refuses to clear one of text and
  emoji without the other.
- **`presence --to away|auto`** is a separate write on purpose. A manual away does NOT expire with the status —
  Slack keeps it across connections until it is set back to `auto` — so it is never folded into `set`, and
  every read of a manual away prints its own undo line.

`--dry-run` calls nothing and records nothing, but it is refused exactly where the real run would be: with
no user token, a dead Datadog console host in the text, or when the door would refuse the text on a voice
rule. A dry run that prints "would" is one the door would admit.

## When a status expires

- No `--until` means it never expires.
- `--until end-of-day` expires at the next midnight in `--zone`, which is REQUIRED with it: the day is never
  guessed from the machine. The calendar's wall-clock search finds that midnight, so a daylight-saving day
  still ends at its own midnight (`statusExpiry.test.ts` pins both Melbourne changeovers).
- `--until <iso>` must carry `Z` or an offset (`2001-01-01T00:00:00+10:00`), because an ISO string without
  one is read as machine-local time. Only strict ISO is taken, and a wall clock that does not exist (a calendar
  day outside its month) is refused rather than rolled over. An instant already past is refused.
- `--zone` on `set` or `show` also renders the expiry as local time. Without it, the UTC instant is printed.

## Scopes, and what to do when one is missing

`set` and `clear` need `users.profile:write` and `presence` needs `users:write`, both on the USER token
(`SLACK_STATUS_USER_SCOPES` in `src/connect/slack.ts`, listed in the full and agent manifests). Without them
the first call is refused by Slack and the verb prints which scope is missing and changes nothing. Granting
one takes the owner's hand: add it to the app's User Token Scopes, reinstall (a workspace admin may have to
approve), store the user token again with `slopweaver secrets set slack-user-token` if Slack issued a new
one, and confirm with `slopweaver slack probe --method auth.test --scopes`.

## What the door sees

The status text is the owner's words, shown to the whole workspace, so `set` runs the voice gate over it
(the `voice-rules` hatch applies, as on every as-me lane). The door request carries the text's
length and never the text. `clear` and `presence` author nothing.
