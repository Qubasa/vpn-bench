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
      packages.cjdns = pkgs.callPackage ./package.nix {
        cjdns-src = inputs.cjdns;
      };
    };
}
