{
  lib,
  buildGoModule,
  edgevpn-src,
}:

buildGoModule (finalAttrs: {
  pname = "edgevpn";
  version = "0.37.0";

  src = edgevpn-src;

  vendorHash = "sha256-oafjvh5Y5YCPffLqor1o+tUqRNwIUoMiHDYXRPUBTsw=";

  # The daemon, plus a key generator so clan vars can pre-generate each node's libp2p
  # identity (peers need each other's peer IDs as bootstrap addresses).
  subPackages = [
    "."
    "cmd/edgevpn-keygen"
  ];

  # api/spa.go embeds react-ui/dist/*, which upstream builds with npm. The web UI is
  # never served here (the API is off), so an empty placeholder satisfies the embed
  # pattern instead of a JS build; the API answers "React UI not built" if enabled.
  postPatch = ''
    mkdir -p api/react-ui/dist cmd/edgevpn-keygen
    touch api/react-ui/dist/.placeholder
    cp ${./keygen.go} cmd/edgevpn-keygen/main.go
  '';

  ldflags = [
    "-s"
    "-w"
    "-X github.com/mudler/edgevpn/internal.Version=v${finalAttrs.version}"
    "-X github.com/mudler/edgevpn/internal.Commit=${edgevpn-src.rev or "unknown"}"
  ];

  # The test suites start libp2p nodes and TUN devices.
  doCheck = false;

  meta = {
    description = "Immutable, decentralized, statically built p2p VPN without any central server";
    homepage = "https://github.com/mudler/edgevpn";
    license = lib.licenses.asl20;
    mainProgram = "edgevpn";
    platforms = lib.platforms.linux;
  };
})
