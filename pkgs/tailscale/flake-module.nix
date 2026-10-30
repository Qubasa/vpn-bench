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
      packages.tailscale = pkgs.callPackage ./package.nix {
        tailscale-src = inputs.tailscale;
      };
    };
}
