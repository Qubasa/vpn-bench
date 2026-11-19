{
  lib,
  buildGoModule,

  nylon-src,
}:

buildGoModule {
  pname = "nylon";
  version = "0.4.7";

  src = nylon-src;

  vendorHash = "sha256-PsJqUHt6KCiNx33SznAy/uZlE00NtA5lMffDryg+ZnM=";

  # Only the CLI; the other main packages are the bundled polyamide (wireguard-go fork)
  # daemon and netstack examples.
  subPackages = [ "." ];

  ldflags = [
    "-s"
    "-w"
  ];

  # The integration/e2e tests need docker and root; the unit tests open real sockets.
  doCheck = false;

  meta = {
    description = "Self-healing WireGuard mesh with latency-based Babel routing";
    homepage = "https://github.com/encodeous/nylon";
    license = lib.licenses.asl20;
    mainProgram = "nylon";
    platforms = lib.platforms.linux;
  };
}
