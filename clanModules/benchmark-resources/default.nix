{
  lib,
  config,
  ...
}:
let
  cfg = config.services.benchmarkResources;
in
{
  options.services.benchmarkResources = {
    enable = lib.mkEnableOption "benchmark resource limits via systemd slice";

    cpuWeight = lib.mkOption {
      type = lib.types.int;
      default = 900;
      description = ''
        CPU weight for benchmark slice (100=normal, 900=90% priority).
        When CPU is contested, benchmark workloads get this proportion.
      '';
    };

    memoryHigh = lib.mkOption {
      type = lib.types.str;
      default = "90%";
      description = ''
        Soft memory limit for benchmark slice.
        Processes are throttled (not killed) when exceeded.
        Allows bursts when memory is available.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.slices.benchmark = {
      description = "VPN Benchmark Suite Slice";
      sliceConfig = {
        CPUWeight = cfg.cpuWeight;
        MemoryHigh = cfg.memoryHigh;
      };
    };
  };
}
