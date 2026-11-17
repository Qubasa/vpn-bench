{
  lib,
  rustPlatform,
  cmake,
  git,
  perl,

  yip-src,
}:

rustPlatform.buildRustPackage {
  pname = "yip";
  version = "0.1.0-unstable-2026-11-16";

  src = yip-src;

  cargoHash = "sha256-oWNc0M/FDAZHUd4aPbA9TpWr3UA/boCPVWxgnVK5/zk=";

  # yipd is the only binary the benchmark needs; it also carries the `yipd ctl` client.
  cargoBuildFlags = [
    "-p"
    "yipd"
  ];

  # boring-sys builds its vendored BoringSSL with cmake, patches it with `git apply` and
  # generates bindings with bindgen.
  nativeBuildInputs = [
    cmake
    git
    perl
    rustPlatform.bindgenHook
  ];

  # The cmake setup hook would otherwise take over configurePhase for the whole crate.
  dontUseCmakeConfigure = true;

  cargoTestFlags = [
    "-p"
    "yipd"
  ];

  # The netns/TUN end-to-end tests need root; this skips them instead of failing in the sandbox.
  env.YIP_SKIP_PRIVILEGED_TESTS = "1";

  meta = {
    description = "High-performance obfuscated mesh VPN with forward error correction";
    homepage = "https://github.com/femboyisp/yip";
    license = lib.licenses.agpl3Plus;
    mainProgram = "yipd";
    platforms = lib.platforms.linux;
  };
}
