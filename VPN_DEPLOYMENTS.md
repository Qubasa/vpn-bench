# How the benchmark deploys each VPN

This file describes how `vpb` sets up every VPN in the `VPN` enum
(`pkgs/vpn-bench/vpn_bench/data.py`). The setup code is in
`pkgs/vpn-bench/vpn_bench/vpn.py`. The NixOS side is in `clanModules/<module>/`.
The packages are in `pkgs/<name>/`.

Common to all VPNs:

- All hosts are the benchmark machines. Each one has a public IPv4 address.
- Where a VPN has a server, controller, lighthouse or bootstrap role, the first
  machine in the machine list takes it. That machine is also a normal peer.
- Every VPN is built from a pinned upstream source, not from nixpkgs. See
  [VPN versions](README.md#vpn-versions) in the README. The pins below are the
  `flake.nix` inputs and the `git describe` names from `vpn-versions.nix`.
- Every VPN daemon runs in `benchmark.slice`.
- When "upstream default" appears below, the module does not set that value.

## Deployment flow

`install_vpn` in `vpn.py` runs these steps for each VPN:

1. Update the `cvpn-bench` input of the clan and record the deployed version in
   `<alias>/<VPN>/vpn_version.json`.
2. When connection timings are collected (the default), deploy all machines
   without a VPN. Then delete the state directories of all VPNs from
   `VPN.get_all_vpn_state_dirs()` on every machine, not only the ones of the VPN
   under test.
3. Write the VPN's clan inventory instance (`install_<vpn>`).
4. Get each machine's overlay IP and deploy. There are two flows:
   - **Static flow** (every VPN except Headscale, NetBird and Netmaker): the overlay
     IP is known before deployment. It is a clan vars file, or an address the
     bench sets in the inventory. The bench reads the IPs, then deploys once.
   - **Deploy-first flow** (Headscale, NetBird, Netmaker): the control server
     assigns IPs when a peer joins. The bench deploys first, then asks each
     machine for its IP over SSH, then deploys again with the Nix cache and
     connection-timing settings.

## Summary

| VPN | Topology / roles | Control server on machine 0? | Overlay addressing | Transport / port | Main systemd unit |
|---|---|---|---|---|---|
| Internal | No VPN | No | Public IPv4 | Plain IP | none |
| Zerotier | controller + moon on machine 0, others peers | Yes (controller, moon) | IPv6 RFC4193, from network ID and node ID | UDP 9993 | `zerotierone.service` |
| Mycelium | All peers, static public peers | No | IPv6 derived from key by mycelium | QUIC and TCP 9651 | `mycelium.service` |
| Hyprspace | All `server` role, peer IDs only | No | IPv6 `fd00:6879:7072:7370:6163:6500::/96`, from peer ID | libp2p TCP and QUIC, port 8001 | `hyprspace.service` |
| Yggdrasil | All peers, static QUIC peers | No | IPv6 derived from key by yggdrasil | QUIC (UDP) and TLS (TCP) 6384 | `yggdrasil.service` |
| VpnCloud | All peers, static peers | No | IPv4 in a random `10.X.0.0/16`, hash of public key | UDP 17000 | `vpncloud.service` |
| Wireguard | Static full mesh, kernel module | No | IPv4 `192.168.2.N` set by bench | UDP 6666 | none (kernel) |
| Easytier | bootstrap on machine 0, others peers | Yes (bootstrap node) | IPv6 in a random ULA `/64`, random host part | TCP and UDP 11010 | `easytier-easytier.service` |
| Nebula | lighthouse on machine 0, others peers | Yes (lighthouse) | IPv6 in a random ULA `/64`, random host part | UDP 4242 | `nebula@nebula.service` |
| Tinc | bootstrap on machine 0, others peers | Yes (bootstrap address) | IPv6 in a random ULA `/64`, random host part | TCP and UDP 655 | `tinc.tinc.service` |
| Tincr | bootstrap on machine 0, others peers | Yes (bootstrap address) | IPv6 in a random ULA `/64`, random host part | TCP and UDP 655 | `tinc.tincr.service` |
| Headscale | controller on machine 0, all peers run tailscaled | Yes (headscale) | Assigned by headscale; bench uses IPv6 | WireGuard UDP 41641, control TCP 443 | `tailscaled.service` |
| Netbird | controller on machine 0, all peers run netbird | Yes (netbird-server) | Assigned by management server; bench uses IPv4 | WireGuard UDP 51820, control TCP 443 | `netbird.service` |
| Yip | Static full mesh | No | IPv6 from public key (`yipd --addr`) | UDP 9420 | `yipd.service` |
| Cjdns | Static full mesh | No | IPv6 from key pair (`cjdnstool`) | UDP 48190 | `cjdns.service` |
| Edgevpn | Static full mesh (bootstrap peers) | No | IPv4 `10.71.0.N` set by bench | QUIC, UDP 8010 | `edgevpn.service` |
| Vnt | vnts on machine 0, all peers run vnt | Yes (vnts) | IPv4 `10.72.0.N` set by bench | P2P UDP/TCP 29873, vnts 29872 | `vnt.service` |
| Nylon | Static full mesh, latency routing | No | IPv4 `10.73.0.N`, by sorted machine name | UDP 57175 | `nylon.service` |
| WireguardGo | Static full mesh, userspace | No | IPv4 `192.168.3.N` set by bench | UDP 6667 | `wireguard-go-wireguard-go.service` |
| Netmaker | controller on machine 0, all peers run netclient | Yes (netmaker, MQTT) | Assigned by server from `10.74.0.0/16` | WireGuard UDP 51830, control TCP 8443/8883 | `netclient.service` |

`N` is the machine's position in the list plus 1 (plus 2 for VNT). The unit
names come from `get_vpn_service_name` in `bench.py`. It returns no unit for
Internal and Wireguard.

## Internal

- **What it is:** the baseline with no VPN.
- **Overlay IP:** the machine's public IPv4 from the Terraform data
  (`get_vpn_ips`), so `vpn.<name>` resolves to the same address as `v4.<name>`.
- **Version, roles, secrets:** none. No inventory instance is written.
- **State wiped:** none of its own (the step that wipes all VPN state still runs).

## Zerotier

- **Version:** input `zerotierone`, `github:zerotier/ZeroTierOne/refs/tags/1.16.2`
  (`1.16.2`). The `refs/tags/` prefix is needed because upstream also has a branch
  named `1.16.2`.
- **Module:** `clanModules/zerotier` is a thin wrapper around clan-core's
  `clanServices/zerotier`. It only swaps in the pinned package and sets
  `benchmark.slice`.
- **Package:** `pkgs/zerotierone/package.nix`, version 1.16.2. The controller
  machine gets the build with the controller code (`ZT_NONFREE=1`) through
  clan-core's wrapper, which relicenses it so the controller evaluates without
  `allowUnfree`. Peers get the build without it. Two patches are applied. Both
  only change `make-mac.mk`, so they do not affect the Linux build.
- **Roles:** machine 0 is `controller` and also `moon` with
  `stableEndpoints = [<public IPv4>]`. The other machines are `peer`. `vpn.py`
  requires the moon's IPv4 "for holepunching".
- **Discovery and relay:** the controller authorises members through clan-core's
  `zerotier-autoaccept-<instance>` unit. Root servers are not overridden, so
  ZeroTier's upstream roots are used. clan-core sets a TCP fallback relay
  (`tcpFallbackRelay = 65.21.12.51/4443`, hosted by clan) because ZeroTier's
  official TCP relay no longer works. clan-core also blacklists other overlay
  interfaces (`ygg`, `wg`, `tinc`, `mycelium`, ...) as underlay paths.
- **Encryption:** upstream default.
- **Interface, MTU, ports:** interface `zt*` (upstream naming), with the network
  name as altname. clan-core's network config sets `mtu = 2800`, IPv6 RFC4193
  assignment only, and no IPv4. TCP and UDP 9993 are open. systemd-networkd turns
  on LLDP and mDNS on the interface.
- **Secrets (clan-core generators):** `zerotier-network-<instance>` (network ID),
  `zerotier-identity-<machine>` (identity secret),
  `zerotier-ip-<machine>-<instance>` (overlay IP).
- **Overlay IP:** var `zerotier-ip-<machine>-zerotier/ip`. It is the RFC4193
  address computed from the network ID and node ID.
- **State wiped:** `/var/lib/zerotier-one`, `/etc/zerotier`.
- **Caveats:**
  - If direct UDP fails, traffic falls back to the TCP relay outside the test
    network.
  - LLDP and mDNS on the overlay add some control traffic.
  - Members can pass traffic only after the autoaccept unit has authorised them.

## Mycelium

- **Version:** input `mycelium`, `github:threefoldtech/mycelium/v0.7.10`
  (`v0.7.10`).
- **Package:** `pkgs/mycelium/package.nix`, `buildRustPackage` of `myceliumd`.
  It links the system OpenSSL instead of the vendored copy. No patches.
- **Module:** `clanModules/mycelium` is a local copy of clan-core's mycelium
  service (`manifest.name = "clan-core/mycelium"`) with its own `service.nix`.
- **Roles:** every machine is a `peer` (`tags.all`), with
  `publicAddress = <public IPv4>`, `openFirewall = true` and
  `addHostedPublicNodes = false`.
- **Discovery and relay:** each peer gets `quic://<ip>:9651` and `tcp://<ip>:9651`
  for every other machine as static peers. The hosted public nodes are not added.
  Other discovery and routing are upstream default.
- **Encryption:** upstream default.
- **Interface, MTU, ports:** interface `mycelium`. MTU upstream default. Firewall
  opens TCP 9651 and UDP 9650, 9651. Listen ports are upstream default.
- **Secrets:** generator `mycelium` (per machine). It runs the daemon for 5 s to
  create `key`, then `mycelium inspect` writes `pubkey` and `ip`.
- **Overlay IP:** var `mycelium/ip`, the IPv6 mycelium derives from the key.
- **State wiped:** `/var/lib/mycelium`, `/var/lib/private/mycelium/`.
- **Caveats:** mycelium routes over its overlay, so traffic may go through another
  bench node (upstream behaviour, not configured).

## Hyprspace

- **Version:** input `hyprspace`, `github:hyprspace/hyprspace/a0d0788b`
  (`v0.15.0+2`). Built by its own flake (`buildGoModule`, `CGO_ENABLED=0`).
- **Extra package:** `pkgs/hyprspace-pre-generate`, a small Go tool used only by
  the vars generator to compute the overlay IP.
- **Module:** `clanModules/hyprspace` uses the upstream NixOS module
  `hyprspace.nixosModules.default`.
- **Roles:** every machine has the `server` role (`tags.all`). On Hetzner the bench
  sets `blockRfc1918Addresses = true`, which adds a systemd `IPAddressDeny` for
  10/8, 172.16/12 and 192.168/16. Hetzner sends abuse reports for connections to
  those ranges.
- **Discovery and relay:** the config lists only the peer IDs of the other
  machines, read from their `hyprspace/peer-id` vars. No addresses are configured.
  `bootstrapPeers` is left at the upstream default (public libp2p and Hyprspace
  bootstrap nodes). Relay and NAT traversal are upstream default.
- **Encryption:** upstream default (libp2p transport security).
- **Interface, MTU, ports:** interface `hyprspace` (upstream default). MTU
  upstream default. TCP and UDP 8001 (upstream default listen addresses).
- **Deviation:** an `ExecStartPre` runs
  `systemd-networkd-wait-online --any --ipv4 --operational-state=routable --timeout=120`.
  Hyprspace 0.15 binds to the addresses present at start and never re-listens.
  clan-core disables wait-online, so after a reboot it listened only on loopback
  and its tunnel address.
- **Secrets:** generator `hyprspace` (per machine): `private-key`, `peer-id`, `ip`.
  `hyprspace init` creates the key. `hyprspace-pre-generate <peer ID>` writes `ip`.
- **Overlay IP:** var `hyprspace/ip`, `fd00:6879:7072:7370:6163:6500:XXXX:XXXX`,
  with the last 32 bits computed from the peer ID.
- **State wiped:** `/var/lib/hyprspace`.
- **Caveats:**
  - Peers find each other's addresses through public bootstrap nodes and the DHT,
    so connection setup needs internet access and causes external control traffic.
  - Start can be delayed by up to 120 s by the wait-online step.

## Yggdrasil

- **Version:** input `yggdrasil`, `github:yggdrasil-network/yggdrasil-go/v0.5.15`
  (`v0.5.15`).
- **Package:** `pkgs/yggdrasil/package.nix`, `buildGoModule` of `yggdrasil`,
  `yggdrasilctl` and `genkeys`. The admin socket default is set to
  `unix:///var/run/yggdrasil/yggdrasil.sock` with `-X`. No patches.
- **Module:** `clanModules/yggdrasil` uses the NixOS `services.yggdrasil` module
  with the pinned package.
- **Roles:** every machine is a `peer` (`tags.all`). The bench gives each the full
  list of machines as `quic://<public IPv4>:6384` peers. The list includes the
  machine itself.
- **Discovery and relay:** static QUIC peers. `AllowedPublicKeys` is the set of all
  peers' public keys. Multicast is on except on Hetzner (`enableMulticast` is false
  there). Other keys keep the `yggdrasil -genconf` defaults.
- **Encryption:** upstream default.
- **Interface, MTU, ports:** `IfName` and `IfMTU` are upstream default. Listens on
  `quic://` and `tls://` port 6384, IPv4 and IPv6. Firewall opens TCP and UDP 6384.
- **Secrets:** generator `yggdrasil` (per machine): `private-key-pem`,
  `public-key`, `ip`, `network`, from `yggdrasil -genconf` and `-useconf`.
- **Overlay IP:** var `yggdrasil/ip`, the address yggdrasil derives from the key.
- **State wiped:** `/var/lib/yggdrasil`.
- **Caveats:** Yggdrasil is a routed mesh, so traffic can be forwarded through
  another bench node (upstream behaviour).

## VpnCloud

- **Version:** input `vpncloud`, `github:dswd/vpncloud/bef99162` (`v2.3.0+11`).
- **Package:** `pkgs/vpncloud/package.nix`, `buildRustPackage`. No patches, no
  features, no profile changes.
- **Module:** `clanModules/vpncloud` with its own `service.nix`, a single-instance
  unit instead of upstream's `vpncloud@.service`.
- **Roles:** every machine is a `peer` (`tags.all`) with
  `peerIps = [<public IPv4>:17000, ...]` for all machines.
- **Discovery and relay:** static `--peer` list and a `--trusted-key` list of all
  peers' public keys. No controller.
- **Encryption:** upstream default.
- **Interface, MTU, ports:** interface name, mode and MTU are upstream default.
  UDP 17000. The address is passed as `--ip <ip>/16`.
- **Secrets:** generator `vpncloud-ula` (shared, a random `10.X.0.0/16`) and
  generator `vpncloud` (per machine: `private-key`, `public-key`, `ip`). The module
  asserts that all IPs are unique.
- **Overlay IP:** var `vpncloud/ip`. `ipgenv4.py` takes the first 8 bytes of the
  SHA-256 of the public key, modulo the usable hosts of the shared `/16`.
- **State wiped:** `/var/lib/vpncloud`.
- **Caveats:**
  - The unit has `TasksMax = 10`.
  - The private key is on the command line, so `systemctl show` reveals it
    (FIXME in `service.nix`).
  - It logs to `/var/log/vpncloud.log`.

## Wireguard

- **Version:** the data plane is the Linux kernel module of the nixpkgs kernel.
  Only `wireguard-tools` is pinned: input `wireguard-tools`,
  `git.zx2c4.com/wireguard-tools` tag `v1.0.20260223`. `vpn-versions.nix` records
  the kernel version as the `linux` component.
- **Package:** `pkgs/wireguard-tools/package.nix`. A nixpkgs overlay in the module
  replaces `pkgs.wireguard-tools` with it. No patches.
- **Module:** `clanModules/wireguard` on top of NixOS `networking.wireguard`.
- **Roles:** every machine is in the `mesh` role of instance `wireguard-all`, with
  `endpoint = <public IPv4>:6666` and `address = 192.168.2.N`.
- **Discovery and relay:** none. Every peer has a static endpoint, public key and
  `AllowedIPs = <address>/32`.
- **Encryption:** WireGuard's fixed protocol. Nothing is configurable.
- **Interface, MTU, ports:** interface `wireguard-all` (the instance name). MTU,
  `persistentKeepalive` and preshared keys are upstream default. UDP 6666.
- **Secrets:** generator `wireguard-<machine>-wireguard-all` (per machine):
  `private-key`, `public-key` from `wg genkey`/`wg pubkey`.
- **Overlay IP:** `192.168.2.N`, hardcoded in `vpn.py` (marked TODO).
- **State wiped:** none (no state directory).
- **Caveats:** there is no daemon process. `get_vpn_service_name` returns none, so
  no per-process data is collected for it.

## Easytier

- **Version:** input `easytier`, `github:EasyTier/EasyTier/24e0303f`
  (`v2.7.0+75`).
- **Package:** `pkgs/easytier/package.nix`, `buildRustPackage` with upstream
  default features (which include `quic`). Links with `mold`, as upstream's
  `.cargo/config.toml` asks. Tests are off. No patches.
- **Module:** `clanModules/easytier` on top of the nixpkgs `services.easytier`
  module.
- **Roles:** machine 0 is `bootstrap` with its public IPv4. The others are `peer`.
  Both roles run the same daemon.
- **Discovery and relay:** every machine dials each bootstrap node over both
  `tcp://<ip>:11010` and `udp://<ip>:11010`. After that, peers find each other
  through EasyTier's own peer exchange and hole punching (upstream default).
  Relay settings are upstream default.
- **Encryption:** upstream default, with a shared network secret.
- **Interface, MTU, ports:** interface `easytier` (instance name, max 15 chars).
  Network name `easytier4`. MTU upstream default. Listens on TCP and UDP 11010.
  The firewall also opens TCP and UDP 11011.
- **Addressing:** `ipv6 = <generated ip>/64` and `dhcp = true` (IPv4 from
  EasyTier at runtime).
- **Secrets:** `easytier-easytier-key` (shared, 32-char network secret),
  `easytier-easytier-ula` (shared, random ULA prefix), `easytier-easytier`
  (per machine, `ip`).
- **Overlay IP:** var `easytier-easytier/ip`. `ipgenv6.py` makes a random
  `fdXX:XXXX:XXXX:0001::/64` and a random 64-bit host part.
- **State wiped:** `/var/lib/easytier`.
- **Deviations:**
  - Dialing over both TCP and UDP. With TCP only, the pairs with the bootstrap
    node never got a UDP link and ran TCP-in-TCP. EasyTier does not hole-punch to
    a peer it is already connected to.
  - `Restart = always`, because EasyTier sometimes exits with 0 when it cannot
    connect (EasyTier issue #1167).
- **Caveats:** the secret is written to `/run/secrets` by a unit tied to
  `sysinit-reactivation.target`, so EasyTier restarts on every activation.

## Nebula

- **Version:** input `nebula`, `github:slackhq/nebula/fb4ef139` (`v1.12.0`).
- **Package:** `pkgs/nebula/package.nix`, `buildGoModule` of `nebula` and
  `nebula-cert`, built with Go 1.27 because `go.mod` requires Go >= 1.27.3.
  No patches.
- **Module:** `clanModules/nebula` on top of the NixOS `services.nebula` module.
- **Roles:** machine 0 is `lighthouse` with `publicAddress = <public IPv4>`. The
  others are `peer`.
- **Discovery and relay:** every node has the lighthouse in `staticHostMap` as
  `<public IPv4>:4242`. Peers learn each other's addresses from the lighthouse.
  No relay nodes are configured. Punchy is upstream default.
- **Encryption:** upstream default (no `cipher` set). Certificates are format v2.
- **Interface, MTU, ports:** network `nebula`, interface from the NixOS module
  default. MTU upstream default. `listen.port = 4242` on every node. The Nebula
  firewall allows any traffic in and out.
- **Secrets:** `nebula-nebula-ca` (shared CA, 99 years), `nebula-nebula-ula`
  (shared ULA prefix), `nebula-nebula` (per machine: `node-key`, `node-crt`, `ip`).
- **Overlay IP:** var `nebula-nebula/ip`, random host part in a random ULA `/64`
  (`ipgenv6.py`).
- **State wiped:** `/var/lib/nebula`.
- **Deviation:** `listen.port = 4242` instead of a random port on non-lighthouses.
  With a random port the firewall did not open it, and peer traffic was dropped
  once the conntrack entry expired.
- **Caveats:** every node certificate has the same name (the instance name).

## Tinc

- **Version:** input `tinc`, `github:gsliepen/tinc/release-1.1pre18`
  (`release-1.1pre18`).
- **Package:** `pkgs/tinc/package.nix`, autotools build with OpenSSL, LZO and zlib.
  `prePatch` writes the version string so the build does not need git. No patches.
- **Module:** `clanModules/tinc` on top of the NixOS `services.tinc` module.
- **Roles:** machine 0 is `bootstrap` with `publicAddress = <public IPv4>`. The
  others are `peer`.
- **Discovery and relay:** every machine has a host entry for every other machine
  with keys and `Subnet`. Only the bootstrap host has an `Address`. No `ConnectTo`
  is set. `LocalDiscovery` is commented out, so it is upstream default.
- **Encryption:** upstream default. Both Ed25519 and 4096-bit RSA keys exist.
- **Interface, MTU, ports:** interface `tinc.tinc`, TUN mode. MTU and PMTU
  discovery upstream default. Firewall opens TCP and UDP 655.
  `StrictSubnets = yes`. Custom `tinc-up` adds the `/128` address and a route
  for the ULA `/64`.
- **Secrets:** `tinc-tinc-ula` (shared ULA prefix), `tinc-tinc` (per machine:
  Ed25519 and RSA key pairs, `ip`) from `tinc generate-keys 4096`.
- **Overlay IP:** var `tinc-tinc/ip`, random host part in a random ULA `/64`.
- **State wiped:** `/etc/tinc` (shared with Tincr).

## Tincr

- **Version:** input `tincr`, `github:mic92/tincr/09804a63` (no release tag,
  `09804a6`). Built by its own flake (package `tincd`).
- **Package:** crane build of `tincd` and `tinc-tools`. On x86_64 the plain
  `tincd` package uses upstream's `target-cpu=x86-64-v3` (AVX2) and frame
  pointers. The release profile uses thin LTO and one codegen unit (upstream
  `Cargo.toml`). No patches from this repo.
- **Module:** `clanModules/tincr` uses the NixOS `services.tinc` module with the
  tincr package, not tincr's own NixOS module. It is the same setup as Tinc
  (roles, host entries, `StrictSubnets`, `tinc-up`, ports) with these
  differences:
  - Ed25519 only: `rsaPrivateKeyFile = null`, no RSA keys in host entries.
    tincr is SPTPS-only.
  - No `LocalDiscovery` line.
- **Interface, ports:** interface `tinc.tincr`, TCP and UDP 655.
- **Secrets:** `tincr-tincr-ula` (shared ULA prefix), `tincr-tincr` (per machine:
  Ed25519 key pair from `sptps_keypair`, `ip`).
- **Overlay IP:** var `tincr-tincr/ip`, random host part in a random ULA `/64`.
- **State wiped:** `/etc/tinc` (shared with Tinc).
- **Caveats:** the binary needs an AVX2 CPU.

## Headscale

- **Version:** inputs `tailscale` (`github:tailscale/tailscale/v1.104.4`, the
  client that carries traffic) and `headscale` (`github:juanfont/headscale/v0.29.7`).
- **Packages:**
  - `pkgs/tailscale`: Go 1.27, `CGO_ENABLED=0`, tag `ts_include_cli`, tests off
    (they fail in the sandbox). Vendored `./tool` is removed.
  - `pkgs/headscale`: Go 1.27. `postPatch` sets the version string, because
    headscale reads it from Go build info, which is empty here.
- **Roles:** machine 0 is `controller` (headscale) and also a peer. All machines
  run `tailscaled`.
- **Controller:** headscale on TCP 443 with a self-signed TLS cert, SQLite,
  sequential IP allocation from `100.64.0.0/10` and a ULA `/48`. The policy file
  is disabled (all traffic allowed). A setup unit creates a reusable preauth key.
  A keyserver serves it over plain HTTP on port 8081.
- **Join:** unit `tailscale-headscale-auth` fetches the key and runs
  `tailscale up --login-server=... --authkey=... --reset`.
- **Discovery and relay:** the DERP map is Tailscale's public one
  (`controlplane.tailscale.com/derpmap/default`). The embedded DERP server is not
  enabled. NAT traversal is upstream default.
- **Encryption:** upstream default (WireGuard).
- **Interface, MTU, ports:** interface `ts-headscale`. MTU upstream default.
  UDP 41641 on all peers. Controller opens TCP 443, 8081 and UDP 3478.
- **DNS:** MagicDNS on with base domain `headscale.local`, `override_local_dns = false`.
- **Secrets:** `headscale-headscale-ula` (shared prefix), `headscale-headscale-tls`
  (shared self-signed RSA 4096 cert). The preauth key is runtime state.
- **Overlay IP:** assigned by headscale. The bench reads it with
  `tailscale ip -6` (deploy-first flow).
- **State wiped:** `/var/lib/headscale`, `/var/lib/tailscale`.
- **Caveats:** relayed paths go through Tailscale's public DERP servers, outside the
  test network.

## Netbird

- **Version:** input `netbird`, `github:netbirdio/netbird/v0.83.1` (`v0.83.1`).
- **Package:** `pkgs/netbird/package.nix` builds `client` and `combined`
  (management, signal, relay, STUN and embedded IdP in one `netbird-server`).
  Tag `production`. Tests are off (they need network). `postPatch`:
  - The daemon socket path matches systemd's `RuntimeDirectory=netbird`.
  - The management server no longer polls `pkgs.netbird.io` for releases. It has
    no setting to turn that off.
- **Roles:** machine 0 is `controller` and also a peer. All machines run the
  client.
- **Controller:** `netbird-server.service` on TCP 443, STUN on UDP 3478, SQLite,
  self-signed EC P-256 TLS. Anonymous metrics, GeoLite updates and geolocation are
  off. A setup unit creates a reusable setup key. A keyserver serves it over plain
  HTTP on port 8081.
- **Join:** `netbird-join.service` runs `netbird up` with the setup key and waits
  until `netbird status --ipv4` has an address (up to 900 s).
- **Discovery and relay:** signal, relay and STUN are on the controller. Relay
  policy and ICE options are upstream default.
- **Encryption:** upstream default (WireGuard). Rosenpass is not set.
- **Interface, MTU, ports:** interface `wt0`. MTU upstream default. UDP 51820 on
  all peers.
- **Deviations:**
  - `NB_LAZY_CONN=false`. Lazy connections would leak setup time into latency
    and reconnect measurements.
  - DNS is disabled; the bench uses static host entries.
  - `ManagementURL` is preset so a fresh daemon does not dial `api.netbird.io`.
- **Secrets:** `netbird-netbird-tls` (shared cert), `netbird-netbird-server`
  (controller only: `auth-secret`, `encryption-key`, `owner-password`). The
  setup key and PAT are runtime state.
- **Overlay IP:** assigned by the management server (upstream default range). The
  bench reads it with `netbird status --ipv4` (deploy-first flow).
- **State wiped:** `/var/lib/netbird`, `/var/lib/netbird-server` (a client's login
  belongs to the server's account).
- **Caveats:** the control plane and relay share machine 0 with a benchmark peer.
  qperf fails on every pair (all profiles of `17.11.2026-newvpns-newlock`). The qperf
  server sends with UDP GSO (`-g`), and quicly sends 1280-byte UDP payloads. Over
  IPv4 that is 1308 bytes, more than the 1280 MTU of `wt0`, and GSO segments are
  not fragmented, so the server's `sendmsg` fails with "Message too long". QUIC
  applications that send 1200-byte datagrams (1228 bytes over IPv4) fit.

## Yip

- **Version:** input `yip`, `github:femboyisp/yip/2872934d` (`v0.1.0+69`). There
  is no release since v0.1.0. `main` carries the multi-core and AF_XDP data plane.
- **Package:** `pkgs/yip/package.nix`, `buildRustPackage` of the `yipd` crate only
  (it includes the `yipd ctl` client). Vendored BoringSSL is built with cmake.
  Privileged tests are skipped. No patches.
- **Roles:** every machine is a `peer` with `publicAddress = <public IPv4>`.
- **Discovery and relay:** static full mesh. Each peer has a `[peer]` block with
  public key and `endpoint = <ip>:9420` for every other machine.
- **Encryption, MTU, FEC:** upstream default.
- **Interface, ports:** interface `yip0`. UDP 9420. `LimitMEMLOCK=infinity`.
- **Secrets:** generator `yip-yip` (per machine): `private`, `public`, `ip` from
  `yipd --genkey` and `yipd --addr`.
- **Overlay IP:** var `yip-yip/ip`, derived from the public key by yipd. yipd
  installs a route for `fd00::/8`.
- **State wiped:** none. yipd keeps no state; its config is in `/run/yipd`.

## Cjdns

- **Version:** input `cjdns`, `github:cjdelisle/cjdns/cjdns-v22.3`
  (`cjdns-v22.3`).
- **Package:** `pkgs/cjdns/package.nix`, version 22.3. Patches:
  - `system-libsodium.patch`: build against the system libsodium instead of
    searching for a vendored one.
  - `event-loop-glock.patch`: upstream bug. cjdroute's config client keeps running
    C code without the global lock after its first event loop. It races the tokio
    UDP threads and segfaults on most starts.
  - Some GCC warnings are not treated as errors. Doctests and two crypto tests are
    skipped.
- **Roles:** every machine is a `peer` with `publicAddress = <public IPv4>`.
- **Discovery and relay:** static `connectTo` for every other machine on
  `<ip>:48190`, authenticated with a shared password. LAN beacons are off
  (`beacon = 0`). No supernodes, DNS seeds or public peers.
- **Encryption:** upstream default.
- **Interface, MTU, ports:** TUN `cjdns`. MTU upstream default. UDP 48190. The
  admin API listens on `127.0.0.1:11234`.
- **Secrets:** `cjdns-cjdns-password` (shared peering password), `cjdns-cjdns`
  (per machine: `private-key`, `public-key`, `ip` from `cjdnstool util keygen`).
- **Overlay IP:** var `cjdns-cjdns/ip`, the IPv6 cjdns derives from the key pair.
- **State wiped:** none. Keys come from clan vars, the config is in `/run/cjdns`.
- **Deviation:** logging is off (no `logTo`) so the debug log does not flood the
  journal during benchmarks.
- **Caveats:** the unit restarts every 1 s with no start limit, so crash loops do
  not stop the unit. qperf fails on every pair (all profiles of
  `17.11.2026-newvpns-newlock`) for the same reason as NetBird: quicly's 1280-byte
  UDP payloads are 1328 bytes over IPv6, more than the 1304 MTU, and the GSO
  server's `sendmsg` fails with "Message too long". Fragmented UDP without GSO
  crosses the tunnel, and 1200-byte QUIC datagrams (1248 bytes) fit. nix-cache
  timed out (700 s) on all three pairs under High.

## Edgevpn

- **Version:** input `edgevpn`, `github:mudler/edgevpn/v0.37.0` (`v0.37.0`).
- **Package:** `pkgs/edgevpn/package.nix`, `buildGoModule`, tests off (they start
  libp2p nodes and TUN devices). It builds an extra helper binary,
  `edgevpn-keygen` (from `pkgs/edgevpn/keygen.go`), that the vars generator uses.
  `postPatch` adds an empty web UI placeholder so the embed works without an npm
  build. The UI and API are never served.
- **Roles:** every machine is a `peer` with its public IPv4 and
  `address = 10.71.0.N`.
- **Transport:** QUIC only, `/ip4/0.0.0.0/udp/8010/quic-v1`. With TCP also offered,
  simultaneous dials put each pair randomly on QUIC or TCP (TCP-in-TCP), so
  results were not comparable.
- **Discovery and relay:** every other peer is passed as
  `--discovery-bootstrap-peers`, which makes them gossipsub direct peers. All of
  these are off: `--dht`, `--mdns`, `--autorelay`, `--relay-service`,
  `--holepunch`, `--natservice`, `--natmap`.
- **Encryption:** the libp2p QUIC transport. The shared network config holds the
  OTP keys that seal ledger messages.
- **Interface, MTU, ports:** interface `edgevpn0`. MTU upstream default (1200).
  UDP 8010.
- **Deviation:** `ExecStartPre` runs
  `systemd-networkd-wait-online --any --ipv4 --operational-state=routable --timeout=120`.
  clan-core disables wait-online. edgevpn dials its peers once at start, then
  only on gossipsub's reconnect about every 5 min, so a node whose first dials
  fail would stay cut off.
- **Secrets:** `edgevpn-edgevpn-network` (shared, `edgevpn -g` network config),
  `edgevpn-edgevpn` (per machine: `privkey`, `peer-id` from `edgevpn-keygen`).
- **Overlay IP:** `10.71.0.N`, set by the bench in the inventory (`/16`).
- **State wiped:** none. The ledger is in memory, the identity in clan vars.
- **Caveats:** a peer whose `peer-id` var does not exist yet at evaluation time is
  left out of the others' bootstrap lists. qperf fails on every pair (all profiles of
  `17.11.2026-newvpns-newlock`): QUIC requires UDP payloads of at least 1200 bytes
  (RFC 9000, section 14), 1228 bytes over IPv4, which do not fit through the 1200
  MTU. No QUIC application works over EdgeVPN's default MTU.

## Vnt

- **Version:** inputs `vnt` (`github:vnt-dev/vnt/v2.0.12`, the client) and `vnts`
  (`github:vnt-dev/vnts/v2.0.9`, the server).
- **Packages:**
  - `pkgs/vnt/package.nix` builds only `vnt2_cli` and `vnt2_ctrl`, without
    default features plus `vnt-ipc`.
  - `pkgs/vnt/vnts.nix` builds `vnts2`. The web UI is a placeholder because
    `web_bind` is never set.
  - Both replace the vendored `protoc` with nixpkgs' `protoc`, because the
    prebuilt one cannot run in the sandbox.
  - Both use upstream's size-optimised release profile (`opt-level = 'z'`, LTO,
    one codegen unit). The package does not override it.
- **Roles:** machine 0 is `server` (vnts) and also a peer. All machines run the
  client with `ip = 10.72.0.N`.
- **Server:** vnts on port 29872 for TLS over TCP and QUIC. Network
  `10.72.0.0/24`; its gateway takes `.1`. `white_list` contains only our network
  code. No persistence.
- **Discovery and relay:** each client connects to `quic://<machine 0>:29872` and
  pins the server cert by SHA-256 fingerprint. Every other peer is listed as
  `udp://<ip>:29873`. Hole punching is off (`no_punch = true`), because it
  discovers public addresses through hardcoded public STUN servers. vnts would
  relay if a direct link failed.
- **Encryption:** ChaCha20-Poly1305, keyed from the shared `password`.
- **Interface, MTU, ports:** interface `vnt0`. MTU upstream default (1380 in
  `vnt-core`). Tunnel on UDP and TCP 29873. Control port `11233` set explicitly,
  because with the implicit default the client writes a `PORT` file into the
  read-only store.
- **Secrets:** `vnt-vnt-network` (shared: `network-code`, `password`),
  `vnt-vnt-server` (machine 0: self-signed P-256 `key`, `cert`, `fingerprint`).
- **Overlay IP:** `10.72.0.N` with `N` = position + 2, set by the bench.
- **State wiped:** `/var/lib/vnt`, `/var/lib/vnts` (log directories).
- **Caveats:**
  - The network is a fixed `/24`, so at most 253 machines fit (`.2` to `.254`).
  - vnts logs the network code in plain text at info level on each registration
    (upstream `src/server/control_server/handler.rs`). The logs are in
    `/var/lib/vnts/logs`.
  - Peers fail evaluation until the server fingerprint var exists.

## Nylon

- **Version:** input `nylon`, `github:encodeous/nylon/v0.4.7` (`v0.4.7`).
- **Package:** `pkgs/nylon/package.nix`, `buildGoModule` of the CLI only, tests off
  (they need docker and root). No patches.
- **Roles:** every machine is a `peer` with `publicAddress = <public IPv4>`.
- **Topology:** the central config lists every machine as a router with its
  endpoint `<ip>:57175`. One `graph` line connects all of them, so every pair has a
  direct tunnel. There is no `dist` section, so nylon never fetches config bundles.
- **Routing:** nylon picks routes by measured latency (Babel-style). It forwards in
  userspace.
- **Encryption:** upstream default, WireGuard in nylon's `polyamide` fork of
  wireguard-go.
- **Interface, MTU, ports:** interface `nylon`. MTU upstream default. UDP 57175.
- **Secrets:** generator `nylon-nylon` (per machine): `private`, `public`, `ip`.
  The vars are regenerated when the address changes.
- **Overlay IP:** var `nylon-nylon/ip`. The address is
  `10.73.<h/256>.<h%256>`, where `h` is the machine's index in the sorted machine
  names plus 1.
- **State wiped:** none. Keys come from clan vars, the config is in `/run/nylon`.
- **Caveats:**
  - Until a link has 15 one-second probes, its metric is a fixed placeholder. So
    for about 15 to 100 s after a start or restart, some pairs are relayed through
    a third node. Later, nylon can also switch to a relayed path if a direct link
    gets slower.
  - Because of this, `wait_for_direct_routes` in `bench.py` polls
    `nylon status --interface nylon --json` on every machine before the first test
    of each tc profile and after every VPN restart. It waits until every selected
    route's next hop is the destination, for up to 300 s. Then it tests anyway with
    a warning.
  - Probes (every 1 s) and route updates travel inside the tunnel.

## WireguardGo

- **Version:** input `wireguard-go`, `git.zx2c4.com/wireguard-go` tag
  `0.0.20250522`, plus the same pinned `wireguard-tools` as Wireguard.
- **Package:** `pkgs/wireguard-go/package.nix`, `buildGoModule`. `postPatch`
  deletes `format_test.go`, because its gofmt check depends on the exact Go
  version. The binary is renamed to `wireguard-go`.
- **Roles:** every machine is in the `mesh` role with
  `endpoint = <public IPv4>:6667` and `address = 192.168.3.N`.
- **Data plane:** userspace. The unit runs `wireguard-go -f wggo0` in the
  foreground. `wg setconf` configures it through the UAPI socket. The kernel
  WireGuard module is not used.
- **Discovery and relay:** none. Static endpoints, `AllowedIPs = <address>/32`.
  No keepalive.
- **Encryption:** WireGuard's fixed protocol.
- **Interface, MTU, ports:** TUN `wggo0`. MTU upstream default (wireguard-go
  `DefaultMTU`). UDP 6667.
- **Secrets:** generator `wireguard-go-wireguard-go` (per machine): `private-key`,
  `public-key`. The private key is set from a credential and never enters the
  store.
- **Overlay IP:** `192.168.3.N`, set by the bench in the inventory (`/24`).
- **State wiped:** none. The TUN device and UAPI socket go away with the process.

## Netmaker

- **Version:** inputs `netclient` (`github:gravitl/netclient/v1.7.0`, the client
  that carries traffic) and `netmaker` (`github:gravitl/netmaker/v1.7.0`).
- **Packages:**
  - `pkgs/netmaker/package.nix`: community edition (no `ee` tag). `postPatch`
    removes the public-IP lookups (ifconfig.me, ipify, ipinfo), turns off
    geolocation, and seeds the default tenant settings from the environment.
    Upstream hardcodes telemetry to PostHog, auto-update, Google STUN and host DNS
    management there.
  - `pkgs/netmaker/netclient.nix`: `CGO_ENABLED=0` like upstream releases, kernel
    WireGuard via netlink. The vendored geolocation lookup is patched out too.
- **Roles:** machine 0 is `controller` and also a peer. All machines run
  `netclient`.
- **Controller:** Mosquitto broker (`netmaker-mqtt`, TLS on 8883, local plain on
  1883), the netmaker server (SQLite, API on 8091), and `socat` for TLS on 8443
  in front of the API. Telemetry, auto-update, DNS, STUN, endpoint detection and
  the metrics exporter are off. `netmaker-setup` creates the network with range
  `10.74.0.0/16` and `defaultmtu: 1420`.
- **Join:** before the daemon starts, `netclient.service` fetches the enrollment
  token with the master key and runs
  `netclient join -t <token> -e <public IPv4> -p 51830`. This keeps an unjoined
  daemon from looking up its public IP through public services.
- **Discovery and relay:** peers learn each other from the server over MQTT and
  HTTPS. Endpoints are static (the public IPv4).
- **Encryption:** kernel WireGuard.
- **Interface, MTU, ports:** interface `netmaker` (netclient's default, because
  `netclient join -I` rejects existing names and breaks re-joining). MTU 1420, set
  on the network because Netmaker would default to 1280. UDP 51830. The
  controller opens TCP 8443 and 8883.
- **Secrets:** `netmaker-netmaker-tls` (shared self-signed cert),
  `netmaker-netmaker-network` (shared `master-key`), `netmaker-netmaker-server`
  (controller only: `mq-password`).
- **Overlay IP:** assigned by the server. The bench reads the IPv4 of interface
  `netmaker` with `ip -4 -json address show dev netmaker` (deploy-first flow).
- **State wiped:** `/etc/netclient`, `/var/lib/netmaker` (a client's registration
  belongs to the server's database).
- **Caveats:**
  - Every peer holds the master key (admin access to the server). This avoids an
    unauthenticated token endpoint.
  - netclient keeps an MQTT connection to the broker and checks in over HTTPS
    every few minutes, so there is ongoing control traffic.
  - netclient turns on IPv4 and IPv6 forwarding and creates its own iptables
    chains (`netmakerfilter`, `netmakernat`, `NETMAKER-ACL-*`).
  - `netmaker-setup` only creates the network if it is missing, so an existing
    network keeps its old MTU and range.
