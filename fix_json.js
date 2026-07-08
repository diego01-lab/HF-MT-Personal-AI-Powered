const fs = require('fs');
let it = JSON.parse(fs.readFileSync('languages.it.json', 'utf8'));
let en = JSON.parse(fs.readFileSync('languages.en.json', 'utf8'));

const itNew = {
    'subtitle_franca': '\"Più prudente di nonna Franca!\"',
    'login_platform': 'Multi-asset algorithmic trading platform · Adaptive, self-learning AI',
    'login_instruction': 'Trading multi-asset (Crypto, Azioni, Forex, Materie Prime) su conti Test, Alpaca Paper e Reale. Accedi con Google per aprire la dashboard e avviare la sessione.',
    'login_consent_text': 'Dichiaro di avere più di 18 anni, di operare da un Paese supportato, e accetto i',
    'login_guest_btn': 'Ospite',
    'login_footer': 'Secure. Professional. Real-time.',
    'onb_title': 'Collega un broker per iniziare',
    'onb_desc': 'Per ricevere i dati di mercato (Radar e grafico) e per operare serve almeno un broker. Configurali in ordine — puoi anche collegarne uno solo.',
    'onb_fh_cats': 'Azioni USA · Forex · Materie Prime — dati reali, denaro virtuale',
    'onb_ap_cats': 'Crypto · Azioni USA — paper, denaro virtuale',
    'onb_al_cats': 'Crypto · Azioni USA — DENARO REALE',
    'paypal_subtitle': 'Ricarica il tuo conto HF MT Personal AI Powered',
    'no_keys': 'Non hai le chiavi? Registrati su',
    'btn_configure': 'Configura',
    'onb_enter_btn': 'Configura almeno un broker per continuare'
};

const enNew = {
    'subtitle_franca': '\"More prudent than Grandma Franca!\"',
    'login_platform': 'Multi-asset algorithmic trading platform · Adaptive, self-learning AI',
    'login_instruction': 'Multi-asset trading (Crypto, Stocks, Forex, Commodities) on Test, Alpaca Paper, and Live accounts. Login with Google to open the dashboard and start the session.',
    'login_consent_text': 'I declare I am over 18, operating from a supported Country, and accept the',
    'login_guest_btn': 'Guest',
    'login_footer': 'Secure. Professional. Real-time.',
    'onb_title': 'Connect a broker to start',
    'onb_desc': 'To receive market data (Radar and chart) and to trade, you need at least one broker. Configure them in order — you can also connect just one.',
    'onb_fh_cats': 'US Stocks · Forex · Commodities — live data, paper money',
    'onb_ap_cats': 'Crypto · US Stocks — paper money',
    'onb_al_cats': 'Crypto · US Stocks — REAL MONEY',
    'paypal_subtitle': 'Top up your HF MT Personal AI Powered account',
    'no_keys': 'Don\'t have keys? Register at',
    'btn_configure': 'Configure',
    'onb_enter_btn': 'Configure at least one broker to continue'
};

Object.assign(it, itNew);
Object.assign(en, enNew);

fs.writeFileSync('languages.it.json', JSON.stringify(it, null, 4));
fs.writeFileSync('languages.en.json', JSON.stringify(en, null, 4));
console.log('JSON files updated');
