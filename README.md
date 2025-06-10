# Blockchain-Spiel: Errate 2/3 des Durchschnitts

Dies ist eine dezentrale Anwendung (DApp) für das Spiel "Errate 2/3 des Durchschnitts", entwickelt im Rahmen des Moduls "Blockchain 3". Das Projekt besteht aus einem Solidity Smart Contract, der mit Hardhat entwickelt wurde, und einem React/TypeScript-Frontend zur Interaktion.

## Features

* **Spiel erstellen:** Ein Factory-Contract kann neue Spiel-Instanzen deployen.
* **Commit-Reveal-Schema:** Spieler reichen ihre Zahlen sicher ein, ohne dass andere sie vor der Aufdeckungsphase sehen können.
* **Phasenbasierter Spielablauf:** Das Spiel durchläuft die Phasen Registrierung, Commit, Reveal, Berechnung und Auszahlung.
* **Admin-Funktionen:** Der Spielleiter kann die Phasenübergänge erzwingen und die Servicegebühr abheben.
* **Auszahlungslogik:** Der Gewinner und der Spielleiter können ihre Anteile am Pot abheben.

## Tech Stack

* **Smart Contracts:** Solidity, Hardhat, OpenZeppelin
* **Frontend:** React, TypeScript, Vite, Ethers.js

---

## Setup & Ausführung

Um das Projekt lokal auszuführen, werden zwei Komponenten benötigt: das Hardhat-Backend und das React-Frontend.

### 1. Backend (Hardhat)

Navigieren Sie in den Hauptordner des Projekts.

```bash
# Abhängigkeiten installieren
npm install

# Smart Contracts kompilieren
npx hardhat compile
```

### 2. Frontend (React)

Navigieren Sie in den Frontend-Ordner.

```bash
# In den Frontend-Ordner wechseln
cd dapp-frontend

# Abhängigkeiten installieren
npm install
```

---

### Lokalen Spielablauf starten

Folgen Sie diesem Workflow, um eine neue Spielsitzung zu starten:

1.  **Node starten:** Öffnen Sie ein Terminal im Hauptverzeichnis und starten Sie den lokalen Hardhat-Node. **Lassen Sie dieses Terminal geöffnet.**
    ```bash
    npx hardhat node
    ```

2.  **Verträge deployen:** Öffnen Sie ein **zweites** Terminal im Hauptverzeichnis und führen Sie das Deployment-Skript aus.
    ```bash
    npx hardhat run scripts/deploy.js --network localhost
    ```

3.  **Adressen aktualisieren:** Kopieren Sie die beiden Adressen, die das Skript ausgibt, und fügen Sie sie in die Datei `dapp-frontend/src/constants.ts` ein.

4.  **Frontend starten:** Öffnen Sie ein **drittes** Terminal, wechseln Sie in den Frontend-Ordner und starten Sie die App.
    ```bash
    cd dapp-frontend
    npm run dev
    ```

5.  **Browser öffnen:** Öffnen Sie die angezeigte `localhost`-URL in einem Browser mit installierter MetaMask-Erweiterung. Stellen Sie sicher, dass MetaMask mit dem `Hardhat Local`-Netzwerk (Chain ID 31337) verbunden ist und Sie ein Test-Konto importiert haben.