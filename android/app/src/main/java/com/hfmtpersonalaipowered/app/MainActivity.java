package com.hfmtpersonalaipowered.app;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Estende BridgeWebViewClient (non una WebViewClient "nuda"): quella di
        // Capacitor implementa shouldInterceptRequest, che serve i file locali
        // impacchettati in www/ quando non c'è un server.url configurato
        // (build STANDALONE). Sostituirla con una WebViewClient semplice
        // toglieva questa logica, e la WebView tentava una vera connessione di
        // rete verso https://localhost — su un dispositivo reale (nessun server
        // in ascolto) falliva con "Pagina web non disponibile" a schermo bianco.
        // onReceivedSslError resta per accettare il certificato autofirmato di
        // server.js in modalità --dev (10.0.2.2): riguarda solo la navigazione
        // della WebView, non le fetch/XHR JS né le chiamate CapacitorHttp verso
        // i broker, quindi non indebolisce la validazione TLS di quelle.
        this.bridge.getWebView().setWebViewClient(new BridgeWebViewClient(this.bridge) {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.proceed();
            }
        });
    }
}