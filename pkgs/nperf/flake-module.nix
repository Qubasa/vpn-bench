{
  ...
}:
{
  perSystem =
    {
        pkgs,
        ...
    }:
    {
      packages.nperf = pkgs.callPackage ./default.nix {  };
    };
}
