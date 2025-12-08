
const path = require('path');
const process = require('process');

// Simulate packaged environment
const mockResourcesPath = '/Applications/TranscriptAI.app/Contents/Resources';

// Current logic
const resourcesVenv = path.join(mockResourcesPath, 'venv_mlx');
console.log('Current Logic Path:', resourcesVenv);

// Check what happens if we use relative path
const relativeVenv = path.resolve(path.join(mockResourcesPath, '..', '..', 'Contents', 'Resources', 'venv_mlx'));
console.log('Relative Path:', relativeVenv);

console.log('Comparison:', resourcesVenv === relativeVenv);
