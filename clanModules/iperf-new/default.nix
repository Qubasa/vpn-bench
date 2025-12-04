{ ... }:
{
  _class = "clan.service";
  manifest.name = "iperf-new";

  roles.server = {
    perInstance =
      { ... }:
      {
        nixosModule =
          { config, ... }:
          {
            systemd.services.iperf3.serviceConfig.Slice = "benchmark.slice";

            networking.firewall.allowedUDPPorts = [ config.services.iperf3.port ];
            services.iperf3 = {
              enable = true;
              openFirewall = true;
              port = 5201;
              rsaPrivateKey = ./iperf3.private;
              authorizedUsersFile = ./iperf3.pwd;
            };

          };
      };
  };
}
