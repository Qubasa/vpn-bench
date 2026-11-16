# Provenance of 03.11.2026-full-newlock

Full run on the updated stack: 12 VPNs (Internal and the 11 VPNs plus tincr), all tests
(iperf3, iperf3-parallel-tcp, qperf, nix-cache, ping, rist-stream, connection times) and
the four tc profiles (Baseline, Low, Medium, High). Same rig, tests and profiles as
`22.10.2026-full-oldlock`; what changed is every VPN's version (latest upstream release or
commit, `vpn-versions.nix`), clan-core and with it nixpkgs.
Rig: NixOS 26.11.20261020.5adc508, kernel 6.18.57 on lom, luna and yuki.

Since 2026-11-16 this alias also holds the Congestion and Reorder profiles of
`11.11.2026-newprofiles-newlock` (same VPN versions, clan-core and nixpkgs; vpb `3d648d2`),
copied unchanged into `<VPN>/congestion_impairment` and `<VPN>/reorder_impairment`. Their
provenance is `PROVENANCE-congestion-reorder.md`; the original alias, with its
`layout.json` files, is in `~/.local/share/vpn_bench/olds/`.

Driver: `~/vpb-rig-tasks/scripts/full_newlock.sh` (devshell `devshell_env_newlock.sh`,
GC-rooted at `gcroots/vpn-bench-devshell-newlock`). Each VPN ran as two invocations,
a = Baseline+Low with connection times, b = Medium+High with `--skip-con-times`. No
invocation started if its estimate could reach 23:45 UTC, because the controlling
machine's nightly nix-gc at 00:00 deletes the clan flake source clan-cli copied into
the store; it waited for 00:05 instead (twice).

## Commits deployed

- `cd745fc` (main run start): VPN updates, clan-core dbae210 / nixpkgs 5adc508 port,
  root-owned harmonia key.
- `b346445` from hyprspace-b on: `clanModules/hyprspace` waits for
  `systemd-networkd-wait-online --any --ipv4 --operational-state=routable` before
  starting. Hyprspace 0.15 resolves its 0.0.0.0/:: listen addresses to the interface
  addresses present at start; after the reboot it started before the DHCP lease and never
  listened on the public address, so `hyprspace-a` failed in the reboot connection check
  (10.5 min, all pairs). Only the Hyprspace module changed.
- `f4f35c8` from gap-mycelium-a on: vpb adds hyperfine 1.x fields to hyperfine 2 output
  and retries an undecodable connection-timings read. Python only; no module change.

The per-VPN table below shows the rev each VPN's baseline was deployed from.

## Gap re-runs (Baseline+Low, all tests, same alias)

- Hyprspace (`gap-hyprspace-a`, rev b346445): the failed main part above. Outcome: all
  files present.
- Mycelium (`gap-mycelium-a`, rev f4f35c8) and ZeroTier (`gap-zerotier-a`, rev f4f35c8):
  the main parts stopped before any test. After the reboot, luna's connection check had
  succeeded (journal: 8.3 s and 31 s), but vpb's `cat` of its result file returned empty
  stdout with exit 0 and the JSON decode aborted the part. Both times luna's ssh master
  closed ("disconnected by user") about 1 s after the preceding `wait_service.sh`, and no
  new session reached luna until 4-5 s later, so the read never ran there. The read is now
  retried; the retry did not trigger in the gap runs. Outcome: all files present.

## nix-cache results

nixpkgs 26.11 ships hyperfine 2.0 (JSON schema_version 2: `summary` and `measurements`
instead of `mean`, `times`, ...). The per-machine `nix_cache.json` files saved before
`f4f35c8` were given the 1.x fields afterwards with the same function
(`vpn_bench.nix_cache.add_hyperfine1_fields`, additive; the 2.x fields are unchanged), and
`General/` was regenerated with `compare_alias.py`. The copied closure is Firefox 158
(old run: Firefox 144), so nix-cache times are not comparable with the old run.

## Error results (59, none missing)

Same mechanisms as in `22.10.2026-full-oldlock`, not re-run:

- Headscale and Nebula qperf, all profiles: QUIC handshake failed.
- Hyprspace UDP (11 of 12 pairs) and Mycelium UDP (12 of 12): `control socket has closed
  unexpectedly`, 120 s timeouts.
- nix-cache over the 700 s budget under High: EasyTier, Hyprspace, Mycelium, Yggdrasil.

Full list: `~/vpb-rig-tasks/logs/completeness_03.11.2026-full-newlock.md`.

## Driver start (`logs/ids_<alias>.txt`)

- alias=03.11.2026-full-newlock
- commit_id=cd745fcf38060fa7a5839cc3348dc154b5668dda
- description=nix-cache: root-own the harmonia key; vpb: save clan command errors again
- dirty=0

## Run log (UTC, `logs/runs.txt`)

- `FULL START 2026-11-03T12:54:02Z alias=03.11.2026-full-newlock vpns=internal easytier headscale hyprspace mycelium nebula tinc tincr vpncloud wireguard yggdrasil zerotier`
- `START 2026-11-03T12:54:05Z label=03.11.2026-full-newlock-internal-a: vpb bench --vpn internal --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-03T13:24:02Z label=03.11.2026-full-newlock-internal-a rc=0`
- `START 2026-11-03T13:24:02Z label=03.11.2026-full-newlock-internal-b: vpb bench --vpn internal --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-03T14:16:48Z label=03.11.2026-full-newlock-internal-b rc=0`
- `START 2026-11-03T14:16:48Z label=03.11.2026-full-newlock-easytier-a: vpb bench --vpn easytier --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-03T15:31:39Z label=03.11.2026-full-newlock-easytier-a rc=0`
- `START 2026-11-03T15:31:39Z label=03.11.2026-full-newlock-easytier-b: vpb bench --vpn easytier --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-03T17:25:54Z label=03.11.2026-full-newlock-easytier-b rc=0`
- `START 2026-11-03T17:25:54Z label=03.11.2026-full-newlock-headscale-a: vpb bench --vpn headscale --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-03T19:10:23Z label=03.11.2026-full-newlock-headscale-a rc=0`
- `START 2026-11-03T19:10:23Z label=03.11.2026-full-newlock-headscale-b: vpb bench --vpn headscale --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-03T21:07:01Z label=03.11.2026-full-newlock-headscale-b rc=0`
- `START 2026-11-03T21:07:01Z label=03.11.2026-full-newlock-hyprspace-a: vpb bench --vpn hyprspace --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-03T21:17:43Z label=03.11.2026-full-newlock-hyprspace-a rc=1`
- `FULL WAIT 2026-11-03T21:17:43Z until 2026-11-04T00:05:00Z (nix-gc at 00:00, estimate 11175s)`
- `START 2026-11-04T00:05:00Z label=03.11.2026-full-newlock-hyprspace-b: vpb bench --vpn hyprspace --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T02:14:53Z label=03.11.2026-full-newlock-hyprspace-b rc=0`
- `START 2026-11-04T02:14:53Z label=03.11.2026-full-newlock-mycelium-a: vpb bench --vpn mycelium --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T02:16:53Z label=03.11.2026-full-newlock-mycelium-a rc=1`
- `START 2026-11-04T02:16:53Z label=03.11.2026-full-newlock-mycelium-b: vpb bench --vpn mycelium --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T04:48:55Z label=03.11.2026-full-newlock-mycelium-b rc=0`
- `START 2026-11-04T04:48:55Z label=03.11.2026-full-newlock-nebula-a: vpb bench --vpn nebula --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T06:09:41Z label=03.11.2026-full-newlock-nebula-a rc=0`
- `START 2026-11-04T06:09:41Z label=03.11.2026-full-newlock-nebula-b: vpb bench --vpn nebula --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T08:04:34Z label=03.11.2026-full-newlock-nebula-b rc=0`
- `START 2026-11-04T08:04:34Z label=03.11.2026-full-newlock-tinc-a: vpb bench --vpn tinc --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T09:40:20Z label=03.11.2026-full-newlock-tinc-a rc=0`
- `START 2026-11-04T09:40:20Z label=03.11.2026-full-newlock-tinc-b: vpb bench --vpn tinc --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T11:25:36Z label=03.11.2026-full-newlock-tinc-b rc=0`
- `START 2026-11-04T11:25:36Z label=03.11.2026-full-newlock-tincr-a: vpb bench --vpn tincr --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T12:42:41Z label=03.11.2026-full-newlock-tincr-a rc=0`
- `START 2026-11-04T12:42:41Z label=03.11.2026-full-newlock-tincr-b: vpb bench --vpn tincr --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T14:27:31Z label=03.11.2026-full-newlock-tincr-b rc=0`
- `START 2026-11-04T14:27:31Z label=03.11.2026-full-newlock-vpncloud-a: vpb bench --vpn vpncloud --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T15:59:43Z label=03.11.2026-full-newlock-vpncloud-a rc=0`
- `START 2026-11-04T15:59:43Z label=03.11.2026-full-newlock-vpncloud-b: vpb bench --vpn vpncloud --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T18:03:27Z label=03.11.2026-full-newlock-vpncloud-b rc=0`
- `START 2026-11-04T18:03:27Z label=03.11.2026-full-newlock-wireguard-a: vpb bench --vpn wireguard --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T18:32:03Z label=03.11.2026-full-newlock-wireguard-a rc=0`
- `START 2026-11-04T18:32:04Z label=03.11.2026-full-newlock-wireguard-b: vpb bench --vpn wireguard --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T19:28:02Z label=03.11.2026-full-newlock-wireguard-b rc=0`
- `START 2026-11-04T19:28:02Z label=03.11.2026-full-newlock-yggdrasil-a: vpb bench --vpn yggdrasil --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-04T20:46:54Z label=03.11.2026-full-newlock-yggdrasil-a rc=0`
- `FULL WAIT 2026-11-04T20:46:54Z until 2026-11-05T00:05:00Z (nix-gc at 00:00, estimate 12680s)`
- `START 2026-11-05T00:05:00Z label=03.11.2026-full-newlock-yggdrasil-b: vpb bench --vpn yggdrasil --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-05T02:18:25Z label=03.11.2026-full-newlock-yggdrasil-b rc=0`
- `START 2026-11-05T02:18:25Z label=03.11.2026-full-newlock-zerotier-a: vpb bench --vpn zerotier --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-05T02:20:50Z label=03.11.2026-full-newlock-zerotier-a rc=1`
- `START 2026-11-05T02:20:50Z label=03.11.2026-full-newlock-zerotier-b: vpb bench --vpn zerotier --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-05T03:58:51Z label=03.11.2026-full-newlock-zerotier-b rc=0`
- `FULL DONE 2026-11-05T03:58:53Z alias=03.11.2026-full-newlock`
- `GAPS START 2026-11-05T03:59:01Z alias=03.11.2026-full-newlock`
- `START 2026-11-05T03:59:01Z label=03.11.2026-full-newlock-gap-hyprspace-a: vpb bench --vpn hyprspace --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-05T05:22:27Z label=03.11.2026-full-newlock-gap-hyprspace-a rc=0`
- `START 2026-11-05T05:22:27Z label=03.11.2026-full-newlock-gap-mycelium-a: vpb bench --vpn mycelium --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-05T07:09:21Z label=03.11.2026-full-newlock-gap-mycelium-a rc=0`
- `GAPS DONE 2026-11-05T07:09:23Z alias=03.11.2026-full-newlock`
- `GAPS START 2026-11-05T07:10:03Z zerotier-a (empty read on luna, like mycelium-a)`
- `START 2026-11-05T07:10:03Z label=03.11.2026-full-newlock-gap-zerotier-a: vpb bench --vpn zerotier --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 03.11.2026-full-newlock`
- `END 2026-11-05T08:26:59Z label=03.11.2026-full-newlock-gap-zerotier-a rc=0`
- `GAPS DONE 2026-11-05T08:27:01Z zerotier-a`

## clan flake.lock (`~/.local/share/vpn_bench/clan/flake.lock`)

- clan-core rev: `dbae21013aca57424620d06863cbfd2e4107352b`
- nixpkgs rev: `5adc50831c259f87faeb09ddf930d43597197473`
- cvpn-bench (last relock): rev `f4f35c89e4f3a06b5ef864ed73ad56cfd52fecff`

## cvpn-bench lock per VPN (baseline `timing_breakdown.json`, vpn_installation)

| VPN | rev | narHash | version |
|---|---|---|---|
| Easytier | cd745fcf38060fa7a5839cc3348dc154b5668dda | `sha256-2L2kL31LO+B+E4D5+tnqVDGJnBYytPgnZ8jhkfaYMEk=` | easytier v2.7.0+75 |
| Headscale | cd745fcf38060fa7a5839cc3348dc154b5668dda | `sha256-2L2kL31LO+B+E4D5+tnqVDGJnBYytPgnZ8jhkfaYMEk=` | tailscale v1.104.4, headscale v0.29.7 |
| Hyprspace | b34644545e08752d49ffed7f6bf43a5916159abe | `sha256-YhkkghbQ7AZQngknGDYzi09F67TLkc8V9bISsOkjvV0=` | hyprspace v0.15.0+2 |
| Internal | cd745fcf38060fa7a5839cc3348dc154b5668dda | `sha256-2L2kL31LO+B+E4D5+tnqVDGJnBYytPgnZ8jhkfaYMEk=` | - |
| Mycelium | f4f35c89e4f3a06b5ef864ed73ad56cfd52fecff | `sha256-h61vf5zO3rmQmFSgNSH0k939rPJxvoq1P3ZUfMUARnU=` | mycelium v0.7.10 |
| Nebula | b34644545e08752d49ffed7f6bf43a5916159abe | `sha256-YhkkghbQ7AZQngknGDYzi09F67TLkc8V9bISsOkjvV0=` | nebula v1.12.0 |
| Tinc | b34644545e08752d49ffed7f6bf43a5916159abe | `sha256-YhkkghbQ7AZQngknGDYzi09F67TLkc8V9bISsOkjvV0=` | tinc release-1.1pre18 |
| Tincr | b34644545e08752d49ffed7f6bf43a5916159abe | `sha256-YhkkghbQ7AZQngknGDYzi09F67TLkc8V9bISsOkjvV0=` | tincr 09804a6 |
| VpnCloud | b34644545e08752d49ffed7f6bf43a5916159abe | `sha256-YhkkghbQ7AZQngknGDYzi09F67TLkc8V9bISsOkjvV0=` | vpncloud v2.3.0+11 |
| Wireguard | b34644545e08752d49ffed7f6bf43a5916159abe | `sha256-YhkkghbQ7AZQngknGDYzi09F67TLkc8V9bISsOkjvV0=` | wireguard-tools v1.0.20260223 |
| Yggdrasil | b34644545e08752d49ffed7f6bf43a5916159abe | `sha256-YhkkghbQ7AZQngknGDYzi09F67TLkc8V9bISsOkjvV0=` | yggdrasil v0.5.15 |
| Zerotier | f4f35c89e4f3a06b5ef864ed73ad56cfd52fecff | `sha256-h61vf5zO3rmQmFSgNSH0k939rPJxvoq1P3ZUfMUARnU=` | zerotierone 1.16.2 |
