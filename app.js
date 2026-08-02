(() => {
    const REFRESH_MS = 30000;

    const $ = (id) => document.getElementById(id);
    const chainGrid = $("chain-grid");
    const tileTemplate = $("chain-tile-template");

    let inFlight = false;
    let lastUpdate = 0;

    const fmtInt = (n) => n.toLocaleString("en-US");

    function fmtPct(ratio) {
        const pct = ratio * 100;
        if (pct === 0) return "0";
        return pct < 1 ? pct.toFixed(2) : pct.toFixed(1);
    }

    function fmtDuration(blocks) {
        let s = blocks * Chainweb.BLOCK_TIME_SECONDS;
        const d = Math.floor(s / 86400);
        s %= 86400;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (d > 0) return `~${d}d ${h}h`;
        if (h > 0) return `~${h}h ${m}m`;
        return `~${m}m`;
    }

    async function loadChain(id, tip) {
        try {
            const header = await Chainweb.fetchHeader(id, tip.hash);
            const state = Chainweb.parseForkState(header);
            const epoch = Chainweb.epochInfo(tip.height);
            const opportunities = Chainweb.voteOpportunities(epoch);
            return {
                id,
                height: tip.height,
                hash: tip.hash,
                epoch,
                opportunities,
                support: state.votes / opportunities,
                ...state,
            };
        } catch (err) {
            return { id, height: tip.height, hash: tip.hash, error: err.message };
        }
    }

    function aggregate(chains) {
        const ok = chains.filter((c) => !c.error);
        const totalVotes = ok.reduce((sum, c) => sum + c.votes, 0);
        const totalOpportunities = ok.reduce((sum, c) => sum + c.opportunities, 0);
        const forkNumbers = [...new Set(ok.map((c) => c.forkNumber))].sort((a, b) => a - b);
        const counting = ok.filter((c) => c.epoch.phase === "counting").length;
        const meanPosition = ok.length
            ? Math.round(ok.reduce((sum, c) => sum + c.epoch.position, 0) / ok.length)
            : 0;
        return {
            ok,
            forkNumbers,
            support: totalOpportunities ? totalVotes / totalOpportunities : 0,
            avgVotes: ok.length ? Math.round(totalVotes / ok.length) : 0,
            avgOpportunities: ok.length ? Math.round(totalOpportunities / ok.length) : 0,
            phase: counting > ok.length / 2 ? "counting" : "voting",
            meanPosition,
            blocksToEnd: Chainweb.FORK_EPOCH_LENGTH - meanPosition,
            blocksToCounting: Math.max(0, Chainweb.VOTING_LENGTH - meanPosition),
        };
    }

    function renderSummary(cut, net) {
        const nextFork = (net.forkNumbers[net.forkNumbers.length - 1] ?? 0) + 1;

        $("support-pct").textContent = fmtPct(net.support);
        $("support-fill").style.width = `${Math.min(net.support * 100, 100)}%`;

        if (net.phase === "counting") {
            $("verdict").textContent =
                "Counting period — chains are averaging their vote totals before the decision.";
        } else if (net.support >= Chainweb.ACTIVATION_RATIO) {
            $("verdict").textContent =
                `On track — above the two-thirds threshold to activate fork ${nextFork}.`;
        } else {
            $("verdict").textContent =
                `Below the two-thirds threshold needed to activate fork ${nextFork}.`;
        }

        $("fork-number").textContent = net.forkNumbers.join(" / ") || "–";
        $("fork-number-sub").textContent =
            net.forkNumbers.length > 1
                ? "chains disagree — transition in progress"
                : "across all chains";

        $("votes").textContent = fmtInt(net.avgVotes);
        $("votes-sub").textContent =
            net.phase === "voting"
                ? `avg per chain, of ${fmtInt(net.avgOpportunities)} blocks · ${fmtInt(Chainweb.VOTES_TO_ACTIVATE)} to pass`
                : `network total · ${fmtInt(Chainweb.VOTES_TO_ACTIVATE)} to pass`;

        $("epoch-progress").textContent = `${fmtPct(net.meanPosition / Chainweb.FORK_EPOCH_LENGTH)}%`;
        $("epoch-progress-sub").textContent =
            `block ${fmtInt(net.meanPosition)} of ${fmtInt(Chainweb.FORK_EPOCH_LENGTH)}`;

        $("decision-eta").textContent = fmtDuration(net.blocksToEnd);
        $("decision-sub").textContent =
            net.phase === "voting"
                ? `counting starts in ${fmtDuration(net.blocksToCounting)}`
                : "counting in progress";

        $("timeline-progress").style.width =
            `${(net.meanPosition / Chainweb.FORK_EPOCH_LENGTH) * 100}%`;
        $("phase-label").textContent =
            net.phase === "voting" ? "Voting period" : "Counting period";

        $("cut-info").textContent =
            `Cut height ${fmtInt(cut.height)} · ${Object.keys(cut.hashes).length} chains`;
    }

    function renderChains(chains) {
        chainGrid.replaceChildren();
        for (const chain of chains) {
            const tile = tileTemplate.content.firstElementChild.cloneNode(true);
            tile.querySelector(".chain-name").textContent = `Chain ${chain.id}`;
            tile.querySelector(".chain-height").textContent = fmtInt(chain.height);
            if (chain.error) {
                tile.classList.add("error");
                tile.querySelector(".phase-text").textContent = "error";
                tile.querySelector(".chain-votes").textContent = "header unavailable";
                tile.title = chain.error;
            } else {
                tile.querySelector(".phase-dot").classList.add(chain.epoch.phase);
                tile.querySelector(".phase-text").textContent = chain.epoch.phase;
                tile.querySelector(".chain-votes").textContent =
                    `${fmtInt(chain.votes)} votes · ${fmtPct(chain.support)}%`;
                tile.querySelector(".minibar-fill").style.width =
                    chain.votes > 0 ? `${Math.max(chain.support * 100, 1)}%` : "0";
                tile.title = `Tip ${chain.hash} · fork ${chain.forkNumber}`;
            }
            chainGrid.append(tile);
        }
    }

    function setStatus(state, text) {
        const dot = $("status-dot");
        dot.classList.remove("live", "error");
        if (state) dot.classList.add(state);
        $("status-text").textContent = text;
    }

    function showError(message) {
        $("error-text").textContent = message;
        $("error-banner").hidden = false;
    }

    async function refresh() {
        if (inFlight) return;
        inFlight = true;
        try {
            const cut = await Chainweb.fetchCut();
            const tips = Object.entries(cut.hashes).sort((a, b) => a[0] - b[0]);
            const chains = await Promise.all(tips.map(([id, tip]) => loadChain(Number(id), tip)));

            $("network").textContent = cut.instance;
            renderSummary(cut, aggregate(chains));
            renderChains(chains);

            const failed = chains.filter((c) => c.error).length;
            lastUpdate = Date.now();
            const time = new Date(lastUpdate).toLocaleTimeString("en-US", { hour12: false });
            if (failed > 0) {
                setStatus("error", `Updated ${time} · ${failed} chains unavailable`);
            } else {
                setStatus("live", `Updated ${time}`);
                $("error-banner").hidden = true;
            }
        } catch (err) {
            setStatus("error", "Connection failed");
            showError(`Could not reach ${Chainweb.API} — ${err.message}. Retrying every 30 s.`);
        } finally {
            inFlight = false;
        }
    }

    $("error-dismiss").addEventListener("click", () => {
        $("error-banner").hidden = true;
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && Date.now() - lastUpdate > REFRESH_MS) refresh();
    });

    refresh();
    setInterval(refresh, REFRESH_MS);
})();
