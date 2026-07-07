const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Radice servita dal gestore statico: solo i file dentro questa cartella.
const WEB_ROOT = __dirname;

// File che NON devono mai essere serviti dal gestore statico:
// chiavi API, chiave privata TLS, dati account. keys.json ha un suo
// handler dedicato (solo same-origin); qui lo blocchiamo per evitare bypass.
const BLOCKED_FILES = new Set(['keys.json', 'key.pem', 'cert.pem', 'alpaca_acc.json']);

// Porta del server (dichiarata qui: serve anche al controllo same-origin)
const PORT = 8443;

// Solo host locali: difesa contro DNS rebinding (un dominio dell'attaccante
// che risolve a 127.0.0.1 avrebbe Host != localhost e viene rifiutato).
function isLocalHost(req) {
  const host = (req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

// Richiesta same-origin: niente header Origin (GET/navigazione same-origin)
// oppure Origin ESATTAMENTE uguale a quella del server (schema https e porta
// comprese). Un'altra app locale su porta diversa (es. localhost:3000) è
// cross-origin e viene respinta: non può leggere né sovrascrivere le chiavi.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const h = u.hostname.replace(/^\[|\]$/g, '');
    const localName = h === 'localhost' || h === '127.0.0.1' || h === '::1';
    return localName && u.protocol === 'https:' && String(u.port || '443') === String(PORT);
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

// Il server gira SEMPRE in HTTPS. Se i certificati mancano proviamo a
// generarli al volo con openssl; se non è possibile, usciamo con un
// messaggio chiaro (nessun fallback HTTP).
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
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
    ], { stdio: 'ignore' });
    console.log('✅ Certificati TLS generati (key.pem, cert.pem).');
    return true;
  } catch (e) {
    return false;
  }
}

if (!ensureCertificates()) {
  console.error('❌ Impossibile avviare in HTTPS: certificati mancanti e openssl non disponibile.');
  console.error('   Genera i certificati manualmente in questa cartella con:');
  console.error('   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"');
  process.exit(1);
}

const tlsOptions = {
  key: fs.readFileSync(KEY_PATH),
  cert: fs.readFileSync(CERT_PATH)
};

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
  // (il server è pensato per uso locale; un sito di terzi che prova a
  // raggiungerlo via un dominio rebindato a 127.0.0.1 ha Host non locale)
  if (!isLocalHost(req)) {
    res.writeHead(403);
    res.end('Forbidden host');
    return;
  }

  // Cross-Origin-Opener-Policy: necessario per il login Google in modalità
  // popup. Senza "same-origin-allow-popups" il popup di accounts.google.com
  // non può fare postMessage di ritorno alla pagina: header necessario al login Google.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // Header di sicurezza di base (non intrusivi: nessun impatto funzionale)
  res.setHeader('X-Content-Type-Options', 'nosniff');   // niente MIME sniffing
  res.setHeader('Referrer-Policy', 'no-referrer');      // nessun referrer verso terzi
  res.setHeader('X-Frame-Options', 'DENY');             // la pagina non è incorniciabile
  // Content-Security-Policy: stessa allowlist del meta tag in index.html
  // (il meta copre anche la WebView Capacitor; l'header copre tutto ciò che
  // serve questo server e aggiunge frame-ancestors, ignorato nei meta tag).
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://unpkg.com https://accounts.google.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://paper-api.alpaca.markets https://api.alpaca.markets https://data.alpaca.markets wss://stream.data.alpaca.markets wss://ws.finnhub.io https://finnhub.io https://accounts.google.com; " +
    "frame-src https://accounts.google.com; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  // NIENTE CORS permissivo: app e proxy girano sulla stessa origine
  // (localhost:8443), quindi non serve alcun header CORS. Rimuovere il
  // wildcard impedisce ai siti di terzi di leggere keys.json o usare il proxy.
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Handle favicon.ico to prevent 404 errors in console
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  // Proxy per Alpaca Trading (Paper) — SOLO same-origin (difesa in profondità:
  // i browser bloccano già le richieste cross-origin con header APCA custom
  // al preflight, ma qui le respingiamo comunque esplicitamente)
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

  // Proxy per Alpaca Trading API REALE (api.alpaca.markets) — SOLO same-origin.
  // Usato unicamente per la verifica di connessione/stato del conto live
  // (GET /v2/account dal pannello Connessioni Broker): il bot NON invia
  // ordini attraverso questo proxy.
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

  // Proxy per Alpaca Data — SOLO same-origin (come sopra)
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

  // Gestione API per salvataggio chiavi — SOLO same-origin.
  // Senza questo controllo un sito di terzi potrebbe sovrascrivere le
  // chiavi dell'utente (CSRF) e dirottare il trading su un account ostile.
  if (req.method === 'POST' && req.url === '/api/save-keys') {
    if (!isSameOrigin(req)) {
      res.writeHead(403);
      res.end('Cross-origin forbidden');
      return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) req.destroy(); // guardia anti-payload abnorme
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        // Whitelist: si salvano solo i campi chiave attesi, solo stringhe
        // di lunghezza sana. Campi extra o payload strutturati vengono ignorati.
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

  // Gestione richiesta keys.json: se il file non esiste, ritorna {} (200)
  // invece di 404, evitando errori in console su installazioni fresche.
  // SOLO same-origin: le chiavi non devono mai essere leggibili da terzi.
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

  // --- Gestore statico con contenimento del path ---
  // Decodifica e normalizza l'URL, poi verifica che il file risolto resti
  // dentro WEB_ROOT: blocca i path traversal tipo GET /../../etc/passwd.
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
  // Deve stare dentro WEB_ROOT (no fuga dalla cartella servita)
  if (resolved !== WEB_ROOT && !resolved.startsWith(WEB_ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  // File sensibili mai serviti dal gestore statico
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
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
};

const server = https.createServer(tlsOptions, requestHandler);

// Bind SOLO su loopback (127.0.0.1): il server non è raggiungibile dalla
// rete locale. Espone chiavi e proxy solo all'app sulla stessa macchina.
// (PORT è dichiarata in alto: serve anche al controllo same-origin)
server.listen(PORT, '127.0.0.1', () => {
  console.log('-------------------------------------------');
  console.log('🚀 Server HFT Pro in ascolto su:');
  console.log(`🔗 https://localhost:${PORT}`);
  console.log('-------------------------------------------');
  console.log('⚠️  IMPORTANTE:');
  console.log('Il browser mostrerà un avviso di sicurezza (certificato self-signed).');
  console.log('Clicca su "Avanzate" e poi su "Procedi su localhost (non sicuro)".');
  console.log('-------------------------------------------');
});

