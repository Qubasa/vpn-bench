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
      packages.zerotierone = pkgs.callPackage ./package.nix {
        zerotierone-src = inputs.zerotierone;
      };
    };
}
