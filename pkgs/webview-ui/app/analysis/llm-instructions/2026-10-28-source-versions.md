# Source versions used for the 2026-10-28 verification

All overviews and `feature_matrix.md` were checked against these checkouts in `~/Projects/meshvpns`.

| Project | Overview file | Commit | Commit date | Version |
|---|---|---|---|---|
| EasyTier | `EasyTier_overview.md` | `c5d7327` | 2026-01-02 | v2.5.0 (+1) |
| Tailscale | `tailscale_headscale_overview.md` | `d451cd54a` | 2025-12-25 | 1.93.0 (`VERSION.txt`) |
| Headscale | `tailscale_headscale_overview.md` | `84c092a9` | 2025-12-28 | v0.28.0-beta.1 (+3) |
| Hyprspace | `hyprspace_overview.md` | `3a710c4` | 2025-12-12 | v0.12.0 |
| Mycelium | `mycelium_overview.md` | `e8653f6` | 2025-12-09 | v0.7.0 (+1) |
| Nebula | `nebula_overview.md` | `3ec527e` | 2025-12-10 | v1.10.0 (+5) |
| Tinc | `tinc_overview.md` | `940d15c4` | 2025-11-09 | 1.1pre18 (`meson.build`) |
| tincr | `tincr_overview.md` | `63f4e588` | 2026-10-28 | tincd crate 0.1.0 (no release tag) |
| VpnCloud | `vpncloud_overview.md` | `bef9916` | 2024-03-21 | 2.4.0 (`Cargo.toml`) |
| Yggdrasil | `yggdrasil_overview.md` | `ae405ad` | 2025-11-24 | v0.5.12 (+25) |
| ironwood (Yggdrasil routing library) | `yggdrasil_overview.md` | `e1358f7` | 2025-11-23 | version pinned by yggdrasil-go |
| ZeroTier | `zerotier_overview.md` | `8d4cb1e05` | 2025-11-03 | 1.16.0 (+18) |
| gVisor | `gvisor_overview.md` | `7b4fe744c` | 2026-04-09 | release-20260406.0 (+26) |

Dependencies that were not checked out locally (wireguard-go forks, go-libp2p v0.42.0, quic-go v0.52.0, flynn/noise, golang.org/x/crypto, management-integrations, go-nat) were read at their pinned versions through `gh api`. No Go module cache was present. Mycelium's quinn claims were checked against quinn 0.11.11 / quinn-udp 0.5.15 from the local cargo registry, while the lockfile pins 0.11.9 / 0.5.10.

Harness: omp, orchestrator model `anthropic/claude-opus-5-5`, one default `task` subagent per VPN.
