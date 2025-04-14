{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "qperf";

  roles.server = {
    interface = {
      options = {
        maxNumCores = lib.mkOption {
          type = lib.types.int;
          description = "Maximum number of cores qperf can use. Will open that many UDP ports.";
        };
      };
    };

    perInstance =
      { extendSettings, ... }:
      {
        nixosModule =
          { config, ... }:
          let
            finalSettings = extendSettings {
              maxNumCores = lib.mkDefault (
                builtins.foldl' (acc: cpu: acc + cpu.cores) 0 config.facter.report.hardware.cpu * 2
              );
            };
          in
          {
            imports = [ ./shared.nix ];

            services.qperf = {
              enable = true;
              maxNumCores = finalSettings.maxNumCores;
              openFirewall = true;
              serverKey = ./server.key;
              serverCrt = ./server.crt;
            };
          };
      };
  };
}
