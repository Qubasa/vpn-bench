{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "myadmin-new";

  roles.default = {
    interface = {
      options = {
        allowedKeys = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          description = "The allowed public keys for ssh access to the admin user";
          example = {
            "key_1" = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQD...";
          };
        };
      };
    };

    perInstance =
      { settings, ... }:
      {
        nixosModule =
          { ... }:
          {
            users.users.root.openssh.authorizedKeys.keys = builtins.attrValues settings.allowedKeys;
            nixpkgs.config.allowUnfree = true;
            nixpkgs.config.permittedInsecurePackages = [
              "openssl-1.1.1w"
            ];
          };
      };
  };
}
