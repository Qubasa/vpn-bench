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
      packages.vpncloud = pkgs.callPackage ./default.nix { };
    };
}
