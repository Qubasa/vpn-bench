{ lib, instanceName }:
rec {
  # Serves the reusable setup key to peers; the key file is the only file in its directory.
  keyserverPort = 8081;
  stunPort = 3478;
  wireguardPort = 51820;
  interface = "wt0";

  serverStateDir = "/var/lib/netbird-server";
  keyDir = "${serverStateDir}/keyserver";

  tlsGenerator = "netbird-${instanceName}-tls";

  isIP = address: lib.hasInfix ":" address || builtins.match "[0-9.]+" address != null;

  # host:port with IPv6 literals bracketed.
  hostPort =
    address: port:
    if lib.hasInfix ":" address then "[${address}]:${toString port}" else "${address}:${toString port}";

  # Self-signed server certificate, shared by the controller (serves it) and every peer (trusts it).
  # Go ignores the CN, so the public address must be a subjectAltName. The module `key` makes a
  # machine in both roles import it once, keeping the shared generator identical on all machines.
  tlsModule = publicAddress: {
    key = "netbird-${instanceName}-tls";
    imports = [
      (
        { config, pkgs, ... }:
        {
          clan.core.vars.generators.${tlsGenerator} = {
            share = true;
            files.cert.secret = false;
            files.key.secret = true;
            validation.publicAddress = publicAddress;
            runtimeInputs = [ pkgs.openssl ];
            script = ''
              openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
                -keyout "$out"/key -out "$out"/cert -days 3650 -nodes \
                -subj "/CN=netbird-${instanceName}" \
                -addext "subjectAltName=${
                  if isIP publicAddress then "IP:${publicAddress}" else "DNS:${publicAddress}"
                },IP:127.0.0.1,DNS:localhost"
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
