{
  lib,
  config,
  ...
}:
{
  options.clan.my-static-hosts = {
    ipToHostnames = lib.mkOption {
      default = { };
      type = lib.types.attrsOf (lib.types.listOf lib.types.str);
      description = "A list of IP addresses which are mapped to hostnames";
      example = { "192.168.1.1" = ["milo"]; };
    };
  };


  config = {
    networking.hosts = config.clan.my-static-hosts.ipToHostnames;
  };
}
