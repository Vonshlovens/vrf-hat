// The parts of Chainlink's VRFCoordinatorV2_5 the verify page reads.
// Source: @chainlink/contracts/src/v0.8/vrf/dev/VRFCoordinatorV2_5.sol
import { parseAbi } from "viem";

export const coordinatorAbi = parseAbi([
  "event RandomWordsRequested(bytes32 indexed keyHash, uint256 requestId, uint256 preSeed, uint256 indexed subId, uint16 minimumRequestConfirmations, uint32 callbackGasLimit, uint32 numWords, bytes extraArgs, address indexed sender)",
  "event RandomWordsFulfilled(uint256 indexed requestId, uint256 outputSeed, uint256 indexed subId, uint96 payment, bool nativePayment, bool success, bool onlyPremium)",
  "struct Proof { uint256[2] pk; uint256[2] gamma; uint256 c; uint256 s; uint256 seed; address uWitness; uint256[2] cGammaWitness; uint256[2] sHashWitness; uint256 zInv; }",
  "struct RequestCommitmentV2Plus { uint64 blockNum; uint256 subId; uint32 callbackGasLimit; uint32 numWords; address sender; bytes extraArgs; }",
  "function fulfillRandomWords(Proof proof, RequestCommitmentV2Plus rc, bool onlyPremium) returns (uint96)",
]);

// Chainlink nodes often deliver several answers in one transaction through
// BatchVRFCoordinatorV2Plus, which forwards each proof to the coordinator.
// Source: @chainlink/contracts/src/v0.8/vrf/dev/BatchVRFCoordinatorV2Plus.sol
export const batchCoordinatorAbi = parseAbi([
  "struct Proof { uint256[2] pk; uint256[2] gamma; uint256 c; uint256 s; uint256 seed; address uWitness; uint256[2] cGammaWitness; uint256[2] sHashWitness; uint256 zInv; }",
  "struct RequestCommitmentV2Plus { uint64 blockNum; uint256 subId; uint32 callbackGasLimit; uint32 numWords; address sender; bytes extraArgs; }",
  "function fulfillRandomWords(Proof[] proofs, RequestCommitmentV2Plus[] rcs)",
]);
