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
        # go.mod requires Go >= 1.27.3, nixpkgs' default Go is 1.26
        buildGoModule = pkgs.buildGo127Module;
      };
    };
}
