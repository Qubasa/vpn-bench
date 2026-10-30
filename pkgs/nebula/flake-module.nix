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
      packages.nebula = pkgs.callPackage ./package.nix {
        nebula-src = inputs.nebula;
      };
    };
}
