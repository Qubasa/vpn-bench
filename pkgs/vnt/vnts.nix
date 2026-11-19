{
  lib,
  rustPlatform,
  protobuf,

  vnts-src,
}:

rustPlatform.buildRustPackage {
  pname = "vnts";
  version = "2.0.9";

  src = vnts-src;

  cargoHash = "sha256-W4JO9jG7brPAXJPEMugS04W7C1f8ktUovH8hne8lmPw=";

  # The build script runs the prebuilt protoc shipped in the protoc-bin-vendored crate, which
  # cannot execute in the sandbox; use protoc from nixpkgs instead.
  # The web management UI is embedded with rust-embed from static/, which upstream builds
  # with pnpm. The benchmark never enables web_bind, so embed a placeholder page instead of
  # building the frontend.
  postPatch = ''
    substituteInPlace build.rs \
      --replace-fail 'protoc_bin_vendored::protoc_bin_path()' \
        'std::env::var("PROTOC").map(std::path::PathBuf::from)'
    mkdir -p static
    echo '<!doctype html><title>vnts</title><p>Web UI not built.</p>' > static/index.html
  '';
  env.PROTOC = lib.getExe protobuf;

  meta = {
    description = "Server for the VNT virtual LAN tool";
    homepage = "https://github.com/vnt-dev/vnts";
    license = lib.licenses.asl20;
    mainProgram = "vnts2";
    platforms = lib.platforms.linux;
  };
}
