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
      packages.iperf = pkgs.callPackage ./default.nix { };
    };
}
