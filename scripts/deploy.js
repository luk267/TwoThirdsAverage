// Wir importieren die Hardhat Runtime Environment, um auf Ethers.js und andere Tools zuzugreifen.
const hre = require("hardhat");

async function main() {
  // --- 1. Parameter für das Spiel festlegen ---
  // Wetteinsatz: 0.01 Ether. `parseEther` wandelt den Betrag in Wei um.
  const wagerAmount = hre.ethers.parseEther("0.01"); 
  // Servicegebühr für den Spielleiter: 10%
  const serviceFeePercentage = 10; 

  console.log("Deployment wird gestartet...");
  
  // --- 2. GameFactory deployen ---
  // Wir holen uns die ContractFactory für "GameFactory". Das ist ein Objekt, um Instanzen dieses Vertrags zu erstellen.
  const GameFactory = await hre.ethers.getContractFactory("GameFactory");
  
  // Wir deployen den Vertrag. Hardhat verbindet sich automatisch mit dem Deployer-Konto.
  const gameFactory = await GameFactory.deploy();

  // Wir warten, bis das Deployment abgeschlossen und der Vertrag in der Blockchain "verankert" ist.
  await gameFactory.waitForDeployment();

  // Wir geben die neue Adresse der GameFactory in der Konsole aus.
  // DIESE ADRESSE BENÖTIGEN WIR!
  console.log(`\n✅ GameFactory wurde erfolgreich deployed.`);
  console.log(`   Adresse: ${gameFactory.target}`);

  // --- 3. Ein neues Spiel über die GameFactory erstellen ---
  console.log("\nErstelle eine neue Spielinstanz über die Factory...");
  
  // Wir rufen die `createGame`-Funktion auf dem deployten Factory-Vertrag auf.
  const createGameTx = await gameFactory.createGame(wagerAmount, serviceFeePercentage);

  // Wir warten, bis die Transaktion zur Erstellung des Spiels abgeschlossen ist.
  const receipt = await createGameTx.wait();
  
  // Die `GameCreated`-Events aus der Transaktion auslesen, um die Adresse des neuen Spiels zu finden.
  // Wir filtern die Events, um das richtige zu finden.
  const gameCreatedEvent = receipt.logs.find(e => e.eventName === 'GameCreated');
  
  if (gameCreatedEvent) {
    const newGameAddress = gameCreatedEvent.args.newGameAddress;
    // DIESE ADRESSE BENÖTIGEN WIR EBENFALLS!
    console.log(`\n✅ TwoThirdsAverageGame wurde erfolgreich erstellt.`);
    console.log(`   Adresse: ${newGameAddress}`);
    console.log("\n----------------------------------------------------");
    console.log("Bitte kopieren Sie die beiden oben genannten Adressen.");
    console.log("----------------------------------------------------");
  } else {
    console.error("Fehler: Das GameCreated-Event wurde nicht gefunden. Spiel konnte nicht erstellt werden.");
  }
}

// Dieses Muster wird empfohlen, um async/await korrekt zu verwenden und Fehler abzufangen.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});