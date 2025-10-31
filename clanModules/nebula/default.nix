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
        roles,
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

            ipPath =
              name:
              "${config.clan.core.settings.directory}/vars/per-machine/${name}/nebula-${instanceName}/ip/value";

            # structure is: { machineName: { vpnAddress, pubAddress, port } }
            lighthouses = lib.mapAttrs (name: machine: {
              vpnAddress = if builtins.pathExists (ipPath name) then builtins.readFile (ipPath name) else "";
              pubAddress =
                if !lib.hasAttr "publicAddress" machine.settings then
                  throw "Machine '${name}' does not have a 'publicAddress' set in ${instanceName}'s lighthouse role settings."
                else
                  machine.settings.publicAddress;

              port = 4242;
            }) (roles.lighthouse.machines or { });

            # structure is { vpnAddress = [ "${pubAddress}:${port}" ]  }
            staticHostMap = lib.mapAttrs' (
              _name: lighthouse:
              lib.nameValuePair lighthouse.vpnAddress [ "${lighthouse.pubAddress}:${toString lighthouse.port}" ]
            ) lighthouses;
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

            assertions = [
              {
                assertion = lib.length (builtins.attrNames lighthouses) != 0;
                message = "The Nebula service instance '${instanceName}' requires at least one machine with the 'lighthouse' role.";
              }
            ];

            services.nebula.networks."${interface}" = {
              staticHostMap = staticHostMap;
              lighthouses = lib.attrNames staticHostMap;
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
      # TODO: We should get this from the internet networking module
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

            services.nebula.networks."${interface}" = {
              isLighthouse = true;
            };
          };
      };
  };

}
