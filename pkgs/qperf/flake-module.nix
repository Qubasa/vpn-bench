{
  self,
  ...
}:
{
  perSystem =
    {
        system,
        pkgs,
        ...
    }:

    {

      _module.args.pkgs = import self.inputs.nixpkgs {
          inherit system;
          config.permittedInsecurePackages = [
            "openssl-1.1.1w"
          ];
        };
      packages.qperf = pkgs.callPackage ./default.nix {  };
    };
}
