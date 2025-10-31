{ }:
{ lib, ... }:

{
  _class = "clan.service";
  manifest.name = "tinc";
  manifest.description = "Tinc decentralized VPN";
  manifest.categories = [ "Utility" ];

  roles.bootstrap = {
    description = "A bootstrap node that other peers use to join your private Tinc network. Needs to have a public IP address / domain name.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = ''
          The public IP address or domain name that other peers will use to connect to this bootstrap node.
        '';
        port = lib.mkOption {
          type = lib.types.nullOr lib.types.int;
          default = null;
          description = ''
            The port that other peers will use to connect to this bootstrap node, 
            if no port is defined the default port is used.
          '';
        };
      };
    };

    nixosModule =
      {
        instanceName,
        config,
        pkgs,
        ...
      }:
      let
        getInterface = instanceName: lib.substring 0 15 instanceName;
        interface = getInterface instanceName;

      in
      {
        imports = [
          (lib.modules.importApply ./shared.nix {
            inherit
              pkgs
              interface
              config
              ;
          })
        ];
      };
  };

  roles.peer = {
    description = "A peer that connects to your private Tinc network.";

    perInstance =
      {
        instanceName,
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

          in
          {
            imports = [
              (lib.modules.importApply ./shared.nix {
                inherit
                  pkgs
                  interface
                  config
                  ;
              })
            ];

            assertions = [
              {
                assertion = lib.length (builtins.attrNames (roles.bootstrap.machines or { })) != 0;
                message = "The Tinc service instance '${instanceName}' requires at least one machine with the 'bootstrap' role.";
              }
            ];

            services.tinc.networks."${interface}" = {
              hostSettings = {
                # structure is: [ { adress, port  } ]
                addresses = lib.mapAttrsToList (_name: machine: {
                  address = machine.settings.publicAddress;
                  port = machine.settings.port;
                }) (roles.bootstrap.machines or { });
              };
            };
          };
      };
  };
}
