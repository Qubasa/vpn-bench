# Provenance of 20.10.2026-netem-v2

Receiver-side impairment re-run (OpenSpec change `netem-impairment-rework`, tasks 3.2-3.3)
on the package versions of the 18.12.2025 data (same clan-core and nixpkgs pins).
Rig: NixOS 25.11.19800101.e1ebeec, kernel 6.12.57 on lom, luna and yuki.

## vpn-benchmark-suite revisions (UTC start, label, change, commit)

- 2026-10-20T16:15:43Z oldlock1 wrmnznvw 4e96299b (netem-v2-oldlock; clan-core fe53467, nixpkgs e1ebeec; rig 25.11 e1ebeec kernel 6.12.57)
- 2026-10-21T04:45:05Z gaps ouuuynxx dbd599a8 (netem-v2-oldlock + v4 hostname fix for Internal; same lock)
- 2026-10-21T06:50:23Z gaps2 yullkulm 3f9e6df7 (dbd599a8 + webview data commit; same code and lock)

The second revision differs from the first only in `vpn_bench/nix_cache.py` (hostnames
for Internal); the third adds only the webview copy of this data. Re-run parts:

- Internal: all tests, both profiles (`gap-internal`, first run failed to deploy because the v4.<host> names were missing from /etc/hosts when the VPN IP is the public IP)
- Tinc: all tests, both profiles (`gap-tinc`, first run lost a store path on the workstation during the Baseline RIST test)
- Nebula: iperf3-parallel-tcp, both profiles (`gap-nebula`); luna/yuki pair failed again
- Mycelium: iperf3-parallel-tcp, Medium (`gap-mycelium`)
- WireGuard: iperf3 (TCP+UDP) and nix-cache, Medium (`gap-wireguard`; in the first run luna->yuki TCP and UDP timed out and nix-cache got no ssh session channel)
- WireGuard: ping and rist-stream, Medium (`gap2-wireguard`; the first run's luna->yuki ping had 100 % loss and RIST 0 fps although marked success)
- Nebula: ping, Baseline (`gap2-nebula`); luna->yuki again lost the first 58 of 100 echoes in the first of three pings, then answered with RTTs falling from 1466 ms

## vpb invocations (UTC, from the run log)

- `START 2026-10-20T16:15:43Z label=oldlock1: vpb bench --vpn headscale --vpn hyprspace --vpn mycelium --vpn nebula --vpn tinc --vpn vpncloud --vpn wireguard --vpn yggdrasil --vpn zerotier --vpn easytier --vpn internal --test iperf3 --test iperf3-parallel-tcp --test ping --test rist-stream --test nix-cache --tc-profile baseline --tc-profile medium --skip-con-times --no-tui --no-sandbox --alias 20.10.2026-netem-v2`
- `END 2026-10-21T04:43:21Z label=oldlock1 rc=1`
- `START 2026-10-21T04:45:05Z label=gap-internal: vpb bench --vpn internal --test iperf3 --test iperf3-parallel-tcp --test ping --test rist-stream --test nix-cache --tc-profile baseline --tc-profile medium --skip-con-times --no-tui --no-sandbox --alias 20.10.2026-netem-v2`
- `END 2026-10-21T05:13:17Z label=gap-internal rc=0`
- `START 2026-10-21T05:13:17Z label=gap-tinc: vpb bench --vpn tinc --test iperf3 --test iperf3-parallel-tcp --test ping --test rist-stream --test nix-cache --tc-profile baseline --tc-profile medium --skip-con-times --no-tui --no-sandbox --alias 20.10.2026-netem-v2`
- `END 2026-10-21T06:22:31Z label=gap-tinc rc=0`
- `START 2026-10-21T06:22:31Z label=gap-nebula: vpb bench --vpn nebula --test iperf3-parallel-tcp --tc-profile baseline --tc-profile medium --skip-con-times --no-tui --no-sandbox --alias 20.10.2026-netem-v2`
- `END 2026-10-21T06:30:17Z label=gap-nebula rc=0`
- `START 2026-10-21T06:30:17Z label=gap-mycelium: vpb bench --vpn mycelium --test iperf3-parallel-tcp --tc-profile medium --skip-con-times --no-tui --no-sandbox --alias 20.10.2026-netem-v2`
- `END 2026-10-21T06:33:57Z label=gap-mycelium rc=0`
- `START 2026-10-21T06:33:57Z label=gap-wireguard: vpb bench --vpn wireguard --test iperf3 --test nix-cache --tc-profile medium --skip-con-times --no-tui --no-sandbox --alias 20.10.2026-netem-v2`
- `END 2026-10-21T06:44:35Z label=gap-wireguard rc=0`
- `GAPS DONE 2026-10-21T06:44:35Z`
- `START 2026-10-21T06:50:23Z label=gap2-wireguard: vpb bench --vpn wireguard --test ping --test rist-stream --tc-profile medium --skip-con-times --no-tui --no-sandbox --alias 20.10.2026-netem-v2`
- `END 2026-10-21T06:58:05Z label=gap2-wireguard rc=0`
- `START 2026-10-21T06:58:05Z label=gap2-nebula: vpb bench --vpn nebula --test ping --tc-profile baseline --skip-con-times --no-tui --no-sandbox --alias 20.10.2026-netem-v2`
- `END 2026-10-21T07:06:32Z label=gap2-nebula rc=0`
- `GAPS2 DONE 2026-10-21T07:06:32Z`

## clan flake.lock (`~/.local/share/vpn_bench/clan/flake.lock`)

- clan-core rev: `fe53467dedf8a9b40e5de1f07311a3785b7b351b`
- nixpkgs rev: `e1ebeec86b771e9d387dd02d82ffdc77ac753abc`
- cvpn-bench (last relock): rev `3f9e6df70cedcedf1103f586dcab2618d172fbba`, narHash `sha256-qnILHJ8E2kziGYrjHuksxYsOE5E1dOEl6tNIKAVKmfM=`

## cvpn-bench lock per VPN (`<VPN>/baseline/timing_breakdown.json`, vpn_installation metadata)

| VPN | narHash | rev | lastModified |
|---|---|---|---|
| Easytier | `sha256-s9g9SsA43ljAd8xxHQGNif0+5ppCz/cp4EW8KAd7y6k=` | 4e96299bbe86dd363f59cc608762dafbb573563f | 1792505743 |
| Headscale | `sha256-s9g9SsA43ljAd8xxHQGNif0+5ppCz/cp4EW8KAd7y6k=` | 4e96299bbe86dd363f59cc608762dafbb573563f | 1792505743 |
| Hyprspace | `sha256-s9g9SsA43ljAd8xxHQGNif0+5ppCz/cp4EW8KAd7y6k=` | 4e96299bbe86dd363f59cc608762dafbb573563f | 1792505743 |
| Internal | `sha256-Jyfb3qIdhx40KF7q9YQgV1zrK8xwhmr77bFhOCw/3XU=` | dbd599a8f3b0d3f77b3bd0c642337f1cdc489b37 | 1792557884 |
| Mycelium | `sha256-s9g9SsA43ljAd8xxHQGNif0+5ppCz/cp4EW8KAd7y6k=` | 4e96299bbe86dd363f59cc608762dafbb573563f | 1792505743 |
| Nebula | `sha256-qnILHJ8E2kziGYrjHuksxYsOE5E1dOEl6tNIKAVKmfM=` | 3f9e6df70cedcedf1103f586dcab2618d172fbba | 1792565178 |
| Tinc | `sha256-Jyfb3qIdhx40KF7q9YQgV1zrK8xwhmr77bFhOCw/3XU=` | dbd599a8f3b0d3f77b3bd0c642337f1cdc489b37 | 1792557884 |
| VpnCloud | `sha256-s9g9SsA43ljAd8xxHQGNif0+5ppCz/cp4EW8KAd7y6k=` | 4e96299bbe86dd363f59cc608762dafbb573563f | 1792505743 |
| Wireguard | `sha256-s9g9SsA43ljAd8xxHQGNif0+5ppCz/cp4EW8KAd7y6k=` | 4e96299bbe86dd363f59cc608762dafbb573563f | 1792505743 |
| Yggdrasil | `sha256-s9g9SsA43ljAd8xxHQGNif0+5ppCz/cp4EW8KAd7y6k=` | 4e96299bbe86dd363f59cc608762dafbb573563f | 1792505743 |
| Zerotier | `sha256-s9g9SsA43ljAd8xxHQGNif0+5ppCz/cp4EW8KAd7y6k=` | 4e96299bbe86dd363f59cc608762dafbb573563f | 1792505743 |

Each profile's `tc_settings.json` records the impairment method (`receiver-ifb` for Medium).
