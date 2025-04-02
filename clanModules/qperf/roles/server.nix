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
      default = builtins.foldl' (acc: cpu: acc + cpu.cores) 0 config.facter.report.hardware.cpu * 2;
      description = "Maximum number of cores qperf can use. Will open that many UDP ports.";
    };
  };

  config = {
    services.qperf = {
      enable = true;
      maxNumCores = config.clan.qperf.maxNumCores;
      openFirewall = true;
      serverKey = ./server.key;
      serverCrt = ./server.crt;
    };
  };
}
