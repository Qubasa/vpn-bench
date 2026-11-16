# Provenance of 22.10.2026-full-oldlock

Full re-run with the fixed vpb code: 11 VPNs, all tests (iperf3, iperf3-parallel-tcp,
qperf, nix-cache, ping, rist-stream, connection times) and the four tc profiles
(Baseline, Low, Medium, High), on the package versions of the 18.12.2025 data (same
clan-core and nixpkgs pins). Replaces the 18.12.2025 data. tincr was added later as
a twelfth, additional result directory (`Tincr/`, see "Tincr addition").
Rig: NixOS 25.11.19800101.e1ebeec, kernel 6.12.57 on lom, luna and yuki.

Since 2026-11-16 this alias also holds the Congestion and Reorder profiles of
`12.11.2026-newprofiles-oldlock` (same VPN versions, clan-core and nixpkgs; vpb `a7e582b`),
copied unchanged into `<VPN>/congestion_impairment` and `<VPN>/reorder_impairment`. Their
provenance is `PROVENANCE-congestion-reorder.md`; the original alias, with its
`layout.json` files, is in `~/.local/share/vpn_bench/olds/`.

## vpn-benchmark-suite revision (`logs/jj_ids.txt`)

- commit_id=82acad98274dd23faa99c6601d5c633039e4d3b3
- change_id=yullkulmonktmknovwutwsoxplrrrtuo
- description=webview-ui: add the 20.10.2026 receiver-side impairment re-run

## Gap re-runs

Same alias; a gap run overwrites only the re-run tests' files and that profile's
timing_breakdown.json.

The first gap attempt at 2026-10-24T00:02:00Z exited with rc=127 before contacting the
rig: the same nightly GC (00:00:20) had removed 39 of the 40 store paths of the vpb
devshell (python3, clan-cli `503i7vwwqjv0...`). The devshell was rebuilt unchanged with
`nix develop --no-update-lock-file --profile ~/vpb-rig-tasks/gcroots/vpn-bench-devshell
.#vpn-bench` at the same commit (identical store paths, now GC-rooted), and the gap batch
was restarted at 00:03 UTC.

- Hyprspace: all tests, High (`gap-hyprspace-high`). In the main run the local `nix-gc.timer` of the controlling machine fired at 00:00:04 UTC on 2026-10-23, during Hyprspace High, and removed the clan flake source that clan-cli had copied into the store (no GC root). The service restart after lom's nix-cache timeout then failed with `path '//nix/store/3w7czyn...-source' does not exist`, and vpb stopped the profile: lom ping/rist/nix-cache, all of luna and yuki, and timing_breakdown.json were missing. Gap runs were started after the next GC so none spans midnight. Outcome: all files present; UDP (2 timeouts, 1 control socket closed) and nix-cache (700 s) errors on all pairs
- Hyprspace: iperf3 (TCP+UDP), Baseline/Low/Medium (`gap-hyprspace-iperf3`; UDP errors: 120 s timeouts and `control socket has closed unexpectedly`). Outcome: UDP errors again (Baseline 2/3, Low 3/3, Medium 3/3), same two causes
- Hyprspace: iperf3-parallel-tcp, Baseline (`gap-hyprspace-par`; 2 of 3 pairs failed). Outcome: 2/3 pairs ok, lom->luna `unable to receive results`
- Mycelium: iperf3 (TCP+UDP), all four profiles (`gap-mycelium-iperf3`; UDP failed on all 12 pairs with `control socket has closed unexpectedly`). Outcome: 11/12 UDP pairs fail the same way; High lom->luna succeeded
- Mycelium: nix-cache, High (`gap-mycelium-nixcache`; 700 s budget exceeded on all pairs). Outcome: 700 s exceeded on all pairs again
- Nebula: iperf3-parallel-tcp, all four profiles (`gap-nebula`; luna/yuki pair failed in every profile). Outcome: luna->yuki fails in Baseline/Low/High with `unable to connect to server ... Connection timed out`; Medium 3/3 ok. Superseded: Nebula was fully re-run after the config fix (see below)
- Yggdrasil: nix-cache, Medium and High (`gap-yggdrasil`; 700 s budget exceeded). Outcome: Medium 2/3 ok (luna->yuki 700 s), High 700 s exceeded on all pairs
- Easytier: nix-cache, High (`gap-easytier`; 700 s budget exceeded on lom and yuki). Outcome: lom and yuki exceeded 700 s again, luna ok (156 s). Superseded: EasyTier was fully re-run after the config fix (see below)

Not re-run (expected failures with known mechanism):

- Nebula qperf (all profiles): `QperfHandshakeError`, GSO sends of 1328 B exceed the 1300 B tun MTU (EMSGSIZE)
- Headscale qperf (all profiles): QUIC handshake failed, qperf reported no connection establishment time

## Config-fix re-runs (Nebula, Easytier)

After the investigation (`~/vpb-rig-tasks/reports/full-oldlock/investigation.md`, Q4 and Q7)
two clan-module setup bugs were fixed in local, unpushed commits on top of `82acad98`, and
both VPNs were re-run completely (all tests incl. connection times, all four profiles) into
this alias. The previous Nebula and Easytier results were moved to
`~/vpb-rig-tasks/backup/22.10.2026-full-oldlock-before-fix/`. Patch:
`~/vpb-rig-tasks/logs/fix-nebula-easytier.patch`.

- `052abd9628c5e9679558a368132eb339c2940245` clanModules: fixed Nebula listen port on all nodes, EasyTier UDP listener. Nebula's non-lighthouse nodes listened on a random UDP port that the NixOS firewall does not open, so luna<->yuki traffic was dropped once the conntrack entry expired (54-63 % ping loss, parallel TCP connect timeouts). Now `listen.port = 4242` on every node (the nixpkgs module opens it).
- `134397254c62df9070aa43eab5250447424ce53f` clanModules/easytier: dial the bootstrap node over TCP and UDP. With only a `tcp://` bootstrap peer the two pairs with lom had no UDP link and ran TCP-in-TCP. Now all three pairs show `udp,tcp` links (`easytier-cli peer`); which link carries the data is EasyTier's choice.

Each part ran as two invocations (Baseline+Low with connection times, Medium+High with
`--skip-con-times`) so that none spans the 00:00 UTC nix-gc. Nebula: `fix-nebula-a/b`
(rev 052abd96), EasyTier: `fix-easytier-a/b` (rev 13439725); the per-VPN cvpn-bench lock
table below shows the rev each VPN was deployed from.

## Tincr addition

tincr (a Rust rewrite of tinc 1.1) was added to this alias afterwards as a twelfth result
directory. It is an addition, not a replacement: the 18.12.2025 data has no comparable
tincr run, and tincr is not one of the 11 VPNs above.

- vpb revision `134397254c62df9070aa43eab5250447424ce53f` (same tree as the EasyTier fix run; the clanModules/tincr code is unchanged from `82acad98`), clan-core and nixpkgs pins as above.
- tincr flake input `mic92/tincr` rev `b234dc798101a595adb121bab1c7cfe8cb2626a0` (lastModified 1776676973, 2026-04-20). Deployed package `tincd-0.1.0`, built on the hosts against nixpkgs `e1ebeec`; `tincd --version`: `tincd 0.1.0 (Rust) protocol 17.7`.
- Crypto: SPTPS only (Ed25519 + ChaCha20-Poly1305, RustCrypto `chacha20` 0.9 / `poly1305` 0.8 with AVX2, build flags `target-cpu=x86-64-v3`, `chacha20_force_avx2`); no RSA, no OpenSSL, no cipher choice at this revision. tinc defaults otherwise (port 655, TCP meta connection plus UDP data), same clan-module settings as Tinc (`StrictSubnets`, lom as the only node with an `Address`).
- Smoke run first, into the separate alias `29.10.2026-tincr-smoke` (`tincr-smoke`, ping, Baseline): tincd built and connected, all three pairs ok.
- Two invocations like the config-fix re-runs, none spanning the 00:00 UTC nix-gc: `add-tincr-a` (Baseline+Low with connection times) and `add-tincr-b` (Medium+High, `--skip-con-times`, started at 00:05 UTC after the GC at 00:00:19). Both rc=0.
- Outcome: all 78 per-machine result files present, no error result, parallel TCP 3/3 pairs in every profile. No other VPN's result files were touched; `General/` was regenerated with `compare_alias.py` and now includes Tincr.

## vpb invocations (UTC, from the run log)

- `START 2026-10-22T11:53:38Z label=full: vpb bench --vpn internal --vpn easytier --vpn headscale --vpn hyprspace --vpn mycelium --vpn nebula --vpn tinc --vpn vpncloud --vpn wireguard --vpn yggdrasil --vpn zerotier --test all --tc-profile all --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-23T22:11:40Z label=full rc=1`
- `GAPS START 2026-10-24T00:02:00Z nix-gc last: Sat 2026-10-24 00:00:20 UTC`
- `START 2026-10-24T00:02:00Z label=gap-hyprspace-high: vpb bench --vpn hyprspace --test all --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T00:02:00Z label=gap-hyprspace-high rc=127`
- `START 2026-10-24T00:02:00Z label=gap-hyprspace-iperf3: vpb bench --vpn hyprspace --test iperf3 --tc-profile baseline --tc-profile low --tc-profile medium --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T00:02:00Z label=gap-hyprspace-iperf3 rc=127`
- `START 2026-10-24T00:02:00Z label=gap-hyprspace-par: vpb bench --vpn hyprspace --test iperf3-parallel-tcp --tc-profile baseline --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T00:02:00Z label=gap-hyprspace-par rc=127`
- `START 2026-10-24T00:02:00Z label=gap-mycelium-iperf3: vpb bench --vpn mycelium --test iperf3 --tc-profile baseline --tc-profile low --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T00:02:00Z label=gap-mycelium-iperf3 rc=127`
- `START 2026-10-24T00:02:00Z label=gap-mycelium-nixcache: vpb bench --vpn mycelium --test nix-cache --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T00:02:00Z label=gap-mycelium-nixcache rc=127`
- `START 2026-10-24T00:02:00Z label=gap-nebula: vpb bench --vpn nebula --test iperf3-parallel-tcp --tc-profile baseline --tc-profile low --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T00:02:00Z label=gap-nebula rc=127`
- `START 2026-10-24T00:02:00Z label=gap-yggdrasil: vpb bench --vpn yggdrasil --test nix-cache --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T00:02:00Z label=gap-yggdrasil rc=127`
- `START 2026-10-24T00:02:00Z label=gap-easytier: vpb bench --vpn easytier --test nix-cache --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T00:02:00Z label=gap-easytier rc=127`
- `GAPS DONE 2026-10-24T00:02:00Z`
- `GAPS START 2026-10-24T00:03:44Z nix-gc last: Sat 2026-10-24 00:00:20 UTC`
- `START 2026-10-24T00:03:44Z label=gap-hyprspace-high: vpb bench --vpn hyprspace --test all --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T01:25:48Z label=gap-hyprspace-high rc=0`
- `START 2026-10-24T01:25:48Z label=gap-hyprspace-iperf3: vpb bench --vpn hyprspace --test iperf3 --tc-profile baseline --tc-profile low --tc-profile medium --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T05:24:38Z label=gap-hyprspace-iperf3 rc=0`
- `START 2026-10-24T05:24:38Z label=gap-hyprspace-par: vpb bench --vpn hyprspace --test iperf3-parallel-tcp --tc-profile baseline --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T05:29:49Z label=gap-hyprspace-par rc=0`
- `START 2026-10-24T05:29:49Z label=gap-mycelium-iperf3: vpb bench --vpn mycelium --test iperf3 --tc-profile baseline --tc-profile low --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T06:22:26Z label=gap-mycelium-iperf3 rc=0`
- `START 2026-10-24T06:22:26Z label=gap-mycelium-nixcache: vpb bench --vpn mycelium --test nix-cache --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T07:06:05Z label=gap-mycelium-nixcache rc=0`
- `START 2026-10-24T07:06:05Z label=gap-nebula: vpb bench --vpn nebula --test iperf3-parallel-tcp --tc-profile baseline --tc-profile low --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T07:19:37Z label=gap-nebula rc=0`
- `START 2026-10-24T07:19:37Z label=gap-yggdrasil: vpb bench --vpn yggdrasil --test nix-cache --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T08:50:55Z label=gap-yggdrasil rc=0`
- `START 2026-10-24T08:50:55Z label=gap-easytier: vpb bench --vpn easytier --test nix-cache --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-24T09:33:56Z label=gap-easytier rc=0`
- `GAPS DONE 2026-10-24T09:33:56Z`
- `FIX RERUNS START 2026-10-26T18:48:10Z`
- `START 2026-10-26T18:48:10Z label=fix-nebula-a: vpb bench --vpn nebula --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-26T20:11:40Z label=fix-nebula-a rc=0`
- `START 2026-10-26T20:11:42Z label=fix-nebula-b: vpb bench --vpn nebula --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-26T22:00:30Z label=fix-nebula-b rc=0`
- `FIX RERUNS DONE 2026-10-26T22:00:31Z`
- `FIX RERUNS START 2026-10-28T11:38:07Z`
- `START 2026-10-28T11:38:07Z label=fix-easytier-a: vpb bench --vpn easytier --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-28T12:57:32Z label=fix-easytier-a rc=0`
- `START 2026-10-28T12:57:34Z label=fix-easytier-b: vpb bench --vpn easytier --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-28T14:40:04Z label=fix-easytier-b rc=0`
- `FIX RERUNS DONE 2026-10-28T14:40:06Z`
- `START 2026-10-29T21:03:47Z label=add-tincr-a: vpb bench --vpn tincr --test all --tc-profile baseline --tc-profile low --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-29T22:23:39Z label=add-tincr-a rc=0`
- `START 2026-10-30T00:05:00Z label=add-tincr-b: vpb bench --vpn tincr --test all --tc-profile medium --tc-profile high --skip-con-times --no-tui --no-sandbox --alias 22.10.2026-full-oldlock`
- `END 2026-10-30T01:48:41Z label=add-tincr-b rc=0`

## clan flake.lock (`~/.local/share/vpn_bench/clan/flake.lock`)

- clan-core rev: `fe53467dedf8a9b40e5de1f07311a3785b7b351b`
- nixpkgs rev: `e1ebeec86b771e9d387dd02d82ffdc77ac753abc`
- cvpn-bench (last relock): rev `134397254c62df9070aa43eab5250447424ce53f`, narHash `sha256-Yl0nW1YyqnieYWlFqqZfz8Es8kO+wRWl/brsNeFoVYM=`

## cvpn-bench lock per VPN (`<VPN>/baseline/timing_breakdown.json`, vpn_installation metadata)

| VPN | narHash | rev | lastModified |
|---|---|---|---|
| Easytier | `sha256-Yl0nW1YyqnieYWlFqqZfz8Es8kO+wRWl/brsNeFoVYM=` | 134397254c62df9070aa43eab5250447424ce53f | 1793186221 |
| Headscale | `sha256-sYJ3GvuhnMiVZ6JsPpy+lJcexVsOohI0E8jNLGyz588=` | 82acad98274dd23faa99c6601d5c633039e4d3b3 | 1792566461 |
| Hyprspace | `sha256-sYJ3GvuhnMiVZ6JsPpy+lJcexVsOohI0E8jNLGyz588=` | 82acad98274dd23faa99c6601d5c633039e4d3b3 | 1792566461 |
| Internal | `sha256-sYJ3GvuhnMiVZ6JsPpy+lJcexVsOohI0E8jNLGyz588=` | 82acad98274dd23faa99c6601d5c633039e4d3b3 | 1792566461 |
| Mycelium | `sha256-sYJ3GvuhnMiVZ6JsPpy+lJcexVsOohI0E8jNLGyz588=` | 82acad98274dd23faa99c6601d5c633039e4d3b3 | 1792566461 |
| Nebula | `sha256-QVe2lFtJyBkbd4GESf+Q/ya0xbpBnQ6JMsTmSlWRphI=` | 052abd9628c5e9679558a368132eb339c2940245 | 1793037920 |
| Tinc | `sha256-sYJ3GvuhnMiVZ6JsPpy+lJcexVsOohI0E8jNLGyz588=` | 82acad98274dd23faa99c6601d5c633039e4d3b3 | 1792566461 |
| Tincr | `sha256-Yl0nW1YyqnieYWlFqqZfz8Es8kO+wRWl/brsNeFoVYM=` | 134397254c62df9070aa43eab5250447424ce53f | 1793186221 |
| VpnCloud | `sha256-sYJ3GvuhnMiVZ6JsPpy+lJcexVsOohI0E8jNLGyz588=` | 82acad98274dd23faa99c6601d5c633039e4d3b3 | 1792566461 |
| Wireguard | `sha256-sYJ3GvuhnMiVZ6JsPpy+lJcexVsOohI0E8jNLGyz588=` | 82acad98274dd23faa99c6601d5c633039e4d3b3 | 1792566461 |
| Yggdrasil | `sha256-sYJ3GvuhnMiVZ6JsPpy+lJcexVsOohI0E8jNLGyz588=` | 82acad98274dd23faa99c6601d5c633039e4d3b3 | 1792566461 |
| Zerotier | `sha256-sYJ3GvuhnMiVZ6JsPpy+lJcexVsOohI0E8jNLGyz588=` | 82acad98274dd23faa99c6601d5c633039e4d3b3 | 1792566461 |

Each profile's `tc_settings.json` records the impairment method (`receiver-ifb` for Low,
Medium and High).

## VPN versions (`<VPN>/vpn_version.json`)

Added on 2026-10-30 from the `vpnVersions` output of the vpn-benchmark-suite flake. The
cvpn-bench revisions recorded in each `timing_breakdown.json` (82acad98, 052abd96, 13439725)
lock the same VPN pins: easytier, hyprspace, nebula and tincr by rev, vpncloud by rev in
`pkgs/vpncloud`, the nixpkgs VPNs through clan-core fe53467 with nixpkgs e1ebeec.

The `linux` component of `Wireguard/vpn_version.json` was added on 2026-11-04. WireGuard runs
in the kernel, and every iperf3 result of this run reports `Linux <host> 6.12.57`, the default
kernel of nixpkgs `e1ebeec`.
