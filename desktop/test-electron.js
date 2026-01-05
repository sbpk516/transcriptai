const { app } = require('electron');
console.log('Electron app object:', app);
if (app) {
    console.log('App is defined correctly!');
    app.whenReady().then(() => {
        console.log('App ready!');
        process.exit(0);
    });
} else {
    console.log('App is UNDEFINED!');
    process.exit(1);
}
