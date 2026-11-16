# Provenance of 11.11.2026-newprofiles-newlock

The two tc profiles added on `vpn-update-newlock`, for all 12 VPNs (Internal and the 11
VPNs plus tincr) and all tests except connection times (`--skip-con-times`): iperf3,
iperf3-parallel-tcp, qperf, nix-cache, ping, rist-stream. Same VPN versions, clan-core and
nixpkgs as `03.11.2026-full-newlock`, which holds Baseline, Low, Medium and High.
Rig: NixOS 26.11.20261020.5adc508, kernel 6.18.57 on lom, luna and yuki.

Profiles, per direction, applied by each machine to the traffic it receives (ifb, GRO off):

- congestion: netem `delay 10ms rate 1000mbit limit 100000`, child
  `tbf rate 100mbit burst 12500 limit 250000` (100 Mbit/s bottleneck, 250 kB tail-drop
  queue, counted on encrypted wire packets).
- reorder: netem `delay 10ms rate 1000mbit limit 100000`, child
  `netem delay 1ms reorder 1% limit 100000` (1 % of packets skip the extra 1 ms).

## Commit deployed

- `3d648d2` (`vpn-update-newlock`) for every VPN. Relative to `f4f35c8`, the commit of
  `03.11.2026-full-newlock`, the four old profiles produce the same netem line (only an
  explicit `handle 1:` was added) and no child qdisc; the test code and `clanModules`
  are unchanged apart from formatting.

## Driver

`~/vpb-rig-tasks/scripts/newprofiles_newlock.sh` (devshell `devshell_env_newlock.sh`),
one invocation per VPN. No invocation started if its estimate could reach 23:45 UTC,
because the controlling machine's nightly nix-gc at 00:00 deletes the clan flake source
clan-cli copied into the store; it waited for 00:05 instead (once, before tinc).
The first runner scaled every VPN's estimate by WireGuard's ratio and underestimated
EasyTier by 44 %. It was stopped during Headscale (`NEWPROF RELAUNCH`, the Headscale vpb
kept running) and a second runner with estimates from each VPN's actual Medium+High
duration in `03.11.2026-full-newlock` ran Hyprspace to ZeroTier. Both runners logged
`NEWPROF START` and rewrote `logs/ids_<alias>.txt`.

## Error results (27, none missing)

Same mechanisms as in `03.11.2026-full-newlock`, not re-run:

- Headscale and Nebula qperf, both profiles: QUIC handshake failed.
- Hyprspace and Mycelium UDP, both profiles: `control socket has closed unexpectedly`.
- Hyprspace nix-cache under reorder, all 3 pairs: over the 700 s budget. Hyprspace TCP
  falls to 6.5-9.1 Mbit/s under reorder and ping averages reach 130-780 ms on two pairs.

## Caveat

ZeroTier UDP under congestion: iperf3 `-b 0` sent about 11 Gbit/s into the ZeroTier
interface and 0.1 Mbit/s arrived (WireGuard: 0.84 Gbit/s sent, 92 Mbit/s arrived). The
value shows the collapse of unpaced UDP through ZeroTier at a 100 Mbit/s bottleneck, not
its paced UDP capacity.

## Driver start (`logs/ids_<alias>.txt`, second runner)

- alias=11.11.2026-newprofiles-newlock
- commit_id=3d648d295a8cf573b98fb7567bcef82a6f0ea25d
- description=Format the tree with nix fmt
- dirty=0

## Run log (UTC, `logs/runs.txt`)

- `NEWPROF START 2026-11-11T14:09:59Z alias=11.11.2026-newprofiles-newlock vpns=internal easytier headscale hyprspace mycelium nebula tinc tincr vpncloud wireguard yggdrasil zerotier`
- `START 2026-11-11T14:10:01Z label=11.11.2026-newprofiles-newlock-internal: vpb bench --vpn internal --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-11T14:45:33Z label=11.11.2026-newprofiles-newlock-internal rc=0`
- `START 2026-11-11T14:45:33Z label=11.11.2026-newprofiles-newlock-easytier: vpb bench --vpn easytier --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-11T16:09:02Z label=11.11.2026-newprofiles-newlock-easytier rc=0`
- `START 2026-11-11T16:09:03Z label=11.11.2026-newprofiles-newlock-headscale: vpb bench --vpn headscale --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `NEWPROF RELAUNCH 2026-11-11T16:54:46Z runner 60623 stopped (estimates too low); resuming after headscale (pid 349669) with hyprspace..zerotier`
- `END 2026-11-11T17:41:17Z label=11.11.2026-newprofiles-newlock-headscale rc=0`
- `NEWPROF START 2026-11-11T17:41:46Z alias=11.11.2026-newprofiles-newlock vpns=hyprspace mycelium nebula tinc tincr vpncloud wireguard yggdrasil zerotier`
- `START 2026-11-11T17:41:49Z label=11.11.2026-newprofiles-newlock-hyprspace: vpb bench --vpn hyprspace --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-11T19:43:56Z label=11.11.2026-newprofiles-newlock-hyprspace rc=0`
- `START 2026-11-11T19:43:57Z label=11.11.2026-newprofiles-newlock-mycelium: vpb bench --vpn mycelium --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-11T21:34:52Z label=11.11.2026-newprofiles-newlock-mycelium rc=0`
- `START 2026-11-11T21:34:52Z label=11.11.2026-newprofiles-newlock-nebula: vpb bench --vpn nebula --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-11T23:03:58Z label=11.11.2026-newprofiles-newlock-nebula rc=0`
- `NEWPROF WAIT 2026-11-11T23:03:58Z until 2026-11-12T00:05:00Z (nix-gc at 00:00, estimate 6540s)`
- `START 2026-11-12T00:05:01Z label=11.11.2026-newprofiles-newlock-tinc: vpb bench --vpn tinc --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-12T01:29:46Z label=11.11.2026-newprofiles-newlock-tinc rc=0`
- `START 2026-11-12T01:29:46Z label=11.11.2026-newprofiles-newlock-tincr: vpb bench --vpn tincr --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-12T02:53:52Z label=11.11.2026-newprofiles-newlock-tincr rc=0`
- `START 2026-11-12T02:53:52Z label=11.11.2026-newprofiles-newlock-vpncloud: vpb bench --vpn vpncloud --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-12T04:33:36Z label=11.11.2026-newprofiles-newlock-vpncloud rc=0`
- `START 2026-11-12T04:33:36Z label=11.11.2026-newprofiles-newlock-wireguard: vpb bench --vpn wireguard --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-12T05:08:05Z label=11.11.2026-newprofiles-newlock-wireguard rc=0`
- `START 2026-11-12T05:08:05Z label=11.11.2026-newprofiles-newlock-yggdrasil: vpb bench --vpn yggdrasil --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-12T06:33:57Z label=11.11.2026-newprofiles-newlock-yggdrasil rc=0`
- `START 2026-11-12T06:33:57Z label=11.11.2026-newprofiles-newlock-zerotier: vpb bench --vpn zerotier --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 11.11.2026-newprofiles-newlock`
- `END 2026-11-12T07:59:37Z label=11.11.2026-newprofiles-newlock-zerotier rc=0`
- `NEWPROF DONE 2026-11-12T07:59:39Z alias=11.11.2026-newprofiles-newlock`

## clan flake.lock (`~/.local/share/vpn_bench/clan/flake.lock`)

- clan-core rev: `dbae21013aca57424620d06863cbfd2e4107352b`
- nixpkgs rev: `5adc50831c259f87faeb09ddf930d43597197473`
- cvpn-bench (last relock): rev `3d648d295a8cf573b98fb7567bcef82a6f0ea25d`

## cvpn-bench lock per VPN (congestion `timing_breakdown.json`, vpn_installation)

| VPN | rev | narHash | version |
|---|---|---|---|
| Easytier | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | easytier v2.7.0+75 |
| Headscale | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | tailscale v1.104.4, headscale v0.29.7 |
| Hyprspace | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | hyprspace v0.15.0+2 |
| Internal | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | - |
| Mycelium | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | mycelium v0.7.10 |
| Nebula | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | nebula v1.12.0 |
| Tinc | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | tinc release-1.1pre18 |
| Tincr | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | tincr 09804a6 |
| VpnCloud | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | vpncloud v2.3.0+11 |
| Wireguard | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | linux 6.18.57, wireguard-tools v1.0.20260223 |
| Yggdrasil | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | yggdrasil v0.5.15 |
| Zerotier | 3d648d295a8cf573b98fb7567bcef82a6f0ea25d | `sha256-bib6Ylwmm7slZs0B6wBCsSb+FsXiH3Y2GNLYXcnq2jA=` | zerotierone 1.16.2 |
