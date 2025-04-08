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
      packages.qperf = pkgs.callPackage ./default.nix { };
    };
}
