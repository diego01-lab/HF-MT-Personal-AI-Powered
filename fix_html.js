const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// Replacements in HTML
html = html.replace('<p>Multi-asset algorithmic trading platform · Adaptive, self-learning AI</p>', '<p id=\"lblLoginPlatform\">Multi-asset algorithmic trading platform · Adaptive, self-learning AI</p>');

html = html.replace('<p class=\"login-instruction\">Trading multi-asset (Crypto, Azioni, Forex, Materie Prime) su conti Test,\n                    Alpaca Paper e Reale. Accedi con Google per aprire la dashboard e avviare la sessione.</p>', '<p id=\"lblLoginInst\" class=\"login-instruction\">Trading multi-asset (Crypto, Azioni, Forex, Materie Prime) su conti Test,\n                    Alpaca Paper e Reale. Accedi con Google per aprire la dashboard e avviare la sessione.</p>');

html = html.replace('Dichiaro di avere più di 18 anni, di operare da un Paese supportato, e accetto i', '<span id=\"lblLegalConsent\">Dichiaro di avere più di 18 anni, di operare da un Paese supportato, e accetto i</span>');

html = html.replace('Ospite', '<span id=\"lblGuestBtn\">Ospite</span>');

html = html.replace('<p class=\"login-footer\">Secure. Professional. Real-time.</p>', '<p id=\"lblLoginFooter\" class=\"login-footer\">Secure. Professional. Real-time.</p>');

html = html.replace('<h1 style=\"font-size: 1.4rem; margin: 0 0 6px;\">Collega un broker per iniziare</h1>', '<h1 id=\"lblOnbTitle\" style=\"font-size: 1.4rem; margin: 0 0 6px;\">Collega un broker per iniziare</h1>');

html = html.replace('<p class=\"login-instruction\" style=\"margin-bottom: 18px !important;\">Per ricevere i dati di mercato\n                (Radar e grafico) e per operare serve <b>almeno un broker</b>. Configurali in ordine — puoi anche\n                collegarne uno solo.</p>', '<p id=\"lblOnbDesc\" class=\"login-instruction\" style=\"margin-bottom: 18px !important;\">Per ricevere i dati di mercato\n                (Radar e grafico) e per operare serve <b>almeno un broker</b>. Configurali in ordine — puoi anche\n                collegarne uno solo.</p>');

html = html.replace('<div class=\"onb-step-cats\">Azioni USA · Forex · Materie Prime — dati reali, denaro virtuale</div>', '<div id=\"lblOnbFinnhubCats\" class=\"onb-step-cats\">Azioni USA · Forex · Materie Prime — dati reali, denaro virtuale</div>');
html = html.replace('<div class=\"onb-step-cats\">Crypto · Azioni USA — paper, denaro virtuale</div>', '<div id=\"lblOnbAlpacaPaperCats\" class=\"onb-step-cats\">Crypto · Azioni USA — paper, denaro virtuale</div>');
html = html.replace('<div class=\"onb-step-cats\">Crypto · Azioni USA — <b>DENARO REALE</b></div>', '<div id=\"lblOnbAlpacaLiveCats\" class=\"onb-step-cats\">Crypto · Azioni USA — <b>DENARO REALE</b></div>');

html = html.replace('<p class=\"paypal-subtitle\">Ricarica il tuo conto HF MT Personal AI Powered</p>', '<p id=\"lblPaypalSubtitle\" class=\"paypal-subtitle\">Ricarica il tuo conto HF MT Personal AI Powered</p>');

html = html.replace(/Non hai le chiavi\? Registrati\s+su <a/g, '<span id=\"lblNoKeys\">Non hai le chiavi? Registrati su</span> <a');

html = html.replace(/"Più prudente di nonna Franca!"/g, '<span id="lblSubtitleFranca">"Più prudente di nonna Franca!"</span>');
html = html.replace('<span id=\"lblSubtitleFranca\">\"Più prudente di nonna Franca!\"</span></p>', '\"Più prudente di nonna Franca!\"</p>');
html = html.replace('<p style=\"color: #f59e0b; margin-top: -12px; margin-bottom: 12px; font-style: italic; font-weight: 500; font-size: 1.1rem;\">\"Più prudente di nonna Franca!\"</p>', '<p id=\"lblSubtitleFrancaLogin\" style=\"color: #f59e0b; margin-top: -12px; margin-bottom: 12px; font-style: italic; font-weight: 500; font-size: 1.1rem;\">\"Più prudente di nonna Franca!\"</p>');

html = html.replace('<span style=\"flex-basis: 100%; font-size: 0.8rem; color: #f59e0b; font-style: italic; font-weight: 500; margin-top: -6px;\">\"Più prudente di nonna Franca!\"</span>', '<span id=\"lblSubtitleFrancaApp\" style=\"flex-basis: 100%; font-size: 0.8rem; color: #f59e0b; font-style: italic; font-weight: 500; margin-top: -6px;\">\"Più prudente di nonna Franca!\"</span>');

html = html.replace('<h4 style=\"color: #f59e0b; margin-top: -4px; margin-bottom: 8px; font-style: italic; font-weight: 500;\">\"Più prudente di nonna Franca!\"</h4>', '<h4 id=\"lblSubtitleFrancaModal\" style=\"color: #f59e0b; margin-top: -4px; margin-bottom: 8px; font-style: italic; font-weight: 500;\">\"Più prudente di nonna Franca!\"</h4>');

fs.writeFileSync('index.html', html);
console.log('HTML updated');
