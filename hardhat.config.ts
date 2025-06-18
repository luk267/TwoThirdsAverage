import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  networks: {
    hardhat: {
      mining: {
        // Deaktiviert den standardmäßigen Automine-Modus
        auto: false, 
        // Stellt ein Intervall ein: Alle 5000 Millisekunden (5 Sekunden) wird ein neuer Block gemined
        interval: 12000 
      }
    }
  }
};

export default config;
