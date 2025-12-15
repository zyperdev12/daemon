// =================================================================
// COMPLETE FIXED Daemon server.js with Java Version Detection
// =================================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const pty = require("node-pty");
const kill = require("tree-kill");
const archiver = require("archiver");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:8080",
      "https://t2sqjj-3000.csb.app",
      "https://*.csb.app",
      "https://zyperpanel.dev.tc",
      "https://zyperpanel.altracloud.fun",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: false,
});

// Load config
const configPath = path.join(__dirname, "../config/node.json");
let config = { servers: {}, stats: {} };

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (e) {
    console.error("Config load error:", e);
  }
}

// Save config helper
const saveConfig = () => {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
};

// Active servers tracking
const activeServers = new Map();

// Middleware
app.use(require("cors")());
app.use(require("compression")());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// Auth middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers["x-api-key"];

  if (!config.nodeKey) return next();

  if (authHeader === `Bearer ${config.nodeKey}` || apiKey === config.nodeKey) {
    return next();
  }

  res.status(401).json({ error: "Unauthorized" });
};

// System stats
const getSystemStats = () => {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();

  return {
    cpu: os.loadavg()[0],
    memory: {
      total: os.totalmem(),
      used: memUsage.heapUsed,
      free: os.freemem(),
      percent: ((memUsage.heapUsed / os.totalmem()) * 100).toFixed(2),
    },
    uptime: uptime,
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    activeServers: activeServers.size,
  };
};

// Update stats periodically
setInterval(() => {
  config.stats = getSystemStats();
  saveConfig();
}, 30000);

// Java version requirements map
const JAVA_VERSION_MAP = {
  1.21: 21,
  "1.20.5": 21,
  "1.20.4": 17,
  "1.20": 17,
  1.19: 17,
  1.18: 17,
  1.17: 17,
  1.16: 11,
  1.15: 11,
  1.14: 11,
  1.13: 11,
  1.12: 8,
};

function getRequiredJavaVersion(mcVersion) {
  for (const [version, javaVer] of Object.entries(JAVA_VERSION_MAP)) {
    if (mcVersion.startsWith(version)) {
      return javaVer;
    }
  }
  return 17; // Default to Java 17
}

// ============ HEALTH ENDPOINTS ============

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "2.0.0",
    nodeId: config.nodeId,
    nodeName: config.nodeName,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get("/stats", authMiddleware, (req, res) => {
  res.json({
    system: getSystemStats(),
    servers: {
      total: Object.keys(config.servers || {}).length,
      running: activeServers.size,
      stopped: Object.keys(config.servers || {}).length - activeServers.size,
    },
    node: {
      id: config.nodeId,
      name: config.nodeName,
      location: config.location || "CodeSandbox",
      host: "0.0.0.0",
      port: config.port || 8080,
    },
  });
});

// ============ PANEL-COMPATIBLE ENDPOINTS ============

app.get("/instances", authMiddleware, (req, res) => {
  const instances = Object.entries(config.servers || {}).map(
    ([id, server]) => ({
      id,
      name: server.name,
      type: server.type,
      status: activeServers.has(id) ? "running" : "stopped",
      port: server.port,
      memory: server.memory,
      created: server.created,
      lastStarted: server.lastStarted,
    })
  );

  res.json(instances);
});

app.get("/instances/:id", authMiddleware, (req, res) => {
  const server = config.servers[req.params.id];

  if (!server) {
    return res.status(404).json({ error: "Server not found" });
  }

  const serverProcess = activeServers.get(req.params.id);

  res.json({
    ...server,
    status: serverProcess ? "running" : "stopped",
    pid: serverProcess ? serverProcess.pid : null,
    uptime: serverProcess ? (Date.now() - serverProcess.startTime) / 1000 : 0,
  });
});

// Helper function to generate startup scripts with Java version detection
function generateStartupScript(serverType, options) {
  const { version, memory, port, build, serverDir, serverId } = options;
  const requiredJava = getRequiredJavaVersion(version);

  let content = `#!/bin/bash
set -e

# =====================================
# ZyperPanel Minecraft Server Startup
# =====================================
# Generated: ${new Date().toISOString()}
# Server ID: ${serverId}
# Server Type: ${serverType}
# Version: ${version}
# Required Java: ${requiredJava}
# =====================================

SERVER_DIR="${serverDir}"
export VERSION="${version}"
export PORT=${port}
export MEMORY=${memory}
export EULA="true"

cd "$SERVER_DIR" || { echo "Failed to enter server directory"; exit 1; }

echo "╔════════════════════════════════════════════════════╗"
echo "║     ZyperPanel Minecraft Server                    ║"
echo "║     Type: ${serverType.padEnd(15)}                  ║"
echo "║     Version: ${version.padEnd(10)}                    ║"
echo "║     Port: ${port.toString().padEnd(15)}               ║"
echo "║     Memory: ${memory}MB                            ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Check for required tools
check_command() {
  if ! command -v \$1 &>/dev/null; then
    echo "❌ ERROR: \$1 is required but not installed"
    exit 1
  fi
}

check_command "curl"

# =====================================
# Java Version Detection & Selection
# =====================================
echo "🔍 Checking Java installation..."

REQUIRED_JAVA=${requiredJava}
JAVA_BIN=""
DETECTED_VERSION=0

# Function to get Java version
get_java_version() {
  local java_path=\$1
  local version_output=\$("\$java_path" -version 2>&1 | head -1)
  
  # Try to extract version number
  if echo "\$version_output" | grep -q "version"; then
    # Modern Java (9+)
    local version=\$(echo "\$version_output" | grep -oP 'version "\\K[0-9]+' | head -1)
    if [ -z "\$version" ]; then
      # Legacy Java (8 and earlier)
      version=\$(echo "\$version_output" | grep -oP 'version "1\\.\\K[0-9]+' | head -1)
    fi
    echo "\$version"
  else
    echo "0"
  fi
}

# Search for suitable Java installation
echo "🔎 Searching for Java \${REQUIRED_JAVA}..."

# Check default java
if command -v java &>/dev/null; then
  DETECTED_VERSION=\$(get_java_version "java")
  if [ "\$DETECTED_VERSION" -ge "\$REQUIRED_JAVA" ]; then
    JAVA_BIN="java"
    echo "✅ Found suitable Java \$DETECTED_VERSION in PATH"
  fi
fi

# If default java is not suitable, search in common locations
if [ -z "\$JAVA_BIN" ]; then
  echo "⚠️  Default Java \$DETECTED_VERSION is too old, searching for Java \${REQUIRED_JAVA}..."
  
  # Common Java installation directories
  JAVA_DIRS=(
    "/usr/lib/jvm/temurin-\${REQUIRED_JAVA}-jdk-amd64/bin/java"
    "/usr/lib/jvm/java-\${REQUIRED_JAVA}-openjdk-amd64/bin/java"
    "/usr/lib/jvm/adoptopenjdk-\${REQUIRED_JAVA}-hotspot-amd64/bin/java"
    "/usr/lib/jvm/zulu-\${REQUIRED_JAVA}-amd64/bin/java"
  )
  
  for java_path in "\${JAVA_DIRS[@]}"; do
    if [ -x "\$java_path" ]; then
      VERSION=\$(get_java_version "\$java_path")
      if [ "\$VERSION" -ge "\$REQUIRED_JAVA" ]; then
        JAVA_BIN="\$java_path"
        DETECTED_VERSION="\$VERSION"
        echo "✅ Found Java \$VERSION at \$java_path"
        break
      fi
    fi
  done
fi

# If still not found, search all JVM directories
if [ -z "\$JAVA_BIN" ] && [ -d "/usr/lib/jvm" ]; then
  echo "🔎 Searching all JVM installations..."
  
  for jvm_dir in /usr/lib/jvm/*/bin/java; do
    if [ -x "\$jvm_dir" ]; then
      VERSION=\$(get_java_version "\$jvm_dir")
      if [ "\$VERSION" -ge "\$REQUIRED_JAVA" ]; then
        JAVA_BIN="\$jvm_dir"
        DETECTED_VERSION="\$VERSION"
        echo "✅ Found Java \$VERSION at \$jvm_dir"
        break
      fi
    fi
  done
fi

# Final check
if [ -z "\$JAVA_BIN" ]; then
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║  ❌ JAVA VERSION ERROR                                     ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Minecraft ${version} requires Java ${requiredJava} or higher"
  echo "No suitable Java version found on this system"
  echo ""
  echo "Solutions:"
  echo "  1. Install Java ${requiredJava}:"
  echo "     sudo apt-get update"
  echo "     sudo apt-get install -y temurin-${requiredJava}-jdk"
  echo ""
  echo "  2. Or use an older Minecraft version:"
  echo "     • Minecraft 1.17-1.20.4 → Java 17"
  echo "     • Minecraft 1.16        → Java 11"
  echo "     • Minecraft 1.12-1.15   → Java 8"
  echo ""
  exit 1
fi

echo "✅ Using Java \$DETECTED_VERSION: \$JAVA_BIN"
echo ""

`;

  switch (serverType.toLowerCase()) {
    case "paper":
      content += `# =====================================
# PaperMC Server
# =====================================
echo "📄 Downloading PaperMC ${version}..."

# Fetch available builds
PAPER_API="https://api.papermc.io/v2/projects/paper/versions/\${VERSION}"
BUILD_LIST=\$(curl -fsSL "\${PAPER_API}" 2>/dev/null)

if [ -z "\$BUILD_LIST" ]; then
  echo "❌ ERROR: Failed to fetch Paper builds for version \${VERSION}"
  echo "💡 Check if version exists: https://api.papermc.io/v2/projects/paper"
  exit 1
fi

# Determine build number
if [ -n "${build}" ] && [ "${build}" != "latest" ]; then
  BUILD="${build}"
  echo "📦 Using specified build: \${BUILD}"
else
  BUILD=\$(echo "\$BUILD_LIST" | grep -oP '"builds":\\[.*?\\K[0-9]+(?=\\])' | tail -1)
  if [ -z "\$BUILD" ]; then
    BUILD=\$(echo "\$BUILD_LIST" | grep -oP '[0-9]+' | tail -1)
  fi
  echo "📦 Using latest build: \${BUILD}"
fi

# Download PaperMC
JAR_NAME="paper-\${VERSION}-\${BUILD}.jar"
DOWNLOAD_URL="https://api.papermc.io/v2/projects/paper/versions/\${VERSION}/builds/\${BUILD}/downloads/\${JAR_NAME}"

echo "⬇️  Downloading: \${JAR_NAME}"
curl -fsSL -o server.jar "\${DOWNLOAD_URL}" || {
  echo "❌ Failed to download PaperMC"
  exit 1
}

# Verify JAR
if [ ! -f server.jar ] || [ ! -s server.jar ]; then
  echo "❌ ERROR: Downloaded file is empty or missing"
  exit 1
fi

SIZE_MB=\$(du -m server.jar | cut -f1)
echo "✅ Downloaded PaperMC \${VERSION} build \${BUILD} (\${SIZE_MB}MB)"
`;
      break;

    case "purpur":
      content += `# =====================================
# Purpur Server
# =====================================
echo "💜 Downloading Purpur ${version}..."

PURPUR_API="https://api.purpurmc.org/v2/purpur/\${VERSION}"
LATEST_BUILD=\$(curl -fsSL "\${PURPUR_API}" | grep -oP '"latest":\\K[0-9]+')

if [ -z "\$LATEST_BUILD" ]; then
  echo "❌ ERROR: Failed to fetch Purpur version \${VERSION}"
  exit 1
fi

DOWNLOAD_URL="https://api.purpurmc.org/v2/purpur/\${VERSION}/\${LATEST_BUILD}/download"

echo "⬇️  Downloading Purpur \${VERSION} build \${LATEST_BUILD}"
curl -fsSL -o server.jar "\${DOWNLOAD_URL}" || {
  echo "❌ Failed to download Purpur"
  exit 1
}

SIZE_MB=\$(du -m server.jar | cut -f1)
echo "✅ Downloaded Purpur \${VERSION} (\${SIZE_MB}MB)"
`;
      break;

    case "spigot":
      content += `# =====================================
# Spigot Server (Using BuildTools)
# =====================================
echo "🔧 Building Spigot ${version}..."

BUILDTOOLS_URL="https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar"

echo "⬇️  Downloading BuildTools..."
curl -fsSL -o BuildTools.jar "\${BUILDTOOLS_URL}" || {
  echo "❌ Failed to download BuildTools"
  exit 1
}

echo "🏗️  Building Spigot \${VERSION} (this may take 5-10 minutes)..."
"\$JAVA_BIN" -jar BuildTools.jar --rev "\${VERSION}" --output-dir "\${SERVER_DIR}" || {
  echo "❌ Failed to build Spigot"
  exit 1
}

SPIGOT_JAR=\$(ls \${SERVER_DIR}/spigot-*.jar 2>/dev/null | head -1)

if [ -z "\$SPIGOT_JAR" ]; then
  echo "❌ ERROR: No Spigot JAR found after build"
  exit 1
fi

mv "\$SPIGOT_JAR" server.jar
rm -f BuildTools.jar BuildTools.log.txt

SIZE_MB=\$(du -m server.jar | cut -f1)
echo "✅ Built Spigot \${VERSION} (\${SIZE_MB}MB)"
`;
      break;

    case "bungee":
      content += `# =====================================
# BungeeCord Proxy
# =====================================
echo "🌉 Downloading BungeeCord..."

BUNGEE_URL="https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar"

echo "⬇️  Downloading BungeeCord..."
curl -fsSL -o server.jar "\${BUNGEE_URL}" || {
  echo "❌ Failed to download BungeeCord"
  exit 1
}

SIZE_MB=\$(du -m server.jar | cut -f1)
echo "✅ Downloaded BungeeCord (\${SIZE_MB}MB)"
`;
      break;

    case "velocity":
      content += `# =====================================
# Velocity Proxy
# =====================================
echo "⚡ Downloading Velocity..."

VELOCITY_API="https://api.papermc.io/v2/projects/velocity"
LATEST_VERSION=\$(curl -fsSL "\${VELOCITY_API}" | grep -oP '"versions":\\[.*?"\\K[^"]+(?="\\])' | tail -1)

if [ -z "\$LATEST_VERSION" ]; then
  LATEST_VERSION="3.3.0-SNAPSHOT"
fi

VELOCITY_BUILD_API="\${VELOCITY_API}/versions/\${LATEST_VERSION}"
LATEST_BUILD=\$(curl -fsSL "\${VELOCITY_BUILD_API}" | grep -oP '"builds":\\[.*?\\K[0-9]+(?=\\])' | tail -1)

DOWNLOAD_URL="https://api.papermc.io/v2/projects/velocity/versions/\${LATEST_VERSION}/builds/\${LATEST_BUILD}/downloads/velocity-\${LATEST_VERSION}-\${LATEST_BUILD}.jar"

echo "⬇️  Downloading Velocity \${LATEST_VERSION}..."
curl -fsSL -o server.jar "\${DOWNLOAD_URL}" || {
  echo "❌ Failed to download Velocity"
  exit 1
}

SIZE_MB=\$(du -m server.jar | cut -f1)
echo "✅ Downloaded Velocity \${LATEST_VERSION} (\${SIZE_MB}MB)"
`;
      break;

    case "vanilla":
    default:
      content += `# =====================================
# Vanilla Minecraft Server
# =====================================
echo "⛏️  Downloading Minecraft ${version}..."

MC_MANIFEST="https://launchermeta.mojang.com/mc/game/version_manifest.json"
VERSION_URL=\$(curl -fsSL "\${MC_MANIFEST}" | grep -oP '"id":"'\${VERSION}'".*?"url":"\\K[^"]+' | head -1)

if [ -z "\$VERSION_URL" ]; then
  echo "❌ ERROR: Version \${VERSION} not found in Minecraft manifest"
  exit 1
fi

SERVER_URL=\$(curl -fsSL "\$VERSION_URL" | grep -oP '"server":.*?"url":"\\K[^"]+')

echo "⬇️  Downloading Minecraft \${VERSION}..."
curl -fsSL -o server.jar "\${SERVER_URL}" || {
  echo "❌ Failed to download Minecraft server"
  exit 1
}

SIZE_MB=\$(du -m server.jar | cut -f1)
echo "✅ Downloaded Minecraft \${VERSION} (\${SIZE_MB}MB)"
`;
      break;
  }

  // Common server startup
  content += `
# =====================================
# Server Configuration
# =====================================
echo "📝 Creating server configuration..."

# Create eula.txt
if [ ! -f eula.txt ]; then
  echo "eula=true" > eula.txt
  echo "✅ Accepted EULA"
fi

# Create server.properties with safe defaults
if [ ! -f server.properties ]; then
  cat > server.properties << EOF
server-port=\${PORT}
max-players=20
view-distance=10
online-mode=false
level-name=world
motd=ZyperPanel Server
pvp=true
difficulty=normal
gamemode=survival
max-world-size=29999984
enable-command-block=true
EOF
  echo "✅ Created server.properties"
fi

# =====================================
# Start Server
# =====================================
echo ""
echo "🚀 Starting ${serverType} server..."
echo "💾 Memory: \${MEMORY}MB"
echo "🔌 Port: \${PORT}"
echo "📦 Version: \${VERSION}"
echo "☕ Java: \$DETECTED_VERSION"
echo ""

# Calculate JVM arguments
XMS=\$((MEMORY / 2))
if [ \$XMS -lt 512 ]; then
  XMS=512
fi

XMX=\${MEMORY}

# Optimized JVM flags (Aikar's flags)
JAVA_ARGS="-Xms\${XMS}M -Xmx\${XMX}M"
JAVA_ARGS="\${JAVA_ARGS} -XX:+UseG1GC"
JAVA_ARGS="\${JAVA_ARGS} -XX:+ParallelRefProcEnabled"
JAVA_ARGS="\${JAVA_ARGS} -XX:MaxGCPauseMillis=200"
JAVA_ARGS="\${JAVA_ARGS} -XX:+UnlockExperimentalVMOptions"
JAVA_ARGS="\${JAVA_ARGS} -XX:+DisableExplicitGC"
JAVA_ARGS="\${JAVA_ARGS} -XX:+AlwaysPreTouch"
JAVA_ARGS="\${JAVA_ARGS} -XX:G1NewSizePercent=30"
JAVA_ARGS="\${JAVA_ARGS} -XX:G1MaxNewSizePercent=40"
JAVA_ARGS="\${JAVA_ARGS} -XX:G1HeapRegionSize=8M"
JAVA_ARGS="\${JAVA_ARGS} -XX:G1ReservePercent=20"
JAVA_ARGS="\${JAVA_ARGS} -XX:G1HeapWastePercent=5"
JAVA_ARGS="\${JAVA_ARGS} -XX:G1MixedGCCountTarget=4"
JAVA_ARGS="\${JAVA_ARGS} -XX:InitiatingHeapOccupancyPercent=15"
JAVA_ARGS="\${JAVA_ARGS} -XX:G1MixedGCLiveThresholdPercent=90"
JAVA_ARGS="\${JAVA_ARGS} -XX:G1RSetUpdatingPauseTimePercent=5"
JAVA_ARGS="\${JAVA_ARGS} -XX:SurvivorRatio=32"
JAVA_ARGS="\${JAVA_ARGS} -XX:+PerfDisableSharedMem"
JAVA_ARGS="\${JAVA_ARGS} -XX:MaxTenuringThreshold=1"

# Different startup for proxy servers
if [ "${serverType}" = "bungee" ] || [ "${serverType}" = "velocity" ]; then
  echo "🎮 Starting proxy server..."
  exec "\$JAVA_BIN" \${JAVA_ARGS} -jar server.jar
else
  echo "🎮 Starting Minecraft server..."
  exec "\$JAVA_BIN" \${JAVA_ARGS} -jar server.jar nogui
fi
`;

  return {
    filename: "start.sh",
    content: content,
  };
}

// Helper function to create server config files
function createServerConfigFiles(serverDir, serverConfig) {
  const { type, port, version } = serverConfig;

  if (type !== "bungee" && type !== "velocity") {
    const serverProps = path.join(serverDir, "server.properties");
    const properties = `server-port=${port}
max-players=20
view-distance=10
online-mode=false
level-name=world
motd=${serverConfig.name}
pvp=true
difficulty=normal
gamemode=survival
enable-command-block=true
`;
    fs.writeFileSync(serverProps, properties);
  }

  const eulaPath = path.join(serverDir, "eula.txt");
  fs.writeFileSync(eulaPath, "eula=true\n");
}

// Create new instance
app.post("/instances/create", authMiddleware, async (req, res) => {
  try {
    const {
      name,
      image,
      memory,
      cpu,
      port,
      env,
      volumes,
      serverType,
      version,
      build,
    } = req.body;

    const serverId = uuidv4();
    const serverDir = path.join(__dirname, "../servers", "minecraft", serverId);

    fs.mkdirSync(serverDir, { recursive: true });

    const environment = {};
    if (Array.isArray(env)) {
      env.forEach((envVar) => {
        const [key, value] = envVar.split("=");
        if (key) environment[key] = value || "";
      });
    }

    const serverVersion = version || environment.VERSION || "1.20.1";
    const memoryMB = parseInt(memory) || 1024;
    const actualServerType =
      serverType ||
      (image && image.includes("paper")
        ? "paper"
        : image && image.includes("spigot")
        ? "spigot"
        : image && image.includes("purpur")
        ? "purpur"
        : image && image.includes("bungee")
        ? "bungee"
        : image && image.includes("velocity")
        ? "velocity"
        : "vanilla");

    const startScript = generateStartupScript(actualServerType, {
      version: serverVersion,
      memory: memoryMB,
      port: port || 25565,
      build: build || "",
      serverDir,
      serverId,
    });

    const serverConfig = {
      id: serverId,
      name: name || `${actualServerType}-${Date.now()}`,
      type: actualServerType,
      port:
        port ||
        (actualServerType === "bungee"
          ? 25577
          : actualServerType === "velocity"
          ? 25578
          : 25565),
      memory: memoryMB,
      cpu: parseInt(cpu) || 100,
      startup: startScript.content,
      startupScript: startScript.filename,
      environment: {
        ...environment,
        VERSION: serverVersion,
        MEMORY: memoryMB,
        PORT:
          port ||
          (actualServerType === "bungee"
            ? 25577
            : actualServerType === "velocity"
            ? 25578
            : 25565),
      },
      directory: serverDir,
      created: new Date().toISOString(),
      lastStarted: null,
      image: image || "itzg/minecraft-server",
      version: serverVersion,
      build: build || "latest",
    };

    config.servers = config.servers || {};
    config.servers[serverId] = serverConfig;
    saveConfig();

    const scriptPath = path.join(serverDir, startScript.filename);
    fs.writeFileSync(scriptPath, startScript.content);
    fs.chmodSync(scriptPath, "755");

    createServerConfigFiles(serverDir, serverConfig);

    const eulaPath = path.join(serverDir, "eula.txt");
    fs.writeFileSync(eulaPath, "eula=true\n");

    res.json({
      success: true,
      id: serverId,
      inspect: serverConfig,
    });
  } catch (error) {
    console.error("Create server error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start instance
app.post("/instances/:id/start", authMiddleware, async (req, res) => {
  try {
    const serverId = req.params.id;
    const server = config.servers[serverId];

    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    if (activeServers.has(serverId)) {
      return res.status(400).json({ error: "Server already running" });
    }

    const startScript = path.join(server.directory, "start.sh");

    const ptyProcess = pty.spawn("bash", [startScript], {
      name: "xterm-color",
      cols: 80,
      rows: 30,
      cwd: server.directory,
      env: { ...process.env, ...server.environment },
    });

    const serverProcess = {
      pty: ptyProcess,
      pid: ptyProcess.pid,
      startTime: Date.now(),
      logs: [],
    };

    ptyProcess.onData((data) => {
      serverProcess.logs.push({ time: Date.now(), data });
      if (serverProcess.logs.length > 1000) {
        serverProcess.logs.shift();
      }

      io.to(`server-${serverId}`).emit("console-output", {
        message: data,
        type: "log",
        timestamp: Date.now(),
      });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`Server ${serverId} exited with code ${exitCode}`);
      activeServers.delete(serverId);
      io.to(`server-${serverId}`).emit("server_stopped", { exitCode, signal });
    });

    activeServers.set(serverId, serverProcess);

    server.lastStarted = new Date().toISOString();
    saveConfig();

    res.json({ success: true, pid: ptyProcess.pid });
  } catch (error) {
    console.error("Start error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get available versions for a server type
app.get("/versions/:type", authMiddleware, async (req, res) => {
  try {
    const serverType = req.params.type.toLowerCase();
    let versions = [];

    switch (serverType) {
      case "paper":
        versions = await getPaperVersions();
        break;
      case "purpur":
        versions = await getPurpurVersions();
        break;
      case "spigot":
        versions = await getSpigotVersions();
        break;
      case "vanilla":
        versions = await getVanillaVersions();
        break;
      case "bungee":
        versions = ["latest"];
        break;
      case "velocity":
        versions = await getVelocityVersions();
        break;
      default:
        versions = ["1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.17.1", "1.16.5"];
    }

    res.json({
      success: true,
      type: serverType,
      versions: versions,
      default: versions[0],
    });
  } catch (error) {
    console.error("Error fetching versions:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions to fetch versions
async function getPaperVersions() {
  try {
    const response = await axios.get(
      "https://api.papermc.io/v2/projects/paper"
    );
    return response.data.versions.reverse();
  } catch (error) {
    return ["1.20.4", "1.20.1", "1.19.4", "1.18.2"];
  }
}

async function getPurpurVersions() {
  try {
    const response = await axios.get("https://api.purpurmc.org/v2/purpur");
    return Object.keys(response.data.versions).reverse();
  } catch (error) {
    return ["1.20.4", "1.20.1", "1.19.4", "1.18.2"];
  }
}

async function getSpigotVersions() {
  return ["1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.17.1", "1.16.5"];
}

async function getVanillaVersions() {
  try {
    const response = await axios.get(
      "https://launchermeta.mojang.com/mc/game/version_manifest.json"
    );
    return response.data.versions
      .filter((v) => v.type === "release")
      .map((v) => v.id)
      .slice(0, 20);
  } catch (error) {
    return ["1.20.4", "1.20.1", "1.19.4", "1.18.2"];
  }
}

async function getVelocityVersions() {
  try {
    const response = await axios.get(
      "https://api.papermc.io/v2/projects/velocity"
    );
    return response.data.versions.reverse();
  } catch (error) {
    return ["3.3.0", "3.2.0"];
  }
}

// Get builds for Paper
app.get("/versions/paper/:version/builds", authMiddleware, async (req, res) => {
  try {
    const version = req.params.version;
    const response = await axios.get(
      `https://api.papermc.io/v2/projects/paper/versions/${version}`
    );

    if (!response.data) {
      return res.status(404).json({ error: "Version not found" });
    }

    res.json({
      success: true,
      version: version,
      builds: response.data.builds.reverse(),
      latest: response.data.builds[response.data.builds.length - 1],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this to your daemon server.js in the FILE MANAGEMENT section

// Change server version
app.post("/instances/:id/change-version", authMiddleware, async (req, res) => {
  try {
    const { version, serverType, build } = req.body;
    const serverId = req.params.id;
    const server = config.servers[serverId];

    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    const serverProcess = activeServers.get(serverId);
    if (serverProcess) {
      kill(serverProcess.pid, "SIGTERM");
      activeServers.delete(serverId);
    }

    server.version = version;
    server.type = serverType || server.type;
    server.build = build || "latest";
    server.environment.VERSION = version;

    const startScript = generateStartupScript(server.type, {
      version: version,
      memory: server.memory,
      port: server.port,
      build: build || "",
      serverDir: server.directory,
      serverId: server.id,
    });

    server.startup = startScript.content;
    server.startupScript = startScript.filename;

    const scriptPath = path.join(server.directory, startScript.filename);
    fs.writeFileSync(scriptPath, startScript.content);
    fs.chmodSync(scriptPath, "755");

    const oldJar = path.join(server.directory, "server.jar");
    if (fs.existsSync(oldJar)) {
      fs.unlinkSync(oldJar);
    }

    saveConfig();

    res.json({
      success: true,
      message: `Server version updated to ${version}`,
      server: {
        id: server.id,
        name: server.name,
        type: server.type,
        version: server.version,
        build: server.build,
      },
    });
  } catch (error) {
    console.error("Error changing version:", error);
    res.status(500).json({ error: error.message });
  }
});

// Stop instance
app.post("/instances/:id/stop", authMiddleware, async (req, res) => {
  try {
    const serverId = req.params.id;
    const serverProcess = activeServers.get(serverId);

    if (!serverProcess) {
      return res.status(400).json({ error: "Server not running" });
    }

    kill(serverProcess.pid, "SIGTERM", (err) => {
      if (err) {
        console.error("Kill error:", err);
      }
      activeServers.delete(serverId);
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restart instance
app.post("/instances/:id/restart", authMiddleware, async (req, res) => {
  try {
    const serverId = req.params.id;

    const serverProcess = activeServers.get(serverId);
    if (serverProcess) {
      await new Promise((resolve) => {
        kill(serverProcess.pid, "SIGTERM", () => {
          activeServers.delete(serverId);
          resolve();
        });
      });

      await new Promise((r) => setTimeout(r, 2000));
    }

    const server = config.servers[serverId];
    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    const startScript = path.join(server.directory, "start.sh");

    const ptyProcess = pty.spawn("bash", [startScript], {
      name: "xterm-color",
      cols: 80,
      rows: 30,
      cwd: server.directory,
      env: { ...process.env, ...server.environment },
    });

    const newServerProcess = {
      pty: ptyProcess,
      pid: ptyProcess.pid,
      startTime: Date.now(),
      logs: [],
    };

    ptyProcess.onData((data) => {
      newServerProcess.logs.push({ time: Date.now(), data });
      io.to(`server-${serverId}`).emit("console-output", {
        message: data,
        timestamp: Date.now(),
      });
    });

    activeServers.set(serverId, newServerProcess);

    res.json({ success: true, pid: ptyProcess.pid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete instance
app.delete("/instances/:id", authMiddleware, async (req, res) => {
  try {
    const serverId = req.params.id;
    const server = config.servers[serverId];

    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    const serverProcess = activeServers.get(serverId);
    if (serverProcess) {
      kill(serverProcess.pid, "SIGKILL");
      activeServers.delete(serverId);
    }

    if (fs.existsSync(server.directory)) {
      fs.rmSync(server.directory, { recursive: true, force: true });
    }

    delete config.servers[serverId];
    saveConfig();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get instance logs
app.get("/instances/:id/logs", authMiddleware, (req, res) => {
  try {
    const { tail = 100 } = req.query;
    const serverProcess = activeServers.get(req.params.id);

    if (!serverProcess) {
      return res.json({
        success: true,
        logs: "Server is not running. Start it to see logs.",
      });
    }

    const logs = serverProcess.logs.slice(-parseInt(tail));

    res.json({
      success: true,
      logs: logs.map((l) => l.data).join(""),
      count: logs.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Execute command
app.post("/instances/:id/command", authMiddleware, (req, res) => {
  try {
    const { command } = req.body;
    const serverProcess = activeServers.get(req.params.id);

    if (!serverProcess) {
      return res.status(400).json({ error: "Server not running" });
    }

    serverProcess.pty.write(command + "\n");

    res.json({ success: true, output: "Command sent" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get instance stats
app.get("/instances/:id/stats", authMiddleware, (req, res) => {
  const serverProcess = activeServers.get(req.params.id);

  if (!serverProcess) {
    return res.json({
      cpu: 0,
      memory: 0,
      disk: 0,
      network: { rx: 0, tx: 0 },
    });
  }

  res.json({
    cpu: 10,
    memory: 512,
    disk: 1024,
    network: { rx: 100, tx: 50 },
    uptime: (Date.now() - serverProcess.startTime) / 1000,
  });
});

// ============ FILE MANAGEMENT ============

app.post("/instances/:id/files/list", authMiddleware, (req, res) => {
  try {
    const { path: filePath = "/" } = req.body;
    const server = config.servers[req.params.id];

    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    if (!fs.existsSync(server.directory)) {
      fs.mkdirSync(server.directory, { recursive: true });
      return res.json({
        success: true,
        path: filePath,
        items: [],
        message: "Server directory created",
      });
    }

    let fullPath = path.resolve(
      server.directory,
      filePath.startsWith("/") ? filePath.slice(1) : filePath
    );

    if (!fullPath.startsWith(path.resolve(server.directory))) {
      fullPath = server.directory;
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "Path not found" });
    }

    const stats = fs.statSync(fullPath);

    if (stats.isFile()) {
      return res.json({
        success: true,
        isFile: true,
        name: path.basename(fullPath),
        path: path.relative(server.directory, fullPath),
        size: stats.size,
        modified: stats.mtime,
        content: fs.readFileSync(fullPath, "utf-8"),
      });
    }

    const items = fs
      .readdirSync(fullPath, { withFileTypes: true })
      .map((item) => {
        const itemPath = path.join(fullPath, item.name);
        const itemStats = fs.statSync(itemPath);

        return {
          name: item.name,
          type: item.isDirectory() ? "directory" : "file",
          size: itemStats.size,
          modified: itemStats.mtime,
          path: path.relative(server.directory, itemPath),
          permissions: itemStats.mode.toString(8).slice(-3),
        };
      })
      .sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === "directory" ? -1 : 1;
      });

    res.json({
      success: true,
      path: path.relative(server.directory, fullPath) || "/",
      items,
    });
  } catch (error) {
    console.error("File list error:", error);
    res.status(500).json({ error: error.message });
  }
});
// In server.js - UPDATE the read endpoint
app.post("/instances/:id/files/read", authMiddleware, (req, res) => {
  try {
    console.log(`[Daemon Read] Request for server: ${req.params.id}`);
    console.log(`[Daemon Read] Raw body:`, req.body);

    // FIXED: Get encoded path, then decode it
    const { filePath: encodedFilePath } = req.body; // Get as encodedFilePath
    const filePath = decodeURIComponent(encodedFilePath); // Now decode it

    const server = config.servers[req.params.id];

    if (!server) {
      console.error(`[Daemon Read] Server ${req.params.id} not found`);
      return res.status(404).json({ error: "Server not found" });
    }

    console.log(`[Daemon Read] Decoded filePath: ${filePath}`);
    console.log(`[Daemon Read] Server dir: ${server.directory}`);

    const fullPath = path.join(server.directory, filePath);
    console.log(`[Daemon Read] Full path: ${fullPath}`);

    if (!fs.existsSync(fullPath)) {
      console.error(`[Daemon Read] File not found: ${fullPath}`);

      // Debug: List parent directory to see what's there
      const parentDir = path.dirname(fullPath);
      if (fs.existsSync(parentDir)) {
        console.log(
          `[Daemon Read] Parent dir exists, contents:`,
          fs.readdirSync(parentDir)
        );
      } else {
        console.log(`[Daemon Read] Parent dir doesn't exist: ${parentDir}`);
      }

      return res.status(404).json({ error: "File not found" });
    }

    const stats = fs.statSync(fullPath);

    // Check if it's a directory
    if (stats.isDirectory()) {
      console.log(`[Daemon Read] Is directory: ${fullPath}`);
      return res.status(400).json({ error: "Cannot read directory" });
    }

    // Check file size limit (increase to 5MB for config files)
    if (stats.size > 5 * 1024 * 1024) {
      console.log(`[Daemon Read] File too large: ${stats.size} bytes`);
      return res
        .status(400)
        .json({ error: "File too large to read (max 5MB)" });
    }

    // Check if file is binary (plugins, jars, etc.)
    const fileName = path.basename(fullPath).toLowerCase();
    const binaryExtensions = [
      ".jar",
      ".zip",
      ".gz",
      ".tar",
      ".exe",
      ".dll",
      ".so",
      ".dylib",
      ".class",
    ];
    const isBinaryFile = binaryExtensions.some((ext) => fileName.endsWith(ext));

    console.log(
      `[Daemon Read] File: ${fileName}, Binary? ${isBinaryFile}, Size: ${stats.size} bytes`
    );

    if (isBinaryFile) {
      // For binary files, send special response
      console.log(`[Daemon Read] Binary file detected, cannot read as text`);

      res.json({
        success: false,
        error: "Cannot read binary file",
        isBinary: true,
        fileName: fileName,
        message:
          "This file appears to be a binary file (plugin, archive, etc.) and cannot be edited as text. Use download instead.",
      });
    } else {
      // For text files, read as UTF-8
      console.log(`[Daemon Read] Reading text file as UTF-8`);

      try {
        const content = fs.readFileSync(fullPath, "utf-8");

        res.json({
          success: true,
          content: content,
          path: filePath,
          size: stats.size,
          modified: stats.mtime,
          isBinary: false,
          encoding: "utf-8",
        });
      } catch (readError) {
        console.error(
          `[Daemon Read] UTF-8 read failed, trying latin1:`,
          readError.message
        );

        // Try alternative encoding
        try {
          const content = fs.readFileSync(fullPath, "latin1");
          res.json({
            success: true,
            content: content,
            path: filePath,
            size: stats.size,
            modified: stats.mtime,
            isBinary: false,
            encoding: "latin1",
            warning: "File read with latin1 encoding (UTF-8 failed)",
          });
        } catch (latinError) {
          console.error(`[Daemon Read] All text encodings failed`);

          // File appears to be binary
          res.json({
            success: false,
            error: "File appears to be binary or uses unknown encoding",
            isBinary: true,
            fileName: fileName,
            message:
              "Cannot read file. It may be a binary file or uses an unsupported encoding.",
          });
        }
      }
    }

    console.log(`[Daemon Read] Successfully processed file: ${filePath}`);
  } catch (error) {
    console.error(`[Daemon Read] Error:`, error);
    console.error(`[Daemon Read] Stack:`, error.stack);
    res.status(500).json({ error: error.message });
  }
});
app.post("/instances/:id/files/write", authMiddleware, (req, res) => {
  try {
    const { filePath, content } = req.body;
    const server = config.servers[req.params.id];

    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    const fullPath = path.join(server.directory, filePath);

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file or directory
// In server.js - Fix the files/delete endpoint
app.post("/instances/:id/files/delete", authMiddleware, async (req, res) => {
  try {
    // ✅ Get filePath from req.body (not req.params)
    const { filePath, force = false } = req.body;
    const serverId = req.params.id;
    const server = config.servers[serverId];

    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    console.log(`[Daemon] Deleting file: ${filePath} from server ${serverId}`);

    const fullPath = path.join(server.directory, filePath);

    // Security check
    const serverDir = path.resolve(server.directory);
    const requestedPath = path.resolve(fullPath);

    if (!requestedPath.startsWith(serverDir)) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (!fs.existsSync(fullPath)) {
      console.error(`[Daemon] File not found: ${fullPath}`);
      return res.status(404).json({ error: "File not found" });
    }

    const stats = fs.statSync(fullPath);
    const isDirectory = stats.isDirectory();

    try {
      if (isDirectory) {
        const items = fs.readdirSync(fullPath);
        if (items.length > 0 && !force) {
          return res.status(400).json({
            success: false,
            error: "Directory is not empty",
            items: items.length,
            message: "Use force=true to delete non-empty directory",
          });
        }
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }

      res.json({
        success: true,
        message: isDirectory ? "Directory deleted" : "File deleted",
        path: filePath,
      });
    } catch (deleteError) {
      console.error("[Daemon] Delete error:", deleteError);
      res.status(500).json({
        success: false,
        error: deleteError.message,
      });
    }
  } catch (error) {
    console.error("[Daemon] Delete endpoint error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Force delete endpoint (for non-empty directories)
app.post(
  "/instances/:id/files/delete-force",
  authMiddleware,
  async (req, res) => {
    try {
      const { filePath } = req.body;
      const server = config.servers[req.params.id];

      if (!server) {
        return res.status(404).json({ error: "Server not found" });
      }

      const fullPath = path.join(server.directory, filePath);

      // Security check
      const serverDir = path.resolve(server.directory);
      const requestedPath = path.resolve(fullPath);

      if (!requestedPath.startsWith(serverDir)) {
        return res
          .status(403)
          .json({ error: "Access denied - path traversal attempt" });
      }

      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: "File or directory not found" });
      }

      const stats = fs.statSync(fullPath);
      const isDirectory = stats.isDirectory();

      try {
        // Force delete (recursive)
        fs.rmSync(fullPath, { recursive: true, force: true });

        res.json({
          success: true,
          message: isDirectory
            ? "Directory and all contents deleted successfully"
            : "File deleted successfully",
          path: filePath,
          type: isDirectory ? "directory" : "file",
        });
      } catch (deleteError) {
        console.error("Force delete operation failed:", deleteError);
        res.status(500).json({
          success: false,
          error: deleteError.message,
          message:
            "Failed to force delete. The file/directory may be in use or you don't have permission.",
        });
      }
    } catch (error) {
      console.error("Force delete error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Internal server error during force delete operation",
      });
    }
  }
);

app.post("/instances/:id/files/upload", authMiddleware, async (req, res) => {
  try {
    const { filePath, fileName, fileData, encoding = "base64" } = req.body;
    const server = config.servers[req.params.id];

    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    const fullPath = path.join(server.directory, filePath || "", fileName);

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (encoding === "base64") {
      const buffer = Buffer.from(fileData, "base64");
      fs.writeFileSync(fullPath, buffer);
    } else {
      fs.writeFileSync(fullPath, fileData);
    }

    const stats = fs.statSync(fullPath);

    res.json({
      success: true,
      path: path.relative(server.directory, fullPath),
      size: stats.size,
      message: `File uploaded successfully: ${fileName}`,
    });
  } catch (error) {
    console.error("File upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============ WEBSOCKET ============

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join-server", (serverId) => {
    console.log(`Client ${socket.id} joined server ${serverId}`);
    socket.join(`server-${serverId}`);

    const serverProcess = activeServers.get(serverId);
    if (serverProcess) {
      const recentLogs = serverProcess.logs.slice(-50);
      recentLogs.forEach((log) => {
        socket.emit("console-output", {
          message: log.data,
          timestamp: log.time,
          type: "log",
        });
      });

      socket.emit("console-output", {
        message: "✅ Connected to server console (Real-time)\n",
        type: "system",
      });
    } else {
      socket.emit("console-output", {
        message: "⚠️ Server is not running. Start it to see live logs.\n",
        type: "system",
      });
    }
  });

  socket.on("console-command", (data) => {
    const { serverId, command } = data;
    console.log(`Command from ${socket.id} to ${serverId}: ${command}`);

    const serverProcess = activeServers.get(serverId);
    if (serverProcess && serverProcess.pty) {
      serverProcess.pty.write(command + "\n");

      io.to(`server-${serverId}`).emit("console-output", {
        message: `> ${command}\n`,
        type: "command",
      });

      console.log(`Command sent to server ${serverId}: ${command}`);
    } else {
      socket.emit("console-output", {
        message: "❌ Server is not running. Start it first.\n",
        type: "error",
      });
    }
  });

  socket.on("detach", (serverId) => {
    socket.leave(`server-${serverId}`);
    console.log(`Client ${socket.id} left server ${serverId}`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// ============ START SERVER ============

const PORT = config.port || 8080;
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`╔════════════════════════════════════════════════════╗`);
  console.log(`║  ZyperPanel Daemon - Java Version Fixed           ║`);
  console.log(`╚════════════════════════════════════════════════════╝`);
  console.log(`🚀 Server: http://${HOST}:${PORT}`);
  console.log(`📡 Node ID: ${config.nodeId}`);
  console.log(`🏷️  Name: ${config.nodeName}`);
  console.log(
    `🔐 Key: ${
      config.nodeKey
        ? config.nodeKey.substring(0, 16) + "..."
        : "Not configured"
    }`
  );
  console.log(`📊 Platform: ${os.platform()} ${os.arch()}`);
  console.log(`💾 Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
  console.log(``);
  console.log(`✨ Features:`);
  console.log(`   ✅ Automatic Java version detection`);
  console.log(`   ✅ Multi-Java support (8, 11, 17, 21)`);
  console.log(`   ✅ Version compatibility checking`);
  console.log(`   ✅ Optimized JVM flags (Aikar's)`);
  console.log(``);
  console.log(`📋 Minecraft Compatibility:`);
  console.log(`   • 1.21+     → Java 21 required`);
  console.log(`   • 1.20.5+   → Java 21 required`);
  console.log(`   • 1.17-1.20 → Java 17 required`);
  console.log(`   • 1.16      → Java 11 required`);
  console.log(`   • 1.12-1.15 → Java 8 required`);
  console.log(``);

  if (!config.panelUrl) {
    console.log(`⚠️  Not configured! Run:`);
    console.log(
      `   npm run configure -- --panel "http://localhost:3000" --key "your-api-key"`
    );
    console.log(``);
  } else {
    console.log(`✅ Connected to panel: ${config.panelUrl}`);
    console.log(`✅ Ready to receive requests!`);
    console.log(``);
  }
});
