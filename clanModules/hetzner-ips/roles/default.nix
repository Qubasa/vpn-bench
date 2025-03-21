{
  config,
  lib,
  ...
}:

let
  cfg = config.clan.hetzner-ips;
in
{

  options.clan.hetzner-ips = {
    ipAddresses = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      description = "List of IP Addresses on the WAN interface";
    };
  };

  config = {
  networking.useNetworkd = true;

   systemd.network.networks."20-wan" = {
      matchConfig = {
        Type = "ether";
      };
      address = cfg.ipAddresses;
      networkConfig.DHCP = "yes";
      routes = [
        { Gateway = "fe80::1"; }
        { Destination = "172.31.1.1";  }
        { Gateway = "172.31.1.1"; GatewayOnLink = true; }
      ];
    };
  };
}
