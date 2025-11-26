import React from 'react'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
}

const Logo: React.FC<LogoProps> = ({ size = 'md', onClick }) => {
  const sizeClasses = {
    sm: 'text-lg font-bold',
    md: 'text-xl font-bold',
    lg: 'text-2xl font-bold'
  }

  const logoContent = (
    <div className={`text-blue-600 ${sizeClasses[size]} cursor-pointer hover:text-blue-700 transition-colors`}>
      TranscriptAI
    </div>
  )

  if (onClick) {
    return (
      <button onClick={onClick} className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded">
        {logoContent}
      </button>
    )
  }

  return logoContent
}

export default Logo
