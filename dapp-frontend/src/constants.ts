// Wir importieren die JSON-Dateien und geben ihnen klare, eindeutige Namen
import GameFactoryJson from './abis/GameFactory.json';
import TwoThirdsAverageGameJson from './abis/TwoThirdsAverageGame.json';

// Die bereitgestellten Adressen
export const GAME_FACTORY_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
export const TWO_THIRDS_AVERAGE_GAME_ADDRESS = '0xa16E02E87b7454126E5E10d957A927A7F5B5d2be';

// Wir exportieren nur den 'abi'-Teil aus den JSON-Dateien
export const gameFactoryABI = GameFactoryJson.abi;
export const twoThirdsAverageGameABI = TwoThirdsAverageGameJson.abi;