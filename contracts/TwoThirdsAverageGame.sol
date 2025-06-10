// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TwoThirdsAverageGame
 * @notice Implementiert die Spiellogik für "Errate 2/3 des Durchschnitts".
 * @dev Alle Beträge sind in Wei (1 Ether = 10^18 Wei).
 */
contract TwoThirdsAverageGame is Ownable {
    // --- Typdefinitionen (Enums und Structs) ---

    enum SpielPhase { Registrierung, Commit, Reveal, Berechnung, Auszahlung, Abgeschlossen }

    struct SpielerInfo {
        uint256 wagerAmount;
        bytes32 commitment;
        uint16  revealedNumber;
        bool    hasCommitted;
        bool    hasRevealed;
        bool    hasWithdrawn;
    }

    // --- Zustandsvariablen ---

    SpielPhase public aktuellePhase;
    mapping(address => SpielerInfo) public spielerDaten;
    address[] public spielerListe;
    uint256 public immutable WAGER_AMOUNT;
    uint8 public immutable SERVICE_FEE_PERCENTAGE;
    uint256 public deadline;
    uint256 public pot;
    bool public serviceFeeWithdrawn;
    address public winner;
    address[] public potentialWinners;
    uint256 public averageValue;
    uint256 public targetValue;
    uint256 public winningDistance;

    uint8 public constant MIN_PLAYERS = 3;
    uint256 public constant REGISTRATION_DURATION = 600; // 10 Minuten
    uint256 public constant COMMIT_DURATION = 300;
    uint256 public constant REVEAL_DURATION = 300;

    // --- Events ---

    event PhaseGeaendert(SpielPhase neuePhase, uint256 neueDeadline);
    event SpielerBeigetreten(address indexed spieler, uint256 einsatz);
    event SpielerHatCommittet(address indexed spieler, bytes32 commitment);
    event SpielerHatAufgedeckt(address indexed spieler, uint16 zahl);
    event SpielBerechnet(uint256 durchschnitt, uint256 zielwert, address gewinner, uint16 gewinnerZahl);
    event AuszahlungErfolgt(address indexed empfaenger, uint256 betrag);

    // --- Modifiers ---

    modifier nurInPhase(SpielPhase _phase) {
        require(aktuellePhase == _phase, "Funktion in dieser Phase nicht erlaubt.");
        _;
    }

    modifier nurVorDeadline() {
        require(block.timestamp < deadline, "Deadline fuer diese Aktion ist abgelaufen.");
        _;
    }

    // --- Constructor ---

    constructor(
        uint256 _wagerAmount,
        uint8 _serviceFeePercentage,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_wagerAmount > 0, "Wetteinsatz muss groesser als 0 sein.");
        require(_serviceFeePercentage <= 100, "Servicegebuehr darf maximal 100% sein.");

        WAGER_AMOUNT = _wagerAmount;
        SERVICE_FEE_PERCENTAGE = _serviceFeePercentage;
        aktuellePhase = SpielPhase.Registrierung;
        deadline = block.timestamp + REGISTRATION_DURATION;

        emit PhaseGeaendert(SpielPhase.Registrierung, deadline);
    }

    // --- Spiel Logik Funktionen ---

    function beitreten() public payable nurInPhase(SpielPhase.Registrierung) nurVorDeadline() {
        require(msg.value == WAGER_AMOUNT, "Falscher Wetteinsatz gesendet.");
        require(spielerDaten[msg.sender].wagerAmount == 0, "Spieler hat bereits teilgenommen.");
        
        spielerListe.push(msg.sender);
        spielerDaten[msg.sender] = SpielerInfo({
            wagerAmount: msg.value,
            commitment: 0,
            revealedNumber: 0,
            hasCommitted: false,
            hasRevealed: false,
            hasWithdrawn: false
        });
        pot += msg.value;
        emit SpielerBeigetreten(msg.sender, msg.value);
    }

    function commit(bytes32 _commitment) public nurInPhase(SpielPhase.Commit) nurVorDeadline() {
        require(spielerDaten[msg.sender].wagerAmount > 0, "Nur registrierte Spieler duerfen committen.");
        require(!spielerDaten[msg.sender].hasCommitted, "Spieler hat bereits einen Commit eingereicht.");
        require(_commitment != bytes32(0), "Commitment darf nicht leer sein.");

        spielerDaten[msg.sender].commitment = _commitment;
        spielerDaten[msg.sender].hasCommitted = true;
        emit SpielerHatCommittet(msg.sender, _commitment);
    }

    function reveal(uint16 _number, bytes32 _salt) public nurInPhase(SpielPhase.Reveal) nurVorDeadline() {
        require(spielerDaten[msg.sender].wagerAmount > 0, "Nur registrierte Spieler duerfen aufdecken.");
        require(spielerDaten[msg.sender].hasCommitted, "Spieler muss zuerst einen Commit einreichen.");
        require(!spielerDaten[msg.sender].hasRevealed, "Spieler hat bereits aufgedeckt.");
        require(_number <= 1000, "Zahl muss zwischen 0 und 1000 liegen.");

        bytes32 recomputedCommitment = keccak256(abi.encodePacked(_number, _salt, msg.sender));
        require(recomputedCommitment == spielerDaten[msg.sender].commitment, "Ungueltiger Reveal. Zahl oder Salt sind falsch.");

        spielerDaten[msg.sender].revealedNumber = _number;
        spielerDaten[msg.sender].hasRevealed = true;
        emit SpielerHatAufgedeckt(msg.sender, _number);
    }

    // --- View Funktionen ---

    function getSpielerAnzahl() public view returns (uint256) {
        return spielerListe.length;
    }
    
    // --- Administrative und Auszahlungs-Funktionen ---

    function forceStateTransition() public {
        if (aktuellePhase == SpielPhase.Registrierung) {
            require(block.timestamp >= deadline || msg.sender == owner(), "Uebergang noch nicht erlaubt.");
            require(spielerListe.length >= MIN_PLAYERS, "Nicht genuegend Spieler beigetreten.");
            aktuellePhase = SpielPhase.Commit;
            deadline = block.timestamp + COMMIT_DURATION;
            emit PhaseGeaendert(aktuellePhase, deadline);
            return;
        }
        if (aktuellePhase == SpielPhase.Commit) {
            require(block.timestamp >= deadline || msg.sender == owner(), "Uebergang noch nicht erlaubt.");
            aktuellePhase = SpielPhase.Reveal;
            deadline = block.timestamp + REVEAL_DURATION;
            emit PhaseGeaendert(aktuellePhase, deadline);
            return;
        }
        if (aktuellePhase == SpielPhase.Reveal) {
            require(block.timestamp >= deadline || msg.sender == owner(), "Uebergang noch nicht erlaubt.");
            aktuellePhase = SpielPhase.Berechnung;
            deadline = 0;
            emit PhaseGeaendert(aktuellePhase, deadline);
            return;
        }
        if (aktuellePhase == SpielPhase.Auszahlung) {
            require(msg.sender == owner(), "Nur Spielleiter kann Spiel beenden.");
            require(serviceFeeWithdrawn && spielerDaten[winner].hasWithdrawn, "Auszahlungen noch nicht abgeschlossen.");
            aktuellePhase = SpielPhase.Abgeschlossen;
            emit PhaseGeaendert(aktuellePhase, 0);
            return;
        }
    }

    function berechneErgebnisUndErmittleGewinner() public onlyOwner nurInPhase(SpielPhase.Berechnung) {
        uint256 summe = 0;
        uint256 anzahlAufgedeckterSpieler = 0;
        for (uint i = 0; i < spielerListe.length; i++) {
            if (spielerDaten[spielerListe[i]].hasRevealed) {
                summe += spielerDaten[spielerListe[i]].revealedNumber;
                anzahlAufgedeckterSpieler++;
            }
        }
        require(anzahlAufgedeckterSpieler > 0, "Niemand hat aufgedeckt, Spiel kann nicht ausgewertet werden.");
        averageValue = summe / anzahlAufgedeckterSpieler;
        targetValue = (averageValue * 2) / 3;
        winningDistance = type(uint256).max;
        for (uint i = 0; i < spielerListe.length; i++) {
            address spielerAdresse = spielerListe[i];
            if (spielerDaten[spielerAdresse].hasRevealed) {
                uint256 differenz = spielerDaten[spielerAdresse].revealedNumber > targetValue
                    ? spielerDaten[spielerAdresse].revealedNumber - targetValue
                    : targetValue - spielerDaten[spielerAdresse].revealedNumber;
                if (differenz < winningDistance) {
                    winningDistance = differenz;
                    delete potentialWinners;
                    potentialWinners.push(spielerAdresse);
                } else if (differenz == winningDistance) {
                    potentialWinners.push(spielerAdresse);
                }
            }
        }
        require(potentialWinners.length > 0, "Interner Fehler: Kein potenzieller Gewinner gefunden.");
        if (potentialWinners.length == 1) {
            winner = potentialWinners[0];
        } else {
            // Vereinfachte Zufallsauswahl für den Fall eines Unentschiedens
            uint256 randomIndex = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao))) % potentialWinners.length;
            winner = potentialWinners[randomIndex];
        }
        aktuellePhase = SpielPhase.Auszahlung;
        emit SpielBerechnet(averageValue, targetValue, winner, spielerDaten[winner].revealedNumber);
    }
    
    /**
     * @notice Ermöglicht dem Gewinner, seinen Preis abzuholen.
     */
    function withdrawPrize() public nurInPhase(SpielPhase.Auszahlung) {
        require(msg.sender == winner, "Nur der Gewinner kann das Preisgeld abheben.");
        require(!spielerDaten[msg.sender].hasWithdrawn, "Gewinner hat bereits abgehoben.");

        spielerDaten[msg.sender].hasWithdrawn = true;
        uint256 serviceFee = (pot * SERVICE_FEE_PERCENTAGE) / 100;
        uint256 winnerPayout = pot - serviceFee;

        (bool sent, ) = msg.sender.call{value: winnerPayout}("");
        require(sent, "Ether-Transfer an Gewinner fehlgeschlagen.");
        emit AuszahlungErfolgt(msg.sender, winnerPayout);
    }

    /**
     * @notice Ermöglicht dem Besitzer, die Servicegebühr abzuholen.
     */
    function withdrawServiceFee() public onlyOwner nurInPhase(SpielPhase.Auszahlung) {
        require(!serviceFeeWithdrawn, "Servicegebuehr wurde bereits abgehoben.");
        
        serviceFeeWithdrawn = true;
        uint256 serviceFee = (pot * SERVICE_FEE_PERCENTAGE) / 100;

        if (serviceFee > 0) {
            (bool sent, ) = owner().call{value: serviceFee}("");
            require(sent, "Ether-Transfer an Spielleiter fehlgeschlagen.");
            emit AuszahlungErfolgt(owner(), serviceFee);
        }
    }
}