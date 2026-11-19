{
  lib,
  rustPlatform,
  protobuf,

  vnt-src,
}:

rustPlatform.buildRustPackage {
  pname = "vnt";
  version = "2.0.12";

  src = vnt-src;

  cargoHash = "sha256-TX6RSmhv87iiBtCynve3djZgP4TeoNcR1JmCmnVMDk0=";

  # Only the headless client (vnt2_cli) and its control tool (vnt2_ctrl, talks to the client's
  # local control port) are needed; the web UI, desktop app and JNI crates are left out.
  buildNoDefaultFeatures = true;
  buildFeatures = [ "vnt-ipc" ];
  cargoBuildFlags = [
    "--bin"
    "vnt2_cli"
    "--bin"
    "vnt2_ctrl"
  ];

  # The build scripts run the prebuilt protoc shipped in the protoc-bin-vendored crate, which
  # cannot execute in the sandbox; use protoc from nixpkgs instead.
  postPatch = ''
    substituteInPlace vnt-core/build.rs vnt-ipc/build.rs \
      --replace-fail 'protoc_bin_vendored::protoc_bin_path()' \
        'std::env::var("PROTOC").map(std::path::PathBuf::from)'
  '';
  env.PROTOC = lib.getExe protobuf;

  meta = {
    description = "Simple, efficient virtual LAN tool (VNT 2 command line client)";
    homepage = "https://github.com/vnt-dev/vnt";
    license = lib.licenses.asl20;
    mainProgram = "vnt2_cli";
    platforms = lib.platforms.linux;
  };
}
