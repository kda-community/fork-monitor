/* Chainweb API client and ForkState parsing.
 *
 * ForkState is the first 8 bytes of the binary block header (the former
 * feature-flags field), encoded as a little-endian 64-bit word:
 *
 *   bits  0-31  fork number
 *   bits 32-63  vote counter, quantized: one vote = 1000
 *
 * A fork epoch is 14,400 blocks. During the first 14,280 each block may
 * add one vote to its chain's counter; during the last 120 each block
 * averages the counters of its parent and adjacent parents, so all
 * chains converge on a network-wide value. A fork activates at the next
 * epoch start when at least 2/3 of the voting blocks signaled.
 *
 * Reference: kadena-io/chainweb-node, src/Chainweb/ForkState.hs
 */
const Chainweb = (() => {
    const API = "https://api.chainweb-community.org/chainweb/0.0/mainnet01";

    const FORK_EPOCH_LENGTH = 14400;
    const VOTE_COUNT_LENGTH = 120;
    const VOTING_LENGTH = FORK_EPOCH_LENGTH - VOTE_COUNT_LENGTH;
    const VOTE_STEP = 1000;
    const ACTIVATION_RATIO = 2 / 3;
    const VOTES_TO_ACTIVATE = Math.ceil(VOTING_LENGTH * ACTIVATION_RATIO);
    const BLOCK_TIME_SECONDS = 30;

    async function getJson(url) {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return res.json();
    }

    function fetchCut() {
        return getJson(`${API}/cut`);
    }

    /** Returns the base64url-encoded binary header of a block. */
    function fetchHeader(chainId, hash) {
        return getJson(`${API}/chain/${chainId}/header/${hash}`);
    }

    /* BigInt keeps the upper 32 bits exact; the API's decoded JSON header
     * exposes the same word as a float, which loses precision once the
     * counter is large. */
    function parseForkState(headerBase64url) {
        const b64 = headerBase64url.replace(/-/g, "+").replace(/_/g, "/");
        const bin = atob(b64);
        const bytes = new Uint8Array(8);
        for (let i = 0; i < 8; i++) bytes[i] = bin.charCodeAt(i);
        const state = new DataView(bytes.buffer).getBigUint64(0, true);
        const counter = Number(state >> 32n);
        return {
            forkNumber: Number(state & 0xffffffffn),
            counter,
            votes: Math.round(counter / VOTE_STEP),
        };
    }

    function epochInfo(height) {
        const position = height % FORK_EPOCH_LENGTH;
        const voting = position < VOTING_LENGTH;
        return {
            position,
            phase: voting ? "voting" : "counting",
            blocksToCounting: voting ? VOTING_LENGTH - position : 0,
            blocksToEnd: FORK_EPOCH_LENGTH - position,
        };
    }

    /* Voting blocks each carry at most one vote, so a tip at epoch
     * position p has seen p + 1 opportunities. Once counting starts the
     * counter approximates the network-wide total for the whole voting
     * period instead. */
    function voteOpportunities(epoch) {
        return epoch.phase === "voting" ? epoch.position + 1 : VOTING_LENGTH;
    }

    return {
        API,
        FORK_EPOCH_LENGTH,
        VOTE_COUNT_LENGTH,
        VOTING_LENGTH,
        ACTIVATION_RATIO,
        VOTES_TO_ACTIVATE,
        BLOCK_TIME_SECONDS,
        fetchCut,
        fetchHeader,
        parseForkState,
        epochInfo,
        voteOpportunities,
    };
})();
