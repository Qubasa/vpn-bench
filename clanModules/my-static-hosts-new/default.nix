{lib, ...}:
{
  _class = "clan.service";
  manifest.name = "my-static-hosts-new";

  roles.default = {
      interface = {
        options = {
          ipToHostnames = lib.mkOption {
                default = { };
                type = lib.types.attrsOf (lib.types.listOf lib.types.str);
                description = "A list of IP addresses which are mapped to hostnames";
                example = { "192.168.1.1" = ["milo"]; };
            };
        };
      };


    perInstance = { settings, pkgs, ... }: 
    {
      nixosModule = { config, ... }:
      {
        networking.hosts = settings.ipToHostnames;
      };
    };

  };
}