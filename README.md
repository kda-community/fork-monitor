# Chainweb Fork Monitor

A live dashboard for on-chain miner voting on the [Kadena Community Edition](https://kda-chain.org/)
Chainweb network. It reads the tip block header of every chain, parses the
**ForkState** flag, and shows how close the network is to activating the next fork.

No dependencies, no build step — plain HTML, CSS, and JavaScript.

## What it shows

- **Fork vote support** — the share of recent blocks signaling for the next fork,
  against the two-thirds activation threshold
- **Current fork number** across all 20 chains
- **Fork epoch progress** — position within the current 14,400-block epoch and the
  estimated time until the next activation decision
- **Per-chain detail** — tip height, votes, support, and epoch phase for each chain

Data refreshes automatically every 30 seconds.

## How it works

1. Fetch the current [cut](https://api.chainweb-community.org/chainweb/0.0/mainnet01/cut)
   (the tip of every chain).
2. Fetch each tip's block header in its binary encoding.
3. Decode the first 8 bytes — the ForkState field, a little-endian 64-bit word:

   | Bits  | Field        | Meaning                                        |
   |-------|--------------|------------------------------------------------|
   | 0–31  | Fork number  | The fork the block was mined under             |
   | 32–63 | Vote counter | Votes this epoch, quantized (one vote = 1,000) |

4. Derive the voting state from the [ForkState rules](https://github.com/kadena-io/chainweb-node/blob/master/src/Chainweb/ForkState.hs):
   a fork epoch is 14,400 blocks — during the first 14,280 each block may add one
   vote, and during the last 120 the chains average their counters so the whole
   network converges on one total. A fork activates at the next epoch start if at
   least 2/3 of the voting blocks (9,520 of 14,280) signaled for it.

The header is parsed from its raw bytes with `BigInt` because the API's decoded
JSON exposes the field as a float, which loses precision at high vote counts.

## Running

Open `index.html` in a browser, or serve the directory with any static file server:

```sh
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Files

```
index.html    page structure
style.css     dark theme, kda-chain.org color scheme
chainweb.js   API client, ForkState parsing, epoch math
app.js        refresh loop and rendering
img/          logo and favicon from kda-chain.org
```

## Data source

All data comes from the public community API at
[api.chainweb-community.org](https://api.chainweb-community.org) (Chainweb
service API, `mainnet01`). To use a different node, change the `API` constant
at the top of `chainweb.js`.

## License

[Apache 2.0](LICENSE)
