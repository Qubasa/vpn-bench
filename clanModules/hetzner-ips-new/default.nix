{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "my-static-hosts-new";

  roles.default = {
    interface = {
      options = {
        ipAddresses = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          description = "List of IP Addresses on the WAN interface";
        };
      };
    };

    perInstance =
      { settings, ... }:
      {
        nixosModule =
          { ... }:
          {
            networking.useNetworkd = true;

            systemd.network.networks."20-wan" = {
              matchConfig = {
                Type = "ether";
              };
              address = settings.ipAddresses;
              networkConfig.DHCP = "yes";
              routes = [
                { Gateway = "fe80::1"; }
                { Destination = "172.31.1.1"; }
                {
                  Gateway = "172.31.1.1";
                  GatewayOnLink = true;
                }
              ];
            };
          };
      };

  };
}
