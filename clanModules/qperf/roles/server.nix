{
  lib,
  config,
  ...
}:
{
  imports = [ ../shared.nix ];
  options.clan.qperf = {
    maxNumCores = lib.mkOption {
      type = lib.types.int;
      default = (builtins.elemAt config.facter.report.hardware.cpu 0).cores * 2;
      description = "Maximum number of cores qperf can use. Will open that many UDP ports.";
    };
  };

  config = {
    assertions = [ { assertion = builtins.length config.facter.report.hardware.cpu == 1;
        message = "More then one CPU is not expected for the qperf clan module.";
      }
    ];

    services.qperf = {
      enable = true;
      maxNumCores = config.clan.qperf.maxNumCores;
      openFirewall = true;
      serverKey = ./server.key;
      serverCrt = ./server.crt;
    };
  };
}
