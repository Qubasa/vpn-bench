{ tincr }:
{ lib, ... }:

{
  _class = "clan.service";
  manifest.name = "tincr";
  manifest.description = "tincr — Rust rewrite of tinc 1.1, SPTPS-only, wire-compatible with upstream";
  manifest.categories = [ "Utility" ];

  roles.bootstrap = {
    description = "A bootstrap node that other peers use to join your private tincr network. Needs to have a public IP address / domain name.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = ''
          The public IP address or domain name that other peers will use to connect to this bootstrap node.
        '';
      };
      port = lib.mkOption {
        type = lib.types.nullOr lib.types.int;
        default = null;
        description = ''
          The port that other peers will use to connect to this bootstrap node,
          if no port is defined the default port is used.
        '';
      };
    };

    perInstance =
      {
        instanceName,
        roles,
        ...
      }:
      {
        nixosModule =
          {
            pkgs,
            lib,
            config,
            ...
          }:

          {
            imports = [
              (lib.modules.importApply ./shared.nix {
                inherit
                  lib
                  pkgs
                  instanceName
                  roles
                  config
                  tincr
                  ;
              })
            ];
          };
      };
  };

  roles.peer = {
    description = "A peer that connects to your private tincr network.";

    perInstance =
      {
        instanceName,
        roles,
        ...
      }:
      {
        nixosModule =
          {
            pkgs,
            lib,
            config,
            ...
          }:

          {
            imports = [
              (lib.modules.importApply ./shared.nix {
                inherit
                  lib
                  pkgs
                  instanceName
                  roles
                  config
                  tincr
                  ;
              })
            ];

          };
      };
  };
}
