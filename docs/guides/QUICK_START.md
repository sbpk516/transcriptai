# TranscriptAI - Quick Start Guide

Get the Contact Center TranscriptAI running locally in minutes!

## Prerequisites

- **Docker & Docker Compose** (latest version)
- **Python 3.9+** (for local development)
- **Git** (for version control)
- **8GB+ RAM** (for running all services)
- **20GB+ free disk space**

## Quick Start (Docker)

### 1. Clone and Setup

```bash
# Clone the repository
git clone <repository-url>
cd transcriptai

# Create environment file
cp env.example .env
# Edit .env with your configuration
```

### 2. Start All Services

```bash
# Start all services with Docker Compose
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f backend
```

### 3. Verify Installation

```bash
# Check API health
curl http://localhost:8001/health

# Check Elasticsearch
curl http://localhost:9200/_cluster/health

# Check Kafka
docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092
```

### 4. Access Services

- **API Documentation**: http://localhost:8001/docs
- **Kibana**: http://localhost:5601
- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090
- **Flower (Celery)**: http://localhost:5555

## Local Development Setup

### 1. Python Environment

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Install development dependencies
pip install -r requirements-dev.txt
```

### 2. Database Setup

```bash
# Start only database services
docker-compose up -d postgres mongodb redis

# Run migrations
alembic upgrade head

# Create initial data
python scripts/init_data.py
```

### 3. Start Development Services

```bash
# Start backend API
uvicorn backend.app.main:app --reload --port 8001

# Start Celery worker
celery -A backend.app.celery worker --loglevel=info

# Start Celery beat (scheduler)
celery -A backend.app.celery beat --loglevel=info
```

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```bash
# Database
DATABASE_URL=postgresql://transcriptai:transcriptai123@localhost:5432/transcriptai
MONGODB_URL=mongodb://transcriptai:transcriptai123@localhost:27017/transcriptai

# Redis
REDIS_URL=redis://localhost:6379

# Kafka
KAFKA_BOOTSTRAP_SERVERS=localhost:9092
KAFKA_TOPIC_AUDIO=audio-stream
KAFKA_TOPIC_TRANSCRIPTS=transcripts
KAFKA_TOPIC_INSIGHTS=insights

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200

# API Keys (get from respective services)
OPENAI_API_KEY=your_openai_key
SLACK_BOT_TOKEN=your_slack_token
JIRA_API_TOKEN=your_jira_token
ZENDESK_API_TOKEN=your_zendesk_token

# Audio Processing
AUDIO_SAMPLE_RATE=16000
AUDIO_CHANNELS=1
```

### API Keys Setup

1. **OpenAI API Key**: Get from https://platform.openai.com/
2. **Slack Bot Token**: Create app at https://api.slack.com/
3. **Jira API Token**: Generate at https://id.atlassian.com/manage-profile/security/api-tokens
4. **Zendesk API Token**: Get from your Zendesk admin panel

## Testing the System

### 1. Upload Audio File

```bash
# Test audio upload
curl -X POST "http://localhost:8001/api/v1/audio/upload" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@test_audio.wav" \
  -F "call_id=test_call_001"
```

### 2. Check Processing Status

```bash
# Get call status
curl "http://localhost:8001/api/v1/calls/test_call_001/status"
```

### 3. View Results

```bash
# Get call insights
curl "http://localhost:8001/api/v1/calls/test_call_001/insights"
```

## Development Workflow

### 1. Code Structure

```
transcriptai/
├── backend/                 # FastAPI application
│   ├── app/
│   │   ├── api/            # API endpoints
│   │   ├── core/           # Configuration
│   │   ├── models/         # Database models
│   │   ├── services/       # Business logic
│   │   └── utils/          # Utilities
│   └── tests/              # Test files
├── audio_processor/         # Audio processing service
├── nlp_engine/             # AI/ML processing
├── streaming/              # Kafka producers/consumers
└── integrations/           # Third-party integrations
```

### 2. Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=backend

# Run specific test file
pytest tests/test_audio_processing.py
```

### 3. Code Quality

```bash
# Format code
black backend/
isort backend/

# Lint code
flake8 backend/
mypy backend/
```

## Troubleshooting

### Common Issues

1. **Port Conflicts**
   ```bash
   # Check what's using a port
   lsof -i :8001
   
   # Kill process
   kill -9 <PID>
   ```

2. **Docker Issues**
   ```bash
   # Clean up Docker
   docker-compose down -v
   docker system prune -a
   
   # Rebuild images
   docker-compose build --no-cache
   ```

3. **Database Connection Issues**
   ```bash
   # Check database status
   docker-compose logs postgres
   
   # Reset database
   docker-compose down -v
   docker-compose up -d postgres
   ```

4. **Memory Issues**
   ```bash
   # Increase Docker memory limit
   # In Docker Desktop: Settings > Resources > Memory > 8GB
   ```

### Performance Tuning

1. **Elasticsearch Memory**
   ```yaml
   # In docker-compose.yml
   environment:
     - "ES_JAVA_OPTS=-Xms1g -Xmx1g"
   ```

2. **Kafka Configuration**
   ```yaml
   # In docker-compose.yml
   environment:
     KAFKA_HEAP_OPTS: "-Xmx1G -Xms1G"
   ```

## Next Steps

1. **Explore the API**: Visit http://localhost:8001/docs
2. **Check Dashboards**: Monitor with Grafana and Kibana
3. **Add Custom Models**: Extend NLP capabilities
4. **Integrate Services**: Connect Slack, Jira, Zendesk
5. **Scale Up**: Deploy to Kubernetes

## Support

- **Documentation**: Check the `/docs` folder
- **Issues**: Create GitHub issues
- **Discussions**: Use GitHub Discussions
- **Wiki**: Check project wiki for detailed guides

Happy coding! 🚀
