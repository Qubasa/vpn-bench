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
      packages.tinc = pkgs.callPackage ./package.nix {
        tinc-src = inputs.tinc;
      };
    };
}
