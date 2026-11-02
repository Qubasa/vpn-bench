{
  lib,
  stdenv,

  buildGoModule,

  makeWrapper,
  installShellFiles,
  # runtime tooling - linux
  getent,
  iproute2,
  iptables,
  shadow,
  procps,
  # runtime tooling - darwin
  lsof,

  tailscale-src,
}:

buildGoModule (finalAttrs: {
  pname = "tailscale";
  version = "1.104.4";

  outputs = [
    "out"
    "derper"
  ];

  src = tailscale-src;

  vendorHash = "sha256-RvaouD88naVNOPJBVcqMaAn+ovjXI4g83ShCdRiR5/Q=";

  nativeBuildInputs = [
    makeWrapper
    installShellFiles
  ];

  env.CGO_ENABLED = 0;

  subPackages = [
    "cmd/derper"
    "cmd/derpprobe"
    "cmd/tailscaled"
    "cmd/tsidp"
    "cmd/get-authkey"
  ];

  ldflags = [
    "-w"
    "-s"
    "-X tailscale.com/version.longStamp=${finalAttrs.version}"
    "-X tailscale.com/version.shortStamp=${finalAttrs.version}"
  ];

  tags = [
    "ts_include_cli"
  ];

  # Remove vendored tooling to ensure it's not used; also avoids some unnecessary tests
  preBuild = ''
    rm -rf ./tool
  '';

  # The full test suite fails in the sandbox and flakes (ssh/tailssh, drive, git hooks,
  # ipn/ipnlocal); nixpkgs disables it in the package build for the same reason.
  doCheck = false;

  postInstall = ''
    ln -s $out/bin/tailscaled $out/bin/tailscale
    moveToOutput "bin/derper" "$derper"
    moveToOutput "bin/derpprobe" "$derper"
  ''
  + lib.optionalString stdenv.hostPlatform.isDarwin ''
    wrapProgram $out/bin/tailscaled \
      --prefix PATH : ${
        lib.makeBinPath [
          # Uses lsof only on macOS to detect socket location
          # See tailscale safesocket_darwin.go
          lsof
        ]
      }
  ''
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    wrapProgram $out/bin/tailscaled \
      --prefix PATH : ${
        lib.makeBinPath [
          getent
          iproute2
          iptables
          shadow
        ]
      } \
      --suffix PATH : ${lib.makeBinPath [ procps ]}
    sed -i -e "s#/usr/sbin#$out/bin#" -e "/^EnvironmentFile/d" ./cmd/tailscaled/tailscaled.service
    install -D -m0444 -t $out/lib/systemd/system ./cmd/tailscaled/tailscaled.service
  ''
  + lib.optionalString (stdenv.buildPlatform.canExecute stdenv.hostPlatform) ''
    local INSTALL="$out/bin/tailscale"
    installShellCompletion --cmd tailscale \
      --bash <($out/bin/tailscale completion bash) \
      --fish <($out/bin/tailscale completion fish) \
      --zsh <($out/bin/tailscale completion zsh)
  '';

  meta = {
    homepage = "https://tailscale.com";
    description = "Node agent for Tailscale, a mesh VPN built on WireGuard";
    changelog = "https://tailscale.com/changelog#client";
    license = lib.licenses.bsd3;
    mainProgram = "tailscale";
  };
})
