{
  lib,
  buildGoModule,
  netmaker-src,
}:

buildGoModule (finalAttrs: {
  pname = "netmaker";
  version = "1.7.0";

  src = netmaker-src;

  vendorHash = "sha256-9pWcY4PaLLwFD0dg5Rn8c20yc3EucRvjin6zVdELn8A=";

  # Community edition server only: without the `ee` build tag no Pro code (license checks) is linked.
  subPackages = [ "." ];

  ldflags = [
    "-s"
    "-w"
  ];

  postPatch = ''
    # Every API-host/broker lookup first asks ifconfig.me/ipify/ipinfo for the public IP even when
    # SERVER_HOST etc. are set; only consult an explicitly configured PUBLIC_IP_SERVICE.
    substituteInPlace servercfg/serverconf.go \
      --replace-fail 'iplist := []string{"https://ifconfig.me/ip", "https://api.ipify.org", "https://ipinfo.io/ip"}' \
                     'var iplist []string'
    # Host geolocation is looked up at ipapi.is/ipinfo.io and only feeds the dashboard.
    substituteInPlace utils/geoinfo.go \
      --replace-fail 'func GetGeoInfo(ip ...net.IP) (*GeoInfo, error) {' \
                     'func GetGeoInfo(ip ...net.IP) (*GeoInfo, error) { return nil, fmt.Errorf("geolocation disabled")'
    # A fresh install seeds its default tenant with hardcoded settings (telemetry on, which is
    # sent to PostHog right at startup; netclient auto-update; public Google STUN; host DNS
    # management) and ignores the environment. Seed from the documented environment variables.
    substituteInPlace logic/settings.go \
      --replace-fail 'NetclientAutoUpdate:         true,' 'NetclientAutoUpdate: servercfg.AutoUpdateEnabled(),' \
      --replace-fail 'Telemetry:                   "on",' 'Telemetry: servercfg.Telemetry(),' \
      --replace-fail 'EndpointDetection:           true,' 'EndpointDetection: servercfg.IsEndpointDetectionEnabled(),' \
      --replace-fail 'ManageDNS:                   true,' 'ManageDNS: servercfg.GetManageDNS(),' \
      --replace-fail 'Stun:                        true,' 'Stun: servercfg.IsStunEnabled(),' \
      --replace-fail 'StunServers:                 "stun1.l.google.com:19302,stun2.l.google.com:19302,stun3.l.google.com:19302,stun4.l.google.com:19302",' \
                     'StunServers: servercfg.GetStunServers(),'
  '';

  # Tests need a database and network access.
  doCheck = false;

  meta = {
    description = "Netmaker community edition server: WireGuard mesh VPN control plane";
    homepage = "https://netmaker.io";
    changelog = "https://github.com/gravitl/netmaker/releases/tag/v${finalAttrs.version}";
    # Everything outside pro/, which this build excludes.
    license = lib.licenses.asl20;
    mainProgram = "netmaker";
    platforms = lib.platforms.linux;
  };
})
