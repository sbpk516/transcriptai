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
      const macConfig = { ...(mergedConfig.mac || {}) }
      if (!macConfig.serverPath) {
        macConfig.serverPath = resolveMacServerPath()
      }
      mergedConfig.mac = macConfig
      super(mergedConfig)
    }
  }

  Factory = PatchedGlobalKeyboardListener
  return Factory
}

module.exports = {
  createGlobalKeyListenerFactory,
}
