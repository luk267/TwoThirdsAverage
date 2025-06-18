import { useState, useEffect } from 'react';
import { ethers, Contract, formatEther, solidityPackedKeccak256, encodeBytes32String } from 'ethers';
import type { BrowserProvider } from 'ethers';
import './App.css';

import {
  TWO_THIRDS_AVERAGE_GAME_ADDRESS,
  twoThirdsAverageGameABI
} from './constants';

// --- Typ-Definitionen ---

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

interface PlayerInfo {
  hasJoined: boolean;
  hasCommitted: boolean;
  hasRevealed: boolean;
  hasWithdrawn: boolean;
}

interface FinalResult {
    playerAddress: string;
    revealedNumber: number;
    difference: number;
    hasRevealed: boolean;
}

type StatusType = 'info' | 'error' | 'success' | 'loading';

const spielPhasen = [
  "Registrierung", "Commit", "Reveal", 
  "Berechnung", "Auszahlung", "Abgeschlossen", "Abgebrochen"
];


// --- Hilfskomponenten ---

interface ResultsTableProps {
  results: FinalResult[];
  targetValue: number;
  winnerAddress: string;
}

const ResultsTable = ({ results, targetValue, winnerAddress }: ResultsTableProps) => {
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
              <th>Differenz</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={result.playerAddress} className={result.playerAddress.toLowerCase() === winnerAddress.toLowerCase() ? 'winner-row' : ''}>
                <td>{index + 1}</td>
                <td>{`${result.playerAddress.substring(0, 6)}...${result.playerAddress.substring(result.playerAddress.length - 4)}`}</td>
                <td>{result.hasRevealed ? result.revealedNumber : 'N/A'}</td>
                <td>{result.hasRevealed ? result.difference.toFixed(2) : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
};

// --- Hilfsfunktionen für die Datenabfrage ---

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


// --- Hauptkomponente: App ---

function App() {
  // --- State-Management ---
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
  const [currentBlock, setCurrentBlock] = useState<number>(0);

  const [commitNumber, setCommitNumber] = useState<string>("");
  const [commitSalt, setCommitSalt] = useState<string>("");
  const [revealNumber, setRevealNumber] = useState<string>("");
  const [revealSalt, setRevealSalt] = useState<string>("");

  // --- Initialisierung und Nebeneffekte (useEffect) ---

  useEffect(() => {
    const init = async () => {
      if (window.ethereum) {
        const newProvider = new ethers.BrowserProvider(window.ethereum);
        setProvider(newProvider);
        const readOnlyContract = new ethers.Contract(TWO_THIRDS_AVERAGE_GAME_ADDRESS, twoThirdsAverageGameABI, newProvider);
        await loadGameData(readOnlyContract);
        
        const blockNumber = await newProvider.getBlockNumber();
        setCurrentBlock(blockNumber);
      } else {
        setStatus({ message: "MetaMask oder ein anderes Wallet ist nicht installiert.", type: 'error' });
      }
    };
    init();

    if (window.ethereum) {
      window.ethereum.on('accountsChanged', () => window.location.reload());
      window.ethereum.on('chainChanged', () => window.location.reload());
    }
  }, []);

  useEffect(() => {
    if (!provider) return;
    const onBlock = (blockNumber: number) => setCurrentBlock(blockNumber);
    provider.on('block', onBlock);
    return () => { provider.off('block', onBlock); };
  }, [provider]);

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
    const AVERAGE_BLOCK_TIME_SECONDS = 12;
    const estimatedSecondsLeft = blocksRemaining * AVERAGE_BLOCK_TIME_SECONDS;
    const minutes = Math.floor(estimatedSecondsLeft / 60);
    const seconds = estimatedSecondsLeft % 60;
    setRemainingTime(`ca. ${minutes}m ${seconds.toString().padStart(2, '0')}s (${blocksRemaining} Blöcke)`);
  }, [gameData, currentBlock]);

  useEffect(() => {
    if (gameContract && gameData && (gameData.phase >= 4 && gameData.phase < 6)) {
        if (!finalResults) {
            loadAndProcessResults(gameContract);
        }
    }
  }, [gameData, gameContract, finalResults]);

  // --- Datenlade-Funktionen ---

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

  // --- Wallet & Transaktions-Handler ---

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
        const reason = error.reason || "Transaktion fehlgeschlagen.";
        const finalMessage = error.code === 'ACTION_REJECTED' 
            ? "Transaktion in MetaMask abgelehnt."
            : reason;
        setStatus({ message: `Fehler: ${finalMessage}`, type: 'error' });
    } finally {
        setIsSubmitting(false);
    }
  };

  // --- Handler für alle Aktionen ---
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
  const handleWithdrawPrize = () => handleTx(() => gameContract!.withdrawPrize(), "Preisgeld erfolgreich abgehoben!");
  const handleReclaimWager = () => handleTx(() => gameContract!.reclaimWager(), "Einsatz erfolgreich zurückgefordert!");
  const handleAdvancePhase = () => handleTx(() => gameContract!.advancePhase(), "Phase erfolgreich vorangetrieben!");
  const handleCalculateResult = () => handleTx(() => gameContract!.calculateResult(), "Ergebnisberechnung erfolgreich angestoßen!");
  const handleWithdrawServiceFee = () => handleTx(() => gameContract!.withdrawServiceFee(), "Servicegebühr erfolgreich abgehoben!");

  // --- JSX: Die Benutzeroberfläche ---
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
            {gameData.phase === 3 && (<p>Das Spiel ist bereit zur Berechnung. Jeder kann den Prozess nun anstoßen.</p>)}
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
            {isOwner && gameData.phase === 4 && !gameData.serviceFeeWithdrawn && (
                <button onClick={handleWithdrawServiceFee} disabled={isSubmitting}>Servicegebühr abheben (Admin)</button>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

export default App;