{
  inputs,
  ...
}:
{
  perSystem =
    {
      config,
      pkgs,
      ...
    }:

    {
      packages.netbird = pkgs.callPackage ./package.nix {
        netbird-src = inputs.netbird;
      };
      packages.netbird-server = config.packages.netbird.server;
    };
}
