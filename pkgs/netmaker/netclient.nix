{
  lib,
  buildGoModule,
  netclient-src,
}:

buildGoModule (finalAttrs: {
  pname = "netclient";
  version = "1.7.0";

  src = netclient-src;

  vendorHash = "sha256-SAJkeuDEVOqNDAUTY8ywSrnbq/lPYIbLtLGGGk882TM=";

  # Matches upstream release builds (pure Go, kernel WireGuard via netlink).
  env.CGO_ENABLED = 0;

  ldflags = [
    "-s"
    "-w"
  ];

  # Host geolocation is looked up at ipapi.is/ipinfo.io (via the vendored netmaker module) on
  # every start and only feeds the dashboard.
  preBuild = ''
    chmod -R u+w vendor/github.com/gravitl/netmaker/utils
    substituteInPlace vendor/github.com/gravitl/netmaker/utils/geoinfo.go \
      --replace-fail 'func GetGeoInfo(ip ...net.IP) (*GeoInfo, error) {' \
                     'func GetGeoInfo(ip ...net.IP) (*GeoInfo, error) { return nil, fmt.Errorf("geolocation disabled")'
  '';

  # Tests need root and network access.
  doCheck = false;

  meta = {
    description = "Netmaker client: joins hosts to Netmaker networks over kernel WireGuard";
    homepage = "https://netmaker.io";
    changelog = "https://github.com/gravitl/netclient/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.asl20;
    mainProgram = "netclient";
    platforms = lib.platforms.linux;
  };
})
