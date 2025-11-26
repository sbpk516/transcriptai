# SignalHub Production Deployment Guide

## Phase 1.3: Audio Processing Pipeline - Production Ready

This guide provides comprehensive instructions for deploying SignalHub Phase 1.3 to production environments.

## 📋 Table of Contents

1. [System Requirements](#system-requirements)
2. [Environment Setup](#environment-setup)
3. [Database Configuration](#database-configuration)
4. [Application Deployment](#application-deployment)
5. [Monitoring & Logging](#monitoring--logging)
6. [Performance Optimization](#performance-optimization)
7. [Security Considerations](#security-considerations)
8. [Troubleshooting](#troubleshooting)
9. [Maintenance](#maintenance)

## 🖥️ System Requirements

### Minimum Requirements
- **CPU**: 4 cores (2.4 GHz or higher)
- **RAM**: 8GB
- **Storage**: 50GB SSD
- **OS**: Ubuntu 20.04+ / CentOS 8+ / macOS 10.15+

### Recommended Requirements
- **CPU**: 8+ cores (3.0 GHz or higher)
- **RAM**: 16GB+
- **Storage**: 100GB+ SSD
- **GPU**: NVIDIA GPU (optional, for faster Whisper processing)

### Software Dependencies
- **Python**: 3.9+
- **PostgreSQL**: 13+
- **FFmpeg**: 4.0+
- **Redis**: 6.0+ (optional, for caching)

## 🔧 Environment Setup

### 1. Install System Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y python3.9 python3.9-venv python3.9-dev
sudo apt install -y postgresql postgresql-contrib
sudo apt install -y ffmpeg
sudo apt install -y build-essential libssl-dev libffi-dev

# CentOS/RHEL
sudo yum install -y python3.9 python3.9-devel
sudo yum install -y postgresql postgresql-server
sudo yum install -y ffmpeg
sudo yum install -y gcc openssl-devel libffi-devel
```

### 2. Create Application User

```bash
# Create application user
sudo useradd -m -s /bin/bash signalhub
sudo usermod -aG sudo signalhub

# Switch to application user
sudo su - signalhub
```

### 3. Setup Python Environment

```bash
# Create virtual environment
python3.9 -m venv /opt/signalhub/venv
source /opt/signalhub/venv/bin/activate

# Install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

## 🗄️ Database Configuration

### 1. PostgreSQL Setup

```bash
# Initialize PostgreSQL (if not already done)
sudo postgresql-setup initdb

# Start PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql

CREATE DATABASE signalhub;
CREATE USER signalhub_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE signalhub TO signalhub_user;
ALTER USER signalhub_user CREATEDB;
\q
```

### 2. Database Migration

```bash
# Set environment variables
export DATABASE_URL="postgresql://signalhub_user:your_secure_password@localhost/signalhub"

# Run database migrations
cd /opt/signalhub/backend
alembic upgrade head
```

## 🚀 Application Deployment

### 1. Application Structure

```
/opt/signalhub/
├── backend/
│   ├── app/
│   ├── alembic/
│   └── requirements.txt
├── audio_uploads/
├── logs/
├── debug_logs/
├── venv/
└── .env
```

### 2. Environment Configuration

Create `/opt/signalhub/.env`:

```env
# Database Configuration
DATABASE_URL=postgresql://signalhub_user:your_secure_password@localhost/signalhub

# Application Settings
UPLOAD_DIR=/opt/signalhub/audio_uploads
DEBUG_MODE=false
LOG_LEVEL=INFO

# Whisper Configuration
WHISPER_MODEL=base
WHISPER_DEVICE=cpu

# Security
SECRET_KEY=your_super_secret_key_here
ALLOWED_HOSTS=localhost,127.0.0.1,your_domain.com

# Monitoring
ENABLE_MONITORING=true
ALERT_EMAIL=admin@yourdomain.com
```

### 3. Systemd Service Configuration

Create `/etc/systemd/system/signalhub.service`:

```ini
[Unit]
Description=SignalHub Audio Processing Pipeline
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=exec
User=signalhub
Group=signalhub
WorkingDirectory=/opt/signalhub/backend
Environment=PATH=/opt/signalhub/venv/bin
ExecStart=/opt/signalhub/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
Restart=always
RestartSec=10

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/signalhub/audio_uploads /opt/signalhub/logs /opt/signalhub/debug_logs

[Install]
WantedBy=multi-user.target
```

### 4. Start Application

```bash
# Reload systemd and start service
sudo systemctl daemon-reload
sudo systemctl start signalhub
sudo systemctl enable signalhub

# Check status
sudo systemctl status signalhub
```

## 📊 Monitoring & Logging

### 1. Log Configuration

The application automatically logs to:
- `/opt/signalhub/logs/signalhub.log` - Application logs
- `/opt/signalhub/debug_logs/` - Debug information
- System journal via systemd

### 2. Monitoring Endpoints

Access monitoring data via API:

```bash
# Health check
curl http://localhost:8000/health

# Active pipelines
curl http://localhost:8000/api/v1/monitor/active

# Performance metrics
curl http://localhost:8000/api/v1/monitor/performance

# Pipeline history
curl http://localhost:8000/api/v1/monitor/history

# Recent alerts
curl http://localhost:8000/api/v1/monitor/alerts
```

### 3. Log Rotation

Create `/etc/logrotate.d/signalhub`:

```
/opt/signalhub/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 signalhub signalhub
    postrotate
        systemctl reload signalhub
    endscript
}
```

## ⚡ Performance Optimization

### 1. System Tuning

```bash
# Increase file descriptor limits
echo "signalhub soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "signalhub hard nofile 65536" | sudo tee -a /etc/security/limits.conf

# Optimize PostgreSQL
sudo -u postgres psql -c "ALTER SYSTEM SET max_connections = 200;"
sudo -u postgres psql -c "ALTER SYSTEM SET shared_buffers = '256MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET effective_cache_size = '1GB';"
sudo systemctl restart postgresql
```

### 2. Application Tuning

```bash
# Adjust worker processes based on CPU cores
# For 8 cores: --workers 6
# For 4 cores: --workers 2

# Enable GPU acceleration for Whisper (if available)
export CUDA_VISIBLE_DEVICES=0
```

### 3. Storage Optimization

```bash
# Monitor disk usage
df -h /opt/signalhub/audio_uploads

# Clean up old files (older than 30 days)
find /opt/signalhub/audio_uploads -type f -mtime +30 -delete
find /opt/signalhub/debug_logs -type f -mtime +7 -delete
```

## 🔒 Security Considerations

### 1. Network Security

```bash
# Configure firewall
sudo ufw allow 8000/tcp  # Application port
sudo ufw allow 22/tcp    # SSH
sudo ufw enable

# Use reverse proxy (nginx) for production
sudo apt install nginx
```

### 2. Application Security

```bash
# Generate secure secret key
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Use HTTPS in production
# Configure SSL certificates
# Enable CORS properly
```

### 3. Database Security

```bash
# Restrict database access
sudo -u postgres psql -c "REVOKE CONNECT ON DATABASE signalhub FROM PUBLIC;"
sudo -u postgres psql -c "GRANT CONNECT ON DATABASE signalhub TO signalhub_user;"
```

## 🛠️ Troubleshooting

### Common Issues

#### 1. Service Won't Start

```bash
# Check service status
sudo systemctl status signalhub

# Check logs
sudo journalctl -u signalhub -f

# Check permissions
ls -la /opt/signalhub/
```

#### 2. Database Connection Issues

```bash
# Test database connection
psql -h localhost -U signalhub_user -d signalhub

# Check PostgreSQL status
sudo systemctl status postgresql

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-*.log
```

#### 3. Audio Processing Failures

```bash
# Check FFmpeg installation
ffmpeg -version

# Check audio file permissions
ls -la /opt/signalhub/audio_uploads/

# Check disk space
df -h
```

#### 4. Performance Issues

```bash
# Monitor system resources
htop
iotop
nethogs

# Check application metrics
curl http://localhost:8000/api/v1/monitor/performance
```

### Debug Commands

```bash
# Test pipeline manually
cd /opt/signalhub/backend
source ../venv/bin/activate
python -c "from app.pipeline_orchestrator import AudioProcessingPipeline; print('Pipeline loaded successfully')"

# Run benchmark
python ../benchmark_pipeline.py

# Check monitoring
curl http://localhost:8000/api/v1/monitor/active
```

## 🔧 Maintenance

### Daily Tasks

```bash
# Check service status
sudo systemctl status signalhub

# Monitor disk usage
df -h

# Check recent errors
sudo journalctl -u signalhub --since "1 day ago" | grep ERROR
```

### Weekly Tasks

```bash
# Clean up old files
find /opt/signalhub/audio_uploads -type f -mtime +30 -delete
find /opt/signalhub/debug_logs -type f -mtime +7 -delete

# Check performance metrics
curl http://localhost:8000/api/v1/monitor/performance

# Update system packages
sudo apt update && sudo apt upgrade
```

### Monthly Tasks

```bash
# Review logs for patterns
sudo journalctl -u signalhub --since "1 month ago" | grep -E "(ERROR|WARNING)"

# Check database performance
sudo -u postgres psql -c "SELECT * FROM pg_stat_database WHERE datname = 'signalhub';"

# Update application
cd /opt/signalhub
git pull
source venv/bin/activate
pip install -r backend/requirements.txt
sudo systemctl restart signalhub
```

## 📈 Scaling Considerations

### Horizontal Scaling

For high-traffic environments:

1. **Load Balancer**: Use nginx or HAProxy
2. **Multiple Instances**: Deploy multiple application instances
3. **Database Clustering**: Consider PostgreSQL clustering
4. **File Storage**: Use shared storage (NFS, S3, etc.)

### Vertical Scaling

For resource-intensive workloads:

1. **GPU Acceleration**: Enable CUDA for Whisper
2. **Memory Optimization**: Increase RAM and adjust PostgreSQL settings
3. **CPU Optimization**: Use more CPU cores and workers

## 📞 Support

For issues and questions:

1. Check the troubleshooting section above
2. Review application logs
3. Check monitoring endpoints
4. Run diagnostic tests

---

**SignalHub Phase 1.3 is now production-ready with comprehensive monitoring, error handling, and deployment automation!** 🚀
