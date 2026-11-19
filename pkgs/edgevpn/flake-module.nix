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
      packages.edgevpn = pkgs.callPackage ./package.nix {
        edgevpn-src = inputs.edgevpn;
      };
    };
}
