"use strict"

const path = require('path')
const { app } = require('electron')

let Factory = null

function resolveMacServerPath() {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'MacKeyServer')
  }
  return path.join(__dirname, '..', '..', 'node_modules', 'node-global-key-listener', 'bin', 'MacKeyServer')
}

function resolveWinServerPath() {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'WinKeyServer.exe')
  }
  return path.join(__dirname, '..', '..', 'node_modules', 'node-global-key-listener', 'bin', 'WinKeyServer.exe')
}

function createGlobalKeyListenerFactory() {
  if (Factory) {
    return Factory
  }
  let BaseListener
  try {
    // eslint-disable-next-line global-require
    BaseListener = require('node-global-key-listener').GlobalKeyboardListener
  } catch (error) {
    const err = new Error('node-global-key-listener unavailable')
    err.cause = error
    throw err
  }

  class PatchedGlobalKeyboardListener extends BaseListener {
    constructor(config = {}) {
      const mergedConfig = { ...config }
      if (process.platform === 'win32') {
        const winConfig = { ...(mergedConfig.windows || {}) }
        if (!winConfig.serverPath) {
          winConfig.serverPath = resolveWinServerPath()
        }
        mergedConfig.windows = winConfig
      } else {
        const macConfig = { ...(mergedConfig.mac || {}) }
        if (!macConfig.serverPath) {
          macConfig.serverPath = resolveMacServerPath()
        }
        mergedConfig.mac = macConfig
      }
      super(mergedConfig)
    }
  }

  Factory = PatchedGlobalKeyboardListener
  return Factory
}

module.exports = {
  createGlobalKeyListenerFactory,
}
