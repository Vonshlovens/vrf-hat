// Browser-side verification of a draw. Everything here comes from the public
// chain plus the published entrant list; nothing is taken from this app's
// server except where to look (and those pointers are checked too).
import {
  createPublicClient,
  decodeFunctionData,
  http,
  isAddressEqual,
  parseEventLogs,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { chainInfo, explorerLink } from "#lib/chain/chains.ts";
import { coordinatorAbi } from "#lib/chain/coordinator-abi.ts";
import { raffleDrawAbi } from "#lib/chain/raffle-draw-abi.ts";
import { commitmentRoot, type CommittedEntrant } from "#lib/draw/commitment.ts";
import { pickWinners, stepHash } from "#lib/draw/winners.ts";
import { actualSeedOf, keyHashOf, randomWordOf, requestIdOf, vrfOutputOf } from "#lib/draw/vrf.ts";

export type Check = { label: string; ok: boolean };
export type Fact = { label: string; value: string; href?: string | null; mono?: boolean };
export type StepStatus = "pending" | "pass" | "fail" | "skip";
export type Step = {
  id: "seal" | "request" | "proof" | "winners";
  title: string;
  summary: string;
  status: StepStatus;
  facts: Fact[];
  checks: Check[];
  note?: string;
};
export type Shuffle = {
  step: number;
  hash: Hex;
  range: number;
  j: number;
  position: number;
  label: string;
};

export type VerifyInput = {
  chainId: number;
  contract: Address;
  raffleKey: Hex;
  rpcUrl?: string;
  entrantsUrl: string;
};

export type VerifyResult = {
  steps: Step[];
  entrants: CommittedEntrant[];
  root: Hex | null;
  shuffle: Shuffle[];
  error?: string;
};

const short = (h: string, n = 10) =>
  h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h;
const hex = (v: bigint) => `0x${v.toString(16).padStart(64, "0")}`;

function finish(step: Step) {
  step.status = step.checks.every((c) => c.ok) ? "pass" : "fail";
  return step;
}

export async function verifyDraw(
  input: VerifyInput,
  onProgress: (r: VerifyResult) => void,
): Promise<VerifyResult> {
  const info = chainInfo(input.chainId);
  const client = createPublicClient({ chain: info.chain, transport: http(input.rpcUrl) });
  const link = (kind: "tx" | "address" | "block", v: string | bigint) =>
    explorerLink(input.chainId, kind, v);

  const steps: Step[] = [
    {
      id: "seal",
      title: "The entry list was sealed",
      summary: "The published list rebuilds the exact fingerprint stored on the blockchain.",
      status: "pending",
      facts: [],
      checks: [],
    },
    {
      id: "request",
      title: "Randomness was requested after sealing",
      summary: "The same transaction stored the fingerprint and asked Chainlink for a number.",
      status: "pending",
      facts: [],
      checks: [],
    },
    {
      id: "proof",
      title: "Chainlink answered with a valid proof",
      summary: "The number comes from Chainlink's VRF key and its proof was checked on-chain.",
      status: "pending",
      facts: [],
      checks: [],
    },
    {
      id: "winners",
      title: "The winners follow from the number",
      summary: "Re-running the public shuffle gives the same winners as the contract.",
      status: "pending",
      facts: [],
      checks: [],
    },
  ];
  const result: VerifyResult = { steps, entrants: [], root: null, shuffle: [] };
  const emit = () => onProgress({ ...result, steps: steps.map((s) => ({ ...s })) });

  try {
    // ---------------------------------------------------------- on-chain state
    const draw = await client.readContract({
      address: input.contract,
      abi: raffleDrawAbi,
      functionName: "getDraw",
      args: [input.raffleKey],
    });
    if (draw.requestId === 0n) throw new Error("This raffle has no draw on-chain yet.");

    // -------------------------------------------------------------- 1. seal
    const res = await fetch(input.entrantsUrl);
    if (!res.ok) throw new Error(`Couldn't load the entry list (${res.status}).`);
    const published = (await res.json()) as { entrants: CommittedEntrant[] };
    result.entrants = published.entrants;
    const root = commitmentRoot(published.entrants);
    result.root = root;

    const seal = steps[0];
    seal.facts.push(
      { label: "Entries published", value: String(published.entrants.length) },
      { label: "Fingerprint rebuilt here", value: root, mono: true },
      { label: "Fingerprint on-chain", value: draw.entrantsRoot, mono: true },
      {
        label: "Contract",
        value: input.contract,
        href: link("address", input.contract),
        mono: true,
      },
    );
    seal.checks.push(
      { label: "Rebuilt fingerprint matches the on-chain one", ok: root === draw.entrantsRoot },
      {
        label: "Entry count matches the on-chain count",
        ok: published.entrants.length === draw.entrantCount,
      },
    );
    finish(seal);
    emit();

    // ----------------------------------------------------------- 2. request
    const request = steps[1];
    const requestLogs = await client.getLogs({
      address: input.contract,
      fromBlock: draw.requestedBlock,
      toBlock: draw.requestedBlock,
    });
    const ours = parseEventLogs({ abi: raffleDrawAbi, logs: requestLogs }).filter(
      (l) => "raffleId" in l.args && l.args.raffleId === input.raffleKey,
    );
    const requested = ours.find((l) => l.eventName === "DrawRequested");
    const retried = ours.find((l) => l.eventName === "DrawRetried");
    const requestEvent = requested ?? retried;
    if (!requestEvent) throw new Error("Couldn't find the draw request on-chain.");

    const requestReceipt = await client.getTransactionReceipt({
      hash: requestEvent.transactionHash,
    });
    const requestBlock = await client.getBlock({ blockNumber: draw.requestedBlock });
    const coordinatorLogs = parseEventLogs({
      abi: coordinatorAbi,
      logs: requestReceipt.logs as Log[],
      eventName: "RandomWordsRequested",
    });
    const vrfRequest = coordinatorLogs.find((l) => l.args.requestId === draw.requestId);

    request.facts.push(
      {
        label: retried ? "Re-request transaction" : "Transaction",
        value: requestEvent.transactionHash,
        href: link("tx", requestEvent.transactionHash),
        mono: true,
      },
      {
        label: "Block",
        value: `${draw.requestedBlock}, mined ${new Date(Number(requestBlock.timestamp) * 1000).toLocaleString()}`,
        href: link("block", draw.requestedBlock),
      },
      { label: "Request ID", value: short(hex(draw.requestId), 12), mono: true },
    );
    if (vrfRequest) {
      request.facts.push(
        {
          label: "Chainlink coordinator",
          value: vrfRequest.address,
          href: link("address", vrfRequest.address),
          mono: true,
        },
        { label: "VRF key hash", value: vrfRequest.args.keyHash, mono: true },
        { label: "Pre-seed", value: short(hex(vrfRequest.args.preSeed), 12), mono: true },
      );
    }
    if (requested) {
      request.checks.push({
        label: "The fingerprint was stored in the transaction that requested randomness",
        ok: requested.args.entrantsRoot === draw.entrantsRoot,
      });
    } else {
      request.note =
        "The first request went unanswered, so the contract allowed one re-request after the waiting period. The sealed list could not change.";
      request.checks.push({ label: "The re-request replaced an unanswered request", ok: true });
    }
    request.checks.push(
      { label: "The coordinator logged a request with the same ID", ok: Boolean(vrfRequest) },
      {
        label: "The request came from this raffle contract",
        ok: Boolean(vrfRequest && isAddressEqual(vrfRequest.args.sender, input.contract)),
      },
    );
    if (info.officialCoordinator && vrfRequest) {
      request.checks.push({
        label: "The coordinator is Chainlink's published address for this network",
        ok: isAddressEqual(vrfRequest.address, info.officialCoordinator),
      });
    }
    finish(request);
    emit();

    if (draw.fulfilledBlock === 0n) {
      steps[2].status = "pending";
      steps[2].note = "Chainlink hasn't answered yet. This page checks again when you reload.";
      emit();
      return result;
    }

    // ------------------------------------------------------------- 3. proof
    const proofStep = steps[2];
    const fulfilLogs = await client.getLogs({
      address: input.contract,
      fromBlock: draw.fulfilledBlock,
      toBlock: draw.fulfilledBlock,
    });
    const fulfilled = parseEventLogs({
      abi: raffleDrawAbi,
      logs: fulfilLogs,
      eventName: "DrawFulfilled",
    }).find((l) => l.args.raffleId === input.raffleKey);
    if (!fulfilled) throw new Error("Couldn't find the fulfilment on-chain.");
    const [fulfilTx, fulfilReceipt, fulfilBlock] = await Promise.all([
      client.getTransaction({ hash: fulfilled.transactionHash }),
      client.getTransactionReceipt({ hash: fulfilled.transactionHash }),
      client.getBlock({ blockNumber: draw.fulfilledBlock }),
    ]);
    const seconds = Number(fulfilBlock.timestamp - requestBlock.timestamp);
    proofStep.facts.push(
      {
        label: "Transaction",
        value: fulfilled.transactionHash,
        href: link("tx", fulfilled.transactionHash),
        mono: true,
      },
      {
        label: "Block",
        value: `${draw.fulfilledBlock}, ${draw.fulfilledBlock - draw.requestedBlock} blocks (${seconds}s) after the request`,
        href: link("block", draw.fulfilledBlock),
      },
      { label: "Random number", value: hex(draw.randomWord), mono: true },
    );

    if (info.mockCoordinator) {
      proofStep.status = "skip";
      proofStep.note =
        "This is a local test chain. Chainlink's mock coordinator supplies a number without a VRF proof, so there's nothing to check here. On Base, this step checks the proof.";
      emit();
    } else {
      const vrfFulfil = parseEventLogs({
        abi: coordinatorAbi,
        logs: fulfilReceipt.logs as Log[],
        eventName: "RandomWordsFulfilled",
      }).find((l) => l.args.requestId === draw.requestId);
      const { args } = decodeFunctionData({ abi: coordinatorAbi, data: fulfilTx.input });
      const [proof, rc] = args as unknown as [
        {
          pk: readonly [bigint, bigint];
          gamma: readonly [bigint, bigint];
          c: bigint;
          s: bigint;
          seed: bigint;
        },
        { blockNum: bigint },
      ];
      const keyHash = keyHashOf(proof.pk);
      const seedBlock = await client.getBlock({ blockNumber: rc.blockNum });
      const actualSeed = actualSeedOf(proof.seed, seedBlock.hash!);
      const output = vrfOutputOf(proof.gamma);
      const word = randomWordOf(output, 0);

      proofStep.facts.push(
        { label: "Proving key (x)", value: short(hex(proof.pk[0]), 12), mono: true },
        { label: "Proof point gamma (x)", value: short(hex(proof.gamma[0]), 12), mono: true },
        { label: "Proof c", value: short(hex(proof.c), 12), mono: true },
        { label: "Proof s", value: short(hex(proof.s), 12), mono: true },
        {
          label: "Seed signed (pre-seed + request block hash)",
          value: short(hex(actualSeed), 12),
          mono: true,
        },
        { label: "VRF output", value: short(hex(output), 12), mono: true },
      );
      proofStep.checks.push(
        {
          label: "Answered by the same coordinator, which only accepts valid proofs",
          ok: Boolean(fulfilTx.to && vrfFulfil && isAddressEqual(fulfilTx.to, vrfFulfil.address)),
        },
        {
          label: "The coordinator reports the callback succeeded",
          ok: Boolean(vrfFulfil?.args.success),
        },
        {
          label: "The proving key hashes to the key hash in the request",
          ok: Boolean(vrfRequest && keyHash === vrfRequest.args.keyHash),
        },
        {
          label: "The proof's seed is the request's pre-seed, and hashes to the request ID",
          ok:
            Boolean(vrfRequest && proof.seed === vrfRequest.args.preSeed) &&
            requestIdOf(keyHash, proof.seed) === draw.requestId,
        },
        { label: "The proof covers the request's block", ok: rc.blockNum === draw.requestedBlock },
        {
          label: "The VRF output is derived from the proof",
          ok: output === vrfFulfil?.args.outputSeed,
        },
        { label: "The random number is derived from the VRF output", ok: word === draw.randomWord },
      );
      if (info.officialCoordinator) {
        proofStep.checks.push({
          label: "The answer came from Chainlink's published coordinator",
          ok: Boolean(fulfilTx.to && isAddressEqual(fulfilTx.to, info.officialCoordinator)),
        });
      }
      finish(proofStep);
      emit();
    }

    // ----------------------------------------------------------- 4. winners
    const winnersStep = steps[3];
    const n = draw.entrantCount;
    const k = draw.winnerCount;
    const local = pickWinners(draw.randomWord, n, k);
    const onChain = await client.readContract({
      address: input.contract,
      abi: raffleDrawAbi,
      functionName: "winningIndices",
      args: [input.raffleKey],
    });

    // Re-run the shuffle visibly, step by step.
    const pool = new Map<number, number>();
    const at = (p: number) => pool.get(p) ?? p;
    for (let i = 0; i < k; i++) {
      const h = stepHash(draw.randomWord, i);
      const range = n - i;
      const j = i + Number(BigInt(h) % BigInt(range));
      const pi = at(i);
      pool.set(i, at(j));
      pool.set(j, pi);
      const position = at(i);
      result.shuffle.push({
        step: i,
        hash: h,
        range,
        j,
        position,
        label: published.entrants[position]?.label ?? "?",
      });
    }

    winnersStep.facts.push(
      { label: "Entries", value: String(n) },
      { label: "Winners", value: String(k) },
    );
    winnersStep.checks.push(
      {
        label: "Your browser and the contract pick the same entries",
        ok: onChain.length === local.length && onChain.every((w, i) => w === local[i]),
      },
      {
        label: "The shuffle walk-through below matches",
        ok: result.shuffle.every((s, i) => s.position === local[i]),
      },
    );
    finish(winnersStep);
    emit();
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    for (const s of steps) if (s.status === "pending") s.status = "fail";
    emit();
  }
  return result;
}
