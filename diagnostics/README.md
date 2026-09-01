# Worker diagnostics

## Diagnostic 02

Base script: **HWH Titan Forge Debug Healer Combos** (user-supplied working copy `HWH Titan Forge Debug Healer Combos.user(1).js`).

Purpose: test whether the runtime `Calc(battleData)` can execute inside a Web Worker using the **current battleData for each battle**. No battle IDs, seeds, attacker IDs, or defender IDs are hardcoded.

Safety: the diagnostic compares Main-thread and Worker execution and does not use the Worker result as the submitted battle result until compatibility is established.
