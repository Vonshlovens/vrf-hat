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

<div class="page reading">
  <header class="page-head">
    <h1>Contract admin</h1>
    <p class="lede">
      The raffle contract's owner can change who draws. Your wallet signs these changes directly; this
      site never sees your key.
    </p>
  </header>

  {#if !contract}
    <div class="state" data-tone="fail" role="alert">
      <h3>No contract is configured</h3>
      <p><code>PUBLIC_RAFFLE_CONTRACT</code> is empty.</p>
    </div>
  {:else}
    <dl class="kv">
      <div>
        <dt>Contract</dt>
        <dd><a href={explorerLink(chain.id, "address", contract)} target="_blank" rel="noreferrer">{contract}</a></dd>
      </div>
      <div><dt>Network</dt><dd>{chain.name}</dd></div>
      <div><dt>Owner</dt><dd>{owner ?? "Loading…"}</dd></div>
      <div><dt>Drawer (app server)</dt><dd>{drawer ?? "Loading…"}</dd></div>
      <div>
        <dt>Your wallet</dt>
        <dd>
          {#if account}
            {account}
            {#if isOwner}<span class="status" data-tone="ok">owner</span>{/if}
          {:else}
            <span class="status" data-tone="idle">not connected</span>
          {/if}
        </dd>
      </div>
    </dl>

    <section class="section">
      {#if !account}
        <div class="btn-row">
          <button class="btn primary" onclick={connect}>Connect MetaMask</button>
        </div>
      {:else if isOwner}
        <div class="section-head"><h2>Replace the drawer</h2></div>
        <form
          class="form"
          onsubmit={(e) => {
            e.preventDefault();
            if (isAddress(newDrawer)) send("Replace drawer", "setDrawer", [newDrawer]);
            else message = { ok: false, text: "Enter a valid address." };
          }}
        >
          <div class="field">
            <label for="drawer">New drawer address</label>
            <input
              class="input"
              id="drawer"
              type="text"
              bind:value={newDrawer}
              placeholder="0x…"
              autocomplete="off"
              aria-describedby="drawer-hint"
            />
            <p class="hint" id="drawer-hint">Use this if the server key is lost or leaked.</p>
          </div>
          <div class="btn-row">
            <button class="btn danger" disabled={busy !== null}>
              {busy === "Replace drawer" ? "Waiting for wallet…" : "Replace drawer"}
            </button>
          </div>
        </form>
      {:else}
        <div class="section-head"><h2>Accept ownership</h2></div>
        <div class="flow">
          <p class="prose">
            If this contract was deployed with your wallet as the proposed owner, accept it here. It costs a
            small amount of test ETH for gas.
          </p>
          <div class="btn-row">
            <button class="btn primary" disabled={busy !== null} onclick={() => send("Accept ownership", "acceptOwnership")}>
              {busy === "Accept ownership" ? "Waiting for wallet…" : "Accept ownership"}
            </button>
          </div>
        </div>
      {/if}

      {#if message}
        <p class="notice result" data-tone={message.ok ? "ok" : "fail"} role="status">
          <span class="status" data-tone={message.ok ? "ok" : "fail"}>{message.ok ? "done" : "failed"}</span>
          <span>{message.text}</span>
          {#if message.tx}<span class="notice-actions"><a href={message.tx} target="_blank" rel="noreferrer">View transaction</a></span>{/if}
        </p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .form {
    max-width: 60ch;
  }
  .result {
    margin-top: var(--lh);
  }
  .kv .status {
    margin-left: 1ch;
  }
</style>
