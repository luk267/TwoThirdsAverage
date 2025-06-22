# Blockchain-Spiel: Errate 2/3 des Durchschnitts

Ein dezentrales Spiel auf der Ethereum-Blockchain, entwickelt im Rahmen des Moduls "Blockchain 3".

---

## Projektbeschreibung

Dieses Projekt ist eine dezentrale Anwendung (DApp) für das Spiel "Errate 2/3 des Durchschnitts". Das bekannte Spielprinzip wurde mithilfe von Solidity Smart Contracts und einem React-Frontend auf der Ethereum-Blockchain implementiert.

**Spielregeln:**
- Eine Gruppe von mindestens drei Spielern tritt einer Spielrunde bei, indem sie einen festen Wetteinsatz (Wager) bezahlen.
- Jeder Spieler reicht geheim eine ganze Zahl zwischen 0 und 1000 ein.
- Nachdem alle ihre Zahlen eingereicht haben, wird der Durchschnitt aller eingereichten Zahlen berechnet.
- Der Zielwert ist 2/3 dieses Durchschnitts.
- Der Spieler, dessen eingereichte Zahl am nächsten am Zielwert liegt, gewinnt den Pot (abzüglich einer Servicegebühr).

---

## Features

- **Factory Pattern:** Ein GameFactory-Vertrag ermöglicht die Erstellung und Verwaltung beliebig vieler Spielinstanzen mit unterschiedlichen Wetteinsätzen und Gebühren.
- **Sichere und faire Spielzüge:** Durch ein Commit-Reveal-Schema werden die Zahlen der Spieler zuerst als geheimer Hash eingereicht und erst später aufgedeckt. Dies verhindert, dass Spieler ihre Entscheidung von den Zügen anderer abhängig machen.
- **Phasenbasierter Spielablauf:** Das Spiel durchläuft klar definierte Phasen (Registrierung, Commit, Reveal, Berechnung, Auszahlung), die den Spielablauf strukturieren und absichern.
- **Dezentrale Phasenübergänge:** Um das Spiel gegen inaktive Spieler oder Leiter abzusichern, kann jeder die nächste Phase einleiten, sobald die Deadline der aktuellen Phase abgelaufen ist.
- **Wetteinsätze & Auszahlungen:** Spieler zahlen einen Einsatz, um teilzunehmen. Der Gewinner kann seinen Gewinn und der Spielleiter seine Servicegebühr am Ende über eine Pull-Funktion sicher abheben.

---

## Technologie-Stack

### Backend (Smart Contracts)
- **Solidity:** Sprache für die Smart-Contract-Entwicklung.
- **Hardhat:** Entwicklungsumgebung zum Kompilieren, Testen und Deployen der Verträge.
- **Ethers.js:** Bibliothek zur Interaktion mit der Ethereum-Blockchain.
- **OpenZeppelin Contracts:** Wiederverwendbare und sichere Vertrags-Komponenten (z.B. für Ownable).

### Frontend
- **React:** JavaScript-Bibliothek zur Erstellung der Benutzeroberfläche.
- **TypeScript:** Sorgt für Typsicherheit und verbesserte Codequalität.
- **Vite:** Modernes Frontend-Build-Tool für einen schnellen Entwicklungsserver.
- **Ethers.js:** Client-seitige Bibliothek zur Kommunikation mit den Smart Contracts über die Wallet des Nutzers.

---

## Lokales Setup und Ausführung

Folgen Sie dieser Anleitung, um das Projekt auf Ihrem lokalen System vollständig einzurichten und zu starten.

### Voraussetzungen

- Node.js (Version 18.x oder höher)
- npm oder yarn
- Git
- MetaMask Browser-Erweiterung

---

### 1. Klonen und Abhängigkeiten installieren

Klonen Sie das Repository und installieren Sie die Abhängigkeiten für das Backend und das Frontend.

```bash
# 1. Repository klonen
git clone https://github.com/luk267/TwoThirdsAverage.git

# 2. In das Projektverzeichnis wechseln
cd TwoThirdsAverage-main

# 3. Backend-Abhängigkeiten (Hardhat) installieren
npm install

# 4. Frontend-Abhängigkeiten (React) installieren
cd dapp-frontend
npm install
cd ..
```

---

### 2. Lokale Blockchain starten

Starten Sie in einem ersten Terminal die lokale Hardhat-Node. Diese simuliert die Ethereum-Blockchain. Lassen Sie dieses Terminal geöffnet.

```bash
# Im Hauptverzeichnis des Projekts ausführen
npx hardhat node
```

Notieren Sie sich die RPC-URL (`http://127.0.0.1:8545/`) und einen der privaten Schlüssel der Test-Accounts für später.

---

### 3. Smart Contracts kompilieren & deployen

Öffnen Sie ein zweites Terminal und führen Sie die folgenden Befehle im Hauptverzeichnis aus.

```bash
# 1. Verträge kompilieren
npx hardhat compile

# 2. Verträge auf der lokalen Node deployen
npx hardhat run scripts/deploy.js --network localhost
```

Das Skript gibt nach der Ausführung die Adressen für **GameFactory** und **TwoThirdsAverageGame** aus. Kopieren Sie sich diese beiden Adressen.

---

### 4. Frontend konfigurieren

Verbinden Sie das Frontend mit den eben deployten Verträgen.

- Öffnen Sie die Datei: `dapp-frontend/src/constants.ts`
- Ersetzen Sie die Platzhalter-Adressen mit den Adressen, die Sie in Schritt 3 kopiert haben.

---

### 5. Anwendung starten und nutzen

Starten Sie den Frontend-Entwicklungsserver im zweiten Terminal (falls nicht bereits im `dapp-frontend`-Ordner, dorthin wechseln).

```bash
cd dapp-frontend
npm run dev
```

- Öffnen Sie die angezeigte `localhost`-URL (z.B. http://localhost:5173) in Ihrem Browser.
- Konfigurieren Sie MetaMask, um sich mit dem Hardhat Local-Netzwerk zu verbinden (Chain ID 31337).
- Importieren Sie einen Test-Account in MetaMask mithilfe eines der privaten Schlüssel aus Schritt 2.
- Klicken Sie in der Web-Anwendung auf "Wallet verbinden" und interagieren Sie