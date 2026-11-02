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
      packages.nebula = pkgs.callPackage ./package.nix {
        nebula-src = inputs.nebula;
        # go.mod requires Go >= 1.27.3, nixpkgs' default Go is 1.26
        buildGoModule = pkgs.buildGo127Module;
      };
    };
}
