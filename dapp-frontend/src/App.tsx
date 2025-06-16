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
  serviceFeeWithdrawn: boolean;
  targetValue: number; // Hinzugefügt für die Ergebnistabelle
}

// Definiert die Struktur der Daten des aktuell verbundenen Spielers
interface PlayerInfo {
  hasJoined: boolean;
  hasCommitted: boolean;
  hasRevealed: boolean;
  hasWithdrawn: boolean;
}

// Definiert die Struktur für eine Zeile in der Ergebnistabelle
interface FinalResult {
    playerAddress: string;
    revealedNumber: number;
    difference: number;
    hasRevealed: boolean;
}

// Definiert die Status-Typen für UI-Feedback
type StatusType = 'info' | 'error' | 'success' | 'loading';

// Hilfs-Array, um die Spielphase (Zahl) in einen lesbaren Text umzuwandeln
const spielPhasen = [
  "Registrierung", "Commit", "Reveal", 
  "Berechnung", "Auszahlung", "Abgeschlossen"
];

// --- Hilfsfunktionen & Unterkomponenten ---

/**
 * Ruft alle Daten ab, die für die Endergebnistabelle benötigt werden.
 */
async function fetchFinalResultsData(contract: Contract) {
    try {
        const playerCount = await contract.getSpielerAnzahl();
        const playerAddresses: string[] = [];
        for (let i = 0; i < playerCount; i++) {
            playerAddresses.push(await contract.spielerListe(i));
        }

        const playerDataPromises = playerAddresses.map(address => contract.spielerDaten(address));
        const [allPlayerData, targetValue] = await Promise.all([
            Promise.all(playerDataPromises),
            contract.targetValue()
        ]);
        
        const combinedResults = playerAddresses.map((address, index) => ({
            playerAddress: address,
            revealedNumber: allPlayerData[index].hasRevealed ? Number(allPlayerData[index].revealedNumber) : -1,
            hasRevealed: allPlayerData[index].hasRevealed
        }));

        return {
            results: combinedResults,
            targetValue: Number(targetValue),
        };
    } catch (error) {
        console.error("Fehler beim Laden der Endergebnisse:", error);
        return null;
    }
}

// Definiert die Props für die ResultsTable Komponente
interface ResultsTableProps {
  results: FinalResult[];
  targetValue: number;
  winnerAddress: string;
}

/**
 * Eine separate Komponente zur Darstellung der Ergebnistabelle.
 */
const ResultsTable = ({ results, targetValue, winnerAddress }: ResultsTableProps) => {
    return (
      <div className="card results-table">
        <h3>Endergebnis</h3>
        <p>Der Zielwert (2/3 des Durchschnitts) war: <strong>{targetValue}</strong></p>
        <table>
          <thead>
            <tr>
              <th>Rang</th>
              <th>Spieler</th>
              <th>Geratene Zahl</th>
              <th>Differenz</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={result.playerAddress} className={result.playerAddress.toLowerCase() === winnerAddress.toLowerCase() ? 'winner-row' : ''}>
                <td>{index + 1}</td>
                <td>{`${result.playerAddress.substring(0, 6)}...${result.playerAddress.substring(result.playerAddress.length - 4)}`}</td>
                <td>{result.hasRevealed ? result.revealedNumber : 'N/A'}</td>
                <td>{result.hasRevealed ? result.difference : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
};


// --- Hauptkomponente: App ---

function App() {
  // --- State-Management mit React Hooks ---
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [gameContract, setGameContract] = useState<Contract | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [status, setStatus] = useState<{ message: string; type: StatusType }>({ message: 'Bitte Wallet verbinden.', type: 'info' });
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo | null>(null);
  const [remainingTime, setRemainingTime] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [finalResults, setFinalResults] = useState<FinalResult[] | null>(null);

  // Eingabewerte aus den HTML-Formularen
  const [commitNumber, setCommitNumber] = useState<string>("");
  const [commitSalt, setCommitSalt] = useState<string>("");
  const [revealNumber, setRevealNumber] = useState<string>("");
  const [revealSalt, setRevealSalt] = useState<string>("");

  // --- Initialisierung und Nebeneffekte mit useEffect ---

  useEffect(() => {
    const initProvider = () => {
      if (window.ethereum) {
        const newProvider = new ethers.BrowserProvider(window.ethereum);
        setProvider(newProvider);
        const readOnlyContract = new ethers.Contract(TWO_THIRDS_AVERAGE_GAME_ADDRESS, twoThirdsAverageGameABI, newProvider);
        loadGameData(readOnlyContract);
      } else {
        setStatus({ message: "MetaMask oder ein anderes Wallet ist nicht installiert.", type: 'error' });
      }
    };
    initProvider();

    if (window.ethereum) {
      window.ethereum.on('accountsChanged', () => window.location.reload());
      window.ethereum.on('chainChanged', () => window.location.reload());
    }
  }, []);

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

  // Lädt die Endergebnisse, wenn das Spiel in Phase 4 oder 5 ist.
  useEffect(() => {
    if (gameContract && gameData && (gameData.phase === 4 || gameData.phase === 5)) {
        if (!finalResults) { // Nur laden, wenn wir es noch nicht haben
            loadAndProcessResults(gameContract);
        }
    }
  }, [gameData, gameContract, finalResults]);


  // --- Funktionen zur Interaktion mit dem Smart Contract ---

  const connectWallet = async () => {
    if (!provider) return;
    try {
      setStatus({ message: "Verbinde mit Wallet...", type: 'loading' });
      const signerInstance = await provider.getSigner();
      const userAddress = await signerInstance.getAddress();
      setAccount(userAddress);
      const contractInstance = new ethers.Contract(TWO_THIRDS_AVERAGE_GAME_ADDRESS, twoThirdsAverageGameABI, signerInstance);
      setGameContract(contractInstance);
      await loadGameData(contractInstance, userAddress);
      setStatus({ message: "Wallet erfolgreich verbunden.", type: 'success' });
    } catch (error) {
      console.error("Fehler beim Verbinden:", error);
      setStatus({ message: "Verbindung fehlgeschlagen.", type: 'error' });
    }
  };
  
  const loadGameData = async (contract: Contract, userAddress?: string) => {
    try {
      setStatus({ message: "Lade Spieldaten...", type: 'loading' });
      const [phase, wager, pot, playerCount, deadline, owner, winner, feeWithdrawn, targetVal] = await Promise.all([
        contract.aktuellePhase(), contract.WAGER_AMOUNT(), contract.pot(),
        contract.getSpielerAnzahl(), contract.deadline(), contract.owner(),
        contract.winner(), contract.serviceFeeWithdrawn(), contract.targetValue()
      ]);
      setGameData({
        phase: Number(phase), wagerAmount: wager, pot: pot, playerCount: Number(playerCount), 
        deadline: Number(deadline), owner: owner, winner: winner, serviceFeeWithdrawn: feeWithdrawn,
        targetValue: Number(targetVal)
      });
      if(userAddress) {
        setIsOwner(userAddress.toLowerCase() === owner.toLowerCase());
        const spieler = await contract.spielerDaten(userAddress);
        setPlayerInfo({
          hasJoined: spieler.wagerAmount > 0, hasCommitted: spieler.hasCommitted, 
          hasRevealed: spieler.hasRevealed, hasWithdrawn: spieler.hasWithdrawn
        });
      }
      setStatus({ message: "Spieldaten geladen.", type: 'info' });
    } catch (error) {
      console.error("Fehler beim Laden der Spieldaten:", error);
      setStatus({ message: "Konnte Spieldaten nicht laden.", type: 'error' });
    }
  }

  const loadAndProcessResults = async (contract: Contract) => {
    const data = await fetchFinalResultsData(contract);
    if (data) {
        const processedResults = data.results
            .filter(r => r.hasRevealed) // Nur Spieler anzeigen, die aufgedeckt haben
            .map(r => ({
                ...r,
                difference: Math.abs(r.revealedNumber - data.targetValue),
            }))
            .sort((a, b) => a.difference - b.difference); // Nach Differenz aufsteigend sortieren
        setFinalResults(processedResults);
    }
  };

  const handleTx = async (txFunction: () => Promise<any>, successMessage: string) => {
    if (!gameContract || !account) return;
    setIsSubmitting(true);
    setStatus({ message: "Warte auf Bestätigung in MetaMask...", type: 'loading' });
    try {
        const tx = await txFunction();
        setStatus({ message: "Transaktion wird verarbeitet...", type: 'loading' });
        await tx.wait();
        setStatus({ message: successMessage, type: 'success' });
        await loadGameData(gameContract, account);
    } catch (error: any) {
        console.error(error);
        const errorMessage = error.code === 'ACTION_REJECTED' 
            ? "Transaktion in MetaMask abgelehnt."
            : (error.reason || "Transaktion fehlgeschlagen.");
        setStatus({ message: `Fehler: ${errorMessage}`, type: 'error' });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleJoinGame = () => handleTx(() => gameContract!.beitreten({ value: gameData!.wagerAmount }), "Erfolgreich beigetreten!");

  const handleCommit = () => {
    const saltAsBytes32 = encodeBytes32String(commitSalt);
    const commitment = solidityPackedKeccak256(["uint16", "bytes32", "address"], [commitNumber, saltAsBytes32, account!]);
    return handleTx(() => gameContract!.commit(commitment), "Commit erfolgreich gesendet!");
  };

  const handleReveal = () => {
    const saltAsBytes32 = encodeBytes32String(revealSalt);
    return handleTx(() => gameContract!.reveal(revealNumber, saltAsBytes32), "Zahl erfolgreich aufgedeckt!");
  };

  const handleStateTransition = () => handleTx(() => gameContract!.forceStateTransition(), "Phase erfolgreich gewechselt!");
  const handleCalculateWinner = () => handleTx(() => gameContract!.berechneErgebnisUndErmittleGewinner(), "Gewinner wurde ermittelt!");
  const handleWithdrawPrize = () => handleTx(() => gameContract!.withdrawPrize(), "Preisgeld erfolgreich abgehoben!");
  const handleWithdrawServiceFee = () => handleTx(() => gameContract!.withdrawServiceFee(), "Servicegebühr erfolgreich abgehoben!");

  // --- JSX: Die Benutzeroberfläche ---
  return (
    <div className="App">
      <header className="App-header">
        <h1>Errate 2/3 des Durchschnitts</h1>
        {!account ? (
          <button onClick={connectWallet} disabled={isSubmitting}>Wallet verbinden</button>
        ) : (
          <div className="accountInfo">Verbunden als: <span>{account}</span></div>
        )}
        <div className={`status status-${status.type}`}>Status: {status.message}</div>
      </header>

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
            {gameData.phase === 0 && (
              <div>
                <p>Treten Sie dem Spiel bei, indem Sie den Wetteinsatz hinterlegen.</p>
                <button onClick={handleJoinGame} disabled={playerInfo?.hasJoined || isSubmitting}>
                  {isSubmitting ? 'Wird verarbeitet...' : (playerInfo?.hasJoined ? 'Du bist bereits beigetreten' : `Spiel beitreten (${formatEther(gameData.wagerAmount)} ETH)`)}
                </button>
              </div>
            )}
            {gameData.phase === 1 && (
              <div>
                {!playerInfo?.hasJoined ? (<p>Die Registrierungsphase ist vorbei.</p>) : playerInfo.hasCommitted ? (<p>Du hast deinen Commit bereits gesendet.</p>) : (
                  <div className="form-group">
                    <p>Reichen Sie Ihre Zahl (0-1000) und ein geheimes "Salt" ein.</p>
                    <input type="number" placeholder="Ihre Zahl (0-1000)" value={commitNumber} onChange={(e) => setCommitNumber(e.target.value)} disabled={isSubmitting} />
                    <input type="text" placeholder="Ihr geheimes Salt" value={commitSalt} onChange={(e) => setCommitSalt(e.target.value)} disabled={isSubmitting} />
                    <button onClick={handleCommit} disabled={isSubmitting || !commitNumber || !commitSalt}>{isSubmitting ? 'Wird verarbeitet...' : 'Zahl committen'}</button>
                  </div>
                )}
              </div>
            )}
            {gameData.phase === 2 && (
               <div>
                {!playerInfo?.hasCommitted ? (<p>Du hast in der Commit-Phase nichts eingereicht.</p>) : playerInfo.hasRevealed ? (<p>Du hast deine Zahl bereits aufgedeckt.</p>) : (
                  <div className="form-group">
                    <p>Decken Sie Ihre Zahl auf.</p>
                     <input type="number" placeholder="Ihre Zahl (0-1000)" value={revealNumber} onChange={(e) => setRevealNumber(e.target.value)} disabled={isSubmitting} />
                     <input type="text" placeholder="Ihr geheimes Salt" value={revealSalt} onChange={(e) => setRevealSalt(e.target.value)} disabled={isSubmitting} />
                    <button onClick={handleReveal} disabled={isSubmitting || !revealNumber || !revealSalt}>{isSubmitting ? 'Wird verarbeitet...' : 'Zahl aufdecken'}</button>
                  </div>
                )}
              </div>
            )}
            {gameData.phase === 3 && (<p>Das Spiel berechnet das Ergebnis. Der Admin muss den Prozess abschließen.</p>)}
            {gameData.phase === 4 && (
              <div>
                <h4>Auszahlung</h4>
                {account?.toLowerCase() === gameData.winner.toLowerCase() ? (
                  !playerInfo?.hasWithdrawn ? ( <button onClick={handleWithdrawPrize} disabled={isSubmitting}>Preisgeld abheben</button> ) : 
                  ( <p><strong>Dein Preisgeld wurde bereits abgehoben.</strong></p> )
                ) : ( <p>Nur der Gewinner kann das Preisgeld abheben.</p> )}
              </div>
            )}
             {gameData.phase >= 4 && finalResults && gameData.winner && (
                <ResultsTable results={finalResults} targetValue={gameData.targetValue} winnerAddress={gameData.winner} />
             )}
            {gameData.phase === 5 && (<p>Das Spiel ist abgeschlossen.</p>)}
          </div>
          
          {isOwner && (
            <div className="card admin-actions">
              <h2>Admin-Aktionen</h2>
              {gameData.phase < 3 && (<button onClick={handleStateTransition} disabled={isSubmitting}>{isSubmitting ? 'Wird verarbeitet...' : 'Nächste Phase erzwingen'}</button>)}
              {gameData.phase === 3 && (<button onClick={handleCalculateWinner} disabled={isSubmitting}>{isSubmitting ? 'Wird verarbeitet...' : 'Gewinner berechnen'}</button>)}
              {gameData.phase === 4 && (!gameData.serviceFeeWithdrawn ? (
                  <button onClick={handleWithdrawServiceFee} disabled={isSubmitting}>{isSubmitting ? 'Wird verarbeitet...' : 'Servicegebühr abheben'}</button>
                ) : ( <p><strong>Servicegebühr wurde bereits abgehoben.</strong></p> ))}
            </div>
          )}
        </main>
      )}
    </div>
  );
}

export default App;
