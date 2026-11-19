{
  lib,
  buildGoModule,
  versionCheckHook,

  wireguard-go-src,
}:

buildGoModule (_finalAttrs: {
  pname = "wireguard-go";
  version = "0.0.20250522";

  src = wireguard-go-src;

  postPatch = ''
    # gofmt check depends on the exact Go toolchain version, not on correctness.
    rm -f format_test.go
  '';

  vendorHash = "sha256-sCajxTV26jjlmgmbV4GG6hg9NkLGS773ZbFyKucvuBE=";

  subPackages = [ "." ];

  ldflags = [ "-s" ];

  # subPackages only covers the root package, which has no tests; the upstream Makefile
  # runs `go test ./...` over all packages.
  checkPhase = ''
    runHook preCheck
    export GOFLAGS=''${GOFLAGS//-trimpath/}
    make test
    runHook postCheck
  '';

  # The module path is golang.zx2c4.com/wireguard, so go names the binary "wireguard".
  postInstall = ''
    mv $out/bin/wireguard $out/bin/wireguard-go
  '';

  nativeInstallCheckInputs = [ versionCheckHook ];
  doInstallCheck = true;

  meta = {
    description = "Userspace Go implementation of WireGuard";
    homepage = "https://git.zx2c4.com/wireguard-go/about/";
    license = lib.licenses.mit;
    mainProgram = "wireguard-go";
    platforms = lib.platforms.linux;
  };
})
