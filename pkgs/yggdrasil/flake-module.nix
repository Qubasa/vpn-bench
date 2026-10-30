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
      packages.yggdrasil = pkgs.callPackage ./package.nix {
        yggdrasil-src = inputs.yggdrasil;
      };
    };
}
