// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract TwoThirdsAverageGame is Ownable {

    //Definiert die verschiedenen Phasen, die das Spiel durchläuft.
    enum SpielPhase { Registrierung, Commit, Reveal, Berechnung, Auszahlung, Abgeschlossen, Abgebrochen }

    //Speichert alle relevanten Informationen zu einem einzelnen Spieler.
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
    
    uint256 public deadlineBlock;
    uint256 public pot;
    address public winner;
    
    bool public serviceFeeWithdrawn;
    address[] public potentialWinners;
    
    uint256 public averageValue;
    uint256 public targetValue;
    uint256 public winningDistance;

    // --- Konstanten ---

    uint8 public constant MIN_PLAYERS = 3;
    // Fristen sind in Blöcken definiert, um eine deterministische und manipulationssichere Zeitmessung zu gewährleisten.
    // Annahme: ca. 5 Blöcke pro Minute auf Ethereum Mainnet.
    uint256 public constant REGISTRATION_BLOCKS = 10; // ca. 10 Minuten
    uint256 public constant COMMIT_BLOCKS = 10;       // ca. 5 Minuten
    uint256 public constant REVEAL_BLOCKS = 10;       // ca. 5 Minuten

    // --- Events ---

    event PhaseGeaendert(SpielPhase neuePhase, uint256 neueDeadlineBlock);
    event SpielerBeigetreten(address indexed spieler, uint256 einsatz);
    event SpielerHatCommittet(address indexed spieler, bytes32 commitment);
    event SpielerHatAufgedeckt(address indexed spieler, uint16 zahl);
    event SpielBerechnet(uint256 durchschnitt, uint256 zielwert, address gewinner, uint16 gewinnerZahl);
    event AuszahlungErfolgt(address indexed empfaenger, uint256 betrag);
    event SpielAbgebrochen(string grund);

    // --- Modifiers ---

    modifier nurInPhase(SpielPhase _phase) {
        require(aktuellePhase == _phase, "Funktion in dieser Phase nicht erlaubt.");
        _;
    }

    modifier nurVorDeadline() {
        require(block.number < deadlineBlock, "Deadline-Block fuer diese Aktion ist erreicht.");
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
        deadlineBlock = block.number + REGISTRATION_BLOCKS;

        emit PhaseGeaendert(SpielPhase.Registrierung, deadlineBlock);
    }

    // --- Spieler-Funktionen ---

    /**
     * @notice Ermöglicht einem Spieler, dem Spiel beizutreten.
     * @dev Muss in der Registrierungsphase vor Ablauf der Deadline aufgerufen werden.
     * Der gesendete Ether-Betrag muss exakt dem Wetteinsatz entsprechen.
     */
    function beitreten() public payable nurInPhase(SpielPhase.Registrierung) nurVorDeadline() {
        require(msg.value == WAGER_AMOUNT, "Falscher Wetteinsatz gesendet.");
        require(spielerDaten[msg.sender].wagerAmount == 0, "Spieler hat bereits teilgenommen.");
        
        spielerListe.push(msg.sender);
        spielerDaten[msg.sender] = SpielerInfo(msg.value, 0, 0, false, false, false);
        pot += msg.value;
        emit SpielerBeigetreten(msg.sender, msg.value);
    }

    /**
     * @notice Nimmt den kryptographischen Hash (Commitment) eines Spielers entgegen.
     * @param _commitment Der `keccak256` Hash aus Zahl, Salt und Spieleradresse.
     */
    function commit(bytes32 _commitment) public nurInPhase(SpielPhase.Commit) nurVorDeadline() {
        require(spielerDaten[msg.sender].wagerAmount > 0, "Nur registrierte Spieler duerfen committen.");
        require(!spielerDaten[msg.sender].hasCommitted, "Spieler hat bereits einen Commit eingereicht.");
        require(_commitment != bytes32(0), "Commitment darf nicht leer sein.");

        spielerDaten[msg.sender].commitment = _commitment;
        spielerDaten[msg.sender].hasCommitted = true;
        emit SpielerHatCommittet(msg.sender, _commitment);
    }

    /**
     * @notice Dient zum Aufdecken der zuvor committeten Zahl.
     * @param _number Die gewählte Zahl (0-1000).
     * @param _salt Das geheime Salt, das für den Commit verwendet wurde.
     */
    function reveal(uint16 _number, bytes32 _salt) public nurInPhase(SpielPhase.Reveal) nurVorDeadline() {
        require(spielerDaten[msg.sender].wagerAmount > 0, "Nur registrierte Spieler duerfen aufdecken.");
        require(spielerDaten[msg.sender].hasCommitted, "Spieler muss zuerst einen Commit einreichen.");
        require(!spielerDaten[msg.sender].hasRevealed, "Spieler hat bereits aufgedeckt.");
        require(_number <= 1000, "Zahl muss zwischen 0 und 1000 liegen.");

        bytes32 recomputedCommitment = keccak256(abi.encodePacked(_number, _salt, msg.sender));
        require(recomputedCommitment == spielerDaten[msg.sender].commitment, "Ungueltiger Reveal: Zahl oder Salt sind falsch.");

        spielerDaten[msg.sender].revealedNumber = _number;
        spielerDaten[msg.sender].hasRevealed = true;
        emit SpielerHatAufgedeckt(msg.sender, _number);
    }

    // --- Spielablauf- und Berechnungsfunktionen ---

    /**
     * @notice Stößt den Übergang in die nächste Spielphase an, sobald die Frist abgelaufen ist.
     * @dev Kann von JEDEM aufgerufen werden, um den Spielfortschritt zu gewährleisten.
     */
    function advancePhase() public {
        require(block.number >= deadlineBlock, "Deadline-Block fuer diese Aktion ist noch nicht erreicht.");

        if (aktuellePhase == SpielPhase.Registrierung) {
            if (spielerListe.length < MIN_PLAYERS) {
                aktuellePhase = SpielPhase.Abgebrochen;
                emit SpielAbgebrochen("Nicht genuegend Spieler beigetreten.");
                emit PhaseGeaendert(aktuellePhase, 0);
            } else {
                aktuellePhase = SpielPhase.Commit;
                deadlineBlock = block.number + COMMIT_BLOCKS;
                emit PhaseGeaendert(aktuellePhase, deadlineBlock);
            }
        } else if (aktuellePhase == SpielPhase.Commit) {
            aktuellePhase = SpielPhase.Reveal;
            deadlineBlock = block.number + REVEAL_BLOCKS;
            emit PhaseGeaendert(aktuellePhase, deadlineBlock);
        } else if (aktuellePhase == SpielPhase.Reveal) {
            aktuellePhase = SpielPhase.Berechnung;
            deadlineBlock = 0;
            emit PhaseGeaendert(aktuellePhase, deadlineBlock);
        }
    }

    /**
     * @notice Berechnet das Spielergebnis und ermittelt den Gewinner.
     * @dev Kann von JEDEM aufgerufen werden, sobald die Berechnungsphase erreicht ist.
     */
    function calculateResult() public nurInPhase(SpielPhase.Berechnung) {
        uint256 summe = 0;
        uint256 anzahlAufgedeckterSpieler = 0;
        for (uint i = 0; i < spielerListe.length; i++) {
            SpielerInfo storage spieler = spielerDaten[spielerListe[i]];
            if (spieler.hasRevealed) {
                summe += spieler.revealedNumber;
                anzahlAufgedeckterSpieler++;
            }
        }
        
        if (anzahlAufgedeckterSpieler == 0) {
            aktuellePhase = SpielPhase.Abgebrochen;
            emit SpielAbgebrochen("Niemand hat eine Zahl aufgedeckt.");
            emit PhaseGeaendert(aktuellePhase, 0);
            return;
        }

        averageValue = summe / anzahlAufgedeckterSpieler;
        targetValue = (averageValue * 2) / 3;
        winningDistance = type(uint256).max;

        for (uint i = 0; i < spielerListe.length; i++) {
            address spielerAdresse = spielerListe[i];
            SpielerInfo storage spieler = spielerDaten[spielerAdresse];
            if (spieler.hasRevealed) {
                uint256 differenz = spieler.revealedNumber > targetValue
                    ? spieler.revealedNumber - targetValue
                    : targetValue - spieler.revealedNumber;
                
                if (differenz < winningDistance) {
                    winningDistance = differenz;
                    delete potentialWinners;
                    potentialWinners.push(spielerAdresse);
                } else if (differenz == winningDistance) {
                    potentialWinners.push(spielerAdresse);
                }
            }
        }

        if (potentialWinners.length == 1) {
            winner = potentialWinners[0];
        } else {
            // @dev Unsichere Zufallsauswahl. Für Produktionssysteme sollte Chainlink VRF genutzt werden.
            uint256 randomIndex = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, pot))) % potentialWinners.length;
            winner = potentialWinners[randomIndex];
        }
        
        aktuellePhase = SpielPhase.Auszahlung;
        emit SpielBerechnet(averageValue, targetValue, winner, spielerDaten[winner].revealedNumber);
        emit PhaseGeaendert(aktuellePhase, 0);
    }
    
    // --- Auszahlungs- und Rückforderungs-Funktionen ---

    /**
     * @notice Ermöglicht dem Gewinner, sein Preisgeld abzuheben (Pull-Pattern).
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

        if (serviceFeeWithdrawn) {
            aktuellePhase = SpielPhase.Abgeschlossen;
            emit PhaseGeaendert(SpielPhase.Abgeschlossen, 0);
        }
    }

    /**
     * @notice Ermöglicht dem Spielleiter (Owner), die Servicegebühr abzuheben (Pull-Pattern).
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

        if (winner != address(0) && spielerDaten[winner].hasWithdrawn) {
            aktuellePhase = SpielPhase.Abgeschlossen;
            emit PhaseGeaendert(SpielPhase.Abgeschlossen, 0);
        }
    }

    /**
     * @notice Ermöglicht Spielern, ihren ursprünglichen Einsatz zurückzufordern,
     * falls das Spiel in die `Abgebrochen`-Phase übergegangen ist.
     */
    function reclaimWager() public nurInPhase(SpielPhase.Abgebrochen) {
        SpielerInfo storage spieler = spielerDaten[msg.sender];
        require(spieler.wagerAmount > 0, "Nur Spieler koennen Einsatz zurueckfordern.");
        require(!spieler.hasWithdrawn, "Einsatz bereits zurueckgefordert.");

        spieler.hasWithdrawn = true;
        uint256 wager = spieler.wagerAmount;

        (bool sent, ) = msg.sender.call{value: wager}("");
        require(sent, "Rueckzahlung fehlgeschlagen.");
        emit AuszahlungErfolgt(msg.sender, wager);
    }

    // --- View Funktionen ---

    /**
     * @notice Gibt die Anzahl der Spieler zurück, die dem Spiel beigetreten sind.
     */
    function getSpielerAnzahl() public view returns (uint256) {
        return spielerListe.length;
    }
}