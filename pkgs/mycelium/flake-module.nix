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
      packages.mycelium = pkgs.callPackage ./package.nix {
        mycelium-src = inputs.mycelium;
      };
    };
}
