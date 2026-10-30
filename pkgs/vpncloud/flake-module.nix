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
      packages.vpncloud = pkgs.callPackage ./package.nix {
        vpncloud-src = inputs.vpncloud;
      };
    };
}
