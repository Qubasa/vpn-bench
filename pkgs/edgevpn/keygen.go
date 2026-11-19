// edgevpn-keygen writes a libp2p Ed25519 private key in the format edgevpn's
// --privkey-cache reads (<dir>/privkey) and prints the matching peer ID, so a
// node's identity can be generated ahead of time and handed to its peers as a
// bootstrap address. edgevpn itself only generates a key on first start.
package main

import (
	"crypto/rand"
	"fmt"
	"os"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: edgevpn-keygen <privkey file>")
		os.Exit(2)
	}
	priv, pub, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		panic(err)
	}
	raw, err := crypto.MarshalPrivateKey(priv)
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(os.Args[1], raw, 0o600); err != nil {
		panic(err)
	}
	id, err := peer.IDFromPublicKey(pub)
	if err != nil {
		panic(err)
	}
	fmt.Print(id.String())
}
