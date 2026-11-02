{
  inputs,
  ...
}:
{
  perSystem =
    {
      pkgs,
      ...
    }:

    {
      packages.easytier = pkgs.callPackage ./package.nix {
        easytier-src = inputs.easytier;
      };
    };
}
