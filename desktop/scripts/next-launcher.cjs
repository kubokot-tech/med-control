// Starts the Next standalone server for the desktop app and stops it when the app closes its stdin
// (also when the app itself is gone), so no server is left behind. Next keeps no state: exiting at once is safe.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
process.stdin.resume();
require('./server.js');
