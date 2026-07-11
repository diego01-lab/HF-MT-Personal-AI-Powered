// ─────────────────────────────────────────────────────────────────────
// legal.js — Documenti legali di Personal HF MT AI Powered (5 lingue)
// Termini di Servizio, EULA e Privacy Policy mostrati nel modale legale.
// Il titolo di ogni documento vive qui; le etichette UI (link, bottoni)
// vivono nei file languages.<lingua>.json.
//
// I testi riflettono le funzionalità attuali dell'App, incluse le TRE
// modalità operative: Test (denaro virtuale locale), Alpaca Paper (denaro
// virtuale) e ALrt / Alpaca Live (DENARO REALE: ordini bot e manuali sul
// conto reale dell'utente).
// ─────────────────────────────────────────────────────────────────────
window.LEGAL_DOCS = {

    IT: {
        tos: {
            title: 'Termini di Servizio',
            html: `
<p class="legal-date">Ultimo aggiornamento: 4 luglio 2026</p>
<h4>1. Oggetto</h4>
<p>Personal HF MT AI Powered ("l'App") è un simulatore educativo di trading algoritmico multi-asset (criptovalute, azioni, forex e materie prime). L'App offre tre modalità operative: <strong>Modalità Test</strong>, con un portafoglio simulato salvato solo sul tuo dispositivo; <strong>Alpaca Paper</strong>, con un conto di paper trading a fondi fittizi fornito da Alpaca Markets; e <strong>ALrt (Alpaca Trading reale)</strong>, che collega il tuo conto Alpaca Live e opera con DENARO REALE.</p>
<h4>2. Requisiti di età</h4>
<p>L'uso dell'App è riservato a chi ha compiuto 18 anni o l'età legale prevista nel proprio Paese. Registrandoti o utilizzando l'App dichiari di soddisfare questo requisito.</p>
<h4>3. Natura educativa — nessuna consulenza finanziaria</h4>
<p>L'App ha finalità educative e dimostrative. Nessun contenuto, segnale, indicatore, automatismo o risultato — incluse le decisioni del bot automatico — costituisce consulenza finanziaria, raccomandazione di investimento o sollecitazione al risparmio. Le performance passate o simulate non sono indicative di risultati futuri.</p>
<h4>4. Modalità operative e rischio del trading reale</h4>
<p>Le modalità Test e Alpaca Paper usano esclusivamente denaro virtuale e non comportano alcun rischio economico. La modalità <strong>ALrt</strong> invia invece ordini reali — sia automatici (bot) sia manuali — sul tuo conto Alpaca Live, utilizzando <strong>denaro reale</strong>. Questa modalità è disattivata per impostazione predefinita, richiede l'inserimento volontario delle chiavi API del tuo conto reale e una conferma esplicita prima dell'attivazione. Attivandola accetti che ogni operazione possa comportare la <strong>perdita totale o parziale del capitale</strong> e che sei l'unico responsabile delle decisioni e delle configurazioni del bot. Il titolare dell'App non è un broker, un consulente finanziario né un intermediario autorizzato.</p>
<h4>5. Account e accesso</h4>
<p>L'accesso può avvenire tramite account Google (facoltativo) o come Ospite. Sei responsabile della custodia delle credenziali e delle chiavi API di terze parti (Finnhub, Alpaca Paper e Alpaca Live) che scegli di configurare.</p>
<h4>6. Servizi di terze parti</h4>
<p>L'App si integra con servizi di terzi — Alpaca Markets (paper e conto reale), Finnhub (dati di mercato) e Google (accesso) — soggetti ai rispettivi termini e condizioni. Il titolare dell'App non risponde di interruzioni, errori, ritardi o limitazioni di tali servizi.</p>
<h4>7. Uso corretto</h4>
<p>Ti impegni a non usare l'App per scopi illeciti e a non tentare di comprometterne la sicurezza. Riconosci che l'App è uno strumento educativo e che ogni uso con denaro reale avviene a tuo esclusivo rischio.</p>
<h4>8. Limitazione di responsabilità</h4>
<p>L'App è fornita "così com'è", senza garanzie di alcun tipo. Nei limiti massimi consentiti dalla legge, il titolare non risponde di alcun danno diretto o indiretto derivante dall'uso o dall'impossibilità d'uso dell'App. In particolare, il produttore di Personal HF MT AI Powered non si assume alcuna responsabilità per eventuali perdite economiche, incluse quelle subite su conti di trading reali collegati tramite chiavi API, ottenute utilizzando l'App.</p>
<h4>9. Modifiche</h4>
<p>Questi Termini possono essere aggiornati; la versione corrente è sempre consultabile nella sezione Note Legali dell'App.</p>
<h4>10. Legge applicabile</h4>
<p>Questi Termini sono regolati dalla legge italiana. Contatto: hftindividualaip@gmail.com</p>`
        },
        eula: {
            title: 'Contratto di Licenza (EULA)',
            html: `
<p class="legal-date">Ultimo aggiornamento: 4 luglio 2026</p>
<h4>1. Concessione di licenza</h4>
<p>Ti viene concessa una licenza personale, non esclusiva, non trasferibile e revocabile per installare e usare Personal HF MT AI Powered a soli fini educativi e personali, su dispositivi di tua proprietà.</p>
<h4>2. Restrizioni</h4>
<p>Non è consentito: (a) vendere, noleggiare, sublicenziare o ridistribuire l'App; (b) rimuovere avvisi di titolarità; (c) decompilare o effettuare reverse engineering se non nei limiti inderogabili di legge; (d) usare l'App per fornire servizi finanziari a terzi. L'eventuale uso della modalità di trading reale (ALrt) avviene a tuo esclusivo rischio e sotto la tua piena responsabilità.</p>
<h4>3. Proprietà intellettuale</h4>
<p>L'App, il suo codice, la grafica e i contenuti restano di proprietà del titolare. Questa licenza non trasferisce alcun diritto di proprietà.</p>
<h4>4. Componenti di terze parti</h4>
<p>L'App incorpora componenti open source e servizi di terzi, tra cui TradingView Lightweight Charts™ (licenza Apache 2.0), Google Identity Services, le API di Alpaca Markets (paper e conto reale) e Finnhub, ciascuno soggetto alla propria licenza.</p>
<h4>5. Nessuna garanzia</h4>
<p>L'App è fornita "COSÌ COM'È" e "COME DISPONIBILE", senza garanzie espresse o implicite di funzionamento continuo, accuratezza dei dati di mercato, esecuzione degli ordini o idoneità a uno scopo specifico.</p>
<h4>6. Limitazione di responsabilità</h4>
<p>Nei limiti massimi di legge, il titolare non sarà responsabile per danni indiretti, incidentali o consequenziali, né per decisioni economiche o operazioni — reali o simulate — assunte tramite l'App.</p>
<h4>7. Risoluzione</h4>
<p>La licenza termina automaticamente in caso di violazione di queste condizioni. Alla risoluzione dovrai cessare l'uso dell'App e rimuoverne ogni copia.</p>`
        },
        privacy: {
            title: 'Privacy Policy',
            html: `
<p class="legal-date">Ultimo aggiornamento: 4 luglio 2026</p>
<h4>1. Titolare e contatto</h4>
<p>Titolare del trattamento: il proprietario dell'applicazione. Contatto: hftindividualaip@gmail.com</p>
<h4>2. Dati trattati</h4>
<p>(a) Se accedi con Google: nome, e-mail e immagine del profilo, usati solo per personalizzare l'interfaccia. (b) Chiavi API di Finnhub, Alpaca Paper e Alpaca Live che inserisci volontariamente. (c) Dati letti dal tuo conto broker (saldo, posizioni, ordini e storico), sia in paper trading sia — in modalità ALrt — dal conto reale. (d) Dati di sessione (portafoglio simulato, cronologia operazioni, preferenze, lingua).</p>
<h4>3. Dove vengono conservati</h4>
<p>Tutti i dati restano sul tuo dispositivo (localStorage del browser o dell'app) e, per le chiavi API, in un file locale letto solo dal server locale dell'App. Nessun dato viene inviato a server remoti del titolare, che non gestisce alcun database esterno.</p>
<h4>4. Finalità</h4>
<p>I dati servono esclusivamente al funzionamento dell'App: autenticazione ai servizi di mercato e al broker, sincronizzazione del conto, esecuzione delle operazioni richieste, persistenza della sessione e preferenze.</p>
<h4>5. Servizi di terze parti</h4>
<p>Le comunicazioni con Google (login), Alpaca Markets (paper trading e conto reale) e Finnhub (dati di mercato) sono regolate dalle rispettive privacy policy. Le richieste partono direttamente dal tuo dispositivo.</p>
<h4>6. Conservazione e cancellazione</h4>
<p>I dati restano finché non li elimini: puoi cancellarli in qualsiasi momento con il reset dell'App o cancellando i dati di navigazione del browser.</p>
<h4>7. Diritti dell'interessato (GDPR)</h4>
<p>Hai diritto di accesso, rettifica, cancellazione, limitazione e opposizione. Poiché i dati risiedono solo sul tuo dispositivo, puoi esercitarli direttamente; per assistenza scrivi al contatto sopra.</p>
<h4>8. Minori</h4>
<p>L'App non è destinata a minori di 18 anni.</p>`
        }
    },

    EN: {
        tos: {
            title: 'Terms of Service',
            html: `
<p class="legal-date">Last updated: July 4, 2026</p>
<h4>1. Scope</h4>
<p>Personal HF MT AI Powered ("the App") is an educational multi-asset algorithmic trading simulator (crypto, stocks, forex and commodities). The App offers three operating modes: <strong>Test Mode</strong>, with a simulated portfolio stored only on your device; <strong>Alpaca Paper</strong>, with a paper-trading account using fictitious funds provided by Alpaca Markets; and <strong>ALrt (real Alpaca trading)</strong>, which connects your Alpaca Live account and operates with REAL money.</p>
<h4>2. Age requirement</h4>
<p>Use of the App is restricted to persons aged 18 or the legal age in their country. By registering or using the App you declare that you meet this requirement.</p>
<h4>3. Educational nature — no financial advice</h4>
<p>The App is for educational and demonstration purposes only. No content, signal, indicator, automation or result — including the automated bot's decisions — constitutes financial advice, an investment recommendation or a solicitation. Past or simulated performance is not indicative of future results.</p>
<h4>4. Operating modes and real-trading risk</h4>
<p>Test and Alpaca Paper modes use virtual money only and carry no financial risk. The <strong>ALrt</strong> mode instead sends real orders — both automated (bot) and manual — to your Alpaca Live account using <strong>real money</strong>. This mode is disabled by default and requires you to voluntarily enter your live-account API keys and give explicit confirmation before activation. By enabling it you accept that any trade may result in the <strong>total or partial loss of your capital</strong> and that you are solely responsible for the bot's decisions and settings. The App owner is not a broker, financial advisor or authorised intermediary.</p>
<h4>5. Accounts and access</h4>
<p>Access is via Google account (optional) or as a Guest. You are responsible for safeguarding your credentials and any third-party API keys (Finnhub, Alpaca Paper and Alpaca Live) you configure.</p>
<h4>6. Third-party services</h4>
<p>The App integrates third-party services — Alpaca Markets (paper and live account), Finnhub (market data) and Google (sign-in) — governed by their own terms. The App owner is not liable for outages, errors, delays or limitations of those services.</p>
<h4>7. Acceptable use</h4>
<p>You agree not to use the App for unlawful purposes and not to attempt to compromise its security. You acknowledge that the App is an educational tool and that any use with real money is at your sole risk.</p>
<h4>8. Limitation of liability</h4>
<p>The App is provided "as is", without warranties of any kind. To the maximum extent permitted by law, the owner shall not be liable for any direct or indirect damage arising from use or inability to use the App. In particular, the maker of Personal HF MT AI Powered accepts no responsibility for any financial losses, including losses on real trading accounts connected via API keys, incurred while using the App.</p>
<h4>9. Changes</h4>
<p>These Terms may be updated; the current version is always available in the App's Legal Notes section.</p>
<h4>10. Governing law</h4>
<p>These Terms are governed by Italian law. Contact: hftindividualaip@gmail.com</p>`
        },
        eula: {
            title: 'End User License Agreement (EULA)',
            html: `
<p class="legal-date">Last updated: July 4, 2026</p>
<h4>1. License grant</h4>
<p>You are granted a personal, non-exclusive, non-transferable, revocable license to install and use Personal HF MT AI Powered for personal, educational purposes only, on devices you own.</p>
<h4>2. Restrictions</h4>
<p>You may not: (a) sell, rent, sublicense or redistribute the App; (b) remove ownership notices; (c) decompile or reverse engineer it except as permitted by mandatory law; (d) use the App to provide financial services to third parties. Any use of the real-trading mode (ALrt) is at your sole risk and under your full responsibility.</p>
<h4>3. Intellectual property</h4>
<p>The App, its code, graphics and content remain the property of the owner. This license transfers no ownership rights.</p>
<h4>4. Third-party components</h4>
<p>The App includes open-source components and third-party services, including TradingView Lightweight Charts™ (Apache 2.0 license), Google Identity Services, and the Alpaca Markets (paper and live account) and Finnhub APIs, each subject to its own license.</p>
<h4>5. No warranty</h4>
<p>The App is provided "AS IS" and "AS AVAILABLE", without express or implied warranties of uninterrupted operation, market-data accuracy, order execution or fitness for a particular purpose.</p>
<h4>6. Limitation of liability</h4>
<p>To the maximum extent permitted by law, the owner shall not be liable for indirect, incidental or consequential damages, nor for financial decisions or trades — real or simulated — made through the App.</p>
<h4>7. Termination</h4>
<p>The license terminates automatically upon breach of these conditions. Upon termination you must stop using the App and remove all copies.</p>`
        },
        privacy: {
            title: 'Privacy Policy',
            html: `
<p class="legal-date">Last updated: July 4, 2026</p>
<h4>1. Controller and contact</h4>
<p>Data controller: the owner of the application. Contact: hftindividualaip@gmail.com</p>
<h4>2. Data processed</h4>
<p>(a) If you sign in with Google: name, e-mail and profile picture, used only to personalize the interface. (b) Finnhub, Alpaca Paper and Alpaca Live API keys you enter voluntarily. (c) Data read from your broker account (balance, positions, orders and history), both in paper trading and — in ALrt mode — from the real account. (d) Session data (simulated portfolio, trade history, preferences, language).</p>
<h4>3. Where data is stored</h4>
<p>All data stays on your device (browser or app localStorage) and, for API keys, in a local file read only by the App's local server. No data is sent to remote servers of the owner, who operates no external database.</p>
<h4>4. Purposes</h4>
<p>Data is used exclusively to run the App: authentication to market services and the broker, account synchronisation, execution of the operations you request, session persistence and preferences.</p>
<h4>5. Third-party services</h4>
<p>Communications with Google (login), Alpaca Markets (paper trading and live account) and Finnhub (market data) are governed by their own privacy policies. Requests are sent directly from your device.</p>
<h4>6. Retention and deletion</h4>
<p>Data persists until you delete it: at any time via the App reset or by clearing your browser data.</p>
<h4>7. Your rights (GDPR)</h4>
<p>You have the rights of access, rectification, erasure, restriction and objection. Since data lives only on your device, you can exercise them directly; for assistance write to the contact above.</p>
<h4>8. Minors</h4>
<p>The App is not intended for persons under 18.</p>`
        }
    },

    ES: {
        tos: {
            title: 'Términos de Servicio',
            html: `
<p class="legal-date">Última actualización: 4 de julio de 2026</p>
<h4>1. Objeto</h4>
<p>Personal HF MT AI Powered ("la App") es un simulador educativo de trading algorítmico multiactivo (criptomonedas, acciones, forex y materias primas). La App ofrece tres modos de funcionamiento: <strong>Modo Test</strong>, con una cartera simulada guardada solo en tu dispositivo; <strong>Alpaca Paper</strong>, con una cuenta de paper trading de fondos ficticios proporcionada por Alpaca Markets; y <strong>ALrt (trading real de Alpaca)</strong>, que conecta tu cuenta Alpaca Live y opera con DINERO REAL.</p>
<h4>2. Requisito de edad</h4>
<p>El uso de la App está reservado a mayores de 18 años o de la edad legal de su país. Al registrarte o usar la App declaras cumplir este requisito.</p>
<h4>3. Naturaleza educativa — sin asesoramiento financiero</h4>
<p>La App tiene fines exclusivamente educativos y demostrativos. Ningún contenido, señal, indicador, automatismo o resultado —incluidas las decisiones del bot automático— constituye asesoramiento financiero, recomendación de inversión ni solicitud. El rendimiento pasado o simulado no es indicativo de resultados futuros.</p>
<h4>4. Modos de funcionamiento y riesgo del trading real</h4>
<p>Los modos Test y Alpaca Paper usan únicamente dinero virtual y no implican ningún riesgo económico. El modo <strong>ALrt</strong>, en cambio, envía órdenes reales —automáticas (bot) y manuales— a tu cuenta Alpaca Live utilizando <strong>dinero real</strong>. Este modo está desactivado de forma predeterminada y requiere que introduzcas voluntariamente las claves API de tu cuenta real y una confirmación explícita antes de activarse. Al activarlo aceptas que cualquier operación puede provocar la <strong>pérdida total o parcial de tu capital</strong> y que eres el único responsable de las decisiones y la configuración del bot. El titular de la App no es un broker, asesor financiero ni intermediario autorizado.</p>
<h4>5. Cuentas y acceso</h4>
<p>El acceso puede realizarse con cuenta de Google (opcional) o como Invitado. Eres responsable de custodiar tus credenciales y las claves API de terceros (Finnhub, Alpaca Paper y Alpaca Live) que configures.</p>
<h4>6. Servicios de terceros</h4>
<p>La App se integra con servicios de terceros —Alpaca Markets (paper y cuenta real), Finnhub (datos de mercado) y Google (acceso)—, sujetos a sus propios términos. El titular no responde de interrupciones, errores, retrasos o limitaciones de dichos servicios.</p>
<h4>7. Uso correcto</h4>
<p>Te comprometes a no usar la App con fines ilícitos ni a intentar comprometer su seguridad. Reconoces que la App es una herramienta educativa y que todo uso con dinero real es a tu exclusivo riesgo.</p>
<h4>8. Limitación de responsabilidad</h4>
<p>La App se proporciona "tal cual", sin garantías de ningún tipo. En la máxima medida permitida por la ley, el titular no responde de daños directos o indirectos derivados del uso o la imposibilidad de uso. En particular, el productor de Personal HF MT AI Powered no asume ninguna responsabilidad por pérdidas económicas, incluidas las sufridas en cuentas de trading reales conectadas mediante claves API, obtenidas al usar la App.</p>
<h4>9. Modificaciones</h4>
<p>Estos Términos pueden actualizarse; la versión vigente está siempre disponible en la sección Notas Legales de la App.</p>
<h4>10. Ley aplicable</h4>
<p>Estos Términos se rigen por la ley italiana. Contacto: hftindividualaip@gmail.com</p>`
        },
        eula: {
            title: 'Acuerdo de Licencia (EULA)',
            html: `
<p class="legal-date">Última actualización: 4 de julio de 2026</p>
<h4>1. Concesión de licencia</h4>
<p>Se te concede una licencia personal, no exclusiva, intransferible y revocable para instalar y usar Personal HF MT AI Powered solo con fines personales y educativos, en dispositivos de tu propiedad.</p>
<h4>2. Restricciones</h4>
<p>No está permitido: (a) vender, alquilar, sublicenciar o redistribuir la App; (b) eliminar avisos de titularidad; (c) descompilar o hacer ingeniería inversa salvo en los límites legales inderogables; (d) usar la App para prestar servicios financieros a terceros. El uso del modo de trading real (ALrt) se realiza a tu exclusivo riesgo y bajo tu plena responsabilidad.</p>
<h4>3. Propiedad intelectual</h4>
<p>La App, su código, gráficos y contenidos siguen siendo propiedad del titular. Esta licencia no transfiere ningún derecho de propiedad.</p>
<h4>4. Componentes de terceros</h4>
<p>La App incorpora componentes open source y servicios de terceros, incluidos TradingView Lightweight Charts™ (licencia Apache 2.0), Google Identity Services y las API de Alpaca Markets (paper y cuenta real) y Finnhub, cada uno con su propia licencia.</p>
<h4>5. Sin garantía</h4>
<p>La App se proporciona "TAL CUAL" y "SEGÚN DISPONIBILIDAD", sin garantías expresas o implícitas de funcionamiento continuo, exactitud de los datos de mercado, ejecución de órdenes o idoneidad para un fin específico.</p>
<h4>6. Limitación de responsabilidad</h4>
<p>En la máxima medida legal, el titular no será responsable de daños indirectos, incidentales o consecuentes, ni de decisiones económicas u operaciones —reales o simuladas— realizadas a través de la App.</p>
<h4>7. Resolución</h4>
<p>La licencia termina automáticamente si incumples estas condiciones. Al terminar deberás cesar el uso de la App y eliminar todas sus copias.</p>`
        },
        privacy: {
            title: 'Política de Privacidad',
            html: `
<p class="legal-date">Última actualización: 4 de julio de 2026</p>
<h4>1. Responsable y contacto</h4>
<p>Responsable del tratamiento: el propietario de la aplicación. Contacto: hftindividualaip@gmail.com</p>
<h4>2. Datos tratados</h4>
<p>(a) Si accedes con Google: nombre, correo e imagen de perfil, usados solo para personalizar la interfaz. (b) Claves API de Finnhub, Alpaca Paper y Alpaca Live que introduces voluntariamente. (c) Datos leídos de tu cuenta de broker (saldo, posiciones, órdenes e historial), tanto en paper trading como —en modo ALrt— de la cuenta real. (d) Datos de sesión (cartera simulada, historial, preferencias, idioma).</p>
<h4>3. Dónde se conservan</h4>
<p>Todos los datos permanecen en tu dispositivo (localStorage del navegador o de la app) y, en el caso de las claves API, en un archivo local leído solo por el servidor local de la App. No se envían datos a servidores remotos del titular.</p>
<h4>4. Finalidades</h4>
<p>Los datos sirven exclusivamente para el funcionamiento de la App: autenticación en los servicios de mercado y en el broker, sincronización de la cuenta, ejecución de las operaciones solicitadas, persistencia de la sesión y preferencias.</p>
<h4>5. Servicios de terceros</h4>
<p>Las comunicaciones con Google (login), Alpaca Markets (paper trading y cuenta real) y Finnhub (datos de mercado) se rigen por sus respectivas políticas de privacidad. Las solicitudes parten directamente de tu dispositivo.</p>
<h4>6. Conservación y supresión</h4>
<p>Los datos permanecen hasta que los elimines: en cualquier momento con el reset de la App o borrando los datos del navegador.</p>
<h4>7. Derechos del interesado (RGPD)</h4>
<p>Tienes derecho de acceso, rectificación, supresión, limitación y oposición. Como los datos residen solo en tu dispositivo, puedes ejercerlos directamente; para asistencia escribe al contacto indicado.</p>
<h4>8. Menores</h4>
<p>La App no está destinada a menores de 18 años.</p>`
        }
    },

    FR: {
        tos: {
            title: 'Conditions d’Utilisation',
            html: `
<p class="legal-date">Dernière mise à jour : 4 juillet 2026</p>
<h4>1. Objet</h4>
<p>Personal HF MT AI Powered (« l'App ») est un simulateur éducatif de trading algorithmique multi-actifs (cryptomonnaies, actions, forex et matières premières). L'App propose trois modes de fonctionnement : le <strong>Mode Test</strong>, avec un portefeuille simulé enregistré uniquement sur votre appareil ; <strong>Alpaca Paper</strong>, avec un compte de paper trading à fonds fictifs fourni par Alpaca Markets ; et <strong>ALrt (trading réel Alpaca)</strong>, qui connecte votre compte Alpaca Live et opère avec de l'ARGENT RÉEL.</p>
<h4>2. Condition d'âge</h4>
<p>L'utilisation de l'App est réservée aux personnes de 18 ans révolus ou ayant l'âge légal de leur pays. En vous inscrivant ou en utilisant l'App, vous déclarez remplir cette condition.</p>
<h4>3. Nature éducative — aucun conseil financier</h4>
<p>L'App a une finalité exclusivement éducative et démonstrative. Aucun contenu, signal, indicateur, automatisme ou résultat — y compris les décisions du bot automatique — ne constitue un conseil financier, une recommandation d'investissement ou une sollicitation. Les performances passées ou simulées ne préjugent pas des résultats futurs.</p>
<h4>4. Modes de fonctionnement et risque du trading réel</h4>
<p>Les modes Test et Alpaca Paper utilisent uniquement de l'argent virtuel et ne comportent aucun risque financier. Le mode <strong>ALrt</strong> envoie en revanche des ordres réels — automatiques (bot) et manuels — sur votre compte Alpaca Live avec de l'<strong>argent réel</strong>. Ce mode est désactivé par défaut et exige la saisie volontaire des clés API de votre compte réel ainsi qu'une confirmation explicite avant l'activation. En l'activant, vous acceptez que toute opération puisse entraîner la <strong>perte totale ou partielle de votre capital</strong> et que vous êtes seul responsable des décisions et des réglages du bot. Le titulaire de l'App n'est ni un courtier, ni un conseiller financier, ni un intermédiaire agréé.</p>
<h4>5. Comptes et accès</h4>
<p>L'accès s'effectue via un compte Google (facultatif) ou en tant qu'Invité. Vous êtes responsable de la garde de vos identifiants et des clés API de tiers (Finnhub, Alpaca Paper et Alpaca Live) que vous configurez.</p>
<h4>6. Services tiers</h4>
<p>L'App s'intègre à des services tiers — Alpaca Markets (paper et compte réel), Finnhub (données de marché) et Google (connexion) — soumis à leurs propres conditions. Le titulaire ne répond pas des interruptions, erreurs, retards ou limitations de ces services.</p>
<h4>7. Usage conforme</h4>
<p>Vous vous engagez à ne pas utiliser l'App à des fins illicites et à ne pas tenter d'en compromettre la sécurité. Vous reconnaissez que l'App est un outil éducatif et que tout usage avec de l'argent réel se fait à vos seuls risques.</p>
<h4>8. Limitation de responsabilité</h4>
<p>L'App est fournie « en l'état », sans garantie d'aucune sorte. Dans les limites maximales autorisées par la loi, le titulaire ne répond d'aucun dommage direct ou indirect lié à l'utilisation ou à l'impossibilité d'utiliser l'App. En particulier, le producteur de Personal HF MT AI Powered décline toute responsabilité pour les pertes financières, y compris celles subies sur des comptes de trading réels connectés via des clés API, résultant de l'utilisation de l'App.</p>
<h4>9. Modifications</h4>
<p>Ces Conditions peuvent être mises à jour ; la version en vigueur est toujours consultable dans la section Mentions Légales de l'App.</p>
<h4>10. Droit applicable</h4>
<p>Ces Conditions sont régies par le droit italien. Contact : hftindividualaip@gmail.com</p>`
        },
        eula: {
            title: 'Contrat de Licence (EULA)',
            html: `
<p class="legal-date">Dernière mise à jour : 4 juillet 2026</p>
<h4>1. Concession de licence</h4>
<p>Il vous est concédé une licence personnelle, non exclusive, non transférable et révocable pour installer et utiliser Personal HF MT AI Powered à des fins personnelles et éducatives uniquement, sur des appareils vous appartenant.</p>
<h4>2. Restrictions</h4>
<p>Il est interdit : (a) de vendre, louer, sous-licencier ou redistribuer l'App ; (b) de supprimer les mentions de propriété ; (c) de décompiler ou pratiquer l'ingénierie inverse hors des limites légales impératives ; (d) d'utiliser l'App pour fournir des services financiers à des tiers. Tout usage du mode de trading réel (ALrt) se fait à vos seuls risques et sous votre entière responsabilité.</p>
<h4>3. Propriété intellectuelle</h4>
<p>L'App, son code, ses graphismes et ses contenus demeurent la propriété du titulaire. Cette licence ne transfère aucun droit de propriété.</p>
<h4>4. Composants tiers</h4>
<p>L'App intègre des composants open source et des services tiers, dont TradingView Lightweight Charts™ (licence Apache 2.0), Google Identity Services et les API Alpaca Markets (paper et compte réel) et Finnhub, chacun soumis à sa propre licence.</p>
<h4>5. Absence de garantie</h4>
<p>L'App est fournie « TELLE QUELLE » et « SELON DISPONIBILITÉ », sans garantie expresse ou implicite de fonctionnement continu, d'exactitude des données de marché, d'exécution des ordres ou d'adéquation à un usage particulier.</p>
<h4>6. Limitation de responsabilité</h4>
<p>Dans les limites maximales légales, le titulaire ne saurait être tenu responsable des dommages indirects, accessoires ou consécutifs, ni des décisions économiques ou des opérations — réelles ou simulées — effectuées via l'App.</p>
<h4>7. Résiliation</h4>
<p>La licence prend fin automatiquement en cas de violation de ces conditions. À la résiliation, vous devez cesser d'utiliser l'App et en supprimer toute copie.</p>`
        },
        privacy: {
            title: 'Politique de Confidentialité',
            html: `
<p class="legal-date">Dernière mise à jour : 4 juillet 2026</p>
<h4>1. Responsable et contact</h4>
<p>Responsable du traitement : le propriétaire de l'application. Contact : hftindividualaip@gmail.com</p>
<h4>2. Données traitées</h4>
<p>(a) Si vous vous connectez avec Google : nom, e-mail et photo de profil, utilisés uniquement pour personnaliser l'interface. (b) Clés API Finnhub, Alpaca Paper et Alpaca Live saisies volontairement. (c) Données lues depuis votre compte de courtage (solde, positions, ordres et historique), en paper trading comme — en mode ALrt — depuis le compte réel. (d) Données de session (portefeuille simulé, historique, préférences, langue).</p>
<h4>3. Où sont conservées les données</h4>
<p>Toutes les données restent sur votre appareil (localStorage du navigateur ou de l'app) et, pour les clés API, dans un fichier local lu uniquement par le serveur local de l'App. Aucune donnée n'est envoyée vers des serveurs distants du titulaire.</p>
<h4>4. Finalités</h4>
<p>Les données servent exclusivement au fonctionnement de l'App : authentification aux services de marché et au courtier, synchronisation du compte, exécution des opérations demandées, persistance de la session et préférences.</p>
<h4>5. Services tiers</h4>
<p>Les communications avec Google (connexion), Alpaca Markets (paper trading et compte réel) et Finnhub (données de marché) sont régies par leurs politiques de confidentialité respectives. Les requêtes partent directement de votre appareil.</p>
<h4>6. Conservation et suppression</h4>
<p>Les données sont conservées jusqu'à leur suppression : à tout moment via la réinitialisation de l'App ou l'effacement des données du navigateur.</p>
<h4>7. Vos droits (RGPD)</h4>
<p>Vous disposez des droits d'accès, de rectification, d'effacement, de limitation et d'opposition. Les données résidant uniquement sur votre appareil, vous pouvez les exercer directement ; pour toute assistance, écrivez au contact ci-dessus.</p>
<h4>8. Mineurs</h4>
<p>L'App n'est pas destinée aux personnes de moins de 18 ans.</p>`
        }
    },

    DE: {
        tos: {
            title: 'Nutzungsbedingungen',
            html: `
<p class="legal-date">Letzte Aktualisierung: 4. Juli 2026</p>
<h4>1. Gegenstand</h4>
<p>Personal HF MT AI Powered („die App") ist ein edukativer Multi-Asset-Simulator für algorithmischen Handel (Kryptowährungen, Aktien, Forex und Rohstoffe). Die App bietet drei Betriebsmodi: den <strong>Testmodus</strong> mit einem nur auf Ihrem Gerät gespeicherten simulierten Portfolio; <strong>Alpaca Paper</strong> mit einem Paper-Trading-Konto (fiktive Mittel) von Alpaca Markets; und <strong>ALrt (echter Alpaca-Handel)</strong>, der Ihr Alpaca-Live-Konto verbindet und mit ECHTEM Geld arbeitet.</p>
<h4>2. Altersanforderung</h4>
<p>Die Nutzung der App ist Personen ab 18 Jahren bzw. dem gesetzlichen Mindestalter ihres Landes vorbehalten. Mit der Registrierung oder Nutzung erklären Sie, diese Anforderung zu erfüllen.</p>
<h4>3. Edukativer Charakter — keine Finanzberatung</h4>
<p>Die App dient ausschließlich Bildungs- und Demonstrationszwecken. Kein Inhalt, Signal, Indikator, Automatismus oder Ergebnis — einschließlich der Entscheidungen des automatischen Bots — stellt eine Finanzberatung, Anlageempfehlung oder Aufforderung dar. Vergangene oder simulierte Ergebnisse lassen keine Rückschlüsse auf künftige Ergebnisse zu.</p>
<h4>4. Betriebsmodi und Risiko des echten Handels</h4>
<p>Test- und Alpaca-Paper-Modus verwenden ausschließlich virtuelles Geld und bergen kein finanzielles Risiko. Der <strong>ALrt</strong>-Modus sendet dagegen echte Orders — automatisch (Bot) und manuell — an Ihr Alpaca-Live-Konto und verwendet <strong>echtes Geld</strong>. Dieser Modus ist standardmäßig deaktiviert und erfordert die freiwillige Eingabe der API-Schlüssel Ihres echten Kontos sowie eine ausdrückliche Bestätigung vor der Aktivierung. Mit der Aktivierung akzeptieren Sie, dass jede Transaktion den <strong>vollständigen oder teilweisen Verlust Ihres Kapitals</strong> zur Folge haben kann und dass Sie allein für die Entscheidungen und Einstellungen des Bots verantwortlich sind. Der Inhaber der App ist weder Broker noch Finanzberater oder zugelassener Vermittler.</p>
<h4>5. Konten und Zugang</h4>
<p>Der Zugang erfolgt über ein Google-Konto (optional) oder als Gast. Sie sind für die Verwahrung Ihrer Zugangsdaten und der von Ihnen konfigurierten Dritt-API-Schlüssel (Finnhub, Alpaca Paper und Alpaca Live) verantwortlich.</p>
<h4>6. Dienste Dritter</h4>
<p>Die App integriert Dienste Dritter — Alpaca Markets (Paper und echtes Konto), Finnhub (Marktdaten) und Google (Anmeldung) —, die deren eigenen Bedingungen unterliegen. Der Inhaber haftet nicht für Ausfälle, Fehler, Verzögerungen oder Einschränkungen dieser Dienste.</p>
<h4>7. Ordnungsgemäße Nutzung</h4>
<p>Sie verpflichten sich, die App nicht für rechtswidrige Zwecke zu nutzen und ihre Sicherheit nicht zu kompromittieren. Sie erkennen an, dass die App ein Bildungswerkzeug ist und dass jede Nutzung mit echtem Geld auf Ihr alleiniges Risiko erfolgt.</p>
<h4>8. Haftungsbeschränkung</h4>
<p>Die App wird „wie besehen" ohne jegliche Gewährleistung bereitgestellt. Im gesetzlich maximal zulässigen Umfang haftet der Inhaber nicht für direkte oder indirekte Schäden aus der Nutzung oder Nichtnutzbarkeit der App. Insbesondere übernimmt der Hersteller von Personal HF MT AI Powered keine Verantwortung für finanzielle Verluste — einschließlich Verlusten auf realen Handelskonten, die über API-Schlüssel verbunden sind —, die bei der Nutzung der App entstehen.</p>
<h4>9. Änderungen</h4>
<p>Diese Bedingungen können aktualisiert werden; die aktuelle Fassung ist stets im Bereich Rechtliche Hinweise der App abrufbar.</p>
<h4>10. Anwendbares Recht</h4>
<p>Es gilt italienisches Recht. Kontakt: hftindividualaip@gmail.com</p>`
        },
        eula: {
            title: 'Endbenutzer-Lizenzvertrag (EULA)',
            html: `
<p class="legal-date">Letzte Aktualisierung: 4. Juli 2026</p>
<h4>1. Lizenzgewährung</h4>
<p>Ihnen wird eine persönliche, nicht ausschließliche, nicht übertragbare und widerrufliche Lizenz gewährt, Personal HF MT AI Powered ausschließlich zu persönlichen Bildungszwecken auf eigenen Geräten zu installieren und zu nutzen.</p>
<h4>2. Beschränkungen</h4>
<p>Untersagt sind: (a) Verkauf, Vermietung, Unterlizenzierung oder Weiterverbreitung der App; (b) Entfernen von Eigentumsvermerken; (c) Dekompilierung oder Reverse Engineering außerhalb zwingender gesetzlicher Grenzen; (d) Nutzung der App zur Erbringung von Finanzdienstleistungen für Dritte. Jede Nutzung des Echtgeld-Handelsmodus (ALrt) erfolgt auf Ihr alleiniges Risiko und unter Ihrer vollen Verantwortung.</p>
<h4>3. Geistiges Eigentum</h4>
<p>Die App, ihr Code, ihre Grafiken und Inhalte bleiben Eigentum des Inhabers. Diese Lizenz überträgt keine Eigentumsrechte.</p>
<h4>4. Komponenten Dritter</h4>
<p>Die App enthält Open-Source-Komponenten und Dienste Dritter, darunter TradingView Lightweight Charts™ (Apache-2.0-Lizenz), Google Identity Services sowie die APIs von Alpaca Markets (Paper und echtes Konto) und Finnhub, jeweils unter eigener Lizenz.</p>
<h4>5. Keine Gewährleistung</h4>
<p>Die App wird „WIE BESEHEN" und „WIE VERFÜGBAR" bereitgestellt, ohne ausdrückliche oder stillschweigende Gewähr für unterbrechungsfreien Betrieb, Genauigkeit der Marktdaten, Orderausführung oder Eignung für einen bestimmten Zweck.</p>
<h4>6. Haftungsbeschränkung</h4>
<p>Im gesetzlich maximal zulässigen Umfang haftet der Inhaber nicht für indirekte, zufällige oder Folgeschäden noch für wirtschaftliche Entscheidungen oder Transaktionen — real oder simuliert — die über die App getroffen werden.</p>
<h4>7. Beendigung</h4>
<p>Die Lizenz endet automatisch bei Verstoß gegen diese Bedingungen. Nach Beendigung müssen Sie die Nutzung einstellen und alle Kopien entfernen.</p>`
        },
        privacy: {
            title: 'Datenschutzerklärung',
            html: `
<p class="legal-date">Letzte Aktualisierung: 4. Juli 2026</p>
<h4>1. Verantwortlicher und Kontakt</h4>
<p>Verantwortlicher: der Eigentümer der Anwendung. Kontakt: hftindividualaip@gmail.com</p>
<h4>2. Verarbeitete Daten</h4>
<p>(a) Bei Google-Anmeldung: Name, E-Mail und Profilbild, nur zur Personalisierung der Oberfläche. (b) Freiwillig eingegebene API-Schlüssel von Finnhub, Alpaca Paper und Alpaca Live. (c) Aus Ihrem Broker-Konto gelesene Daten (Saldo, Positionen, Orders und Verlauf), sowohl im Paper Trading als auch — im ALrt-Modus — vom echten Konto. (d) Sitzungsdaten (simuliertes Portfolio, Handelsverlauf, Einstellungen, Sprache).</p>
<h4>3. Speicherort</h4>
<p>Alle Daten verbleiben auf Ihrem Gerät (localStorage des Browsers bzw. der App), API-Schlüssel zusätzlich in einer lokalen Datei, die nur vom lokalen Server der App gelesen wird. Es werden keine Daten an entfernte Server des Inhabers gesendet.</p>
<h4>4. Zwecke</h4>
<p>Die Daten dienen ausschließlich dem Betrieb der App: Authentifizierung bei Marktdiensten und beim Broker, Kontosynchronisierung, Ausführung der angeforderten Vorgänge, Sitzungspersistenz und Einstellungen.</p>
<h4>5. Dienste Dritter</h4>
<p>Die Kommunikation mit Google (Login), Alpaca Markets (Paper Trading und echtes Konto) und Finnhub (Marktdaten) unterliegt deren eigenen Datenschutzerklärungen. Anfragen gehen direkt von Ihrem Gerät aus.</p>
<h4>6. Speicherung und Löschung</h4>
<p>Die Daten bleiben, bis Sie sie löschen: jederzeit über den App-Reset oder das Löschen der Browserdaten.</p>
<h4>7. Ihre Rechte (DSGVO)</h4>
<p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung und Widerspruch. Da die Daten nur auf Ihrem Gerät liegen, können Sie diese Rechte direkt ausüben; für Unterstützung wenden Sie sich an den obigen Kontakt.</p>
<h4>8. Minderjährige</h4>
<p>Die App ist nicht für Personen unter 18 Jahren bestimmt.</p>`
        }
    }
};
