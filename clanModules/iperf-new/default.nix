{ ... }:
{
  _class = "clan.service";
  manifest.name = "iperf-new";

  roles.server = {
    perInstance =
      { ... }:
      {
        nixosModule =
          { config, pkgs, ... }:
          let
            package = pkgs.callPackage ../../pkgs/iperf/default.nix { };
          in
          {
            systemd.services.iperf3.serviceConfig.Slice = "benchmark.slice";
            environment.systemPackages = [ package ];
            networking.firewall.allowedUDPPorts = [ config.services.iperf3.port ];
            services.iperf3 = {
              enable = true;
              package = package;
              openFirewall = true;
              port = 5201;
              rsaPrivateKey = ./iperf3.private;
              authorizedUsersFile = ./iperf3.pwd;
            };

          };
      };
  };
}
