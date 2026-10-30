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
  inputs.hyprspace.url = "github:hyprspace/hyprspace/a5957e485ff0c2e9133e7da5408ec1273681688e";
  inputs.hyprspace.inputs.flake-parts.follows = "flake-parts";
  inputs.hyprspace.inputs.nixpkgs.follows = "nixpkgs";
  inputs.tincr.url = "github:mic92/tincr/b234dc798101a595adb121bab1c7cfe8cb2626a0";
  inputs.tincr.inputs.nixpkgs.follows = "nixpkgs";
  inputs.easytier = {
    url = "github:EasyTier/EasyTier/7aba65ea32d36588b64bbf19cb02142b1c72a859";
    flake = false;
  };
  inputs.nebula = {
    url = "github:slackhq/nebula/770147264da18f94e582a0b99ad08ed19c0ae9fb";
    flake = false;
  };
  inputs.vpncloud = {
    url = "github:dswd/vpncloud/bef99162fe0d66e2c9fbf6421a69ca8ec2ac8f55";
    flake = false;
  };
  inputs.zerotierone = {
    url = "github:zerotier/ZeroTierOne/1.16.0";
    flake = false;
  };
  inputs.headscale = {
    url = "github:juanfont/headscale/v0.27.0";
    flake = false;
  };
  inputs.tailscale = {
    url = "github:tailscale/tailscale/v1.88.4";
    flake = false;
  };
  inputs.tinc = {
    url = "github:gsliepen/tinc/release-1.1pre18";
    flake = false;
  };
  inputs.wireguard-tools = {
    url = "git+https://git.zx2c4.com/wireguard-tools?ref=refs/tags/v1.0.20250521&exportIgnore=1";
    flake = false;
  };
  inputs.yggdrasil = {
    url = "github:yggdrasil-network/yggdrasil-go/v0.5.12";
    flake = false;
  };
  inputs.mycelium = {
    url = "github:threefoldtech/mycelium/v0.6.1";
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
        "x86_64-darwin"
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
