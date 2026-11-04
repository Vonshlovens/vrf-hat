import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEventLogs, toHex, type Hex } from "viem";
import {
  commitmentRoot,
  entrantLeaf,
  merkleProof,
  merkleRoot,
  raffleKey,
  verifyMerkleProof,
  type CommittedEntrant,
} from "../../src/lib/draw/commitment.ts";
import { pickWinners } from "../../src/lib/draw/winners.ts";

const { viem, networkHelpers } = await network.create();

const KEY_HASH = "0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71";

function entrants(n: number): CommittedEntrant[] {
  return Array.from({ length: n }, (_, index) => ({
    index,
    ticket: toHex(BigInt(index + 1) * 0x1234567n, { size: 16 }),
    label: `Entrant ${index}`,
  }));
}

async function deploy() {
  const publicClient = await viem.getPublicClient();
  const [owner, stranger, admin] = await viem.getWalletClients();
  const coordinator = await viem.deployContract("VRFCoordinatorV2_5Mock", [
    100000000000000000n,
    1000000000n,
    4000000000000000n,
  ]);
  const createTx = await coordinator.write.createSubscription();
  const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  const [created] = parseEventLogs({
    abi: coordinator.abi,
    logs: receipt.logs,
    eventName: "SubscriptionCreated",
  });
  const subId = created.args.subId;
  await coordinator.write.fundSubscription([subId, 100n * 10n ** 18n]);

  const raffle = await viem.deployContract("RaffleDraw", [
    coordinator.address,
    subId,
    KEY_HASH,
    3,
    200_000,
    false,
    owner.account.address, // drawer
    admin.account.address, // proposed owner
  ]);
  await coordinator.write.addConsumer([subId, raffle.address]);
  return { publicClient, owner, stranger, admin, coordinator, raffle };
}

async function requestAndGetId(
  ctx: Awaited<ReturnType<typeof deploy>>,
  id: Hex,
  root: Hex,
  n: number,
  k: number,
) {
  const hash = await ctx.raffle.write.requestDraw([id, root, n, k]);
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  const [ev] = parseEventLogs({
    abi: ctx.raffle.abi,
    logs: receipt.logs,
    eventName: "DrawRequested",
  });
  return ev.args.requestId;
}

describe("RaffleDraw", () => {
  it("commits, fulfils, and picks the same winners as the TypeScript mirror", async () => {
    const ctx = await deploy();
    const list = entrants(25);
    const root = commitmentRoot(list);
    const id = raffleKey("raffle-1");

    const requestId = await requestAndGetId(ctx, id, root, list.length, 3);
    const word = 0xdeadbeefcafebabe1234567890n;
    await ctx.coordinator.write.fulfillRandomWordsWithOverride([
      requestId,
      ctx.raffle.address,
      [word],
    ]);

    const draw = await ctx.raffle.read.getDraw([id]);
    assert.equal(draw.entrantsRoot, root);
    assert.equal(draw.randomWord, word);
    assert.ok(draw.fulfilledBlock > draw.requestedBlock);

    const onChain = await ctx.raffle.read.winningIndices([id]);
    assert.deepEqual([...onChain], pickWinners(word, 25, 3));
  });

  it("matches the mirror for many words and sizes, always picking distinct winners", async () => {
    const ctx = await deploy();
    for (const [n, k] of [
      [1, 1],
      [2, 2],
      [7, 3],
      [50, 50],
      [1000, 10],
    ] as const) {
      for (let s = 0n; s < 5n; s++) {
        const word = (s + 1n) * 0x9e3779b97f4a7c15f39cc0605cedc834n;
        const sol = [...(await ctx.raffle.read.pickWinners([word, n, k]))];
        const ts = pickWinners(word, n, k);
        assert.deepEqual(sol, ts, `n=${n} k=${k}`);
        assert.equal(new Set(ts).size, k);
        assert.ok(ts.every((w) => w >= 0 && w < n));
      }
    }
  });

  it("verifies Merkle proofs on-chain for every entrant, and rejects a forged one", async () => {
    const ctx = await deploy();
    const list = entrants(13); // odd size exercises the carried-up node
    const leaves = list.map(entrantLeaf);
    const root = merkleRoot(leaves);
    const id = raffleKey("raffle-merkle");
    await ctx.raffle.write.requestDraw([id, root, list.length, 1]);

    for (let i = 0; i < leaves.length; i++) {
      const proof = merkleProof(leaves, i);
      assert.ok(verifyMerkleProof(leaves[i], proof, root));
      assert.ok(await ctx.raffle.read.isCommittedEntrant([id, leaves[i], proof]));
    }
    const forged = entrantLeaf({ ...list[4], label: "Someone else" });
    assert.equal(
      await ctx.raffle.read.isCommittedEntrant([id, forged, merkleProof(leaves, 4)]),
      false,
    );
  });

  it("allows exactly one draw per raffle", async () => {
    const ctx = await deploy();
    const id = raffleKey("raffle-once");
    const root = commitmentRoot(entrants(5));
    await ctx.raffle.write.requestDraw([id, root, 5, 1]);
    await viem.assertions.revertWithCustomError(
      ctx.raffle.write.requestDraw([id, root, 5, 1]),
      ctx.raffle,
      "AlreadyRequested",
    );
  });

  it("rejects bad parameters and non-drawers", async () => {
    const ctx = await deploy();
    const id = raffleKey("raffle-bad");
    const root = commitmentRoot(entrants(5));
    await viem.assertions.revertWithCustomError(
      ctx.raffle.write.requestDraw([id, root, 5, 6]),
      ctx.raffle,
      "InvalidWinnerCount",
    );
    await viem.assertions.revertWithCustomError(
      ctx.raffle.write.requestDraw([id, root, 0, 0]),
      ctx.raffle,
      "InvalidEntrantCount",
    );
    await viem.assertions.revertWithCustomError(
      ctx.raffle.write.requestDraw([id, root, 10_001, 1]),
      ctx.raffle,
      "InvalidEntrantCount",
    );
    const asStranger = await viem.getContractAt("RaffleDraw", ctx.raffle.address, {
      client: { wallet: ctx.stranger },
    });
    await viem.assertions.revertWithCustomError(
      asStranger.write.requestDraw([id, root, 5, 1]),
      ctx.raffle,
      "OnlyDrawer",
    );
  });

  it("only lets the coordinator deliver randomness", async () => {
    const ctx = await deploy();
    const id = raffleKey("raffle-direct");
    const requestId = await requestAndGetId(ctx, id, commitmentRoot(entrants(3)), 3, 1);
    await viem.assertions.revertWithCustomError(
      ctx.raffle.write.rawFulfillRandomWords([requestId, [1n]]),
      ctx.raffle,
      "OnlyCoordinatorCanFulfill",
    );
  });

  it("retries an unanswered request only after the delay, and ignores the stale answer", async () => {
    const ctx = await deploy();
    const id = raffleKey("raffle-retry");
    const first = await requestAndGetId(ctx, id, commitmentRoot(entrants(4)), 4, 1);

    await viem.assertions.revertWithCustomError(
      ctx.raffle.write.retryDraw([id]),
      ctx.raffle,
      "TooEarlyToRetry",
    );
    await networkHelpers.mine(1800);
    const hash = await ctx.raffle.write.retryDraw([id]);
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    const [retried] = parseEventLogs({
      abi: ctx.raffle.abi,
      logs: receipt.logs,
      eventName: "DrawRetried",
    });
    assert.equal(retried.args.previousRequestId, first);
    const second = retried.args.requestId;

    // The old request arriving late changes nothing.
    await ctx.coordinator.write.fulfillRandomWordsWithOverride([first, ctx.raffle.address, [111n]]);
    assert.equal((await ctx.raffle.read.getDraw([id])).fulfilledBlock, 0n);

    await ctx.coordinator.write.fulfillRandomWordsWithOverride([
      second,
      ctx.raffle.address,
      [222n],
    ]);
    const draw = await ctx.raffle.read.getDraw([id]);
    assert.equal(draw.randomWord, 222n);
    await viem.assertions.revertWithCustomError(
      ctx.raffle.write.retryDraw([id]),
      ctx.raffle,
      "AlreadyFulfilled",
    );
  });

  it("refuses to report winners before fulfilment", async () => {
    const ctx = await deploy();
    const id = raffleKey("raffle-pending");
    await ctx.raffle.write.requestDraw([id, commitmentRoot(entrants(3)), 3, 1]);
    await viem.assertions.revertWithCustomError(
      ctx.raffle.read.winningIndices([id]),
      ctx.raffle,
      "NotFulfilled",
    );
  });

  it("hands ownership to the proposed owner, who alone can change settings", async () => {
    const ctx = await deploy();
    const asAdmin = await viem.getContractAt("RaffleDraw", ctx.raffle.address, {
      client: { wallet: ctx.admin },
    });
    const asStranger = await viem.getContractAt("RaffleDraw", ctx.raffle.address, {
      client: { wallet: ctx.stranger },
    });

    await viem.assertions.revertWith(asStranger.write.acceptOwnership(), "Must be proposed owner");
    await asAdmin.write.acceptOwnership();
    assert.equal(
      (await ctx.raffle.read.owner()).toLowerCase(),
      ctx.admin.account.address.toLowerCase(),
    );

    // The drawer (deployer) no longer has owner powers.
    await viem.assertions.revertWith(
      ctx.raffle.write.setDrawer([ctx.stranger.account.address]),
      "Only callable by owner",
    );

    // The owner can rotate the drawer; the old drawer can no longer draw.
    await asAdmin.write.setDrawer([ctx.stranger.account.address]);
    const root = commitmentRoot(entrants(3));
    await viem.assertions.revertWithCustomError(
      ctx.raffle.write.requestDraw([raffleKey("rotated"), root, 3, 1]),
      ctx.raffle,
      "OnlyDrawer",
    );
    await asStranger.write.requestDraw([raffleKey("rotated"), root, 3, 1]);
  });
});
