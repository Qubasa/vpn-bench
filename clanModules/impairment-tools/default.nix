{ ... }:
{
  _class = "clan.service";
  manifest.name = "impairment-tools";
  manifest.description = "Tools vpb needs to apply receiver-side netem impairment";
  manifest.categories = [ "System" ];

  roles.default = {
    perInstance =
      { ... }:
      {
        nixosModule =
          { pkgs, ... }:
          {
            environment.systemPackages = [ pkgs.ethtool ];
          };
      };
  };
}
