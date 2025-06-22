// contracts/GameFactory.sol

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./TwoThirdsAverageGame.sol";

/**
 * @notice Erstellt und verwaltet Instanzen des "Errate 2/3 des Durchschnitts"-Spiels.
 * @dev Dies ist der Einstiegspunkt für die Erstellung neuer Spiele, gemäß dem Factory-Pattern.
 */
contract GameFactory is Ownable {
    address[] public games;

    event GameCreated(address indexed newGameAddress, address indexed creator, uint256 wager);

    /**
     * @dev Setzt den Deployer der Factory als deren Besitzer.
     */
    constructor() Ownable(msg.sender) {
        // Der Constructor des Ownable-Vertrags wird mit der Adresse des Deployers (msg.sender) aufgerufen.
        // Der Körper dieses Constructors kann leer bleiben.
    }

    /**
     * @notice Erstellt eine neue Instanz des Spiels TwoThirdsAverageGame.
     * @param _wagerAmount Der feste Wetteinsatz für das neue Spiel.
     * @param _serviceFeePercentage Die Servicegebühr für den Spielleiter (0-100).
     */
    function createGame(uint256 _wagerAmount, uint8 _serviceFeePercentage) public {
        TwoThirdsAverageGame newGame = new TwoThirdsAverageGame(
            _wagerAmount,
            _serviceFeePercentage,
            msg.sender
        );

        games.push(address(newGame));
        emit GameCreated(address(newGame), msg.sender, _wagerAmount);
    }
}