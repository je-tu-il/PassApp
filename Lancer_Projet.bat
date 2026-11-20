@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "APP_TITLE=PassApp"
title %APP_TITLE%

echo ========================================================
echo   %APP_TITLE%
echo ========================================================
echo.
REM --- 1. VERIFICATION DE NODE.JS ---
node --version >nul 2>&1
if errorlevel 1 (
    echo ========================================================
    echo   [ERREUR] Node.js introuvable sur votre machine
    echo ========================================================
    echo Node.js n'est pas detecte dans le PATH.
    echo.
    echo Ouverture du site officiel Node.js...
    start https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM --- 2. INSTALLATION AUTOMATIQUE MODULES NPM ---
if not exist "%~dp0node_modules" (
    echo [*] Installation automatique des dependances npm...
    call npm install --no-fund --no-audit --silent
)

REM --- 3. DEMARRAGE DE L'APPLICATION ---
echo [*] Demarrage du serveur / de l'application...
call npm run dev
if errorlevel 1 (
    echo.
    echo [!] Une erreur est survenue (Code: %errorlevel%).
    pause
    exit /b %errorlevel%
)
exit /b 0
