/// <reference types="vite/client" />

// Erweitert das globale Window-Interface
interface Window {
    // Sagt TypeScript, dass 'window.ethereum' existieren kann und welchen Typ es hat.
    ethereum?: any;
  }