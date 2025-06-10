import { useState, useEffect } from 'react';
import { ethers, Contract, formatEther, solidityPackedKeccak256, encodeBytes32String } from 'ethers';
import type { BrowserProvider } from 'ethers';
import './App.css';

// Importieren unserer Adressen und ABIs aus der Konstanten-Datei
import {
  TWO_THIRDS_AVERAGE_GAME_ADDRESS,
  twoThirdsAverageGameABI
} from './constants';

// --- Typ-Definitionen für bessere Code-Qualität mit TypeScript ---

// Definiert die Struktur der allgemeinen Spieldaten
interface GameData {
  phase: number;
  wagerAmount: bigint;
  pot: bigint;
  playerCount: number;
  deadline: number;
  owner: string;
  winner: string;
  serviceFeeWithdrawn: boolean; // Um zu wissen, ob die Gebühr abgehoben wurde
}

// Definiert die Struktur der Daten des aktuell verbundenen Spielers
interface PlayerInfo {
  hasJoined: boolean;
  hasCommitted: boolean;
  hasRevealed: boolean;
  hasWithdrawn: boolean; // Um zu wissen, ob der Spieler seinen Gewinn abgehoben hat
}

// Hilfs-Array, um die Spielphase (Zahl) in einen lesbaren Text umzuwandeln
const spielPhasen = [
  "Registrierung", "Commit", "Reveal", 
  "Berechnung", "Auszahlung", "Abgeschlossen"
];

function App() {
  // --- State-Management mit React Hooks ---
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [gameContract, setGameContract] = useState<Contract | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('Bitte Wallet verbinden.');
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo | null>(null);
  const [remainingTime, setRemainingTime] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false); // Sperrt Buttons während Transaktionen

  // Eingabewerte aus den HTML-Formularen
  const [commitNumber, setCommitNumber] = useState<string>("");
  const [commitSalt, setCommitSalt] = useState<string>("");
  const [revealNumber, setRevealNumber] = useState<string>("");
  const [revealSalt, setRevealSalt] = useState<string>("");

  // --- Initialisierung und Nebeneffekte mit useEffect ---

  // Dieser Hook läuft einmal beim Laden der Komponente
  useEffect(() => {
    // Erstellt eine grundlegende Verbindung zur Blockchain ("read-only")
    const initProvider = () => {
      if (window.ethereum) {
        const newProvider = new ethers.BrowserProvider(window.ethereum);
        setProvider(newProvider);
        const readOnlyContract = new ethers.Contract(TWO_THIRDS_AVERAGE_GAME_ADDRESS, twoThirdsAverageGameABI, newProvider);
        loadGameData(readOnlyContract);
      } else {
        setStatus("MetaMask oder ein anderes Wallet ist nicht installiert.");
      }
    };
    initProvider();

    // Event-Listener für Konto- und Netzwerkwechsel in MetaMask
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', () => window.location.reload());
      window.ethereum.on('chainChanged', () => window.location.reload());
    }
  }, []);

  // Dieser Hook implementiert den Live-Countdown für die Deadline
  useEffect(() => {
    if (!gameData || gameData.deadline === 0) {
      setRemainingTime("Keine Deadline gesetzt");
      return;
    }
    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const secondsLeft = gameData.deadline - now;
      if (secondsLeft <= 0) {
        setRemainingTime("Deadline abgelaufen");
        clearInterval(interval);
        return;
      }
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = secondsLeft % 60;
      setRemainingTime(`Noch ${minutes}m ${seconds.toString().padStart(2, '0')}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [gameData]);


  // --- Funktionen zur Interaktion mit dem Smart Contract ---

  /**
   * Verbindet sich mit dem Wallet, holt den Signer und initialisiert eine "schreibbare" Vertragsinstanz.
   */
  const connectWallet = async () => {
    if (!provider) return;
    try {
      setStatus("Verbinde mit Wallet...");
      const signerInstance = await provider.getSigner();
      const userAddress = await signerInstance.getAddress();
      setAccount(userAddress);
      const contractInstance = new ethers.Contract(TWO_THIRDS_AVERAGE_GAME_ADDRESS, twoThirdsAverageGameABI, signerInstance);
      setGameContract(contractInstance);
      await loadGameData(contractInstance, userAddress); // Daten nach erfolgreicher Verbindung laden
      setStatus("Wallet erfolgreich verbunden.");
    } catch (error) {
      console.error("Fehler beim Verbinden:", error);
      setStatus("Verbindung fehlgeschlagen.");
    }
  };
  
  /**
   * Lädt alle relevanten Spieldaten vom Smart Contract und aktualisiert den Frontend-State.
   */
  const loadGameData = async (contract: Contract, userAddress?: string) => {
    try {
      setStatus("Lade Spieldaten...");
      const [phase, wager, pot, playerCount, deadline, owner, winner, feeWithdrawn] = await Promise.all([
        contract.aktuellePhase(), contract.WAGER_AMOUNT(), contract.pot(),
        contract.getSpielerAnzahl(), contract.deadline(), contract.owner(),
        contract.winner(), contract.serviceFeeWithdrawn()
      ]);
      setGameData({
        phase: Number(phase), wagerAmount: wager, pot: pot, playerCount: Number(playerCount), 
        deadline: Number(deadline), owner: owner, winner: winner, serviceFeeWithdrawn: feeWithdrawn
      });
      if(userAddress) {
        setIsOwner(userAddress.toLowerCase() === owner.toLowerCase());
        const spieler = await contract.spielerDaten(userAddress);
        setPlayerInfo({
          hasJoined: spieler.wagerAmount > 0, hasCommitted: spieler.hasCommitted, 
          hasRevealed: spieler.hasRevealed, hasWithdrawn: spieler.hasWithdrawn
        });
      }
      setStatus("Spieldaten geladen.");
    } catch (error) {
      console.error("Fehler beim Laden der Spieldaten:", error);
      setStatus("Konnte Spieldaten nicht laden.");
    }
  }

  // Die folgenden `handle...`-Funktionen kapseln die Logik für jede Benutzeraktion.

  const handleJoinGame = async () => {
    if (!gameContract || !gameData) return;
    setIsSubmitting(true);
    setStatus("Warte auf Bestätigung...");
    try {
      const tx = await gameContract.beitreten({ value: gameData.wagerAmount });
      await tx.wait();
      setStatus("Erfolgreich beigetreten!");
      await loadGameData(gameContract, account!);
    } catch (error: any) {
      console.error(error);
      setStatus(`Fehler: ${error.reason || "Transaktion fehlgeschlagen."}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCommit = async () => {
    if (!gameContract || !account || !commitNumber || !commitSalt) return;
    setIsSubmitting(true);
    setStatus("Commit wird verarbeitet...");
    try {
      const saltAsBytes32 = encodeBytes32String(commitSalt);
      const commitment = solidityPackedKeccak256(["uint16", "bytes32", "address"], [commitNumber, saltAsBytes32, account]);
      const tx = await gameContract.commit(commitment);
      await tx.wait();
      setStatus("Commit erfolgreich gesendet!");
      await loadGameData(gameContract, account!);
    } catch (error: any) {
      console.error(error);
      setStatus(`Fehler: ${error.reason || "Transaktion fehlgeschlagen."}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReveal = async () => {
    if (!gameContract || !revealNumber || !revealSalt) return;
    setIsSubmitting(true);
    setStatus("Reveal wird verarbeitet...");
    try {
      const saltAsBytes32 = encodeBytes32String(revealSalt);
      const tx = await gameContract.reveal(revealNumber, saltAsBytes32);
      await tx.wait();
      setStatus("Zahl erfolgreich aufgedeckt!");
      await loadGameData(gameContract, account!);
    } catch (error: any) {
      console.error(error);
      setStatus(`Fehler: ${error.reason || "Transaktion fehlgeschlagen."}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleStateTransition = async () => {
    if (!gameContract || !isOwner) return;
    setIsSubmitting(true);
    setStatus("Phasenübergang wird eingeleitet...");
    try {
      const tx = await gameContract.forceStateTransition();
      await tx.wait();
      setStatus("Phase erfolgreich gewechselt!");
      await loadGameData(gameContract, account!);
    } catch(error: any) {
      console.error(error);
      setStatus(`Fehler: ${error.reason || "Transaktion fehlgeschlagen."}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleCalculateWinner = async () => {
    if (!gameContract || !isOwner) return;
    setIsSubmitting(true);
    setStatus("Ergebnis wird berechnet...");
    try {
      const tx = await gameContract.berechneErgebnisUndErmittleGewinner();
      await tx.wait();
      setStatus("Gewinner wurde ermittelt! Nächste Phase: Auszahlung.");
      await loadGameData(gameContract, account!);
    } catch (error: any) {
      console.error("Fehler bei der Berechnung:", error);
      setStatus(`Fehler: ${error.reason || "Berechnung fehlgeschlagen."}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleWithdrawPrize = async () => {
    if (!gameContract || !account) return;
    setIsSubmitting(true);
    setStatus("Preisgeld-Auszahlung wird angefordert...");
    try {
      const tx = await gameContract.withdrawPrize();
      await tx.wait();
      setStatus("Preisgeld erfolgreich abgehoben!");
      await loadGameData(gameContract, account);
    } catch (error: any) {
      console.error("Fehler bei der Preisgeld-Auszahlung:", error);
      setStatus(`Fehler: ${error.reason || "Auszahlung fehlgeschlagen."}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdrawServiceFee = async () => {
    if (!gameContract || !account) return;
    setIsSubmitting(true);
    setStatus("Servicegebühr-Auszahlung wird angefordert...");
    try {
      const tx = await gameContract.withdrawServiceFee();
      await tx.wait();
      setStatus("Servicegebühr erfolgreich abgehoben!");
      await loadGameData(gameContract, account);
    } catch (error: any) {
      console.error("Fehler bei der Gebühren-Auszahlung:", error);
      setStatus(`Fehler: ${error.reason || "Auszahlung fehlgeschlagen."}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- JSX: Die Benutzeroberfläche ---
  return (
    <div className="App">
      <header className="App-header">
        <h1>Errate 2/3 des Durchschnitts</h1>
        {!account ? (
          <button onClick={connectWallet}>Wallet verbinden</button>
        ) : (
          <div className="accountInfo">Verbunden als: <span>{account}</span></div>
        )}
        <div className="status">Status: {status}</div>
      </header>

      {/* Hauptbereich wird nur angezeigt, wenn Wallet verbunden ist und Spieldaten geladen sind */}
      {account && gameData && (
        <main className="game-container">
          <div className="card game-info">
            <h2>Spiel-Informationen</h2>
            <p>Aktuelle Phase: <strong>{spielPhasen[gameData.phase]}</strong></p>
            <p>Einsatz pro Spieler: <strong>{formatEther(gameData.wagerAmount)} ETH</strong></p>
            <p>Aktueller Pot: <strong>{formatEther(gameData.pot)} ETH</strong></p>
            <p>Anzahl Spieler: <strong>{gameData.playerCount}</strong></p>
            <p>Deadline: <strong>{remainingTime}</strong></p>
          </div>

          <div className="card game-actions">
            <h2>Ihre Aktionen</h2>
            {/* PHASE 0: REGISTRIERUNG */}
            {gameData.phase === 0 && (
              <div>
                <p>Treten Sie dem Spiel bei, indem Sie den Wetteinsatz hinterlegen.</p>
                <button onClick={handleJoinGame} disabled={playerInfo?.hasJoined || isSubmitting}>
                  {playerInfo?.hasJoined ? 'Du bist bereits beigetreten' : `Spiel beitreten (${formatEther(gameData.wagerAmount)} ETH)`}
                </button>
              </div>
            )}
            {/* PHASE 1: COMMIT */}
            {gameData.phase === 1 && (
              <div>
                {!playerInfo?.hasJoined ? (<p>Die Registrierungsphase ist vorbei.</p>) : playerInfo.hasCommitted ? (<p>Du hast deinen Commit bereits gesendet.</p>) : (
                  <div className="form-group">
                    <p>Reichen Sie Ihre Zahl (0-1000) und ein geheimes "Salt" ein.</p>
                    <input type="number" placeholder="Ihre Zahl (0-1000)" value={commitNumber} onChange={(e) => setCommitNumber(e.target.value)} />
                    <input type="text" placeholder="Ihr geheimes Salt (z.B. 'geheim123')" value={commitSalt} onChange={(e) => setCommitSalt(e.target.value)} />
                    <button onClick={handleCommit} disabled={isSubmitting}>Zahl committen</button>
                  </div>
                )}
              </div>
            )}
            {/* PHASE 2: REVEAL */}
            {gameData.phase === 2 && (
               <div>
                {!playerInfo?.hasCommitted ? (<p>Du hast in der Commit-Phase nichts eingereicht.</p>) : playerInfo.hasRevealed ? (<p>Du hast deine Zahl bereits aufgedeckt.</p>) : (
                  <div className="form-group">
                    <p>Decken Sie Ihre Zahl auf.</p>
                     <input type="number" placeholder="Ihre Zahl (0-1000)" value={revealNumber} onChange={(e) => setRevealNumber(e.target.value)} />
                     <input type="text" placeholder="Ihr geheimes Salt" value={revealSalt} onChange={(e) => setRevealSalt(e.target.value)} />
                    <button onClick={handleReveal} disabled={isSubmitting}>Zahl aufdecken</button>
                  </div>
                )}
              </div>
            )}
            {/* PHASE 3: BERECHNUNG */}
            {gameData.phase === 3 && (
              <p>Das Spiel berechnet das Ergebnis. Bitte warten Sie, bis der Admin den Prozess abschließt.</p>
            )}
            {/* PHASE 4: AUSZAHLUNG */}
            {gameData.phase === 4 && (
              <div>
                <h4>Auszahlung</h4>
                <p>Der Gewinner ist: <span className="winner-address">{gameData.winner}</span></p>
                {/* Zeigt den Button nur für den Gewinner an */}
                {account?.toLowerCase() === gameData.winner.toLowerCase() ? (
                  !playerInfo?.hasWithdrawn ? (
                    <button onClick={handleWithdrawPrize} disabled={isSubmitting}>Preisgeld abheben</button>
                  ) : (
                    <p><strong>Dein Preisgeld wurde bereits abgehoben.</strong></p>
                  )
                ) : (
                  <p>Nur der Gewinner kann das Preisgeld abheben.</p>
                )}
              </div>
            )}
            {/* PHASE 5: ABGESCHLOSSEN */}
            {gameData.phase === 5 && (
              <p>Das Spiel ist abgeschlossen. Vielen Dank für die Teilnahme!</p>
            )}
          </div>
          
          {/* Admin-Bereich, der je nach Phase unterschiedliche Aktionen anzeigt */}
          {isOwner && (
            <div className="card admin-actions">
              <h2>Admin-Aktionen</h2>
              {/* Button zum Phasenübergang, nur sichtbar in den Phasen 0, 1 und 2 */}
              {gameData.phase < 3 && (
                  <button onClick={handleStateTransition} disabled={isSubmitting}>Nächste Phase erzwingen</button>
              )}
              {/* Button für die Berechnungsphase (Phase 3) */}
              {gameData.phase === 3 && (
                  <button onClick={handleCalculateWinner} disabled={isSubmitting}>Gewinner berechnen</button>
              )}
              {/* Button für die Auszahlungsphase (Phase 4) */}
              {gameData.phase === 4 && (
                !gameData.serviceFeeWithdrawn ? (
                  <button onClick={handleWithdrawServiceFee} disabled={isSubmitting}>Servicegebühr abheben</button>
                ) : (
                  <p><strong>Servicegebühr wurde bereits abgehoben.</strong></p>
                )
              )}
            </div>
          )}
        </main>
      )}
    </div>
  );
}

export default App;