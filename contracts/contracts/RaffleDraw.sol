// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title RaffleDraw
/// @notice Commits a raffle's entrant list on-chain, then asks Chainlink VRF for
/// a random word to pick its winners.
///
/// The ordering is what makes the draw verifiable:
///   1. `requestDraw` stores the Merkle root of the entrant list *in the same
///      transaction* that requests randomness, so the list is fixed before
///      anyone (including the operator) can know the random word.
///   2. Each raffle gets exactly one draw. The operator cannot re-roll a result
///      they dislike; `retryDraw` only exists for a request that VRF never
///      answered, and only after `RETRY_AFTER_BLOCKS`.
///   3. Chainlink's coordinator verifies the VRF proof on-chain before calling
///      `rawFulfillRandomWords`; only the coordinator can deliver the word.
///   4. Winners are a pure function of (randomWord, entrantCount, winnerCount),
///      exposed as `pickWinners`, so anyone can recompute them.
///
/// Roles: the `drawer` is the app server's hot key and can only request draws.
/// The `owner` (a wallet the operator keeps offline) changes VRF settings and
/// can replace the drawer, so a leaked server key can't touch configuration.
contract RaffleDraw is VRFConsumerBaseV2Plus {
    struct Draw {
        bytes32 entrantsRoot;
        uint32 entrantCount;
        uint32 winnerCount;
        uint64 requestedBlock;
        uint64 fulfilledBlock;
        uint256 requestId;
        uint256 randomWord;
    }

    /// @notice How long a request must go unanswered before it can be replaced.
    /// About an hour on Base (2s blocks).
    uint64 public constant RETRY_AFTER_BLOCKS = 1800;
    /// @notice Bounds the memory `pickWinners` allocates.
    uint32 public constant MAX_ENTRANTS = 10_000;

    address public drawer;
    uint256 public subscriptionId;
    bytes32 public keyHash;
    uint16 public requestConfirmations;
    uint32 public callbackGasLimit;
    bool public nativePayment;

    mapping(bytes32 raffleId => Draw) private s_draws;
    mapping(uint256 requestId => bytes32 raffleId) public raffleOfRequest;

    event DrawRequested(
        bytes32 indexed raffleId,
        uint256 indexed requestId,
        bytes32 entrantsRoot,
        uint32 entrantCount,
        uint32 winnerCount
    );
    event DrawRetried(bytes32 indexed raffleId, uint256 indexed previousRequestId, uint256 indexed requestId);
    event DrawFulfilled(bytes32 indexed raffleId, uint256 indexed requestId, uint256 randomWord);
    event DrawerSet(address indexed drawer);
    event VrfConfigSet(
        uint256 subscriptionId,
        bytes32 keyHash,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        bool nativePayment
    );

    error AlreadyRequested(bytes32 raffleId);
    error NotRequested(bytes32 raffleId);
    error AlreadyFulfilled(bytes32 raffleId);
    error NotFulfilled(bytes32 raffleId);
    error TooEarlyToRetry(uint64 retryAtBlock);
    error InvalidRaffleId();
    error InvalidRoot();
    error InvalidEntrantCount(uint32 entrantCount);
    error InvalidWinnerCount(uint32 winnerCount, uint32 entrantCount);
    error OnlyDrawer(address caller);
    error ZeroDrawer();

    constructor(
        address coordinator,
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        bool nativePayment_,
        address drawer_,
        address proposedOwner
    ) VRFConsumerBaseV2Plus(coordinator) {
        _setVrfConfig(subscriptionId_, keyHash_, requestConfirmations_, callbackGasLimit_, nativePayment_);
        _setDrawer(drawer_);
        // The deployer owns the contract until `proposedOwner` calls acceptOwnership().
        if (proposedOwner != address(0) && proposedOwner != msg.sender) transferOwnership(proposedOwner);
    }

    modifier onlyDrawer() {
        if (msg.sender != drawer) revert OnlyDrawer(msg.sender);
        _;
    }

    // ---------------------------------------------------------------- draws

    /// @notice Lock a raffle's entrant list and request its random word.
    function requestDraw(bytes32 raffleId, bytes32 entrantsRoot, uint32 entrantCount, uint32 winnerCount)
        external
        onlyDrawer
        returns (uint256 requestId)
    {
        if (raffleId == bytes32(0)) revert InvalidRaffleId();
        if (entrantsRoot == bytes32(0)) revert InvalidRoot();
        if (entrantCount == 0 || entrantCount > MAX_ENTRANTS) revert InvalidEntrantCount(entrantCount);
        if (winnerCount == 0 || winnerCount > entrantCount) revert InvalidWinnerCount(winnerCount, entrantCount);

        Draw storage d = s_draws[raffleId];
        if (d.requestId != 0) revert AlreadyRequested(raffleId);

        d.entrantsRoot = entrantsRoot;
        d.entrantCount = entrantCount;
        d.winnerCount = winnerCount;
        requestId = _requestRandomWord(raffleId, d);

        emit DrawRequested(raffleId, requestId, entrantsRoot, entrantCount, winnerCount);
    }

    /// @notice Replace a request VRF never answered (for example, because the
    /// subscription ran dry). The committed entrant list is unchanged, and a
    /// late answer to the old request is ignored.
    function retryDraw(bytes32 raffleId) external onlyDrawer returns (uint256 requestId) {
        Draw storage d = s_draws[raffleId];
        if (d.requestId == 0) revert NotRequested(raffleId);
        if (d.fulfilledBlock != 0) revert AlreadyFulfilled(raffleId);
        uint64 retryAt = d.requestedBlock + RETRY_AFTER_BLOCKS;
        if (block.number < retryAt) revert TooEarlyToRetry(retryAt);

        uint256 previous = d.requestId;
        delete raffleOfRequest[previous];
        requestId = _requestRandomWord(raffleId, d);

        emit DrawRetried(raffleId, previous, requestId);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        bytes32 raffleId = raffleOfRequest[requestId];
        // A superseded request: ignore rather than revert, so the coordinator
        // doesn't keep the subscription's funds tied up retrying it.
        if (raffleId == bytes32(0)) return;
        Draw storage d = s_draws[raffleId];
        if (d.fulfilledBlock != 0) return;

        d.randomWord = randomWords[0];
        d.fulfilledBlock = uint64(block.number);

        emit DrawFulfilled(raffleId, requestId, randomWords[0]);
    }

    function _requestRandomWord(bytes32 raffleId, Draw storage d) private returns (uint256 requestId) {
        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment}))
            })
        );
        d.requestId = requestId;
        d.requestedBlock = uint64(block.number);
        raffleOfRequest[requestId] = raffleId;
    }

    // ---------------------------------------------------------------- reads

    function getDraw(bytes32 raffleId) external view returns (Draw memory) {
        return s_draws[raffleId];
    }

    /// @notice Positions (0-based, into the committed entrant list) of the
    /// winners, in winning order.
    function winningIndices(bytes32 raffleId) external view returns (uint32[] memory) {
        Draw storage d = s_draws[raffleId];
        if (d.fulfilledBlock == 0) revert NotFulfilled(raffleId);
        return pickWinners(d.randomWord, d.entrantCount, d.winnerCount);
    }

    /// @notice Partial Fisher–Yates shuffle: step i swaps position i with a
    /// position j in [i, n), where j = i + keccak256(abi.encode(word, i)) % (n - i).
    /// The first k positions are the winners. Bias from the modulo is below
    /// 2^-200 for n <= MAX_ENTRANTS.
    function pickWinners(uint256 randomWord, uint32 n, uint32 k) public pure returns (uint32[] memory winners) {
        if (n == 0 || n > MAX_ENTRANTS) revert InvalidEntrantCount(n);
        if (k == 0 || k > n) revert InvalidWinnerCount(k, n);

        uint32[] memory pool = new uint32[](n);
        for (uint32 i = 0; i < n; ++i) {
            pool[i] = i;
        }
        winners = new uint32[](k);
        for (uint32 i = 0; i < k; ++i) {
            uint256 r = uint256(keccak256(abi.encode(randomWord, uint256(i))));
            uint32 j = i + uint32(r % (n - i));
            (pool[i], pool[j]) = (pool[j], pool[i]);
            winners[i] = pool[i];
        }
    }

    /// @notice Check that `leaf` is in a raffle's committed entrant list.
    /// Pairs are hashed in sorted order, matching OpenZeppelin's MerkleProof.
    function isCommittedEntrant(bytes32 raffleId, bytes32 leaf, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        bytes32 node = leaf;
        for (uint256 i = 0; i < proof.length; ++i) {
            bytes32 sibling = proof[i];
            node = node < sibling
                ? keccak256(abi.encodePacked(node, sibling))
                : keccak256(abi.encodePacked(sibling, node));
        }
        return node == s_draws[raffleId].entrantsRoot && node != bytes32(0);
    }

    // ---------------------------------------------------------------- admin

    function setDrawer(address drawer_) external onlyOwner {
        _setDrawer(drawer_);
    }

    function _setDrawer(address drawer_) private {
        if (drawer_ == address(0)) revert ZeroDrawer();
        drawer = drawer_;
        emit DrawerSet(drawer_);
    }

    function setVrfConfig(
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        bool nativePayment_
    ) external onlyOwner {
        _setVrfConfig(subscriptionId_, keyHash_, requestConfirmations_, callbackGasLimit_, nativePayment_);
    }

    function _setVrfConfig(
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        bool nativePayment_
    ) private {
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        requestConfirmations = requestConfirmations_;
        callbackGasLimit = callbackGasLimit_;
        nativePayment = nativePayment_;
        emit VrfConfigSet(subscriptionId_, keyHash_, requestConfirmations_, callbackGasLimit_, nativePayment_);
    }
}
