# Feature matrix for one benchmark run

You write the feature matrix for the mesh VPNs of one benchmark run. The report shows it
next to benchmark numbers measured with exactly these versions:

{{VPNS}}

## Input

- `overviews/<VPN>.md`: one overview per VPN, written from the source of that version. Each
  checklist item already carries a value and evidence.
- `sources/<VPN>/`: read-only links to the source of each VPN and its dependencies
  (`src/<input>/`, `deps/<input>/`). Use it to settle a cell when an overview is unclear or
  two overviews used a row differently.
- `matrix_row_contract.md`: row definitions and scoring rules.
- `matrix_skeleton.md`: the exact document structure.

## What to write

1. `feature_matrix.md` in this folder. Copy `matrix_skeleton.md` and:
   - Replace the `<VPN>` column header in every table with one column per VPN, in the order of
     the table above. Use the project's own spelling (e.g. `EasyTier`, `Tailscale / Headscale`,
     `ZeroTier`). Every table must have the same columns.
   - Fill every cell. Feature rows take exactly one of `✓`, `◐`, `✗`, `N/A`, `?`. At a Glance
     rows take short text.
   - Keep every row name, heading and the `<!-- feature-scores -->` line unchanged. Do not add
     or remove rows. Do not write scores, the web UI computes them.
   - Replace the `<!-- -->` hints under "Caveats the Matrix Cannot Show" and "Key Takeaways"
     with prose about only the VPNs in this matrix.
2. Fill `date` (today, `YYYY-MM-DD`) and `model` (your model name) in `analysis.json`. Leave
   `revs` as it is.

## Rules

- A cell must agree with the overview of that VPN. If an overview applied
  `matrix_row_contract.md` differently from the other overviews, or the source shows it is
  wrong, follow the contract and the source, and list each such cell in your final message
  with the file and line.
- Score with "How to score a row" in `matrix_row_contract.md`, step by step, the same way for
  every VPN, so a cell means the same thing in every column. When torn between two values,
  pick the higher one.
- Plain, factual English. No marketing words, no em-dashes.
- Do not write anything outside this folder.
