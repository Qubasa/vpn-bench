{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "my-nginx-new";

  roles.default = {
    interface = {
      options = {
        publicIPs = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          description = "A list of IP addresses which are allowed as server aliases";
          example = {
            "192.168.1.1" = "milo";
          };
        };

        vpnIPs = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          description = "A list of IP addresses which are allowed as server aliases";
          example = {
            "192.168.1.1" = "milo";
          };
        };
      };
    };

    perInstance =
      { settings, ... }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:
          {
            imports = [
              ../nginx
            ];

            config =
              let
                hostName = config.networking.hostName;
                serverAliases =
                  lib.attrNames settings.publicIPs
                  ++ lib.attrNames settings.vpnIPs
                  ++ [
                    "v4.${hostName}"
                    "v6.${hostName}"
                  ];
              in
              {

                # We do this to override default curl with curlHTTP3
                users.users.root = {
                  packages = [
                    pkgs.curlHTTP3
                  ];
                };

                services.nginx = {
                  enable = true;
                  package = pkgs.nginxQuic;
                  virtualHosts."vpn.${hostName}" = {
                    quic = true;
                    root = "/var/www/example";
                    serverAliases = serverAliases;
                    locations."/name" = {
                      return = "200 ${hostName}";
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
                  # {
                  #   assertion = lib.length config.systemd.services."connection-check".after == 1;
                  #   message = "connection-check detected multiple or no VPN services only one is allowed";
                  # }
                  # {
                  #   assertion = (config.clan.service ? my-static-hosts-new) == true;
                  #   message = "The my-nginx module requires the my-static-hosts module to be configured with the hostnames.";
                  # }
                ];

                systemd.services."connection-check" =
                  let

                    deps =
                      lib.optional (config.systemd.services ? "zerotierone.service") "zerotierone.service"
                      ++ lib.optional (config.systemd.services ? "mycelium.service") "mycelium.service"
                      ++ lib.optional (config.systemd.services ? "hyprspace.service") "hyprspace.service";

                  in
                  {
                    description = "Check if the connection is up";
                    wantedBy = [ "multi-user.target" ];

                    after = deps;

                    requires = deps;

                    partOf = deps;

                    environment = {
                      "VPN_IPS" = builtins.toJSON settings.vpnIPs;
                      "PUBLIC_IPS" = builtins.toJSON settings.publicIPs;
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
          };
      };

  };
}
