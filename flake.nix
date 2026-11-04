{
  description = "A Nix flake for benchmarking mesh VPNs with Clan";

  inputs.clan-core.url = "https://git.clan.lol/clan/clan-core/archive/main.tar.gz";
  #inputs.clan-core.url = "https://git.clan.lol/Qubasa/clan-core/archive/api_fixes.tar.gz";
  inputs.old-nixpkgs.url = "github:NixOS/nixpkgs/23.05";
  inputs.nixpkgs.follows = "clan-core/nixpkgs";
  inputs.flake-parts.url = "github:hercules-ci/flake-parts";
  inputs.flake-parts.inputs.nixpkgs-lib.follows = "nixpkgs";
  inputs.treefmt-nix.url = "github:numtide/treefmt-nix";
  inputs.treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";
  inputs.hyprspace.url = "github:hyprspace/hyprspace/a0d0788b5934999a929cdfbaa769036f035bf118";
  inputs.hyprspace.inputs.flake-parts.follows = "flake-parts";
  inputs.hyprspace.inputs.nixpkgs.follows = "nixpkgs";
  inputs.tincr.url = "github:mic92/tincr/09804a637976137793e8638670422ce8aebcec19";
  inputs.tincr.inputs.nixpkgs.follows = "nixpkgs";
  inputs.easytier = {
    url = "github:EasyTier/EasyTier/24e0303fc55e4e645a11818954dd5b712fb94510";
    flake = false;
  };
  inputs.nebula = {
    url = "github:slackhq/nebula/fb4ef139cbb4af67d142c72083fb735f56460e50";
    flake = false;
  };
  inputs.vpncloud = {
    url = "github:dswd/vpncloud/bef99162fe0d66e2c9fbf6421a69ca8ec2ac8f55";
    flake = false;
  };
  inputs.zerotierone = {
    # refs/tags/: upstream also has a branch named 1.16.2, which a bare ref resolves to.
    url = "github:zerotier/ZeroTierOne/refs/tags/1.16.2";
    flake = false;
  };
  inputs.headscale = {
    url = "github:juanfont/headscale/v0.29.7";
    flake = false;
  };
  inputs.tailscale = {
    url = "github:tailscale/tailscale/v1.104.4";
    flake = false;
  };
  inputs.tinc = {
    url = "github:gsliepen/tinc/release-1.1pre18";
    flake = false;
  };
  inputs.wireguard-tools = {
    url = "git+https://git.zx2c4.com/wireguard-tools?ref=refs/tags/v1.0.20260223&exportIgnore=1";
    flake = false;
  };
  inputs.yggdrasil = {
    url = "github:yggdrasil-network/yggdrasil-go/v0.5.15";
    flake = false;
  };
  inputs.mycelium = {
    url = "github:threefoldtech/mycelium/v0.7.10";
    flake = false;
  };
  # Official apps that live outside the VPN's repository, pinned to their last commit before
  # the benchmarked VPN commit. Only the source analysis reads them.
  inputs.wireguard-apple = {
    url = "github:WireGuard/wireguard-apple/2fec12a6e1f6e3460b6ee483aa00ad29cddadab1";
    flake = false;
  };
  inputs.wireguard-android = {
    url = "github:WireGuard/wireguard-android/09b75c2bd37f749e2a8c85876394854113c74be7";
    flake = false;
  };
  inputs.wireguard-windows = {
    url = "github:WireGuard/wireguard-windows/8e6558eba6665b51de35779bffa46803dbc4c10d";
    flake = false;
  };
  inputs.tailscale-android = {
    url = "github:tailscale/tailscale-android/9b62cdc07e3e2b2981894dbd18798721902273a1";
    flake = false;
  };
  inputs.mobile-nebula = {
    url = "github:DefinedNet/mobile_nebula/97542611720d3705d7e20ffe4eb7c792c117b1ef";
    flake = false;
  };
  inputs.yggdrasil-android = {
    url = "github:yggdrasil-network/yggdrasil-android/1b921b313d983c4366207fb6c808083a30aa138b";
    flake = false;
  };
  inputs.yggdrasil-ios = {
    url = "github:yggdrasil-network/yggdrasil-ios/838e37b92834e7dd9535b1c3559464baef4ad623";
    flake = false;
  };
  inputs.myceliumflut = {
    url = "github:threefoldtech/myceliumflut/e4dbdf8c6d750eaf57919fec0e06d36619ff59fa";
    flake = false;
  };

  outputs =
    inputs@{
      flake-parts,
      self,
      ...
    }:
    let
      lib = inputs.nixpkgs.lib;
    in
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      imports = [
        inputs.clan-core.flakeModules.default
        ./treefmt.nix
        ./pkgs/vpn-bench/flake-module.nix
        ./pkgs/webview-ui/flake-module.nix
        ./pkgs/qperf/flake-module.nix
        ./pkgs/vpncloud/flake-module.nix
        ./pkgs/hyprspace-pre-generate/flake-module.nix
        ./pkgs/iperf/flake-module.nix
        ./pkgs/phantun/flake-module.nix
        ./pkgs/easytier/flake-module.nix
        ./pkgs/nebula/flake-module.nix
        ./pkgs/zerotierone/flake-module.nix
        ./pkgs/headscale/flake-module.nix
        ./pkgs/tailscale/flake-module.nix
        ./pkgs/tinc/flake-module.nix
        ./pkgs/wireguard-tools/flake-module.nix
        ./pkgs/yggdrasil/flake-module.nix
        ./pkgs/mycelium/flake-module.nix
      ];

      flake =
        let
          vpns = import ./vpn-versions.nix {
            inherit inputs;
            inherit (self) packages;
            lock = lib.importJSON ./flake.lock;
          };
        in
        {
          vpnVersions = vpns.versions;
          vpnSources = vpns.sources;
        };

      clan = {
        # specialArgs = {
        #   inherit inputs;
        # };

        templates = {
          clan = {
            "vpnBenchClan" = {
              description = "VPN Bench Clan";
              path = ./templates/clan/minimal;
            };
          };
        };

        modules = {
          "hyprspace" = (
            lib.modules.importApply ./clanModules/hyprspace {
              hyprspace = inputs.hyprspace;
              packages = self.packages;
            }
          );
          "easytier" = (
            lib.modules.importApply ./clanModules/easytier {
              packages = self.packages;
            }
          );
          "nebula" = (
            lib.modules.importApply ./clanModules/nebula {
              packages = self.packages;
            }
          );
          "zerotier" = (
            lib.modules.importApply ./clanModules/zerotier {
              packages = self.packages;
              clan-core = inputs.clan-core;
            }
          );
          "headscale" = (
            lib.modules.importApply ./clanModules/headscale {
              packages = self.packages;
            }
          );
          "rist-stream" = ./clanModules/rist-stream;
          "tinc" = (
            lib.modules.importApply ./clanModules/tinc {
              packages = self.packages;
            }
          );
          "tincr" = (
            lib.modules.importApply ./clanModules/tincr {
              tincr = inputs.tincr;
            }
          );
          "wireguard" = (
            lib.modules.importApply ./clanModules/wireguard {
              packages = self.packages;
            }
          );
          "yggdrasil" = (
            lib.modules.importApply ./clanModules/yggdrasil {
              packages = self.packages;
            }
          );
          "vpncloud" = (lib.modules.importApply ./clanModules/vpncloud { packages = self.packages; });
          "iperf-new" = ./clanModules/iperf-new;
          "benchmark-resources" = ./clanModules/benchmark-resources;
          "hetzner-ips-new" = ./clanModules/hetzner-ips-new;
          "impairment-tools" = ./clanModules/impairment-tools;
          "my-trusted-nix-caches-new" = ./clanModules/my-trusted-nix-caches-new;
          "my-nginx-new" = ./clanModules/my-nginx-new;
          "myadmin-new" = ./clanModules/myadmin-new;
          "qperf-new" = ./clanModules/qperf-new;
          "my-static-hosts-new" = ./clanModules/my-static-hosts-new;
          "nix-cache-new" = ./clanModules/nix-cache-new;
          "mycelium" = (
            lib.modules.importApply ./clanModules/mycelium {
              packages = self.packages;
            }
          );
          "phantun" = (lib.modules.importApply ./clanModules/phantun { packages = self.packages; });
          "tcp-reorder-tune" = ./clanModules/tcp-reorder-tune;
        };
      };
    };
}
