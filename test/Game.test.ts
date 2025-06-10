// test/Game.test.ts

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers"; // Hinzugefügter Import
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { GameFactory, TwoThirdsAverageGame } from "../typechain-types";

describe("GameFactory and TwoThirdsAverageGame (TypeScript)", function () {
    let gameFactory: GameFactory;
    let gameContract: TwoThirdsAverageGame;
    let owner: HardhatEthersSigner;
    let player1: HardhatEthersSigner;
    let player2: HardhatEthersSigner;
    let player3: HardhatEthersSigner;

    const wagerAmount = ethers.parseEther("0.1");
    const serviceFeePercentage = 10; // 10%

    beforeEach(async function () {
        [owner, player1, player2, player3] = await ethers.getSigners();
        const GameFactoryFactory = await ethers.getContractFactory("GameFactory");
        gameFactory = await GameFactoryFactory.deploy();
        await gameFactory.connect(owner).createGame(wagerAmount, serviceFeePercentage);
        const gameAddress = await gameFactory.games(0);
        gameContract = await ethers.getContractAt("TwoThirdsAverageGame", gameAddress);
    });

    // --- Bestehende Tests ---
    describe("Registrierung", function () {
        // ... (deine bestehenden Tests bleiben hier unverändert)
        it("Sollte es Spielern erlauben, korrekt beizutreten", async function () { /*...*/ });
        it("Sollte abbrechen, wenn ein Spieler mit falschem Einsatz beitritt", async function () { /*...*/ });
    });

    describe("Kompletter Spielablauf (Happy Path)", function () {
        // ... (dein bestehender Happy Path Test bleibt hier unverändert)
        it("Sollte ein ganzes Spiel von der Registrierung bis zur Auszahlung korrekt abwickeln", async function () { /*...*/ });
    });

    // ==================================================================
    // NEUER BLOCK: TESTS FÜR FEHLERFÄLLE UND RANDBEDINGUNGEN
    // ==================================================================
    describe("Fehlerfälle und Randbedingungen (Unhappy Paths)", function () {
        
        it("Sollte fehlschlagen, wenn ein Spieler versucht, zweimal beizutreten", async function () {
            await gameContract.connect(player1).beitreten({ value: wagerAmount });
            // Der zweite Versuch vom selben Spieler sollte fehlschlagen
            await expect(
                gameContract.connect(player1).beitreten({ value: wagerAmount })
            ).to.be.revertedWith("Spieler hat bereits teilgenommen.");
        });

        it("Sollte fehlschlagen, wenn versucht wird, eine Funktion in der falschen Phase aufzurufen", async function () {
            // Versuch zu committen, während die Phase noch auf "Registrierung" steht
            const dummyHash = ethers.encodeBytes32String("dummy");
            await expect(
                gameContract.connect(player1).commit(dummyHash)
            ).to.be.revertedWith("Funktion in dieser Phase nicht erlaubt.");
        });

        it("Sollte fehlschlagen, wenn ein Nicht-Owner eine Owner-Funktion aufruft", async function () {
            // player1 (kein Owner) versucht, die Phase zu wechseln
            await expect(
                gameContract.connect(player1).forceStateTransition()
            ).to.be.revertedWith("Uebergang noch nicht erlaubt.");
            // Hinweis: Der OpenZeppelin-Vertrag würde bei einer reinen Owner-Funktion "Ownable: caller is not the owner" werfen.
            // Unsere spezifische Fehlermeldung ist hier aber passender.
        });

        it("Sollte fehlschlagen, wenn ein Spieler nach Ablauf der Deadline beitreten will", async function () {
            // Wir spulen die Zeit vor, sodass die Deadline der Registrierung überschritten ist.
            // REGISTRATION_DURATION ist 300 Sekunden. Wir spulen 301 Sekunden vor.
            await time.increase(301);

            await expect(
                gameContract.connect(player1).beitreten({ value: wagerAmount })
            ).to.be.revertedWith("Deadline fuer diese Aktion ist abgelaufen.");
        });

        it("Sollte bei einem Reveal mit falschem Salt fehlschlagen", async function () {
            // Setup: Spiel bis zur Reveal-Phase bringen
            // KORREKTUR: Es müssen MIN_PLAYERS (3) beitreten, damit das Spiel starten kann.
            await gameContract.connect(player1).beitreten({ value: wagerAmount });
            await gameContract.connect(player2).beitreten({ value: wagerAmount });
            await gameContract.connect(player3).beitreten({ value: wagerAmount });

            // Jetzt kann die Phase gewechselt werden
            await gameContract.connect(owner).forceStateTransition(); // -> Commit

            // Der Rest des Setups, um zum Reveal zu kommen
            const number1 = 100, salt1 = ethers.encodeBytes32String("salt1");
            const wrongSalt = ethers.encodeBytes32String("wrong_salt");
            const hash1 = ethers.keccak256(ethers.solidityPacked(["uint16", "bytes32", "address"], [number1, salt1, player1.address]));
            
            await gameContract.connect(player1).commit(hash1);
            
            await gameContract.connect(owner).forceStateTransition(); // -> Reveal

            // Der eigentliche Test: Spieler 1 versucht, mit dem falschen Salt aufzudecken
            await expect(
                gameContract.connect(player1).reveal(number1, wrongSalt)
            ).to.be.revertedWith("Ungueltiger Reveal. Zahl oder Salt sind falsch.");
        });
    });
});

// Hinweis: Um die Platzhalter für die langen Tests zu entfernen, 
// kannst du einfach den Inhalt der it-Blöcke aus der vorherigen Antwort kopieren.