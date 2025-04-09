package main

import (
	"fmt"
	"net"
	"flag"
	"os"
	"github.com/libp2p/go-libp2p/core/peer"
)

func MkNetID(decoded_peerid peer.ID) [4]byte {
	r := [4]byte{0xde, 0xad, 0xbe, 0xef}
	for i, b := range []byte(decoded_peerid) {
		r[i%4] ^= b
	}
	return r
}

func mkBuiltinAddr6(peer_id string) net.IP {
	p, err := peer.Decode(peer_id)
	if err != nil {
		panic(err)
	}
	builtinAddr := []byte("\xfd\x00hyprspace\x00\x00\x00\x00\x00")
	for i, b := range []byte(p) {
		builtinAddr[(i%4)+12] ^= b
	}
	netId := MkNetID(p)
	builtinAddr[12], builtinAddr[13], builtinAddr[14], builtinAddr[15] = netId[0], netId[1], netId[2], netId[3]
	return net.IP(builtinAddr).To16()
}


func main() {
	peerID := flag.String("peer", "", "peer id to use")
	flag.Parse()
	if *peerID == "" {
		if flag.NArg() > 0 {
			*peerID = flag.Arg(0)
		} else {
			fmt.Fprintf(os.Stderr, "Usage: %s <peer id>\n", os.Args[0])
			os.Exit(1)
		}
	}
	fmt.Print(mkBuiltinAddr6(*peerID))
}