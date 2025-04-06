{
  description = "<Put your description here>";

  # inputs.clan-core.url = "https://git.clan.lol/clan/clan-core/archive/main.tar.gz";
  inputs.clan-core.url = "https://git.clan.lol/Qubasa/clan-core/archive/vpb-patches.zip";
  inputs.nixpkgs.follows = "clan-core/nixpkgs";
  inputs.flake-parts.url = "github:hercules-ci/flake-parts";
  inputs.flake-parts.inputs.nixpkgs-lib.follows = "nixpkgs";
  inputs.treefmt-nix.url = "github:numtide/treefmt-nix";
  inputs.treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";

  outputs =
    inputs@{
      clan-core,
      flake-parts,
      ...
    }:
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
      ];

      clan = {
        templates = {
          clan = {
            "vpnBenchClan" = {
              description = "VPN Bench Clan";
              path = ./templates/clan/minimal;
            };
          };
        };

        modules = {
          "iperf" = ./clanModules/iperf;
          "my-trusted-nix-caches" = ./clanModules/my-trusted-nix-caches;
          "my-nginx" = ./clanModules/my-nginx;
          "hetzner-ips" = ./clanModules/hetzner-ips;

          "myadmin-new" = ./clanModules/myadmin-new;
          "qperf-new" = ./clanModules/qperf-new;
          "my-static-hosts-new" = ./clanModules/my-static-hosts-new;
          "nix-cache-new" = ./clanModules/nix-cache-new;
        };
      };    
    };
}
