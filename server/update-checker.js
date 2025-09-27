// update-checker.js
const { exec } = require('child_process');
const { config } = require('./config');

function checkForUpdates() {
  exec('git fetch', (err) => {
    if (err) return console.error('Git fetch error:', err);
    exec('git rev-parse HEAD', (err, localHash) => {
      if (err) return console.error('Git rev-parse HEAD error:', err);
      exec('git rev-parse origin/main', (err, remoteHash) => {
        if (err) return console.error('Git rev-parse origin/main error:', err);
        if (localHash.trim() !== remoteHash.trim()) {
          console.log('New version found. Updating...');
          exec(`git pull && pm2 restart ${config.updater.pm2ProcessName}`, (err, stdout, stderr) => {
            if (err) console.error('Update error:', err);
            else console.log('Update successful:', stdout);
          });
        } else {
          console.log('No updates available.');
        }
      });
    });
  });
}

// Check at configured interval (converted from minutes to milliseconds)
const checkIntervalMs = config.updater.checkIntervalMinutes * 60 * 1000;
console.log(`Update checker started. Checking every ${config.updater.checkIntervalMinutes} minutes.`);

setInterval(checkForUpdates, checkIntervalMs);
checkForUpdates();