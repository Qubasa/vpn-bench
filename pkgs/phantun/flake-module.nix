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
      packages.phantun = pkgs.callPackage ./default.nix { };
    };
}
