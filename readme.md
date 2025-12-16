# 🖥️ ZyperPanel Daemon

*The powerful node daemon for ZyperPanel - Run game servers across multiple machines*

[![Discord](https://img.shields.io/discord/123456789012345678?color=7289DA&label=Support%20Server&logo=discord&logoColor=white)](https://discord.gg/v8swAnehVP)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/yourusername/zyperpanel-daemon)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🎯 What is the Daemon?

The ZyperPanel Daemon is a lightweight Node.js service that runs on your game server nodes. It communicates with the main panel to manage Docker containers, execute commands, and monitor server resources.


## ✨ Features

### 🐳 **Container Management**
- Docker container creation & management
- Auto-start on system boot
- Resource limits (CPU, RAM)
- Port mapping & network configuration

### 📊 **Real-time Monitoring**
- CPU & Memory usage tracking
- Server uptime monitoring
- Player count statistics
- Network I/O monitoring

### 🔧 **Server Control**
- Start/Stop/Restart servers
- Console command execution
- File management (upload/download/edit)
- Backup & restore operations

### 🔐 **Security**
- API key authentication
- Container isolation
- Resource limits per server
- Secure WebSocket connections

## 🚀 Quick Installation

### Prerequisites

Node.js 18.x or higher
Docker & Docker Compose
At least 2GB RAM free
Linux/Unix system (Ubuntu/Debian/CentOS)


### 1. Clone & Install
```bash
# Clone the daemon repository
git clone https://github.com/zyperdev12/daemon.git
cd daemon
```
# Install dependencies
```bash
npm install
```

### 2. I Setup auto Config So, Now let's start the Node
```bash
npm install -g pm2
```

```
pm2 start npm --name "Zyper-Daemon" -- start
```
```
pm2 save
```
```
pm2 startup
```

### 3. Install All java versions
```bash
sudo apt update && \
sudo apt install -y wget curl ca-certificates apt-transport-https gpg lsb-release && \
wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | sudo gpg --dearmor -o /usr/share/keyrings/adoptium.gpg && \
echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/adoptium.list && \
sudo apt update && \
sudo apt install -y temurin-8-jdk temurin-11-jdk temurin-17-jdk temurin-21-jdk
```


