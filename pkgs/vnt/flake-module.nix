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
      packages.vnt = pkgs.callPackage ./package.nix {
        vnt-src = inputs.vnt;
      };
      packages.vnts = pkgs.callPackage ./vnts.nix {
        vnts-src = inputs.vnts;
      };
    };
}
