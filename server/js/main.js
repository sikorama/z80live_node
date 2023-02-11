const http = require('http');
const fs = require('fs');
const path = require('path');
const exec = require('child_process').exec;

const binpath = '../bin';

const outputpath = './output';
// Currently input files ares storerd in output folder
// Need first to fix assemblers params
const inputpath = './output';

// Sends a 404 error
function respError404(response) {
  fs.readFile('./404.html', function (error, content) {
    response.writeHead(200, {
      'Content-Type': 'text/html'
    });
    response.end(content, 'utf-8');
  });
}

function respError(response, content) {
  response.writeHead(200, {
    'Content-Type': 'application/json'
  });
  response.end(content, 'utf-8');
}




http.createServer(function (request, response) {
  try {
    // Website you wish to allow to connect
    response.setHeader('Access-Control-Allow-Origin', '*');
    // Request methods you wish to allow
    //    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    // Request headers you wish to allow
    response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    //response.setHeader('Access-Control-Allow-Credentials', true);

    // handle POST Request, to assemble files

    // URL format:
    // command/main_filename?param1=value1&param2=value2...
    // parameters:
    // asm=[sjaspmlus|rasm|uz80]



    // FIXME: globals....

  
    if (request.method == 'POST') {

      console.log('POST request URL=', request.url);

      if (request.url.length == 0) {
        respError404(response);
        return;
      }

      let p, cmd, pcmd, op;
      var fname;
      var params = [];
   
      // parse URL
      // TODO: cleanup this code (use standard libs)
      try {
        p = request.url.split('?');
        cmd = p[0];
        console.info('cmd=', cmd);
        pcmd = cmd.split('/');
        console.error(pcmd);
        op = pcmd[1];
        fname= pcmd[2];

        if (op != 'build' && op != 'store') {
          console.error('Wrong post command', op);
          respError404(response);
          return;
        }

        if (p.length > 1)
          params = p[1].split('&');

      } catch (e) {
        console.error('Error parsing URL', e.stack);
      }


      // Si c'est un fichier DSK ou SNA, on le stocke
      // Si c'est un fichier ASM, on le stocke et on execute RASM
      // Sinon on renvoie un objet qui contient
      // - le status
      // - le message de rasm
      // - le nom du fichier généré
      // En mode data,on renvoie le binaire généré par rasm
      // en cas de non erreur

      var body = '';
      request.on('data', function (data) {
        body += data;
      });

      request.on('end', function () {
        //console.log('Body: ' + body);

        // Default variables
        let asm = 'rasm';
      
        // Save file
        let filePath = [inputpath, fname].join('/');
        console.info('Saving file', filePath);
        fs.writeFile(filePath, body, function (error) {
          if (error) {
            console.error('Write Error', error);
            respError(response, 'Write Error');
            return;
          }

          // If only storing, exits now
          if (op != 'build') {
            response.writeHead(200, {
              'Content-Type': 'application/json'
            });
            response.end(JSON.stringify({ status: 'ok' }), 'utf-8');
            return;
          }

          // Si on a une commande build

          // Execute RASM
          // Returns RASM output: bin,dsk or sna and onsole output.

          // TODO: On utilise -oa, mais on pourrait controler les noms
          // pour dispatcher dans différents répertoires

          // String returned by the assembler
          let resStr = "";
          let outputType = 'bin';
          let outputFile = '';




          const asm_options = {
            // -eo: if using DSK , insert file 
            // -oa: output file is named after input file
            // -utf8: handles characters
            'rasm': '-oa -eo -utf8',
            'uz80': '',
            'sjasmplus': ''
          };

          let options = '';
          if (asm_options.hasOwnProperty(asm)) {
            options = asm_options[asm];
          }

          let asmcmd = [binpath, asm].join('/');


          let execcmd = [
            'timeout -t 10', 
            asmcmd, 
            fname, 
            options
          ].join(' ');

          console.info('Exec command', execcmd);

          // On devrait executer depuis ./ et utiliser outputpath et inputpath relatifs a ce path
          let d0=Date.now();
          let child = exec(execcmd, { cwd: outputpath+'/' });

          child.stdout.on('data', function (data) {
            console.error('std:', data);
            resStr += data;

          });


          child.stderr.on('data', function (data) {
            console.error('err:', data);


            resStr += data;
          });

          child.on('close', function (code) {

            let d1= Date.now();

            let resArr = resStr.split('\n');
            let regex = new RegExp(fname, 'g');
            let filtres = [];

            // On cherche a recuperer le nom du fichier généré
            // FIXME: méthod bancale, on devrait le savoir à l'avance :)
            // FIXME: Ne marche que pour rasm

            // TODO: utiliser le code js pour generer des snas

           outputType = 'bin';
            // rasm
            const typeStrings = [
              ['bin', 'Write binary file '],
              ['dsk', 'Write edsk file '],
              ['sna', 'Write snapshot v3 file '], 
              ['sna', 'Write snapshot v2 file ']
            ];

            for (let j = 0; j < resArr.length; j++) {
              let pline = resArr[j];
              for (let i = 0; i < typeStrings.length; i++) {
                let binstr = typeStrings[i][1];
                let i0 = pline.indexOf(binstr);

                if (i0 >= 0) {
                  outputType = typeStrings[i][0];
                  var subs = pline.substr(i0 + binstr.length);
                  // On récupere le nom de fichier qui commence en i0+binstr.lengh, et qui va jusqu'au prochain espace ou retour chariot
                  outputFile = subs.split(' ')[0];
                }
              }


              // Filtre la sortie (code ansi) (rasm only)
              let o = pline.replace(/.\[[0-9]+m/g, '');
              //  Remplace le nom du fichier
              o = o.replace(fname, "source");
              if (o.length > 0)
                filtres.push(o);
            }

            filtres.push('Assmebled in '+ d1-d0 +'ms');

            var pckt = {
              status: code,
              output: outputFile,
              outputType: outputType,
              stdout: filtres,
              src: fname,
              date: Date.now(),
              duration: d1-d0
            };

            console.info("OUTPUT FILE=", outputFile);
            console.info(JSON.parse(JSON.stringify(pckt)));

            response.writeHead(200, {
              'Content-Type': 'application/json'
            });
            response.end(JSON.stringify(pckt), 'utf-8');
          }); //on close
        });//write file
      });
    }

    // handle GET Request, to retrieve files
    if (request.method == 'GET') {
      let filePath = './index.html';

      // Safety filters
      if (request.url.indexOf('..') > -1) {
        console.error('URL contains ".."');
        return;
      }

      let p = request.url.split('?');
      let fname = p[0];

      // URL format
      // filename?param=1&param2=value2  
      // Parameters are ignored

      if (request.url.length > 1)
        filePath = './output' + fname;

      let extname = path.extname(filePath);
      let contentType = 'text/html';

      switch (extname) {
        case '.js':
          contentType = 'text/javascript';
          break;
        case '.css':
          contentType = 'text/css';
          break;
        case '.json':
          contentType = 'application/json';
          break;
        case '.png':
          contentType = 'image/png';
          break;
        case '.jpg':
          contentType = 'image/jpg';
          break;
        case '.wav':
          contentType = 'audio/wav';
          break;
        case '.ico':
          contentType = 'image/x-icon';
          break;
        case '.wasm':
          contentType = 'application/wasm';
          break;
        case '.dsk':
        case '.bin':
        case '.sna':
          contentType = 'application/octet-stream';
          break;
      }

      console.info('GET', request.url, fname, filePath, extname, contentType);

      fs.readFile(filePath, function (error, content) {
        if (error) {
          if (error.code == 'ENOENT') {
            respError(response);
          } else {
            response.writeHead(500);
            response.end('Error: ' + error.code + ' ..\n');
            response.end();
          }
        } else {
          response.writeHead(200, {
            'Content-Type': contentType
          });
          response.end(content, 'utf-8');
        }
      });

    }
  } catch (e) {
    console.error(e.stack);
  }
}).listen(8125);

console.log('Server running at http://127.0.0.1:8125/');
