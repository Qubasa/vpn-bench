# Source analysis: {{VPN}}

You write the overview of the mesh VPN **{{VPN}}** for a benchmark report. The report shows
it next to benchmark numbers measured with exactly this source code, so describe this
version, not the project's current state.

## Source code

`sources/` is a read-only folder of links to the code nix built the benchmarked VPN from:

{{COMPONENTS}}

- `sources/src/<input>/`: the VPN's own source, the first component carries the traffic.
- `sources/deps/<input>/`: the source of its dependencies as they were built: `go-modules`
  (vendored Go modules), `go-stdlib` (Go standard library of the toolchain), `cargo-vendor`
  (vendored Rust crates), and the unpacked, patched source of each C library it links.

The source is the only authority. There is no git history, so do not run git. Do not use
documentation, blog posts or your memory of other versions of this project as evidence. When
behavior lives in a dependency (crypto, TUN handling, QUIC, netstack, kernel crypto), read
that dependency in `sources/deps/` at the version given there.

## What to write

1. `overview.md` in this folder. Follow `overview_template.md` exactly: same `#`/`##`/`###`
   headings in the same order, and every checklist item it lists, with its name unchanged.
   Fill each checklist item with a value and one sentence of evidence, using the conventions
   in `matrix_row_contract.md`. Replace every `<!-- -->` hint with prose.
2. Fill `date` (today, `YYYY-MM-DD`) and `model` (your model name, e.g. `Claude Opus 5.5`) in
   `analysis.json`. Leave `revs` as it is.

## Rules

- Every claim cites a file and line in `sources/` (`src/<input>/path/file.go:123`) or names
  the function. Mark anything inferred and not read in code as `(inferred)`.
- Describe the default build and default configuration on Linux, then options.
- Use the row definitions in `matrix_row_contract.md` for every checklist item, and its
  "At a Glance" keys for the facts the `# Overview` section must state (language, license,
  default peer transport, data cipher, handshake, default tunnel MTU, control-plane model,
  data-plane threading).
- Plain, factual English. Short sentences. No marketing words, no em-dashes.
- Do not write anything outside this folder.
