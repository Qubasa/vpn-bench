{ ... }:
{
  _class = "clan.service";
  manifest.name = "benchmark-resources";
  manifest.description = "benchmark.slice, which holds the VPN daemons, test servers and the clients vpb starts";
  manifest.categories = [ "System" ];

  roles.default = {
    perInstance =
      { ... }:
      {
        nixosModule = {
          systemd.slices.benchmark = {
            description = "VPN Benchmark Suite Slice";
            sliceConfig = {
              # system.slice and user.slice keep the default weight of 100, so under contention
              # the benchmark gets nine times the CPU share of each.
              CPUWeight = 900;
              MemoryHigh = "90%";
            };
          };
        };
      };
  };
}
