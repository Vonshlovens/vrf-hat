// Recomputes the hash chain inside Chainlink's VRFCoordinatorV2_5 so a browser
// can check each link from public chain data. Mirrors
// VRFCoordinatorV2_5._getRandomnessFromProof and _fulfillRandomWords.
// (The elliptic-curve check of the proof itself happens on-chain: the
// coordinator reverts the fulfillment if the proof is invalid.)
import { encodeAbiParameters, encodePacked, keccak256, type Hex } from "viem";

/** keyHash = keccak256(abi.encode(uint256[2] publicKey)) */
export function keyHashOf(pk: readonly [bigint, bigint]): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256[2]" }], [pk]));
}

/** requestId = keccak256(abi.encode(keyHash, preSeed)) */
export function requestIdOf(keyHash: Hex, preSeed: bigint): bigint {
  return BigInt(
    keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [keyHash, preSeed])),
  );
}

/** The seed the VRF actually signs: keccak256(abi.encodePacked(preSeed, blockhash(requestBlock))) */
export function actualSeedOf(preSeed: bigint, requestBlockHash: Hex): bigint {
  return BigInt(keccak256(encodePacked(["uint256", "bytes32"], [preSeed, requestBlockHash])));
}

/** VRF output = keccak256(abi.encode(3, uint256[2] gamma)) */
export function vrfOutputOf(gamma: readonly [bigint, bigint]): bigint {
  return BigInt(
    keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256[2]" }], [3n, gamma])),
  );
}

/** randomWords[i] = keccak256(abi.encode(vrfOutput, i)) */
export function randomWordOf(vrfOutput: bigint, i = 0): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [vrfOutput, BigInt(i)]),
    ),
  );
}
