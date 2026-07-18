const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Radice servita dal gestore statico: solo i file dentro questa cartella.
const WEB_ROOT = __dirname;

// File che NON devono mai essere serviti dal gestore statico:
// chiavi API, chiave privata TLS, dati account. keys.json ha un suo
// handler dedicato (solo same-origin); qui lo blocchiamo per evitare bypass.
const BLOCKED_FILES = new Set(['keys.json', 'key.pem', 'cert.pem', 'alpaca_acc.json']);

// Porte standard.
const HTTP_PORT = 80;
const HTTPS_PORT = 443;

// Modalità attive (impostate a runtime dopo la scelta all'avvio). Il
// requestHandler le legge per il controllo same-origin e per l'HSTS.
let enableHttp = false;
let enableHttps = false;

// Solo host locali: difesa contro DNS rebinding (un dominio dell'attaccante
// che risolve a 127.0.0.1 avrebbe Host != localhost e viene rifiutato).
function isLocalHost(req) {
  const host = (req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '');

  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '10.0.2.2' ||           // Standard Android Emulator Loopback
    host.startsWith('10.0.') ||      // Emulatori Android / Altre subnet
    host.startsWith('192.168.')     // Dispositivi fisici nella rete locale
  );
}

// Richiesta same-origin: niente header Origin (GET/navigazione same-origin)
// oppure Origin ESATTAMENTE uguale a uno degli endpoint attivi del server.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const h = u.hostname.replace(/^\[|\]$/g, '');
    // Inclusione di 10.0.2.2 e delle subnet locali per permettere all'emulatore
    // di superare il controllo Same-Origin sui proxy Alpaca e sul salvataggio chiavi.
    const localName = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '10.0.2.2' || h.startsWith('192.168.');
    if (!localName) return false;

    // Il browser omette la porta di default (443 per https, 80 per http).
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (u.protocol === 'https:' && enableHttps && port === String(HTTPS_PORT)) return true;
    if (u.protocol === 'http:' && enableHttp && port === String(HTTP_PORT)) return true;
    return false;
  } catch (e) { return false; }
}

// Header CORS eventualmente presenti nelle risposte di Alpaca: vanno rimossi
// prima di inoltrarle, altrimenti il proxy regalerebbe a pagine di terzi il
// permesso di leggere le risposte. L'app è same-origin e non ne ha bisogno.
function cleanProxyHeaders(headers) {
  const out = { ...headers };
  delete out['access-control-allow-origin'];
  delete out['access-control-allow-credentials'];
  delete out['access-control-allow-headers'];
  delete out['access-control-allow-methods'];
  delete out['access-control-expose-headers'];
  return out;
}

// Certificati TLS: necessari solo se si avvia in HTTPS.
const KEY_PATH = path.join(WEB_ROOT, 'key.pem');
const CERT_PATH = path.join(WEB_ROOT, 'cert.pem');

function ensureCertificates() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) return true;
  console.warn('⚠️  Certificati TLS non trovati: provo a generarli con openssl...');
  try {
    const { execFileSync } = require('child_process');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', KEY_PATH, '-out', CERT_PATH,
      '-days', '3650', '-nodes',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:10.0.2.2'
    ], { stdio: 'ignore' });
    console.log('✅ Certificati TLS generati (key.pem, cert.pem).');
    return true;
  } catch (e) {
    return false;
  }
}

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const requestHandler = (req, res) => {
  // Difesa DNS rebinding: accetta solo richieste con Host locale.
  if (!isLocalHost(req)) {
    res.writeHead(403);
    res.end('Forbidden host');
    return;
  }

  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');

  // Content-Security-Policy: aggiornato per supportare le richieste locali dell'emulatore
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://unpkg.com https://accounts.google.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://paper-api.alpaca.markets https://api.alpaca.markets https://data.alpaca.markets wss://stream.data.alpaca.markets wss://ws.finnhub.io https://finnhub.io https://accounts.google.com https://api.alternative.me; " +
    "frame-src https://accounts.google.com; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");

  if (req.socket.encrypted && !enableHttp) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Proxy per Alpaca Trading (Paper)
  if (req.url.startsWith('/proxy/alpaca/')) {
    if (!isSameOrigin(req)) {
      res.writeHead(403);
      res.end('Cross-origin forbidden');
      return;
    }
    const alpacaUrl = 'https://paper-api.alpaca.markets' + req.url.replace('/proxy/alpaca', '');
    const apiKey = req.headers['apca-api-key-id'] || req.headers['APCA-API-KEY-ID'];
    const apiSecret = req.headers['apca-api-secret-key'] || req.headers['APCA-API-SECRET-KEY'];

    if (!apiKey || !apiSecret) {
      res.writeHead(401);
      res.end('Missing Alpaca API Keys in headers');
      return;
    }

    const proxyReq = https.request(alpacaUrl, {
      method: req.method,
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
        'Content-Type': 'application/json'
      }
    }, proxyRes => {
      res.writeHead(proxyRes.statusCode, cleanProxyHeaders(proxyRes.headers));
      proxyRes.pipe(res);
      proxyRes.on('error', e => console.error("Proxy Trading Res Error:", e.message));
    });

    req.pipe(proxyReq);
    req.on('error', e => {
      console.error("Client Req Error:", e.message);
      proxyReq.destroy();
    });
    proxyReq.on('error', e => {
      console.error("Proxy Trading Error:", e.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy Error', message: e.message }));
      } else {
        res.end();
      }
    });
    res.on('error', e => console.error("Client Res Error:", e.message));
    return;
  }

  // Proxy per Alpaca Trading API REALE (api.alpaca.markets)
  if (req.url.startsWith('/proxy/alpaca-live/')) {
    if (!isSameOrigin(req)) {
      res.writeHead(403);
      res.end('Cross-origin forbidden');
      return;
    }
    const alpacaUrl = 'https://api.alpaca.markets' + req.url.replace('/proxy/alpaca-live', '');
    const apiKey = req.headers['apca-api-key-id'] || req.headers['APCA-API-KEY-ID'];
    const apiSecret = req.headers['apca-api-secret-key'] || req.headers['APCA-API-SECRET-KEY'];

    if (!apiKey || !apiSecret) {
      res.writeHead(401);
      res.end('Missing Alpaca API Keys in headers');
      return;
    }

    const proxyReq = https.request(alpacaUrl, {
      method: req.method,
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
        'Content-Type': 'application/json'
      }
    }, proxyRes => {
      res.writeHead(proxyRes.statusCode, cleanProxyHeaders(proxyRes.headers));
      proxyRes.pipe(res);
      proxyRes.on('error', e => console.error("Proxy Live Res Error:", e.message));
    });

    req.pipe(proxyReq);
    req.on('error', e => {
      console.error("Client Req Error:", e.message);
      proxyReq.destroy();
    });
    proxyReq.on('error', e => {
      console.error("Proxy Live Error:", e.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy Live Error', message: e.message }));
      } else {
        res.end();
      }
    });
    res.on('error', e => console.error("Client Res Error:", e.message));
    return;
  }

  // Proxy per Alpaca Data
  if (req.url.startsWith('/proxy/alpaca-data/')) {
    if (!isSameOrigin(req)) {
      res.writeHead(403);
      res.end('Cross-origin forbidden');
      return;
    }
    const alpacaUrl = 'https://data.alpaca.markets' + req.url.replace('/proxy/alpaca-data', '');
    const apiKey = req.headers['apca-api-key-id'] || req.headers['APCA-API-KEY-ID'];
    const apiSecret = req.headers['apca-api-secret-key'] || req.headers['APCA-API-SECRET-KEY'];

    const proxyReq = https.request(alpacaUrl, {
      method: req.method,
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret
      }
    }, proxyRes => {
      res.writeHead(proxyRes.statusCode, cleanProxyHeaders(proxyRes.headers));
      proxyRes.pipe(res);
      proxyRes.on('error', e => console.error("Proxy Data Res Error:", e.message));
    });

    req.pipe(proxyReq);
    req.on('error', e => {
      console.error("Client Req Error:", e.message);
      proxyReq.destroy();
    });
    proxyReq.on('error', e => {
      console.error("Proxy Data Error:", e.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy Data Error', message: e.message }));
      } else {
        res.end();
      }
    });
    res.on('error', e => console.error("Client Res Error:", e.message));
    return;
  }

  // Proxy per il Crypto Fear & Greed Index (alternative.me): sentiment di
  // mercato REALE per il modulo NLP del bot. Nessuna chiave richiesta — il
  // proxy serve solo ad aggirare il CORS del browser (l'app nativa va
  // diretta, vedi FNG_URL in app.js). L'upstream è fisso: la query del
  // client viene ignorata, nessun input utente raggiunge la request.
  if (req.method === 'GET' && req.url.split('?')[0] === '/proxy/fng') {
    if (!isSameOrigin(req)) {
      res.writeHead(403);
      res.end('Cross-origin forbidden');
      return;
    }
    const fngReq = https.request('https://api.alternative.me/fng/?limit=1&format=json', { method: 'GET' }, fngRes => {
      res.writeHead(fngRes.statusCode, cleanProxyHeaders(fngRes.headers));
      fngRes.pipe(res);
      fngRes.on('error', e => console.error('Proxy FNG Res Error:', e.message));
    });
    fngReq.end();
    fngReq.on('error', e => {
      console.error('Proxy FNG Error:', e.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy FNG Error', message: e.message }));
      } else {
        res.end();
      }
    });
    res.on('error', e => console.error('Client Res Error:', e.message));
    return;
  }

  // Gestione API per salvataggio chiavi
  if (req.method === 'POST' && req.url === '/api/save-keys') {
    if (!isSameOrigin(req)) {
      res.writeHead(403);
      res.end('Cross-origin forbidden');
      return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('payload non valido');
        const ALLOWED_KEYS = ['finnhub_api_key', 'alpaca_key_id', 'alpaca_secret_key',
          'alpaca_live_key_id', 'alpaca_live_secret_key'];
        const clean = {};
        for (const k of ALLOWED_KEYS) {
          if (typeof data[k] === 'string' && data[k].length <= 200) clean[k] = data[k];
        }
        fs.writeFileSync(path.join(WEB_ROOT, 'keys.json'), JSON.stringify(clean, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(400);
        res.end('Errore JSON');
      }
    });
    return;
  }

  // Gestione richiesta keys.json
  if (req.method === 'GET' && req.url.split('?')[0] === '/keys.json') {
    if (!isSameOrigin(req)) {
      res.writeHead(403);
      res.end('Cross-origin forbidden');
      return;
    }
    fs.readFile(path.join(WEB_ROOT, 'keys.json'), (err, data) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(err ? '{}' : data);
    });
    return;
  }

  // --- Gestore statico ---
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const resolved = path.resolve(WEB_ROOT, '.' + urlPath);
  if (resolved !== WEB_ROOT && !resolved.startsWith(WEB_ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (BLOCKED_FILES.has(path.basename(resolved))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const extname = path.extname(resolved).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(resolved, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File non trovato');
      } else {
        res.writeHead(500);
        res.end('Errore interno: ' + error.code);
      }
    } else {
      // Nessuna cache lato client/WebView: siamo in sviluppo locale e ogni
      // richiesta deve riflettere il file su disco appena aggiornato (senza
      // questo header, la WebView di Capacitor può continuare a mostrare
      // una versione vecchia di index.html/app.js dopo una modifica).
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      res.end(content, 'utf-8');
    }
  });
};

function normalizeMode(value) {
  const m = String(value || '').trim().toLowerCase().replace(/^--mode=/, '');
  return ['http', 'https', 'both'].includes(m) ? m : null;
}

function modeFromArgsOrEnv() {
  for (const arg of process.argv.slice(2)) {
    const m = normalizeMode(arg);
    if (m) return m;
  }
  return normalizeMode(process.env.SERVER_MODE);
}

function askMode() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('-------------------------------------------');
    console.log('Scegli la modalità di avvio del server:');
    console.log(`  1) HTTP      (porta ${HTTP_PORT})`);
    console.log(`  2) HTTPS     (porta ${HTTPS_PORT})`);
    console.log(`  3) Entrambe  (HTTP:${HTTP_PORT} + HTTPS:${HTTPS_PORT})`);
    console.log('-------------------------------------------');
    rl.question('Selezione [1/2/3]: ', (answer) => {
      rl.close();
      const a = answer.trim();
      if (a === '1') resolve('http');
      else if (a === '2') resolve('https');
      else if (a === '3') resolve('both');
      else {
        console.log('Scelta non valida: uso HTTPS come default.');
        resolve('https');
      }
    });
  });
}

async function resolveMode() {
  const preset = modeFromArgsOrEnv();
  if (preset) return preset;
  if (process.stdin.isTTY) return await askMode();
  console.log('Nessuna modalità specificata e nessun terminale interattivo: uso HTTPS.');
  return 'https';
}

function startServer(server, port, label) {
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`❌ ${label}: la porta ${port} è già in uso (un altro processo la occupa).`);
    } else if (e.code === 'EACCES') {
      console.error(`❌ ${label}: permessi insufficienti per la porta ${port} (richiede privilegi di amministratore).`);
    } else {
      console.error(`❌ ${label}: ${e.message}`);
    }
    process.exitCode = 1;
  });

  // MODIFICA CRUCIALE: Cambiato da '127.0.0.1' a '0.0.0.0' per permettere all'emulatore 
  // Android (sottorete virtuale) di connettersi a questo server.
  server.listen(port, '0.0.0.0', () => {
    const scheme = label === 'HTTPS' ? 'https' : 'http';
    console.log(`✅ ${label} in ascolto su ${scheme}://0.0.0.0:${port}`);
  });
}

(async () => {
  const mode = await resolveMode();
  enableHttp = mode === 'http' || mode === 'both';
  enableHttps = mode === 'https' || mode === 'both';

  if (enableHttps && !ensureCertificates()) {
    console.error('❌ Impossibile avviare in HTTPS: certificati mancanti e openssl non disponibile.');
    process.exit(1);
  }

  console.log('-------------------------------------------');
  console.log('🚀 Server HFT Pro — modalità: ' + mode.toUpperCase());

  if (enableHttp) {
    startServer(http.createServer(requestHandler), HTTP_PORT, 'HTTP');
  }
  if (enableHttps) {
    const tlsOptions = {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH)
    };
    startServer(https.createServer(tlsOptions, requestHandler), HTTPS_PORT, 'HTTPS');
  }

  console.log('-------------------------------------------');
  if (enableHttps) {
    console.log('⚠️  In HTTPS il browser mostrerà un avviso (certificato self-signed).');
    console.log('   Clicca su "Avanzate" → "Procedi su 10.0.2.2 (non sicuro)".');
    console.log('-------------------------------------------');
  }
})();