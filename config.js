// TranscriptAI Port Configuration
// CHANGE ONLY THESE VALUES TO UPDATE ALL PORTS

const config = {
  BACKEND_PORT: 8001,
  FRONTEND_PORT: 3000
};

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = config;
}

// Export for browser
if (typeof window !== 'undefined') {
  window.TRANSCRIPTAI_CONFIG = config;
}
