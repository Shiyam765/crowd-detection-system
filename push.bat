@echo off
echo ========================================================
echo Pushing Crowd Detection System to GitHub
echo ========================================================
git init
git add .
git commit -m "Initialize project with 10-min predictive analysis and custom dashboard config"
git branch -M main
git remote add origin https://github.com/Shiyam765/crowd-detection-system
git push -u origin main
echo ========================================================
echo Done! Please check https://github.com/Shiyam765/crowd-detection-system
echo ========================================================
pause
