import React from 'react'

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
  activePage: 'dashboard' | 'capture' | 'transcripts' | 'analytics' | 'settings'
  onPageChange: (page: 'dashboard' | 'capture' | 'transcripts' | 'analytics' | 'settings') => void
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle, activePage, onPageChange }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', description: 'Overview and analytics' },
    { id: 'capture', label: 'Capture', icon: '🎙️', description: 'Record or upload audio' },
    { id: 'transcripts', label: 'Transcripts', icon: '📄', description: 'Review completed transcriptions' },
    { id: 'analytics', label: 'Analytics', icon: '📈', description: 'Advanced insights' },
    { id: 'settings', label: 'Settings', icon: '⚙️', description: 'Configuration' },
    { id: 'help', label: 'Help', icon: '❓', description: 'Documentation & support' }
  ]

  const handleItemClick = (itemId: string) => {
    if (['dashboard', 'capture', 'transcripts', 'analytics', 'settings'].includes(itemId)) {
      onPageChange(itemId as any)
    }
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 lg:hidden bg-gray-600 bg-opacity-75"
          onClick={onToggle}
        />
      )}
      
      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
            <span className="sr-only">TranscriptAI navigation</span>
            <button
              onClick={onToggle}
              className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
            >
              <span className="sr-only">Close sidebar</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
            {menuItems.map((item) => {
              const isActive = activePage === (item.id as any)
              const isClickable = ['dashboard', 'capture', 'transcripts', 'analytics', 'settings'].includes(item.id)
              
              return (
                <div
                  key={item.id}
                  className={`
                    group flex items-center px-3 py-3 text-sm font-medium rounded-lg cursor-pointer transition-all duration-200
                    ${isActive 
                      ? 'bg-blue-100 text-blue-900 border-r-2 border-blue-500' 
                      : isClickable
                        ? 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                        : 'text-gray-400 cursor-not-allowed'
                    }
                  `}
                  onClick={() => isClickable && handleItemClick(item.id)}
                >
                  <span className="text-xl mr-3">{item.icon}</span>
                  <div className="flex-1">
                    <div className="font-medium">{item.label}</div>
                    <div className={`text-xs ${isActive ? 'text-blue-700' : 'text-gray-500'}`}>
                      {item.description}
                    </div>
                  </div>
                  {isActive && (
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  )}
                </div>
              )
            })}
          </nav>
          
          {/* Footer */}
          <div className="p-4 border-t border-gray-200">
            <div className="text-xs text-gray-500 text-center">
              <div className="mb-2">TranscriptAI v1.0</div>
              <div className="flex items-center justify-center space-x-2">
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                <span>System Online</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default Sidebar
