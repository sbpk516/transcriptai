const { app } = require('electron')
console.log('APP OBJECT:', app)
console.log('TYPE_OF_APP:', typeof app)
if (app) {
    app.on('ready', () => {
        console.log('Electron is ready. Exiting.')
        app.quit()
    })
} else {
    console.error('CRITICAL: app is undefined!')
    process.exit(1)
}
