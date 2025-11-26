import React from 'react'

import type { DictationControllerState } from './dictationController'

interface DictationPermissionPromptProps {
  permission: DictationControllerState['permission']
  onAllow: () => void
  onDeny: () => void
  allowDisabled?: boolean
}

export const DictationPermissionPrompt: React.FC<DictationPermissionPromptProps> = ({
  permission,
  onAllow,
  onDeny,
  allowDisabled = false,
}) => {
  if (!permission) {
    return null
  }

  const needsAccessibility = permission.accessibilityOk === false
  const needsMic = permission.micOk === false

  return (
    <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
      <h2 className="text-lg font-semibold text-gray-900">Microphone access required</h2>
      <p className="mt-2 text-sm text-gray-700">
        Press-and-hold dictation needs permission to use your microphone. Grant access to continue.
      </p>
      {(needsAccessibility || needsMic) && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
          {needsAccessibility && <li>Enable accessibility control for TranscriptAI in system settings.</li>}
          {needsMic && <li>Allow TranscriptAI to use the microphone.</li>}
        </ul>
      )}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onAllow}
          disabled={allowDisabled}
          className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Allow
        </button>
        <button
          type="button"
          onClick={onDeny}
          className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default DictationPermissionPrompt
