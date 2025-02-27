{
  inputs = {
    cvpn-bench = {
      url = "__VPN_BENCH_PATH__";
    };
    nixpkgs.follows = "cvpn-bench/nixpkgs";
    clan-core.follows = "cvpn-bench/clan-core";
  };

  outputs =
    { self, clan-core, ... }:
    let
      # Usage see: https://docs.clan.lol
      clan = clan-core.lib.buildClan { inherit self; };
    in
    {
      # all machines managed by Clan
      inherit (clan) nixosConfigurations clanInternals;
    };
}
