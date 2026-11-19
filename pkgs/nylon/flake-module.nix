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
      packages.nylon = pkgs.callPackage ./package.nix {
        nylon-src = inputs.nylon;
      };
    };
}
