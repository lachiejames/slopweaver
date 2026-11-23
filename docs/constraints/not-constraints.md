# Not constraints

Part of [Design constraints](../constraints.md).

Every item below is how the code works, not a requirement. The method generalises: a number measured on one
implementation is a choice, not a cost, and a plan built on it should say so.

| looks fixed                                | actually                                                                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`derive` is a free, fast, full re-scan** | The full re-scan is not sacred. Its _character_ is worth protecting: `derive` being cheap and quick is load-bearing for how it gets used, so a 20-hour `derive` would break the mental model even if it were technically the right home.       |
| **`store load` reads a bounded window**    | A choice the load makes per platform, not a property of the store. Postgres full text covers every row it holds at the same cost; widening the window is a load decision, and `slopweaver store status` is what says how wide it currently is. |
