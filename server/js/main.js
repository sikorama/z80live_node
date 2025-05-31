const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pidusage = require('pidusage');

const execAsync = promisify(exec);

class Z80AssemblerServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 8125;
    
    // Configuration des chemins
    this.config = {
      binPath: process.env.BINPATH || './bin',
      outputPath: process.env.OUTPUTPATH || './output',
      inputPath: process.env.INPUTPATH || './output',
      timeoutCmd: process.env.TIMEOUTCMD || '',
      maxFileSize: '10MB',
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
      // Limites de ressources
      maxExecutionTime: parseInt(process.env.MAX_EXECUTION_TIME) || 10000, // 10 secondes
      maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB) || 300, // 300 MB
      memoryCheckInterval: 1000, // Vérification mémoire toutes les 1s
      killSignalTimeout: 5000 // Timeout pour SIGKILL après SIGTERM
    };

    // Configuration des assembleurs supportés
    this.assemblers = {
      rasm: {
        name: 'rasm',
        options: '-oa -eo -utf8',
        executable: 'rasm'
      },
      sjasmplus: {
        name: 'sjasmplus',
        options: '',
        executable: 'sjasmplus'
      },
      uz80: {
        name: 'uz80',
        options: '',
        executable: 'uz80'
      }
    };

    // Configuration des modes de build
    this.buildModes = {
      sna_cpc464: {
        extension: 'sna',
        headers: {
          rasm: 'BUILDSNA V2 : BANKSET 0',
          sjasmplus: ' DEVICE AMSTRADCPC464: org {startAddress}'
        },
        footers: {
          sjasmplus: ' SAVECPCSNA "{outputFile}", {entryPoint}'
        }
      },
      sna_cpc6128: {
        extension: 'sna',
        headers: {
          rasm: 'BUILDSNA V2 : BANKSET 0',
          sjasmplus: ' DEVICE AMSTRADCPC6128 : org {startAddress}'
        },
        footers: {
          sjasmplus: ' SAVECPCSNA "{outputFile}", {entryPoint}'
        }
      },
      sna: {
        extension: 'sna',
        headers: {
          rasm: 'BUILDSNA V2 : BANKSET 0',
          sjasmplus: ' DEVICE AMSTRADCPC6128 : org {startAddress}'
        },
        footers: {
          sjasmplus: ' SAVECPCSNA "{outputFile}", {entryPoint}'
        }
      },
      sna_zx48: {
        extension: 'sna',
        headers: {
          sjasmplus: ' DEVICE ZXSPECTRUM48'
        },
        footers: {
          sjasmplus: ' SAVESNA "{outputFile}", {entryPoint}'
        }
      },
      sna_zx128: {
        extension: 'sna',
        headers: {
          sjasmplus: ' DEVICE ZXSPECTRUM128'
        },
        footers: {
          sjasmplus: ' SAVESNA "{outputFile}", {entryPoint}'
        }
      },
      tap_zx48: {
        extension: 'tap',
        headers: {
          sjasmplus: ' DEVICE ZXSPECTRUM48'
        },
        footers: {
          sjasmplus: ' SAVETAP "{outputFile}", {entryPoint}'
        }
      },
      dsk: {
        extension: 'dsk',
        headers: {},
        footers: {}
      },
      bin: {
        extension: 'bin',
        headers: {},
        footers: {}
      }
    };

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Sécurité de base
    this.app.use(helmet());
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100 // limite par IP
    });
    this.app.use('/api/', limiter);

    // CORS configuré
    this.app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (this.config.allowedOrigins.includes('*') || this.config.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });

    // Body parser
    this.app.use(express.json({ limit: this.config.maxFileSize }));
    this.app.use(express.text({ limit: this.config.maxFileSize }));

    // Multer pour les uploads
    const upload = multer({
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['.asm', '.z80', '.inc'];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowedTypes.includes(ext));
      }
    });
  //  this.upload = upload;
  }

  setupRoutes() {
    // Route pour la compilation des fichiers
    this.app.post('/api/assemble/:filename',this.handleAssemble.bind(this));
    this.app.post('/api/store/:filename', this.handleStore.bind(this));
    this.app.get('/api/assemblers', this.getAssemblers.bind(this));
    this.app.get('/api/buildmodes', this.getBuildModes.bind(this));


    // File serving
    this.app.get('/files/:filename', this.serveFile.bind(this));
    this.app.get('/', this.serveIndex.bind(this));
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Error handling
    this.app.use(this.errorHandler.bind(this));
  }


 async handleAssemble(req, res) {
    try {
    const { filename, assembler, buildmode, startAddress, entryPoint, source } = req.body;
    console.warn({ filename, assembler, buildmode, startAddress, entryPoint, source });
      console.log("req.params = ",req.params);
      console.log("req.query = ",req.query);
      console.log("req.fbody = ",req.body);
      
      const buildParams={ filename, assembler, buildmode, startAddress, entryPoint};

      console.log(`Building ${filename} with params:`, buildParams);
      
      // Préparation du code source
      const processedCode = this.processSourceCode(source, buildParams);
      
      // Sauvegarde du fichier
      const inputFile = path.join(process.env.PWD,this.config.inputPath, filename);
      await fs.writeFile(inputFile, processedCode, 'utf8');
      
      // Compilation
      const result = await this.assembleFile(inputFile, buildParams);
      
      res.json(result);
    } catch (error) {
      console.error('Build error:', error);
      res.status(500).json({ 
        error: 'Build failed', 
        message: error.message 
      });
    }
}

  async handleStore(req, res) {
    try {
      const { filename } = req.params;
      const content = req.body;
      
      const filePath = path.join(process.env.PWD,this.config.inputPath, filename);
      await fs.writeFile(filePath, content, 'utf8');
      
      res.json({ 
        status: 'ok', 
        message: `File ${filename} stored successfully` 
      });
      
    } catch (error) {
      console.error('Store error:', error);
      res.status(500).json({ 
        error: 'Store failed', 
        message: error.message 
      });
    }
  }

  validateBuildParams(query) {
    const defaults = {
      assembler: 'rasm',
      buildmode: 'sna_cpc464',
      startAddress: '0x1000',
      entryPoint: null,
      noheader: false
    };

    const params = { ...defaults, ...query };
    
    // Validation
    if (!this.assemblers[params.assembler]) {
      throw new Error(`Unsupported assembler: ${params.assembler}`);
    }
    
    if (!this.buildModes[params.buildmode]) {
      throw new Error(`Unsupported build mode: ${params.buildmode}`);
    }
    
    // Conversion des valeurs
    params.startAddress = parseInt(params.startAddress, 16) || parseInt(defaults.startAddress, 16);
    params.entryPoint = params.entryPoint ? parseInt(params.entryPoint, 16) : params.startAddress;
    params.noheader = params.noheader === 'true' || params.noheader === true;
    
    return params;
  }

  processSourceCode(sourceCode, params) {
    if (params.noheader) {
      return sourceCode;
    }

    const buildMode = this.buildModes[params.buildmode];
    const assembler = params.assembler;
    
    // Génération header
    let header = '';
    if (buildMode.headers[assembler]) {
      header = this.templateReplace(buildMode.headers[assembler], params) + '\n';
    }
    
    // Génération footer
    let footer = '';
    if (buildMode.footers[assembler]) {
      const outputFile = this.generateOutputFilename(params);
      const footerParams = { ...params, outputFile };
      footer = '\n' + this.templateReplace(buildMode.footers[assembler], footerParams);
    }
    
    return header + sourceCode + footer;
  }

  templateReplace(template, params) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return params[key] !== undefined ? params[key] : match;
    });
  }

  generateOutputFilename(params) {
    const buildMode = this.buildModes[params.buildmode];
    const baseName = params.filename ? params.filename.replace(/\.asm$/, '') : 'output';
    return `${baseName}.${buildMode.extension}`;
  }

  async assembleFile(inputFile, params) {
    const startTime = Date.now();
    
    const assembler = this.assemblers[params.assembler];
    const asmPath = path.join(this.config.binPath, assembler.executable);
    
    // Construction de la commande
    const cmdArgs = [inputFile];
    if (assembler.options) {
      cmdArgs.push(...assembler.options.split(' ').filter(arg => arg.length > 0));
    }
    
    console.log(`Executing: ${asmPath} ${cmdArgs.join(' ')}`);
    
    try {
      const result = await this.executeWithLimits(asmPath, cmdArgs, {
        cwd: this.config.outputPath,
        timeout: this.config.maxExecutionTime,
        maxMemoryMB: this.config.maxMemoryMB
      });
      
      const duration = Date.now() - startTime;
      const outputFile = this.generateOutputFilename(params);
      
      // Parse de la sortie pour rasm
      const output = this.parseAssemblerOutput(result.stdout + result.stderr, params.assembler, inputFile);
      
      return {
        status: 0,
        success: true,
        output: outputFile,
        outputType: params.buildmode,
        stdout: output,
        duration,
        memoryPeak: result.memoryPeak,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      let errorType = 'compilation_error';
      if (error.killed) {
        if (error.signal === 'SIGTERM' || error.signal === 'SIGKILL') {
          errorType = error.reason === 'memory' ? 'memory_limit_exceeded' : 'timeout';
        }
      }
      
      return {
        status: error.code || 1,
        success: false,
        error: error.message,
        errorType,
        stdout: error.stdout ? error.stdout.split('\n') : [],
        stderr: error.stderr ? error.stderr.split('\n') : [],
        duration,
        memoryPeak: error.memoryPeak || 0,
        timestamp: new Date().toISOString()
      };
    }
  }

  async executeWithLimits(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const {
        cwd = process.cwd(),
        timeout = this.config.maxExecutionTime,
        maxMemoryMB = this.config.maxMemoryMB
      } = options;

      let stdout = '';
      let stderr = '';
      let memoryPeak = 0;
      let memoryCheckTimer = null;
      let timeoutTimer = null;
      let isKilled = false;
      let killReason = null;
console.log("Commande", command, args);

console.log( process.env.PATH );
console.log( process.env.PWD );

// Spawn du processus
      const child = spawn(path.join(process.env.PWD,command), args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      console.log(`Started process PID: ${child.pid}`);

      // Gestion des sorties
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Monitoring de la mémoire
      const checkMemory = async () => {
        if (isKilled || !child.pid) return;

        try {
          const stats = await pidusage(child.pid);
          const memoryMB = Math.round(stats.memory / 1024 / 1024);
          
          if (memoryMB > memoryPeak) {
            memoryPeak = memoryMB;
          }

          console.log(`Process ${child.pid} - Memory: ${memoryMB}MB, CPU: ${stats.cpu.toFixed(1)}%`);

          if (memoryMB > maxMemoryMB) {
            console.warn(`Process ${child.pid} exceeded memory limit: ${memoryMB}MB > ${maxMemoryMB}MB`);
            killReason = 'memory';
            this.killProcess(child, 'Memory limit exceeded');
            return;
          }

          // Programmer la prochaine vérification
          if (!isKilled) {
            memoryCheckTimer = setTimeout(checkMemory, this.config.memoryCheckInterval);
          }

        } catch (error) {
          // Le processus a probablement terminé
          if (error.code !== 'ESRCH') {
            console.warn(`Memory check failed for PID ${child.pid}:`, error.message);
          }
        }
      };

      // Démarrer le monitoring mémoire
      memoryCheckTimer = setTimeout(checkMemory, this.config.memoryCheckInterval);

      // Timer de timeout
      timeoutTimer = setTimeout(() => {
        if (!isKilled) {
          console.warn(`Process ${child.pid} timed out after ${timeout}ms`);
          killReason = 'timeout';
          this.killProcess(child, 'Execution timeout');
        }
      }, timeout);

      // Gestion de la fin du processus
      child.on('close', (code, signal) => {
        // Nettoyage des timers
        if (memoryCheckTimer) {
          clearTimeout(memoryCheckTimer);
          memoryCheckTimer = null;
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }

        console.log(`Process ${child.pid} finished - Code: ${code}, Signal: ${signal}, Memory peak: ${memoryPeak}MB`);

        if (isKilled) {
          const error = new Error(`Process killed: ${killReason}`);
          error.killed = true;
          error.signal = signal;
          error.reason = killReason;
          error.code = code;
          error.stdout = stdout;
          error.stderr = stderr;
          error.memoryPeak = memoryPeak;
          reject(error);
        } else if (code === 0) {
          resolve({
            stdout,
            stderr,
            code,
            memoryPeak
          });
        } else {
          const error = new Error(`Process exited with code ${code}`);
          error.code = code;
          error.stdout = stdout;
          error.stderr = stderr;
          error.memoryPeak = memoryPeak;
          reject(error);
        }
      });

      child.on('error', (error) => {
        // Nettoyage des timers
        if (memoryCheckTimer) {
          clearTimeout(memoryCheckTimer);
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }

        console.error(`Process ${child.pid} error:`, error);
        error.memoryPeak = memoryPeak;
        reject(error);
      });
    });
  }

  killProcess(child, reason) {
    if (!child.pid || child.killed) {
      return;
    }

    console.log(`Killing process ${child.pid}: ${reason}`);
    
    try {
      // D'abord essayer SIGTERM (terminaison propre)
      process.kill(child.pid, 'SIGTERM');
      
      // Si le processus ne se termine pas dans les 5 secondes, utiliser SIGKILL
      setTimeout(() => {
        try {
          if (!child.killed) {
            console.log(`Force killing process ${child.pid} with SIGKILL`);
            process.kill(child.pid, 'SIGKILL');
          }
        } catch (error) {
          // Le processus est probablement déjà terminé
          console.log(`Process ${child.pid} already terminated`);
        }
      }, this.config.killSignalTimeout);
      
    } catch (error) {
      console.error(`Failed to kill process ${child.pid}:`, error);
    }
  }

  parseAssemblerOutput(output, assembler, inputFile) {
    const lines = output.split('\n').filter(line => line.trim());
    
    if (assembler === 'rasm') {
      // Nettoyage des codes ANSI pour rasm
      return lines.map(line => {
        return line
          .replace(/\x1b\[[0-9]+m/g, '') // Supprime codes ANSI
          .replace(new RegExp(path.basename(inputFile), 'g'), 'source');
      }).filter(line => line.length > 0);
    }
    
    return lines;
  }

  async serveFile(req, res) {
    try {
      const { filename } = req.params;
      // Validation de sécurité
      if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      
      const filePath = path.join(this.config.outputPath, filename);
      
      // Vérification existence
      try {
        await fs.access(filePath);
      } catch {
        return res.status(404).json({ error: 'File not found' });
      }
      
      // Détermination du type MIME
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.wav': 'audio/wav',
        '.ico': 'image/x-icon',
        '.wasm': 'application/wasm',
        '.dsk': 'application/octet-stream',
        '.bin': 'application/octet-stream',
        '.sna': 'application/octet-stream',
        '.tap': 'application/octet-stream',
        '.z80': 'application/octet-stream'
      };
      
      const contentType = mimeTypes[ext] || 'text/plain';
      
      // Headers de cache pour les fichiers binaires
      if (['.dsk', '.bin', '.sna', '.tap', '.z80'].includes(ext)) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
      
      res.setHeader('Content-Type', contentType);
      
      const fileContent = await fs.readFile(filePath);
      res.send(fileContent);
      
    } catch (error) {
      console.error('File serve error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }

  async serveIndex(req, res) {
    try {
      const indexPath = './index.html';
      const content = await fs.readFile(indexPath, 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.send(content);
    } catch {
      res.status(404).send('Index file not found');
    }
  }

  getAssemblers(req, res) {
    const assemblerList = Object.keys(this.assemblers).map(key => ({
      id: key,
      name: this.assemblers[key].name,
      executable: this.assemblers[key].executable
    }));
    
    res.json({ assemblers: assemblerList });
  }

  getBuildModes(req, res) {
    const buildModeList = Object.keys(this.buildModes).map(key => ({
      id: key,
      extension: this.buildModes[key].extension,
      description: key.replace(/_/g, ' ').toUpperCase()
    }));
    
    res.json({ buildModes: buildModeList });
  }

  errorHandler(error, req, res, next) {
    console.error('Unhandled error:', error);
    
    if (res.headersSent) {
      return next(error);
    }
    
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }

  async start() {
    try {
      // Vérification des dossiers
      await this.ensureDirectories();
      
      this.app.listen(this.port, () => {
        console.log(`🚀 Z80 Assembler Server running on port ${this.port}`);
        console.log(`📁 Input path: ${this.config.inputPath}`);
        console.log(`📁 Output path: ${this.config.outputPath}`);
        console.log(`🔧 Binary path: ${this.config.binPath}`);
        console.log(`🔗 API available at http://localhost:${this.port}/api/`);
      });
      
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  async ensureDirectories() {
    const dirs = [this.config.inputPath, this.config.outputPath];
    
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  }
}

// Démarrage du serveur
if (require.main === module) {
  const server = new Z80AssemblerServer();
  server.start();
}

module.exports = Z80AssemblerServer;