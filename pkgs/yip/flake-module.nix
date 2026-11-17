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
      packages.yip = pkgs.callPackage ./package.nix {
        yip-src = inputs.yip;
      };
    };
}
