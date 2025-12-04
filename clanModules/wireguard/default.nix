{
  lib,
  ...
}:
let
  shared = import ./shared.nix { inherit lib; };
in
{
  _class = "clan.service";

  options.subnet = lib.mkOption {
    type = lib.types.str;
  };

  config = {
    manifest.name = "wireguard";
    roles."mesh" = {
      interface.options = shared.instanceOptions;

      perInstance =
        {
          settings,
          roles,
          instanceName,
          ...
        }:
        {
          nixosModule =
            { config, pkgs, ... }:
            let
              wgName = if settings.name != null then settings.name else config.networking.hostName;
            in
            {
              systemd.services."wireguard-${instanceName}".serviceConfig.Slice = "benchmark.slice";

              networking.firewall.allowedUDPPorts = [ settings.listenPort ];

              networking.wireguard.interfaces.${instanceName} = {
                ips = [ "${settings.address}/32" ];

                peers =
                  (lib.mapAttrsToList (
                    peerName: peer:
                    let
                      peerWgName = if peer.settings.name != null then peer.settings.name else peerName;
                    in
                    {
                      publicKey = (
                        builtins.readFile (
                          config.clan.core.settings.directory
                          + "/vars/per-machine/${peerName}/wireguard-${peerWgName}-${instanceName}/public-key/value"
                        )
                      );

                      allowedIPs = [ "${peer.settings.address}/32" ];

                      endpoint = peer.settings.endpoint;
                    }
                  ) roles."mesh".machines)
                  ++ (
                    if builtins.hasAttr "star" roles then
                      lib.mapAttrsToList (
                        peerName: peer:
                        let
                          peerWgName = if peer.settings.name != null then peer.settings.name else peerName;
                        in
                        {
                          publicKey = (
                            builtins.readFile (
                              config.clan.core.settings.directory
                              + "/vars/per-machine/${peerName}/wireguard-${peerWgName}-${instanceName}/public-key/value"
                            )
                          );

                          allowedIPs = [ "${peer.settings.address}/32" ];

                          endpoint = peer.settings.endpoint;
                        }
                      ) roles.star.machines
                    else
                      [ ]
                  );

                listenPort = settings.listenPort;

                privateKeyFile =
                  config.clan.core.vars.generators."wireguard-${wgName}-${instanceName}".files."private-key".path;
              };

              clan.core.vars.generators."wireguard-${wgName}-${instanceName}" = shared.generator {
                inherit (pkgs) wireguard-tools;
              };
            };
        };
    };

    roles."star" = {
      interface.options = shared.instanceOptions;

      perInstance =
        {
          settings,
          instanceName,
          roles,
          ...
        }:
        {
          nixosModule =
            { config, pkgs, ... }:
            let
              wgName = if settings.name != null then settings.name else config.networking.hostName;
            in
            {
              systemd.services."wireguard-${instanceName}".serviceConfig.Slice = "benchmark.slice";

              networking.firewall.allowedUDPPorts = [ settings.listenPort ];

              networking.wireguard.interfaces.${instanceName} = {
                ips = [ "${settings.address}/32" ];

                peers = (
                  lib.mapAttrsToList (
                    peerName: peer:
                    let
                      peerWgName = if peer.settings.name != null then peer.settings.name else peerName;
                    in
                    {
                      publicKey = (
                        builtins.readFile (
                          config.clan.core.settings.directory
                          + "/vars/per-machine/${peerName}/wireguard-${peerWgName}-${instanceName}/public-key/value"
                        )
                      );

                      allowedIPs = [ "${peer.settings.address}/32" ];

                      endpoint = peer.settings.endpoint;
                    }
                  ) roles."mesh".machines
                );

                listenPort = settings.listenPort;

                privateKeyFile =
                  config.clan.core.vars.generators."wireguard-${wgName}-${instanceName}".files."private-key".path;
              };

              clan.core.vars.generators."wireguard-${wgName}-${instanceName}" = shared.generator {
                inherit (pkgs) wireguard-tools;
              };
            };
        };
    };
  };
}
