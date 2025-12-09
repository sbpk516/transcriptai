const { execSync } = require('child_process');
const path = require('path');

module.exports = async function (context) {
    console.log('[beforePack] Running MLX @rpath fix...');

    const scriptPath = path.join(__dirname, '..', 'scripts', 'fix-mlx-rpath.sh');

    try {
        execSync(`bash "${scriptPath}"`, {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit'
        });
        console.log('[beforePack] MLX @rpath fix completed successfully');
    } catch (error) {
        console.error('[beforePack] MLX @rpath fix failed:', error.message);
        throw error;
    }
};
