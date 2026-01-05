const electron = require('electron');
console.log('Type of electron:', typeof electron);
console.log('Value of electron:', electron);
if (typeof electron === 'string') {
    console.log('Length of string:', electron.length);
}
process.exit(0);
