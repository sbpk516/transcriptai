const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization: not macOS');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID || 'KVLNE2Y696';

  if (!appleId || !appleIdPassword) {
    console.log('Skipping notarization: APPLE_ID or APPLE_ID_PASSWORD not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath}...`);
  console.log(`  Apple ID: ${appleId}`);
  console.log(`  Team ID: ${teamId}`);

  try {
    await notarize({
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('Notarization complete!');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
