# What `raw` was actually carrying

Part of [The local Supabase store](../store.md).

The owner asked to be told if the owner was wrong that nothing important is impossible to represent. The
owner is not wrong, and
this is the measurement rather than the opinion — over 4,000 records of each source's `compact.jsonl`:

| source | `raw` as a share of record bytes | its largest keys                      | how much of `raw` was already in the `body` column |
| ------ | -------------------------------- | ------------------------------------- | -------------------------------------------------- |
| slack  | 64.7%                            | `blocks` 35.6%, `attachments` 20.9%   | —                                                  |
| linear | 57.2%                            | `description` 35.9%, `comments` 26.5% | 6,200,462 of 6,200,462 bytes                       |
| github | 51.2%                            | `body` 85.7% of `raw`                 | 13,467,470 of 13,467,470 bytes                     |
| notion | 31.3%                            | `properties` 40.4%                    | 0                                                  |

GitHub's and Linear's bodies were verified byte-for-byte CONTAINED in the record's own `text`, so more than
half of what `raw` cost was one column stored twice. `self` and `gmail` carry no `raw` at all.

**One shape is genuinely open and it keeps a `jsonb` column: Notion's `properties`.** Its keys are defined
per DATABASE by whoever made it, so no schema we control can name them. That is a representation, not an
exception — and it is the answer to the owner's question.
