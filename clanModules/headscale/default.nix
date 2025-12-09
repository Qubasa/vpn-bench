{
  clanLib,
  config,
  lib,
  directory,
  ...
}:
{
  _class = "clan.service";
  manifest.name = "headscale";
  manifest.description = "Headscale - Self-hosted Tailscale control server for mesh VPN networking";
  manifest.categories = [ "Utility" ];

  exports = lib.mapAttrs' (instanceName: _: {
    name = clanLib.buildScopeKey {
      inherit instanceName;
      serviceName = config.manifest.name;
    };
    value = {
      networking.priority = 900;
    };
  }) config.instances;

  roles.controller = {
    description = "The headscale server that manages the Tailscale network. Must be publicly reachable.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = ''
          The public IP address or domain name that other peers will use to connect to this headscale server.
        '';
        example = "headscale.example.com";
      };
      port = lib.mkOption {
        type = lib.types.port;
        default = 8080;
        description = ''
          The port on which headscale listens.
        '';
      };
      baseDomain = lib.mkOption {
        type = lib.types.str;
        default = "headscale.local";
        description = ''
          The base domain for MagicDNS.
        '';
        example = "tailnet.example.com";
      };
      openFirewall = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether to open the firewall for headscale.
        '';
      };
    };

    perInstance =
      {
        instanceName,
        settings,
        machine,
        mkExports,
        ...
      }:
      {
        exports = mkExports {
          controller.hosts = [
            {
              plain = settings.publicAddress;
            }
          ];
        };

        nixosModule =
          {
            lib,
            pkgs,
            ...
          }:
          let
            serverUrl =
              let
                proto = "https";
              in
              "${proto}://${settings.publicAddress}:${toString settings.port}";
          in
          {
            imports = [
              (lib.modules.importApply ./shared.nix {
                inherit
                  instanceName
                  settings
                  serverUrl
                  pkgs
                  lib
                  machine
                  ;
                isController = true;
              })
            ];
          };
      };
  };

  roles.peer = {
    description = "A Tailscale client that connects to the headscale server.";
    interface.options = {
      exitNode = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether this peer should advertise itself as an exit node.
        '';
      };
      acceptRoutes = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether to accept routes advertised by other peers.
        '';
      };
    };

    perInstance =
      {
        instanceName,
        settings,
        roles,
        mkExports,
        machine,
        ...
      }:
      {
        exports = mkExports {
          peer.hosts = [
            {
              plain = clanLib.getPublicValue {
                machine = machine.name;
                generator = "headscale-${instanceName}-peer";
                file = "ip";
                flake = directory;
              };
            }
          ];
        };

        nixosModule =
          {
            lib,
            pkgs,
            ...
          }:
          let
            # Get controller information
            controllers = roles.controller.machines or { };
            controllerNames = lib.attrNames controllers;

            controllerInfo =
              if controllerNames == [ ] then
                throw "The Headscale service instance '${instanceName}' requires at least one machine with the 'controller' role."
              else
                let
                  name = lib.head controllerNames;
                  ctrl = controllers.${name};
                in
                {
                  inherit name;
                  publicAddress = ctrl.settings.publicAddress;
                  port = ctrl.settings.port;
                };

            serverUrl = "https://${controllerInfo.publicAddress}:${toString controllerInfo.port}";
          in
          {
            imports = [
              (lib.modules.importApply ./shared.nix {
                inherit
                  instanceName
                  settings
                  serverUrl
                  controllerInfo
                  pkgs
                  lib
                  machine
                  ;
                isController = false;
              })
            ];

            assertions = [
              {
                assertion = controllerNames != [ ];
                message = "The Headscale service instance '${instanceName}' requires at least one machine with the 'controller' role.";
              }
            ];
          };
      };
  };
}
