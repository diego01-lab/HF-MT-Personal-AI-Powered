@echo off
setlocal
title Avvia HF MT Personal AI Powered su android

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
set "AVD=Pixel_API35"
set "PKG=com.hfmtpersonalaipowered.app"
set "APK=android\app\build\outputs\apk\debug\app-debug.apk"

cd /d "%PROJ%"

echo ===========================================
echo  HF MT Personal AI Powered - Build e avvio Android
echo ===========================================
echo.

echo [1/5] Build web (www/)...
call npm run build || goto :err

echo.
echo [2/5] Sync Capacitor Android...
call npx cap sync android || goto :err

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
  echo Avvio emulatore %AVD%...
  start "" "%EMULATOR%" -avd %AVD%
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
