# Mergeability is three-valued, and a first read is the one most likely to miss

Bundled reference for the `github` skill, linked from [dispatch.md](dispatch.md). Loaded when a row's
`mergeable` test reads `unknown`, or a first read and a later one disagree about a conflict.

`mergeable` is `MERGEABLE`, `CONFLICTING` or `UNKNOWN`, and collapsing everything that is not `CONFLICTING` to
"not conflicted" would PASS the `mergeable` test on an answer GitHub had not computed.
GitHub computes it lazily: a query for a pull request it has not computed answers `UNKNOWN` and starts the
job. Not every cold read misses — measured below, 15 of 20 did — but a fleet read is where the misses land.

| read                                    | MERGEABLE | UNKNOWN | CONFLICTING |
| --------------------------------------- | --------- | ------- | ----------- |
| first of the session, the owner's fleet | 10        | **16**  | 5           |
| a later read                            | 23        | 0       | **8**       |

Three of the owner's open pull requests were printed mergeable in a landing run whose next read called them
conflicting. Both halves are needed: `UNKNOWN` answers the test `unknown` (which can only hold
a row back), and the fleet read RE-READS what came back `UNKNOWN`, once. Measured on twenty pull requests
nobody had queried: **15 of 20 cold, all 15 resolved by one aliased re-read 871 ms later**, with two further
rounds changing nothing. Anything still `UNKNOWN` after it is honestly unknown.
