// sync-platforms.js — esegue "cap sync" per Android/iOS.
//
// Di DEFAULT produce una build STANDALONE: nessun server.url, l'app carica
// i file già impacchettati in www/ (webDir) invece di dipendere da un
// server esterno. È l'unica build installabile su un telefono/tablet vero:
// un dispositivo reale non ha modo di raggiungere un PC di sviluppo, quindi
// puntare a un server esterno per default produceva solo una schermata
// bianca all'avvio fuori dall'emulatore/simulatore. Le chiamate ai broker
// (Alpaca/Capital.com) vanno dirette da app.js/brokers/*.js quando girano
// in nativo (window.Capacitor) — nessun proxy locale necessario.
//
// Con --dev, ripristina il vecchio comportamento (server.url verso il PC
// host) per testare rapidamente su EMULATORE/SIMULATORE con hot-reload
// puntato a server.js in esecuzione sul host:
//   - Android (emulatore):  10.0.2.2   (alias NAT verso l'host, non è un IP reale)
//   - iOS (simulatore):     localhost  (il simulatore condivide la rete del Mac host)
// Su un dispositivo FISICO --dev non funziona con questi valori: server.url
// andrebbe puntato all'IP LAN reale del PC (es. https://192.168.1.x) a mano.
//
// Uso:
//   node sync-platforms.js                -> standalone, ENTRAMBE le piattaforme
//   node sync-platforms.js android        -> standalone, solo Android (CI: ubuntu-latest)
//   node sync-platforms.js ios            -> standalone, solo iOS (CI: macos-latest)
//   node sync-platforms.js --dev          -> dev (server.url), entrambe, per emulatore/simulatore
//   node sync-platforms.js android --dev  -> dev, solo Android
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEV_SERVER_URL = {
    android: 'https://10.0.2.2',
    ios: 'https://localhost',
};

const BUNDLED_CONFIG_PATH = {
    android: path.join('android', 'app', 'src', 'main', 'assets', 'capacitor.config.json'),
    ios: path.join('ios', 'App', 'App', 'capacitor.config.json'),
};

const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const requested = args.find(a => a !== '--dev');
if (requested && !DEV_SERVER_URL[requested]) {
    console.error(`[SYNC] Piattaforma sconosciuta: "${requested}". Valide: android, ios (o nessun argomento per entrambe).`);
    process.exit(1);
}
const platforms = requested ? [requested] : Object.keys(DEV_SERVER_URL);

console.log(`[SYNC] cap sync (${platforms.join(' + ')})${isDev ? ' [DEV]' : ' [STANDALONE]'}...`);
// Si invoca direttamente l'entry point del CLI Capacitor con "node" invece di
// "npx" (che su Windows è npx.cmd e richiederebbe shell:true, con conseguente
// rischio di escaping degli argomenti): stesso risultato, portabile su ogni
// piattaforma, nessuna shell coinvolta.
const capBin = require.resolve('@capacitor/cli/bin/capacitor');
execFileSync(process.execPath, [capBin, 'sync', ...(requested ? [requested] : [])], { stdio: 'inherit' });

for (const platform of platforms) {
    const configPath = BUNDLED_CONFIG_PATH[platform];
    if (!fs.existsSync(configPath)) {
        console.warn(`[SYNC] ATTENZIONE: ${configPath} non trovato, salto la correzione per ${platform}.`);
        continue;
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (isDev) {
        if (!config.server) config.server = {};
        config.server.url = DEV_SERVER_URL[platform];
        console.log(`[SYNC] ${platform}: server.url -> ${DEV_SERVER_URL[platform]} (DEV, richiede server.js in esecuzione sull'host)`);
    } else {
        delete config.server;
        console.log(`[SYNC] ${platform}: nessun server.url (STANDALONE, carica www/ impacchettata)`);
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

console.log(`[SYNC] Completato: ${platforms.join(' + ')} allineata/e a www/ ${isDev ? 'in modalità DEV' : 'in modalità STANDALONE'}.`);
