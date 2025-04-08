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
      packages.vpn-bench = pkgs.callPackage ./default.nix { };
    };
}
