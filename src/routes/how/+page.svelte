<svelte:head><title>How it works | VRF Hat</title></svelte:head>

<article class="page reading">
  <header class="page-head">
    <h1>How it works</h1>
    <p class="lede">
      Collect entries, then let Chainlink's verifiable randomness pull names from the hat. Every step is recorded
      on a public blockchain, so nobody has to take your word that the draw was fair.
    </p>
  </header>

  <section class="section">
    <div class="section-head"><h2>A draw, step by step</h2></div>
    <ol class="steps how">
      <li>
        <span class="step-name">The list is sealed</span>
        <span class="step-note">
          When a draw starts, entries close and a fingerprint of the full list (a Merkle root) is written
          to the blockchain. The list has one line per ticket. Changing a single name afterwards would
          change the fingerprint.
        </span>
      </li>
      <li>
        <span class="step-name">Chainlink picks a number</span>
        <span class="step-note">
          In the same transaction, the raffle asks Chainlink VRF for a random number. It arrives with a
          cryptographic proof that the chain checks before accepting it. Nobody, including us, can see the
          number in advance or ask for another one.
        </span>
      </li>
      <li>
        <span class="step-name">Anyone can redo the math</span>
        <span class="step-note">
          The tickets pulled follow from the number by a fixed public formula. Each draw has a verify
          page that re-checks every step in your browser against the blockchain, without trusting this site.
        </span>
      </li>
    </ol>
  </section>

  <section class="section">
    <div class="section-head"><h2>Running a raffle</h2></div>
    <div class="prose">
      <p>
        Name the raffle and choose how many names each draw pulls. You can add names yourself, one per
        line or separated by commas, or let people sign in and add their own.
      </p>
      <p>
        Drawing closes entries and seals the list on the blockchain. It can't be undone, and the result
        can't be re-rolled. Usually Chainlink answers within a minute, and the raffle page updates on its
        own when it does.
      </p>
    </div>
  </section>

  <section class="section" id="options">
    <div class="section-head"><h2>Tickets, eliminations and repeat draws</h2></div>
    <div class="prose">
      <p>
        <strong>More than one ticket.</strong> A name can hold several tickets: write
        <code>Dev Patel x3</code> when adding names, or change the number beside a name. Each ticket is its
        own line in the sealed list, so three tickets are three times as likely to be pulled as one.
      </p>
      <p>
        <strong>Winners or eliminations.</strong> A raffle either draws winners or draws names out. In an
        elimination, a name is out once all of its tickets have been pulled, and whoever is left at the
        end comes out on top. Which kind it is gets fixed when the raffle is created and is part of each
        draw's on-chain key, so a list of eliminations can't be passed off as a list of winners.
      </p>
      <p>
        <strong>Repeat draws.</strong> A raffle can draw once, on a schedule, or whenever the host says.
        Every round is its own sealed list and its own Chainlink number, with its own verify page. Between
        rounds the hat reopens, so names and tickets can be added. A pulled ticket stays out of later
        rounds unless the host chose to put winners back. A scheduled round that finds too few tickets is
        skipped. The raffle finishes when the hat runs out, when an elimination is down to the number of
        names to keep, after a set number of draws, or when the host ends it.
      </p>
    </div>
  </section>

  <section class="section" id="verify">
    <div class="section-head"><h2>What the verify page checks</h2></div>
    <p class="prose intro">
      Your browser reads the blockchain directly and redoes each step of the draw. It doesn't rely on
      anything this site says beyond where to look.
    </p>
    <dl class="kv">
      <div>
        <dt>1 · Sealed</dt>
        <dd>The published list rebuilds the exact fingerprint stored on the blockchain.</dd>
      </div>
      <div>
        <dt>2 · Requested</dt>
        <dd>The same transaction stored the fingerprint and asked Chainlink for a number.</dd>
      </div>
      <div>
        <dt>3 · Proven</dt>
        <dd>The number comes from Chainlink's VRF key, and its proof was checked on-chain.</dd>
      </div>
      <div>
        <dt>4 · Winners</dt>
        <dd>Re-running the public shuffle pulls the same tickets as the contract.</dd>
      </div>
    </dl>
    <p class="prose intro">
      You can also search for any ticket and ask the contract itself whether it was in the sealed list.
      On a local test chain the proof check is skipped, because there is no real Chainlink there.
    </p>
  </section>

  <section class="section" id="by-hand">
    <div class="section-head"><h2>Checking without this site</h2></div>
    <p class="prose intro">
      Every draw's verify page links to a by-hand guide filled in with that draw's contract and key.
      In short:
    </p>
    <ol class="prose diy">
      <li>
        Download the sealed list (one line per ticket) and rebuild its Merkle root. Each leaf is
        <code>keccak256(keccak256(abi.encode(uint32 index, bytes16 ticket, string label)))</code>; pairs are
        hashed in sorted order, and an unpaired node moves up unchanged.
      </li>
      <li>
        Call <code>getDraw(key)</code> on the contract and compare <code>entrantsRoot</code> with your root.
        The key is the hash of the raffle's ID, plus the round and kind of draw for anything but a first
        draw of winners.
      </li>
      <li>
        Call <code>pickWinners(randomWord, entrantCount, winnerCount)</code> and look up those positions in
        the list. In an elimination those positions are the tickets drawn out. The source is in
        <code>contracts/RaffleDraw.sol</code>.
      </li>
    </ol>
  </section>
</article>

<style>
  .how li {
    padding-block: var(--s-3);
  }
  .how .step-note {
    margin-top: var(--s-1);
    font-family: var(--font-prose);
    font-size: var(--fs-base);
    line-height: 1.55;
    color: var(--ink-2);
  }
  .kv dd {
    font-family: var(--font-prose);
    font-size: var(--fs-base);
    line-height: 1.55;
  }
  .intro {
    margin-block: var(--lh);
  }
  .diy {
    padding-left: 3ch;
  }
  .diy li + li {
    margin-top: var(--s-3);
  }
</style>
