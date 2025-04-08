{ packages }:
{ ... }:
{
  _class = "clan.service";
  manifest.name = "vpncloud";

  roles.server = {
    interface = {
      options = {

      };
    };

    perInstance =
      { ... }:
      {
        nixosModule =
          { config, pkgs, ... }:
          let
            vpncloud = packages.${config.nixpkgs.hostPlatform.system}.vpncloud;
          in
          {
            imports = [
              ./service.nix
            ];

            environment.systemPackages = [
              vpncloud
            ];

            systemd.services.vpncloud = {
              description = "Vpncloud Distributed Network";
              after = [ "network-online.target" ];
              wants = [ "network-online.target" ];
              wantedBy = [ "multi-user.target" ];
            };

            services.vpncloud = {
              enable = true;
              privateKeyFile = config.clan.core.vars.generators.vpncloud.files.private-key.path;
              publicKeyFile = config.clan.core.vars.generators.vpncloud.files.public-key.path;
            };

            clan.core.vars.generators.vpncloud = {
              files.private-key = { };
              files.public-key = {
                deploy = false;
                secret = false;
              };
              runtimeInputs = [
                vpncloud
                pkgs.jq
              ];
              script = ''
                keys=$(vpncloud genkey)
                echo "$keys" | grep "Private key:" | sed 's/Private key: *//' > $out/private-key
                echo "$keys" | grep "Public key:" | sed 's/Public key: *//' > $out/public-key
              '';
            };
          };
      };
  };
}
