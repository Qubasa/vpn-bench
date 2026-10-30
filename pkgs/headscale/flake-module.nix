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
      packages.headscale = pkgs.callPackage ./package.nix {
        headscale-src = inputs.headscale;
      };
    };
}
