/*
 * CONFIGURAZIONE FIREBASE - progetto chat-tv-f16a3
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDyUrWJJblTMfqg64mWrt8JdL6f7oVLJDE",
  authDomain: "chat-tv-f16a3.firebaseapp.com",
  databaseURL: "https://chat-tv-f16a3-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "chat-tv-f16a3",
  storageBucket: "chat-tv-f16a3.firebasestorage.app",
  messagingSenderId: "82268696115",
  appId: "1:82268696115:web:880a1e67a1d2881934fd46"
};

/*
 * SERVER DI APPOGGIO (TURN) - Metered, credenziale "ChatTV", regione UE
 * Usato solo quando il collegamento diretto tra due dispositivi non riesce (4G, hotel, reti aziendali).
 * Per cambiare credenziale: Metered → Credenziali → Mostra l'array dei server ICE, e incolla qui.
 */
window.TURN_STATICO = [
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "turn:eu.relay.metered.ca:80", username: "0b964dce03e2af1d1827c196", credential: "gMe53j1lUSyGqor+" },
  { urls: "turn:eu.relay.metered.ca:80?transport=tcp", username: "0b964dce03e2af1d1827c196", credential: "gMe53j1lUSyGqor+" },
  { urls: "turn:eu.relay.metered.ca:443", username: "0b964dce03e2af1d1827c196", credential: "gMe53j1lUSyGqor+" },
  { urls: "turns:eu.relay.metered.ca:443?transport=tcp", username: "0b964dce03e2af1d1827c196", credential: "gMe53j1lUSyGqor+" }
];

// In alternativa: credenziali richieste a ogni chiamata tramite API key (lasciare vuoto se si usa TURN_STATICO)
window.TURN_METERED = { app: "", apiKey: "" };
