@echo off
setlocal
title Avvia Personal HF MT - AI Powered su android

REM ============================================================
REM  Build + sync + compila APK + avvia emulatore + installa app
REM  Doppio click per eseguire tutto in automatico.
REM ============================================================

set "PROJ=%~dp0"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
set "EMULATOR=%ANDROID_HOME%\emulator\emulator.exe"
REM  Pixel_4_API35: stesso hardware Pixel 4 ma con immagine android-35 (Play
REM  Services 2024+). L'immagine android-34 del vecchio AVD "Pixel_4" ha GMS
REM  di maggio 2023, troppo vecchio: il login Google fallisce sia nell'aggiunta
REM  account ("codice non valido") sia nel Credential Manager (protocollo non
REM  riconosciuto dal plugin social-login).
set "AVD=Pixel_4_API35"
set "PKG=com.hfmtpersonalaipowered.app"
set "APK=android\app\build\outputs\apk\debug\app-debug.apk"

cd /d "%PROJ%"

echo ===========================================
echo  Personal HF MT - AI Powered - Build e avvio Android
echo ===========================================
echo.

echo [1/5] Build web (www/)...
call npm run build || goto :err

echo.
echo [2/5] Sync Capacitor (Android + iOS)...
REM  npm run sync = sync-platforms.js: aggiorna gli asset web di ENTRAMBE le
REM  piattaforme (android/ e ios/) e corregge il server.url per ciascuna
REM  (10.0.2.2 per l'emulatore Android, localhost per il simulatore iOS).
REM  La copia iOS resta sempre pronta anche se qui si compila solo Android
REM  (la build/esecuzione iOS richiede un Mac con Xcode).
call npm run sync || goto :err

echo.
echo [3/5] Compilo APK (Gradle)...
pushd android
call gradlew.bat assembleDebug
set "GERR=%ERRORLEVEL%"
popd
if not "%GERR%"=="0" goto :err

echo.
echo [4/5] Controllo emulatore...
"%ADB%" shell getprop sys.boot_completed 2>nul | findstr /b "1" >nul
if not errorlevel 1 (
  echo Emulatore gia' pronto.
) else (
  echo Avvio emulatore %AVD% ^(GPU host + 4GB RAM^)...
  REM  -gpu host   : usa la GPU dell'host (accelerazione hardware). Senza questo
  REM               flag l'AVD cade su rendering software (lentissimo).
  REM               Se lo schermo resta nero o glitcha, sostituisci "host" con
  REM               "angle_indirect" (Direct3D, molto stabile su Windows).
  REM  -memory 4096: 4GB RAM (l'AVD di default ne ha solo 2, causa di lentezza).
  REM  -no-boot-anim / -no-snapshot-load: boot piu' rapido e pulito.
  start "" "%EMULATOR%" -avd %AVD% -gpu host -memory 4096 -no-boot-anim -no-snapshot-load
  "%ADB%" wait-for-device
  echo Attendo il boot completo ^(puo' richiedere 1-2 minuti^)...
)

:waitboot
"%ADB%" shell getprop sys.boot_completed 2>nul | findstr /b "1" >nul
if errorlevel 1 (
  timeout /t 3 /nobreak >nul
  goto :waitboot
)

echo.
echo [5/5] Installo e avvio l'app...
"%ADB%" install -r "%APK%" || goto :err
"%ADB%" shell monkey -p %PKG% -c android.intent.category.LAUNCHER 1 >nul

echo.
echo ===========================================
echo   FATTO! App avviata sull'emulatore.
echo ===========================================
echo.
pause
exit /b 0

:err
echo.
echo *** ERRORE durante un passaggio. Controlla i messaggi sopra. ***
echo.
pause
exit /b 1
