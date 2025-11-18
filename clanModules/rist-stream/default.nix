{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "rist-stream";

  roles.server = {
    interface = {
      options = {
        port = lib.mkOption {
          type = lib.types.port;
          default = 40052;
          description = "UDP port to listen on for RIST streams";
        };
        buffer = lib.mkOption {
          type = lib.types.int;
          default = 400;
          description = "RIST buffer size in milliseconds";
        };
        profile = lib.mkOption {
          type = lib.types.enum [ "simple" "main" "advanced" ];
          default = "main";
          description = "RIST profile (simple, main, advanced)";
        };
      };
    };

    perInstance =
      { extendSettings, ... }:
      {
        nixosModule =
          { ... }:
          let
            finalSettings = extendSettings {
              port = lib.mkDefault 40052;
              buffer = lib.mkDefault 400;
              profile = lib.mkDefault "main";
            };
          in
          {
            imports = [ ./shared.nix ];

            services.rist-stream = {
              enable = true;
              port = finalSettings.port;
              buffer = finalSettings.buffer;
              profile = finalSettings.profile;
              openFirewall = true;
            };
          };
      };
  };
}
