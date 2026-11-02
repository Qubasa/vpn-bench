{ packages, clan-core }:
{
  # clan-core's ZeroTier service, with the daemon built from the pinned source and run
  # in benchmark.slice.
  imports = [ "${clan-core}/clanServices/zerotier/default.nix" ];

  perMachine =
    { machine, ... }:
    {
      nixosModule =
        { pkgs, ... }:
        {
          # clan-core's wrapper adds the controller code and relicenses it, so the
          # controller evaluates without allowUnfree.
          services.zerotierone.package =
            pkgs.callPackage "${clan-core}/clanServices/zerotier/pkgs/zerotierone"
              {
                zerotierone = packages.${pkgs.stdenv.hostPlatform.system}.zerotierone;
                includeController = builtins.elem "controller" machine.roles;
              };

          systemd.services.zerotierone.serviceConfig.Slice = "benchmark.slice";
        };
    };
}
