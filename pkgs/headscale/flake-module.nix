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
        # go.mod requires Go >= 1.27.3, nixpkgs' default Go is 1.26
        buildGoModule = pkgs.buildGo127Module;
      };
    };
}
