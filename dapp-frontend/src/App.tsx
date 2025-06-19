import { useState, useEffect } from 'react';
import { ethers, Contract, formatEther, solidityPackedKeccak256, encodeBytes32String } from 'ethers';
import type { BrowserProvider } from 'ethers';
import './App.css';

import {
  TWO_THIRDS_AVERAGE_GAME_ADDRESS,
  twoThirdsAverageGameABI
} from './constants';

// --- TYP-DEFINITIONEN ---
// Definiert die Struktur für die allgemeinen Spieldaten, die vom Vertrag abgerufen werden.
interface GameData {
  phase: number;
  wagerAmount: bigint;
  pot: bigint;
  playerCount: number;
  deadlineBlock: number;
  owner: string;
  winner: string;
  serviceFeeWithdrawn: boolean;
  targetValue: number;
}

// Definiert die Struktur für den spezifischen Status des aktuellen Benutzers im Spiel.
interface PlayerInfo {
  hasJoined: boolean;
  hasCommitted: boolean;
  hasRevealed: boolean;
  hasWithdrawn: boolean;
}

// Definiert die Struktur für die finale Ergebnistabelle.
interface FinalResult {
    playerAddress: string;
    revealedNumber: number;
    difference: number;
    hasRevealed: boolean;
}

// Definiert die möglichen Typen für Statusmeldungen, um bedingtes Styling zu ermöglichen.
type StatusType = 'info' | 'error' | 'success' | 'loading';

// --- KONSTANTEN ---
// Mappt das Phasen-Enum aus dem Vertrag auf lesbare Strings.
const spielPhasen = [
  "Registrierung", "Commit", "Reveal", 
  "Berechnung", "Auszahlung", "Abgeschlossen", "Abgebrochen"
];
// Wird zur Schätzung der verbleibenden Zeit verwendet.
const AVERAGE_BLOCK_TIME_SECONDS = 12;

// --- HILFSKOMPONENTEN ---

/**
 * Eine Unterkomponente zur Darstellung der finalen Ergebnistabelle.
 * @param {object} props - Die Props der Komponente.
 * @param {FinalResult[]} props.results - Die sortierten und aufbereiteten Ergebnisdaten.
 * @param {number} props.targetValue - Der berechnete Zielwert des Spiels.
 * @param {string} props.winnerAddress - Die Adresse des Spielgewinners.
 * @returns {JSX.Element}
 */
const ResultsTable = ({ results, targetValue, winnerAddress }: { results: FinalResult[]; targetValue: number; winnerAddress: string; }) => {
    if (results.length === 0) {
        return <div className="card results-table"><p>Noch keine Ergebnisse verfügbar oder niemand hat aufgedeckt.</p></div>;
    }
    return (
      <div className="card results-table">
        <h3>Endergebnis</h3>
        <p>Der Zielwert (2/3 des Durchschnitts) war: <strong>{targetValue.toFixed(2)}</strong></p>
        <table>
          <thead>
            <tr>
              <th>Rang</th>
              <th>Spieler</th>
              <th>Geratene Zahl</th>
              <th>Differenz zum Ziel</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={result.playerAddress} className={result.playerAddress.toLowerCase() === winnerAddress.toLowerCase() ? 'winner-row' : ''}>
                <td>{index + 1}</td>
                <td>{`${result.playerAddress.substring(0, 6)}...${result.playerAddress.substring(result.playerAddress.length - 4)}`}</td>
                <td>{result.hasRevealed ? result.revealedNumber : 'N/A'}</td>
                <td>{result.hasRevealed ? (result.difference % 1 === 0 ? result.difference : result.difference.toFixed(2)) : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
};

// --- HILFSFUNKTIONEN ---

/**
 * Ruft alle Daten ab, die zur Anzeige der Endergebnisse benötigt werden, und verarbeitet sie.
 * @param {Contract} contract - Die ethers Contract-Instanz.
 * @returns {Promise<{results: any[], targetValue: number} | null>}
 */
async function fetchFinalResultsData(contract: Contract) {
    try {
        const playerCount = await contract.getSpielerAnzahl();
        if (Number(playerCount) === 0) return null;

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

// --- HAUPTKOMPONENTE: APP ---

function App() {
  // --- STATE-VERWALTUNG ---
  // Zustand für Blockchain und Vertrag
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [gameContract, setGameContract] = useState<Contract | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [currentBlock, setCurrentBlock] = useState<number>(0);

  // Zustand für Spiellogik und Daten
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo | null>(null);
  const [finalResults, setFinalResults] = useState<FinalResult[] | null>(null);
  const [remainingTime, setRemainingTime] = useState<string>("");
  const [isOwner, setIsOwner] = useState<boolean>(false);

  // Zustand für UI und Formulare
  const [status, setStatus] = useState<{ message: string; type: StatusType }>({ message: 'Bitte Wallet verbinden.', type: 'info' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [commitNumber, setCommitNumber] = useState<string>("");
  const [commitSalt, setCommitSalt] = useState<string>("");
  const [revealNumber, setRevealNumber] = useState<string>("");
  const [revealSalt, setRevealSalt] = useState<string>("");

  // --- LEBENSZYKLUS & DATENABRUF (useEffect) ---

  // Effekt für die einmalige Initialisierung beim Mounten der Komponente.
  useEffect(() => {
    const init = async () => {
      if (window.ethereum) {
        const newProvider = new ethers.BrowserProvider(window.ethereum);
        setProvider(newProvider);
        // Erstellt eine schreibgeschützte Vertragsinstanz, um initiale Daten vor der Verbindung abzurufen.
        const readOnlyContract = new ethers.Contract(TWO_THIRDS_AVERAGE_GAME_ADDRESS, twoThirdsAverageGameABI, newProvider);
        await loadGameData(readOnlyContract);
        
        const blockNumber = await newProvider.getBlockNumber();
        setCurrentBlock(blockNumber);

        // Lauscht auf Änderungen von Wallet und Netzwerk, um die Konsistenz der App zu gewährleisten.
        window.ethereum.on('accountsChanged', () => window.location.reload());
        window.ethereum.on('chainChanged', () => window.location.reload());
      } else {
        setStatus({ message: "MetaMask oder ein anderes Wallet ist nicht installiert.", type: 'error' });
      }
    };
    init();
  }, []);

  // Effekt, um neue Blöcke zu abonnieren und die aktuelle Blocknummer zu aktualisieren.
  useEffect(() => {
    if (!provider) return;
    const onBlock = (blockNumber: number) => setCurrentBlock(blockNumber);
    provider.on('block', onBlock);
    // Aufräumfunktion, um den Listener zu entfernen, wenn die Komponente unmounted wird.
    return () => { provider.off('block', onBlock); };
  }, [provider]);

  // Effekt zur Berechnung und Aktualisierung des Countdowns für die verbleibende Zeit.
  useEffect(() => {
    if (!gameData || gameData.deadlineBlock === 0 || currentBlock === 0) {
      setRemainingTime("Keine Deadline gesetzt");
      return;
    }
    const blocksRemaining = gameData.deadlineBlock - currentBlock;
    if (blocksRemaining <= 0) {
      setRemainingTime("Deadline-Block erreicht");
      return;
    }
    const estimatedSecondsLeft = blocksRemaining * AVERAGE_BLOCK_TIME_SECONDS;
    const minutes = Math.floor(estimatedSecondsLeft / 60);
    const seconds = estimatedSecondsLeft % 60;
    setRemainingTime(`ca. ${minutes}m ${seconds.toString().padStart(2, '0')}s (${blocksRemaining} Blöcke)`);
  }, [gameData, currentBlock]);
  
  // Effekt zum automatischen Laden der Ergebnisse, wenn das Spiel in die Endphasen eintritt.
  useEffect(() => {
    if (gameContract && gameData && (gameData.phase >= 4 && gameData.phase < 6)) {
        // Nur abrufen, wenn die Ergebnisse noch nicht geladen sind.
        if (!finalResults) { 
            loadAndProcessResults(gameContract);
        }
    }
  }, [gameData, gameContract, finalResults]);

  // Effekt, um das Salt eines Benutzers aus dem localStorage zu laden für eine bessere UX während des Reveals.
  useEffect(() => {
    if (account) {
        const savedSalt = localStorage.getItem(`salt-${TWO_THIRDS_AVERAGE_GAME_ADDRESS}-${account}`);
        if (savedSalt) {
            setRevealSalt(savedSalt);
        }
    }
  }, [account]);

  // --- DATENLADE-FUNKTIONEN ---

  /**
   * Lädt alle relevanten Spiel- und Spielerdaten vom Smart Contract.
   * @param {Contract} contract - Die ethers Contract-Instanz.
   * @param {string} [userAddress] - Optionale Adresse des verbundenen Benutzers.
   */
  const loadGameData = async (contract: Contract, userAddress?: string) => {
    try {
      setStatus({ message: "Lade Spieldaten...", type: 'loading' });
      const [phase, wager, pot, playerCount, deadline, owner, winner, feeWithdrawn, targetVal] = await Promise.all([
        contract.aktuellePhase(), contract.WAGER_AMOUNT(), contract.pot(),
        contract.getSpielerAnzahl(), contract.deadlineBlock(), contract.owner(),
        contract.winner(), contract.serviceFeeWithdrawn(), contract.targetValue()
      ]);

      const newGameData = {
        phase: Number(phase), wagerAmount: wager, pot: pot, playerCount: Number(playerCount), 
        deadlineBlock: Number(deadline), owner: owner, winner: winner, serviceFeeWithdrawn: feeWithdrawn,
        targetValue: Number(targetVal)
      };
      setGameData(newGameData);

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

  /**
   * Ruft die Endergebnisdaten ab und bereitet sie für die Anzeige auf.
   * @param {Contract} contract - Die ethers Contract-Instanz.
   */
  const loadAndProcessResults = async (contract: Contract) => {
    const data = await fetchFinalResultsData(contract);
    if (data) {
        const processedResults = data.results
            .filter(r => r.hasRevealed)
            .map(r => ({
                ...r,
                difference: Math.abs(r.revealedNumber - data.targetValue),
            }))
            .sort((a, b) => a.difference - b.difference);
        setFinalResults(processedResults);
    }
  };

  // --- WALLET- & TRANSAKTIONS-HANDLER ---

  /**
   * Verbindet sich mit dem Wallet des Benutzers (z.B. MetaMask).
   */
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

  /**
   * Ein generischer Handler zum Senden von Transaktionen an die Blockchain.
   * Gibt dem Benutzer während des gesamten Prozesses detailliertes Feedback.
   * @param {() => Promise<any>} txFunction - Eine Funktion, die das Transaktions-Promise zurückgibt.
   * @param {string} successMessage - Die Nachricht, die bei erfolgreicher Bestätigung angezeigt wird.
   * @param {() => void} [postTxCallback] - Ein optionaler Callback, der ausgeführt wird, nachdem die Transaktion gesendet, aber bevor sie bestätigt wurde.
   */
  const handleTx = async (txFunction: () => Promise<any>, successMessage: string, postTxCallback?: () => void) => {
    if (!gameContract || !account) return;
    setIsSubmitting(true);
    setStatus({ message: "Bitte Transaktion in Ihrer Wallet bestätigen...", type: 'loading' });
    try {
        const tx = await txFunction();
        if (postTxCallback) {
            postTxCallback();
        }
        setStatus({ message: `Transaktion gesendet (Hash: ${tx.hash.substring(0, 10)}...). Warte auf Bestätigung...`, type: 'loading' });
        
        await tx.wait();
        
        setStatus({ message: successMessage, type: 'success' });
        await loadGameData(gameContract, account);
    } catch (error: any) {
        console.error(error);
        const reason = error.reason || "Transaktion fehlgeschlagen.";
        const finalMessage = error.code === 'ACTION_REJECTED' 
            ? "Transaktion in Wallet abgelehnt."
            : `Fehler: ${reason}`;
        setStatus({ message: finalMessage, type: 'error' });
    } finally {
        setIsSubmitting(false);
    }
  };

  // --- SPEZIFISCHE AKTIONS-HANDLER ---
  const handleJoinGame = () => handleTx(() => gameContract!.beitreten({ value: gameData!.wagerAmount }), "Erfolgreich beigetreten!");
  
  const handleCommit = () => {
    const saltAsBytes32 = encodeBytes32String(commitSalt);
    const commitment = solidityPackedKeccak256(["uint16", "bytes32", "address"], [commitNumber, saltAsBytes32, account!]);
    const saveSalt = () => localStorage.setItem(`salt-${TWO_THIRDS_AVERAGE_GAME_ADDRESS}-${account}`, commitSalt);
    handleTx(() => gameContract!.commit(commitment), "Commit erfolgreich gesendet!", saveSalt);
  };

  const handleReveal = () => {
    const saltAsBytes32 = encodeBytes32String(revealSalt);
    handleTx(() => gameContract!.reveal(revealNumber, saltAsBytes32), "Zahl erfolgreich aufgedeckt!");
  };

  const handleWithdrawPrize = () => handleTx(() => gameContract!.withdrawPrize(), "Preisgeld erfolgreich abgehoben!");
  const handleReclaimWager = () => handleTx(() => gameContract!.reclaimWager(), "Einsatz erfolgreich zurückgefordert!");
  const handleAdvancePhase = () => handleTx(() => gameContract!.advancePhase(), "Phase erfolgreich vorangetrieben!");
  const handleCalculateResult = () => handleTx(() => gameContract!.calculateResult(), "Ergebnisberechnung erfolgreich angestoßen!");
  const handleWithdrawServiceFee = () => handleTx(() => gameContract!.withdrawServiceFee(), "Servicegebühr erfolgreich abgehoben!");

  // --- JSX-RENDER-METHODE ---
  return (
    <div className="App">
      <header>
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
            <p>Phasenende: <strong>{remainingTime}</strong></p>
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
                    <p className="explanation-text">
                        <strong>Phase 1: Commit</strong><br/>
                        Senden Sie einen "digitalen Fingerabdruck" (Hash) Ihrer Zahl. Ihre Zahl bleibt geheim, aber Ihre Wahl ist auf der Blockchain festgelegt. Das "Salt" ist ein geheimes Wort, das Ihren Hash einzigartig macht.
                    </p>
                    <input type="number" placeholder="Ihre Zahl (0-1000)" value={commitNumber} onChange={(e) => setCommitNumber(e.target.value)} disabled={isSubmitting} />
                    <input type="text" placeholder="Ihr geheimes Salt (gut merken!)" value={commitSalt} onChange={(e) => setCommitSalt(e.target.value)} disabled={isSubmitting} />
                    <button onClick={handleCommit} disabled={isSubmitting || !commitNumber || !commitSalt}>{isSubmitting ? 'Wird verarbeitet...' : 'Zahl committen'}</button>
                  </div>
                )}
              </div>
            )}
            {gameData.phase === 2 && (
               <div>
                {!playerInfo?.hasCommitted ? (<p>Du hast in der Commit-Phase nichts eingereicht.</p>) : playerInfo.hasRevealed ? (<p>Du hast deine Zahl bereits aufgedeckt.</p>) : (
                  <div className="form-group">
                    <p className="explanation-text">
                        <strong>Phase 2: Reveal</strong><br/>
                        Decken Sie nun Ihre Zahl auf, indem Sie die <strong>exakt gleichen</strong> Daten wie in der Commit-Phase eingeben. Der Smart Contract prüft, ob alles übereinstimmt.
                    </p>
                     <input type="number" placeholder="Ihre Zahl (0-1000)" value={revealNumber} onChange={(e) => setRevealNumber(e.target.value)} disabled={isSubmitting} />
                     <input type="text" placeholder="Ihr geheimes Salt" value={revealSalt} onChange={(e) => setRevealSalt(e.target.value)} disabled={isSubmitting} />
                    <button onClick={handleReveal} disabled={isSubmitting || !revealNumber || !revealSalt}>{isSubmitting ? 'Wird verarbeitet...' : 'Zahl aufdecken'}</button>
                  </div>
                )}
              </div>
            )}
            {gameData.phase === 4 && (
              <div>
                <h4>Auszahlung</h4>
                {account.toLowerCase() === gameData.winner.toLowerCase() ? (
                  !playerInfo?.hasWithdrawn ? ( <button onClick={handleWithdrawPrize} disabled={isSubmitting}>Preisgeld abheben</button> ) : 
                  ( <p><strong>Dein Preisgeld wurde bereits abgehoben.</strong></p> )
                ) : ( <p>Nur der Gewinner ({`${gameData.winner.substring(0, 6)}...`}) kann das Preisgeld abheben.</p> )}
              </div>
            )}
            {gameData.phase === 5 && (<p>Das Spiel ist abgeschlossen.</p>)}
            {gameData.phase === 6 && (
              <div>
                <h4>Spiel Abgebrochen</h4>
                <p>Das Spiel wurde abgebrochen. Sie können Ihren Einsatz zurückfordern.</p>
                {!playerInfo?.hasWithdrawn ? (
                    <button onClick={handleReclaimWager} disabled={isSubmitting || !playerInfo?.hasJoined}>Einsatz zurückfordern</button>
                ) : (
                    <p><strong>Dein Einsatz wurde bereits zurückgefordert.</strong></p>
                )}
              </div>
            )}
            
            {gameData.phase >= 4 && gameData.phase < 6 && finalResults && gameData.winner && (
              <ResultsTable results={finalResults} targetValue={gameData.targetValue} winnerAddress={gameData.winner} />
            )}
          </div>
          
          <div className="card public-actions">
            <h2>Öffentliche Aktionen</h2>
            {gameData.phase < 3 && (<button onClick={handleAdvancePhase} disabled={isSubmitting}>Phase vorantreiben</button>)}
            {gameData.phase === 3 && (<button onClick={handleCalculateResult} disabled={isSubmitting}>Ergebnis berechnen</button>)}
          </div>

          {isOwner && (
            <div className="card admin-actions">
                <h2>Admin Aktionen</h2>
                {gameData.phase === 4 && !gameData.serviceFeeWithdrawn ? (
                    <button onClick={handleWithdrawServiceFee} disabled={isSubmitting}>Servicegebühr abheben</button>
                ) : (
                    <p>Aktuell keine Admin-Aktionen verfügbar.</p>
                )}
            </div>
          )}
        </main>
      )}
    </div>
  );
}

export default App;
