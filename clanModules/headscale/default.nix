{
  clanLib,
  config,
  lib,
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
        default = 443;
        description = ''
          The port on which headscale listens. Default is 443 for noise protocol compatibility.
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
      let
        # Controller is always also a peer so it can participate in the VPN mesh
        isPeer = true;
      in
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
            config,
            lib,
            pkgs,
            ...
          }:
          let
            # Use HTTPS for headscale with TLS (required for noise protocol)
            serverUrl = "https://${settings.publicAddress}:${toString settings.port}";

            # IPv6 ULA address generator
            ipgenv6 = pkgs.writers.writePython3Bin "ipgenv6" {
              libraries = [ ];
              doCheck = false;
            } (builtins.readFile ./ipgenv6.py);
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
                  isPeer
                  config
                  ipgenv6
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
      let
        # Check if this peer is also a controller
        isAlsoController = roles.controller.machines ? ${machine.name};
      in
      {
        # Headscale assigns IPs dynamically, so we export the hostname
        # which is resolvable via MagicDNS (machine.baseDomain)
        exports = mkExports {
          peer.hosts = [
            {
              plain = machine.name;
            }
          ];
        };

        # Only apply peer nixosModule if this machine is NOT also a controller
        # (controller role handles peer config when machine has both roles)
        nixosModule =
          {
            config,
            lib,
            pkgs,
            ...
          }:
          # If this peer is also a controller, return empty module
          # (controller role already handles peer config)
          if isAlsoController then
            { }
          else
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

              # Use HTTPS for headscale with TLS (required for noise protocol)
              serverUrl = "https://${controllerInfo.publicAddress}:${toString controllerInfo.port}";

              # IPv6 ULA address generator
              ipgenv6 = pkgs.writers.writePython3Bin "ipgenv6" {
                libraries = [ ];
                doCheck = false;
              } (builtins.readFile ./ipgenv6.py);
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
                    config
                    ipgenv6
                    ;
                  isController = false;
                  isPeer = true;
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
