{
  config,
  ...
}:
{
  imports = [ ../shared.nix ];
  options = {
    
  };

  config = {
    networking.firewall.allowedUDPPorts = [ config.services.iperf3.port ];
      services.iperf3 = {
        enable = true;
        openFirewall = true;
        port = 5201;
        rsaPrivateKey = ./iperf3.private;
        authorizedUsersFile = ./iperf3.pwd;
      };
    };
}
