@echo off
REM ============================================================
REM Phase F - departments. DOUBLE-CLICK THIS FILE.
REM It runs each step in a FRESH shell, so it is immune to the
REM broken terminal. Nothing here is destructive: step 2 only
PRINTS the SQL for review, and step 3 is skipped unless you
edit APPLY to yes below.
REM ============================================================
cd /d c:\Users\Lenovo\Desktop\zzzz

echo.
echo === 1/6  prisma validate===============================
call node tool-results\phasef-gate.cjs validate
type tool-results\phasef-validate.txt

echo.
echo === 2/6  generate additive SQL (review only)=============
call node tool-results\phasef-gate.cjs sql
type tool-results\phasef-sql.txt
echo.
echo ---- the SQL that WOULD be applied ----
type prisma\phase6_departments.sql
echo.
echo ---- end SQL ----

set /p APPLY="Apply it to the database? Type YES to continue: "
if /i not "%APPLY%"=="YES" (
  echo.
  echo SKIPPED - nothing was applied. Safe.
  goto :regen
)

echo.
echo === 3/6  apply===========================================
call node tool-results\phasef-gate.cjs apply
type tool-results\phasef-apply.txt

:regen
echo.
echo === 4/6  prisma generate=================================
echo (this kills any running dev server first - that is expected)
call node tool-results\phasef-gate.cjs regen
type tool-results\phasef-regen.txt

echo.
echo === 5/6  verify row counts===============================
call node tool-results\phasef-gate.cjs verify
type tool-results\phasef-verify.txt

echo.
echo === 6/6  typecheck=======================================
call node tool-results\phasef-gate.cjs tsc
type tool-results\phasef-tsc.txt

echo.
echo ============================================================
echo DONE. Scroll up and read every block.
echo Expected: validate OK / destructive-scan clean /
echo           41 cases, 52 clients, 17 designations all UNLOCKED
echo           tsc exit=0
echo If any block says FAIL, do NOT continue - send it to me.
echo ============================================================
pause