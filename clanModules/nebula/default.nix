{ nebula-src }:
{ lib, ... }:

{
  _class = "clan.service";
  manifest.name = "nebula";
  manifest.description = "Nebula decentralized VPN";
  manifest.categories = [ "Utility" ];

  roles.peer = {
    description = "A peer that connects to your private Nebula network.";
    interface.options = {
      groups = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        description = ''
          Groups that this lighthouse belongs to. Used to define traffic rules in a nebula network.
        '';
      };
    };
    perInstance =
      {
        instanceName,
        settings,
        ...
      }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:

          let
            getInterface = instanceName: lib.substring 0 15 instanceName;
            interface = getInterface instanceName;
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
                  ipgenv6
                  pkgs
                  lib
                  interface
                  config
                  nebula-src
                  ;
              })
            ];

            services.nebula.networks."${interface}" = {
              staticHostMap = { };
            };
          };
      };
  };

  roles.lighthouse = {
    description = "A lighthouse acts as a middleman node to connect other nodes in the nebula network that are not publicly reachable. Each lighthouse must be publicly reachable.";
    interface.options = {
      groups = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        description = ''
          Groups that this lighthouse belongs to. Used to define traffic rules in a nebula network.
        '';
      };
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = ''
          The public IP address or domain name that other peers will use to connect to this lighthouse.
        '';
      };
    };

    perInstance =
      {
        instanceName,
        settings,
        ...
      }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:

          let
            getInterface = instanceName: lib.substring 0 15 instanceName;
            interface = getInterface instanceName;
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
                  ipgenv6
                  pkgs
                  lib
                  interface
                  config
                  nebula-src
                  ;
              })
            ];

            # exports.nebula =
            #   let
            #     ipPath =
            #       name: "${config.clan.core.settings.directory}/vars/per-machine/${name}/nebula-${instanceName}/ip/value";
            #   in
            #   {
            #     lighthouses = lib.mapAttrs (name: _: {
            #       vpnAddress =
            #         if builtins.pathExists (ipPath name) then builtins.readFile (ipPath name) name else null;
            #       pubAddress = settings.publicAddress;
            #       port = 4242;
            #     }) (roles.lighthouse.machines or { });
            #   };

            services.nebula.networks."${interface}" = {
              isLighthouse = true;
            };
          };
      };
  };

}
