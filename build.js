// build.js — prepara la cartella www/ per Capacitor (webDir, vedi capacitor.config.json).
// Sostituisce il vecchio one-liner in package.json che copiava una lista incompleta
// (mancavano grafico.js, statusbar.js, radar.js, tengine.js e brokers/): l'APK
// veniva impacchettato senza il grafico, il radar e i connettori broker.
// ATTENZIONE: niente segreti in www/ (keys.json, .env, cert.pem/key.pem, server.js
// NON vanno mai aggiunti alla lista: finirebbero dentro l'app distribuita).
const fs = require('fs');
const path = require('path');

const FILES = [
    'index.html', 'app.js', 'tengine.js', 'legal.js', 'grafico.js', 'statusbar.js', 'radar.js',
    'styles.css', 'manifest.json', 'icon.svg',
    'languages.it.json', 'languages.en.json', 'languages.es.json', 'languages.fr.json', 'languages.de.json',
];
const DIRS = ['brokers'];

fs.mkdirSync('www', { recursive: true });
for (const f of FILES) fs.copyFileSync(f, path.join('www', f));
for (const d of DIRS) fs.cpSync(d, path.join('www', d), { recursive: true });

// Verifica di completezza: ogni riferimento locale (src/href) di index.html deve
// esistere in www/. Un file aggiunto a index.html ma dimenticato qui fa FALLIRE
// la build, invece di produrre un APK rotto in modo silenzioso.
const html = fs.readFileSync('index.html', 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
    .map(m => m[1].split('?')[0])
    .filter(u => !/^(https?:|data:)/.test(u));
const missing = [...new Set(refs)].filter(u => !fs.existsSync(path.join('www', u)));
if (missing.length) {
    console.error('[BUILD] ERRORE: file referenziati da index.html ma assenti in www/: ' + missing.join(', '));
    process.exit(1);
}
console.log(`[BUILD] www/ pronta: ${FILES.length} file + ${DIRS.map(d => d + '/').join(', ')} — ${refs.length} riferimenti di index.html verificati.`);
