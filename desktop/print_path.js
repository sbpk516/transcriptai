const { app } = require('electron');
console.log("USER_DATA_PATH:", app.getPath('userData'));
app.quit();
