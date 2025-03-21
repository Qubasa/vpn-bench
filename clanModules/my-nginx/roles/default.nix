{
  lib,
  config,
  clan-core,
  pkgs,
  ...
}:
{
  options.clan.my-nginx = {
    publicIPs = lib.mkOption {
      default = { };
      type = lib.types.attrsOf lib.types.str;
      description = "A list of IP addresses which are allowed as server aliases";
      example = { "192.168.1.1" = "milo"; };
    };


    vpnIPs = lib.mkOption {
      default = { };
      type = lib.types.attrsOf lib.types.str;
      description = "A list of IP addresses which are allowed as server aliases";
      example = { "192.168.1.1" = "milo"; };
    };
  };

  imports = [
    clan-core.clanModules.nginx
  ];


  config = {

    # We do this to override default curl with curlHTTP3
    users.users.root = {
      packages = [
        pkgs.curlHTTP3
      ];
    };

    services.nginx = {
      enable = true;
      package = pkgs.nginxQuic;
      virtualHosts."example.com" = {
        quic = true;
        root = "/var/www/example";
        serverAliases = lib.attrNames config.clan.my-nginx.publicIPs ++ lib.attrNames config.clan.my-nginx.vpnIPs;
        locations."/name" = {
          return = "200 ${config.networking.hostName}";
        };
      };
    };

  users.groups.connection-check = { };
  users.users.connection-check = {
    isSystemUser = true;
    group = "connection-check";
    createHome = true;
    home = "/var/lib/connection-check";
    homeMode = "0774";
  };


  assertions = [
    {
      assertion = lib.length config.systemd.services."connection-check".after == 1;
      message = "connection-check detected multiple or no VPN services only one is allowed";
    }
  ];

  systemd.services."connection-check" = {
    description = "Check if the connection is up";
    wantedBy = [ "multi-user.target" ];

    after =
      lib.optional (config.clan ? zerotier) "zerotierone.service"
      ++ lib.optional (config.clan ? mycelium) "mycelium.service";
    requires =
      lib.optional (config.clan ? zerotier) "zerotierone.service"
      ++ lib.optional (config.clan ? mycelium) "mycelium.service";
    partOf =
      lib.optional (config.clan ? zerotier) "zerotierone.service"
      ++ lib.optional (config.clan ? mycelium) "mycelium.service";

    environment = {
      "VPN_IPS" = builtins.toJSON config.clan.my-nginx.vpnIPs;
      "PUBLIC_IPS" = builtins.toJSON config.clan.my-nginx.publicIPs;
    };

    serviceConfig = 
    let
      pyscript = pkgs.writers.writePython3Bin "connection_check.py" {
        libraries = [ ];
        doCheck = false;
      } (builtins.readFile ./connection_check.py);
    in
    {
      Type = "oneshot";
      WorkingDirectory = "/var/lib/connection-check";
      ExecStart = lib.getExe pyscript;
    };
  };
  };

}
