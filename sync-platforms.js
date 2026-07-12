// sync-platforms.js — esegue "cap sync" e corregge il server.url bundled,
// perché il loopback dell'host va raggiunto in modo diverso a seconda
// dell'emulatore/simulatore:
//   - Android (emulatore):  10.0.2.2   (alias NAT verso l'host, non è un IP reale)
//   - iOS (simulatore):     localhost  (il simulatore condivide la rete del Mac host)
// "cap sync" copia SEMPRE capacitor.config.json (radice) as-is nella/e
// piattaforma/e sincronizzata/e: senza questa correzione, l'app iOS
// erediterebbe 10.0.2.2 e non riuscirebbe a raggiungere il server locale
// (10.0.2.2 non esiste fuori dalla NAT dell'emulatore Android).
//
// Uso:
//   node sync-platforms.js          -> sincronizza ENTRAMBE (uso locale,
//                                       Android e iOS sullo stesso host)
//   node sync-platforms.js android  -> solo Android (CI: job su ubuntu-latest,
//                                       niente toolchain iOS/CocoaPods disponibile)
//   node sync-platforms.js ios      -> solo iOS (CI: job su macos-latest)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PLATFORM_SERVER_URL = {
    android: 'https://10.0.2.2',
    ios: 'https://localhost',
};

const BUNDLED_CONFIG_PATH = {
    android: path.join('android', 'app', 'src', 'main', 'assets', 'capacitor.config.json'),
    ios: path.join('ios', 'App', 'App', 'capacitor.config.json'),
};

const requested = process.argv[2];
if (requested && !PLATFORM_SERVER_URL[requested]) {
    console.error(`[SYNC] Piattaforma sconosciuta: "${requested}". Valide: android, ios (o nessun argomento per entrambe).`);
    process.exit(1);
}
const platforms = requested ? [requested] : Object.keys(PLATFORM_SERVER_URL);

console.log(`[SYNC] cap sync (${platforms.join(' + ')})...`);
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
    if (!config.server) config.server = {};
    config.server.url = PLATFORM_SERVER_URL[platform];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`[SYNC] ${platform}: server.url -> ${PLATFORM_SERVER_URL[platform]}`);
}

console.log(`[SYNC] Completato: ${platforms.join(' + ')} allineata/e a www/ con il server.url corretto per piattaforma.`);
