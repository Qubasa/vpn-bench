{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "srt-stream";

  roles.server = {
    interface = {
      options = {
        port = lib.mkOption {
          type = lib.types.port;
          default = 40052;
          description = "UDP port to listen on for SRT streams";
        };
        latency = lib.mkOption {
          type = lib.types.int;
          default = 400;
          description = "SRT latency in milliseconds";
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
              latency = lib.mkDefault 400;
            };
          in
          {
            imports = [ ./shared.nix ];

            services.srt-stream = {
              enable = true;
              port = finalSettings.port;
              latency = finalSettings.latency;
              openFirewall = true;
            };
          };
      };
  };
}
