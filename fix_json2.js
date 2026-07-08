const fs = require('fs');
let it = JSON.parse(fs.readFileSync('languages.it.json', 'utf8'));
let en = JSON.parse(fs.readFileSync('languages.en.json', 'utf8'));

it['onb_connected'] = 'Collegato';
it['onb_todo'] = 'Da configurare';

en['onb_connected'] = 'Connected';
en['onb_todo'] = 'To configure';

fs.writeFileSync('languages.it.json', JSON.stringify(it, null, 4));
fs.writeFileSync('languages.en.json', JSON.stringify(en, null, 4));
console.log('JSON updated for onb badges');
