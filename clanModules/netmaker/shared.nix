{ lib, instanceName }:
rec {
  # Plain-HTTP REST API of the server. It binds all interfaces but the firewall keeps it local;
  # netclient only speaks HTTPS, which `tlsApiPort` terminates in front of it.
  apiPort = 8091;
  tlsApiPort = 8443;
  # Mosquitto: plain MQTT on loopback for the server, MQTT over TLS for peers.
  mqttPort = 1883;
  mqttTlsPort = 8883;
  wireguardPort = 51830;
  # netclient's default interface name; `netclient join -I` rejects names that already exist,
  # which would break re-joining after a restart.
  interface = "netmaker";
  network = instanceName;

  serverStateDir = "/var/lib/netmaker";
  netclientStateDir = "/etc/netclient";

  tlsGenerator = "netmaker-${instanceName}-tls";
  networkGenerator = "netmaker-${instanceName}-network";

  isIP = address: lib.hasInfix ":" address || builtins.match "[0-9.]+" address != null;

  # host:port with IPv6 literals bracketed.
  hostPort =
    address: port:
    if lib.hasInfix ":" address then "[${address}]:${toString port}" else "${address}:${toString port}";

  # Generators every machine of the instance needs, plus trust in the server certificate.
  # The module `key` makes a machine in both roles import it once.
  sharedModule = publicAddress: {
    key = "netmaker-${instanceName}-shared";
    imports = [
      (
        { config, pkgs, ... }:
        {
          # Self-signed certificate for the API and MQTT endpoints. Go ignores the CN, so the
          # public address must be a subjectAltName.
          clan.core.vars.generators.${tlsGenerator} = {
            share = true;
            files.cert.secret = false;
            files.key.secret = true;
            validation.publicAddress = publicAddress;
            runtimeInputs = [ pkgs.openssl ];
            script = ''
              openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
                -keyout "$out"/key -out "$out"/cert -days 3650 -nodes \
                -subj "/CN=netmaker-${instanceName}" \
                -addext "subjectAltName=${
                  if isIP publicAddress then "IP:${publicAddress}" else "DNS:${publicAddress}"
                },IP:127.0.0.1,DNS:localhost"
            '';
          };

          # The server's admin master key. Peers use it to fetch the network's enrollment token
          # over the TLS API, so no unauthenticated token endpoint is needed.
          clan.core.vars.generators.${networkGenerator} = {
            share = true;
            files.master-key.secret = true;
            runtimeInputs = [
              pkgs.openssl
              pkgs.coreutils
            ];
            script = ''
              openssl rand -hex 32 | tr -d '\n' > "$out"/master-key
            '';
          };

          security.pki.certificateFiles = [
            config.clan.core.vars.generators.${tlsGenerator}.files.cert.path
          ];
        }
      )
    ];
  };
}
