{
  description = "<Put your description here>";

  # inputs.clan-core.url = "https://git.clan.lol/clan/clan-core/archive/main.tar.gz";
  inputs.clan-core.url = "https://git.clan.lol/Qubasa/clan-core/archive/vpb-patches2.zip";
  inputs.nixpkgs.follows = "clan-core/nixpkgs";
  inputs.flake-parts.url = "github:hercules-ci/flake-parts";
  inputs.flake-parts.inputs.nixpkgs-lib.follows = "nixpkgs";
  inputs.treefmt-nix.url = "github:numtide/treefmt-nix";
  inputs.treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";
  inputs.hyprspace.url = "github:hyprspace/hyprspace";
  inputs.hyprspace.inputs.flake-parts.follows = "flake-parts";
  inputs.hyprspace.inputs.nixpkgs.follows = "nixpkgs";

  outputs =
    inputs@{
      clan-core,
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
          "yggdrasil" = ./clanModules/yggdrasil;
          "vpncloud" = (lib.modules.importApply ./clanModules/vpncloud { packages = self.packages; });
          "iperf-new" = ./clanModules/iperf-new;
          "hetzner-ips-new" = ./clanModules/hetzner-ips-new;
          "my-trusted-nix-caches-new" = ./clanModules/my-trusted-nix-caches-new;
          "my-nginx-new" = ./clanModules/my-nginx-new;
          "myadmin-new" = ./clanModules/myadmin-new;
          "qperf-new" = ./clanModules/qperf-new;
          "my-static-hosts-new" = ./clanModules/my-static-hosts-new;
          "nix-cache-new" = ./clanModules/nix-cache-new;
        };
      };
    };
}
