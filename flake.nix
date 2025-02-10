{
  description = "<Put your description here>";

  inputs.clan-core.url = "https://git.clan.lol/clan/clan-core/archive/main.tar.gz";
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
      ];


      flake = {
        clanModules = {
          "myadmin" = ./clanModules/myadmin;
        };
        clan = {
          templates = {
            clan = {
              "vpnBenchClan" = {
                description = "VPN Bench Clan";
                path = ./templates/clan/minimal;
              };
            };
          };
        };
      };

    
    };
}
