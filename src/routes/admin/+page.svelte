<!--
  Contract admin, done from the owner's browser wallet (MetaMask).
  Nothing here goes through the app server: the wallet signs, and the
  contract decides who is allowed.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import {
    BaseError,
    createPublicClient,
    createWalletClient,
    custom,
    http,
    isAddress,
    isAddressEqual,
    type Address,
  } from "viem";
  import { PUBLIC_CHAIN_ID, PUBLIC_RAFFLE_CONTRACT, PUBLIC_RPC_URL } from "$app/env/public";
  import { chainInfo, explorerLink } from "#lib/chain/chains.ts";
  import { raffleDrawAbi } from "#lib/chain/raffle-draw-abi.ts";

  const { chain } = chainInfo(PUBLIC_CHAIN_ID);
  const contract = PUBLIC_RAFFLE_CONTRACT;
  const publicClient = createPublicClient({ chain, transport: http(PUBLIC_RPC_URL) });

  let owner = $state<Address | null>(null);
  let drawer = $state<Address | null>(null);
  let account = $state<Address | null>(null);
  let busy = $state<string | null>(null);
  let message = $state<{ ok: boolean; text: string; tx?: string } | null>(null);
  let newDrawer = $state("");

  const isOwner = $derived(Boolean(account && owner && isAddressEqual(account, owner)));

  async function refresh() {
    if (!contract) return;
    [owner, drawer] = await Promise.all([
      publicClient.readContract({ address: contract, abi: raffleDrawAbi, functionName: "owner" }),
      publicClient.readContract({ address: contract, abi: raffleDrawAbi, functionName: "drawer" }),
    ]);
  }

  function wallet() {
    if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask and reload this page.");
    return createWalletClient({ chain, transport: custom(window.ethereum) });
  }

  async function connect() {
    message = null;
    try {
      const client = wallet();
      [account] = await client.requestAddresses();
      await client.switchChain({ id: chain.id });
    } catch (err) {
      message = { ok: false, text: describe(err) };
    }
  }

  function describe(err: unknown) {
    if (err instanceof BaseError) return err.shortMessage;
    return err instanceof Error ? err.message : String(err);
  }

  async function send(label: string, functionName: "acceptOwnership" | "setDrawer", args?: [Address]) {
    if (!contract || !account) return;
    busy = label;
    message = null;
    try {
      const client = wallet();
      await client.switchChain({ id: chain.id });
      // Simulate first so a refusal shows the contract's reason, not a failed transaction.
      const { request } = await publicClient.simulateContract({
        address: contract,
        abi: raffleDrawAbi,
        functionName,
        args: args as never,
        account,
      });
      const hash = await client.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      message = { ok: true, text: `${label}: done.`, tx: explorerLink(chain.id, "tx", hash) ?? hash };
      await refresh();
    } catch (err) {
      message = { ok: false, text: describe(err) };
    } finally {
      busy = null;
    }
  }

  onMount(async () => {
    await refresh();
    // Pick up an already-connected wallet without prompting.
    const accounts = (await window.ethereum?.request({ method: "eth_accounts" })) as Address[] | undefined;
    if (accounts?.[0]) account = accounts[0];
  });
</script>

<svelte:head><title>Contract admin | VRF Hat</title></svelte:head>

<div class="wrap">
  <h1>Contract admin</h1>
  <p class="muted">
    The raffle contract's owner can change who draws. Your wallet signs these changes directly; this
    site never sees your key.
  </p>

  {#if !contract}
    <p class="error">No contract is configured (PUBLIC_RAFFLE_CONTRACT is empty).</p>
  {:else}
    <dl class="facts">
      <div>
        <dt>Contract</dt>
        <dd class="mono"><a href={explorerLink(chain.id, "address", contract)} target="_blank" rel="noreferrer">{contract}</a></dd>
      </div>
      <div><dt>Network</dt><dd>{chain.name}</dd></div>
      <div><dt>Owner</dt><dd class="mono">{owner ?? "…"}</dd></div>
      <div><dt>Drawer (app server)</dt><dd class="mono">{drawer ?? "…"}</dd></div>
      <div><dt>Your wallet</dt><dd class="mono">{account ?? "Not connected"}</dd></div>
    </dl>

    {#if !account}
      <button onclick={connect}>Connect MetaMask</button>
    {:else if isOwner}
      <p class="ok">✓ Your wallet owns this contract.</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          if (isAddress(newDrawer)) send("Replace drawer", "setDrawer", [newDrawer]);
          else message = { ok: false, text: "Enter a valid address." };
        }}
      >
        <div class="field">
          <label for="drawer">Replace the drawer <span class="hint">if the server key is lost or leaked</span></label>
          <input id="drawer" type="text" bind:value={newDrawer} placeholder="0x…" autocomplete="off" />
        </div>
        <button class="secondary" disabled={busy !== null}>{busy === "Replace drawer" ? "Waiting for wallet…" : "Replace drawer"}</button>
      </form>
    {:else}
      <section>
        <h2>Accept ownership</h2>
        <p>
          If this contract was deployed with your wallet as the proposed owner, accept it here. It costs
          a small amount of test ETH for gas.
        </p>
        <button disabled={busy !== null} onclick={() => send("Accept ownership", "acceptOwnership")}>
          {busy === "Accept ownership" ? "Waiting for wallet…" : "Accept ownership"}
        </button>
      </section>
    {/if}

    {#if message}
      <p class={message.ok ? "ok" : "error"} role="status">
        {message.text}
        {#if message.tx}<a href={message.tx} target="_blank" rel="noreferrer">View transaction</a>{/if}
      </p>
    {/if}
  {/if}
</div>

<style>
  .wrap {
    padding-top: 2rem;
  }
  .facts {
    display: grid;
    gap: 0.5rem;
    margin: 1.5rem 0 2rem;
    padding: 1rem 1.25rem;
    background: var(--surface);
    border-radius: 4px;
  }
  .facts div {
    display: grid;
    grid-template-columns: minmax(8rem, 12rem) minmax(0, 1fr);
    gap: 0.75rem;
  }
  .facts dt {
    color: var(--ink-soft);
  }
  .facts dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  @media (max-width: 560px) {
    .facts div {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }
  .ok {
    color: var(--pass);
    font-weight: 600;
  }
  form {
    max-width: 32rem;
  }
</style>
