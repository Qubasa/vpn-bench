{
  inputs = {
    cvpn-bench = {
      url = "__VPN_BENCH_PATH__";
    };
    nixpkgs.follows = "cvpn-bench/nixpkgs";
    clan-core.follows = "cvpn-bench/clan-core";
  };

  outputs =
    inputs@{ self, clan-core, ... }:
    let
      # Usage see: https://docs.clan.lol
      clan = clan-core.lib.clan {
        inherit self;
      };
    in
    {
      # all machines managed by Clan
      inherit (clan.config) nixosConfigurations nixosModules clanInternals;
      clan = clan.config;

      devShells =
        inputs.nixpkgs.lib.genAttrs
          [
            "x86_64-linux"
            "aarch64-linux"
            "aarch64-darwin"
            "x86_64-darwin"
          ]
          (
            system:
            let
              pkgs = clan-core.inputs.nixpkgs.legacyPackages.${system};
            in
            {
              default = pkgs.mkShell {
                packages = [
                  pkgs.python3
                  pkgs.python3Packages.argcomplete
                ];
                shellHook = ''
                  export GIT_ROOT="$(git rev-parse --show-toplevel)"
                '';
              };
            }
          );
    };
}
