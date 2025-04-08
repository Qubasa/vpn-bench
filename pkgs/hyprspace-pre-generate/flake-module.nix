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
      packages.hyprspace-pre-generate = pkgs.callPackage ./default.nix { };
    };
}
