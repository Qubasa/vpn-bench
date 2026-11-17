# Provenance of 12.11.2026-newprofiles-oldlock

The congestion and reorder profiles of `11.11.2026-newprofiles-newlock` on the old
lock: same 12 VPNs and tests (`--skip-con-times`), with the VPN versions, clan-core
(`fe53467`) and nixpkgs (`e1ebeec`) of `18.12.2025-full-oldlock`, which holds Baseline,
Low, Medium and High on this lock.
Rig: NixOS 25.11.19800101.e1ebeec, kernel 6.12.57 on lom, luna and yuki, deployed and
rebooted into with `deploy_reboot_oldlock.sh` before the run (the hosts ran the new lock).

Profiles, per direction, applied by each machine to the traffic it receives (ifb, GRO off):

- congestion: netem `delay 10ms rate 1000mbit limit 100000`, child
  `tbf rate 100mbit burst 12500 limit 250000` (100 Mbit/s bottleneck, 250 kB tail-drop
  queue, counted on encrypted wire packets).
- reorder: netem `delay 10ms rate 1000mbit limit 100000`, child
  `netem delay 1ms reorder 1% limit 100000` (1 % of packets skip the extra 1 ms).

## Commit deployed

- `a7e582b` (branch `newprofiles-oldlock`) for every VPN: `13439725`, the tree of the
  22.10 Nebula/EasyTier fix re-runs and the tincr addition, plus the profile commit
  `ea24777` cherry-picked. Its vpb Python is the profile code of the new-lock run apart
  from formatting; Baseline to High produce the same netem line as in 22.10 (plus an
  explicit `handle 1:`).
- Not backported: `65f9625`, which runs the benchmark clients in a prioritized
  `benchmark.slice`. The measurement setup equals `18.12.2025-full-oldlock`, so the
  comparison with `11.11.2026-newprofiles-newlock` differs in the VPN versions and that
  slice, as `18.12.2025-full-oldlock` vs `03.11.2026-full-newlock` does.

## Driver

`~/vpb-rig-tasks/scripts/newprofiles_oldlock.sh` (old-lock devshell), one invocation per
VPN, with the nix-gc guard of the new-lock run; it waited for 00:05 once, before
Hyprspace.

## Incidents and fixes

- Headscale: the deploy hung 2.5 h (18:08-20:39 UTC on 2026-11-12) in
  `tailscale-headscale-auth.service` on all hosts. `/var/lib/headscale/db.sqlite` on lom
  had been migrated by the new-lock headscale, and the old one refused it ("init
  database: validating schema"), so no client could log in. The state was copied to
  lom:/root/headscale-newlock-state-20261112 and removed; headscale, its setup (new user
  and preauth key) and keyserver were restarted, the clients logged in, and the same vpb
  invocation went on. Its congestion `timing_breakdown.json` therefore shows a
  9233 s vpn_installation. `deploy_reboot_oldlock.sh` now removes `/var/lib/headscale`.
- Yggdrasil, first attempt (10:44-14:47 UTC on 2026-11-13, stopped, rc=143): every test
  failed. The new-lock yggdrasil generator had regenerated `ip`, `network` and
  `public-key` in the clan vars on 2026-11-03, but the old-lock module deploys
  `yggdrasil-config`, still on the 2026-10-16 key, so `/etc/hosts` named addresses no
  node had. Clan commit `bc7f82e` restored the 2026-10-16 values (the 22.10 keys) and
  removed the new-lock `private-key-pem`. The first attempt's results and log are in
  `~/vpb-rig-tasks/backup/12.11.2026-newprofiles-oldlock-yggdrasil-wrong-hosts/`; the
  re-run (16:22-18:42 UTC) wrote this alias's `Yggdrasil/`. `deploy_oldlock.py` now
  refuses to deploy while new-lock yggdrasil vars are present.

## Error results (29, none missing)

Known mechanisms, also present in `18.12.2025-full-oldlock` or the new-lock runs, not
re-run:

- Headscale and Nebula qperf, both profiles: QUIC handshake failed.
- Mycelium UDP, both profiles: `control socket has closed unexpectedly`.
- Hyprspace UDP: 120 s timeouts (2 pairs under congestion, 3 under reorder).
- Hyprspace and Yggdrasil nix-cache under reorder, all 3 pairs: over the 700 s budget.

## Caveat

ZeroTier UDP under congestion: iperf3 `-b 0` sent about 11 Gbit/s into the ZeroTier
interface and 0.1 Mbit/s arrived (WireGuard: 0.84 Gbit/s sent, 92 Mbit/s arrived). The
value shows the collapse of unpaced UDP through ZeroTier at a 100 Mbit/s bottleneck, not
its paced UDP capacity.

## Driver start (`logs/ids_<alias>.txt`, last runner)

- alias=12.11.2026-newprofiles-oldlock
- commit_id=a7e582b94d0d811ea2e131c5243d7df22fc15bd8
- description=Add congestion and reorder impairment profiles
- dirty=0

## Run log (UTC, `logs/runs.txt`)

- `NEWPROF-OLD START 2026-11-12T16:02:30Z alias=12.11.2026-newprofiles-oldlock vpns=internal easytier headscale hyprspace mycelium nebula tinc tincr vpncloud wireguard yggdrasil zerotier`
- `START 2026-11-12T16:02:32Z label=12.11.2026-newprofiles-oldlock-internal: vpb bench --vpn internal --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-12T16:39:04Z label=12.11.2026-newprofiles-oldlock-internal rc=0`
- `START 2026-11-12T16:39:04Z label=12.11.2026-newprofiles-oldlock-easytier: vpb bench --vpn easytier --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-12T18:06:25Z label=12.11.2026-newprofiles-oldlock-easytier rc=0`
- `START 2026-11-12T18:06:25Z label=12.11.2026-newprofiles-oldlock-headscale: vpb bench --vpn headscale --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-12T22:13:46Z label=12.11.2026-newprofiles-oldlock-headscale rc=0`
- `NEWPROF-OLD WAIT 2026-11-12T22:13:46Z until 2026-11-13T00:05:00Z (nix-gc at 00:00, estimate 9720s)`
- `START 2026-11-13T00:05:00Z label=12.11.2026-newprofiles-oldlock-hyprspace: vpb bench --vpn hyprspace --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-13T02:17:08Z label=12.11.2026-newprofiles-oldlock-hyprspace rc=0`
- `START 2026-11-13T02:17:08Z label=12.11.2026-newprofiles-oldlock-mycelium: vpb bench --vpn mycelium --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-13T04:01:05Z label=12.11.2026-newprofiles-oldlock-mycelium rc=0`
- `START 2026-11-13T04:01:05Z label=12.11.2026-newprofiles-oldlock-nebula: vpb bench --vpn nebula --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-13T05:32:02Z label=12.11.2026-newprofiles-oldlock-nebula rc=0`
- `START 2026-11-13T05:32:02Z label=12.11.2026-newprofiles-oldlock-tinc: vpb bench --vpn tinc --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-13T06:57:38Z label=12.11.2026-newprofiles-oldlock-tinc rc=0`
- `START 2026-11-13T06:57:38Z label=12.11.2026-newprofiles-oldlock-tincr: vpb bench --vpn tincr --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-13T08:25:30Z label=12.11.2026-newprofiles-oldlock-tincr rc=0`
- `START 2026-11-13T08:25:30Z label=12.11.2026-newprofiles-oldlock-vpncloud: vpb bench --vpn vpncloud --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-13T10:07:23Z label=12.11.2026-newprofiles-oldlock-vpncloud rc=0`
- `START 2026-11-13T10:07:23Z label=12.11.2026-newprofiles-oldlock-wireguard: vpb bench --vpn wireguard --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-13T10:44:03Z label=12.11.2026-newprofiles-oldlock-wireguard rc=0`
- `START 2026-11-13T10:44:03Z label=12.11.2026-newprofiles-oldlock-yggdrasil: vpb bench --vpn yggdrasil --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-13T14:47:32Z label=12.11.2026-newprofiles-oldlock-yggdrasil rc=143`
- `START 2026-11-13T14:47:32Z label=12.11.2026-newprofiles-oldlock-zerotier: vpb bench --vpn zerotier --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-13T16:21:42Z label=12.11.2026-newprofiles-oldlock-zerotier rc=0`
- `NEWPROF-OLD DONE 2026-11-13T16:21:44Z alias=12.11.2026-newprofiles-oldlock`
- `NEWPROF-OLD START 2026-11-13T16:22:33Z alias=12.11.2026-newprofiles-oldlock vpns=yggdrasil`
- `START 2026-11-13T16:22:35Z label=12.11.2026-newprofiles-oldlock-yggdrasil: vpb bench --vpn yggdrasil --test all --tc-profile congestion --tc-profile reorder --skip-con-times --no-tui --no-sandbox --alias 12.11.2026-newprofiles-oldlock`
- `END 2026-11-13T18:42:05Z label=12.11.2026-newprofiles-oldlock-yggdrasil rc=0`
- `NEWPROF-OLD DONE 2026-11-13T18:42:07Z alias=12.11.2026-newprofiles-oldlock`

## clan flake.lock (`~/.local/share/vpn_bench/clan/flake.lock`)

- clan-core rev: `fe53467dedf8a9b40e5de1f07311a3785b7b351b`
- nixpkgs rev: `e1ebeec86b771e9d387dd02d82ffdc77ac753abc`
- cvpn-bench (last relock): rev `a7e582b94d0d811ea2e131c5243d7df22fc15bd8`

## cvpn-bench lock per VPN (congestion `timing_breakdown.json`, vpn_installation)

| VPN | rev | narHash | version |
|---|---|---|---|
| Easytier | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| Headscale | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| Hyprspace | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| Internal | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| Mycelium | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| Nebula | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| Tinc | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| Tincr | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| VpnCloud | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| Wireguard | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| Yggdrasil | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
| Zerotier | a7e582b94d0d811ea2e131c5243d7df22fc15bd8 | `sha256-nhKIQa5whqkXRe0exgbl/fQeCt8IIlD+6e2rymnAzdQ=` | as 18.12.2025-full-oldlock |
