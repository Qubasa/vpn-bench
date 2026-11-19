{
  inputs,
  ...
}:
{
  perSystem =
    { pkgs, ... }:
    {
      packages.netmaker = pkgs.callPackage ./package.nix {
        netmaker-src = inputs.netmaker;
      };
      packages.netclient = pkgs.callPackage ./netclient.nix {
        netclient-src = inputs.netclient;
      };
    };
}
