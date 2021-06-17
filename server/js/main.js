var http = require('http');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;



// Renvoie une erreur (404)
var respError404 = function (response) {
  fs.readFile('./404.html', function (error, content) {
    response.writeHead(200, {
      'Content-Type': 'text/html'
    });
    response.end(content, 'utf-8');
  });
}

var respError = function (response,content) {
    response.writeHead(200, {
      'Content-Type': 'application/json'
    });
    response.end(content, 'utf-8');
}


http.createServer(function (request, response) {
  try {
    //    console.log('< ', request.url, request.method);

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

    // Requete POST??
    if (request.method == 'POST') {
      console.log('POST request', request.url);
      if (request.url.length == 0) {
        respError404(response);
        return;
      }

      // On sépare les params
      try {

        var p = request.url.split('?');
        var cmd = p[0];
        console.error(cmd);
        var pcmd = cmd.split('/');
        console.error(pcmd);
        var op = pcmd[1];

        if (op != 'build' && op != 'store') {
          console.error('Wrong post command', op);
          respError404(response);
          return;
        }

        var fname = pcmd[2];

        var params = [];
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

      var body = ''
      request.on('data', function (data) {
        body += data
      });

      request.on('end', function () {
        //console.log('Body: ' + body);

        var filePath = "rasm_output/" + fname; // en attendant de trouver le nom
        fs.writeFile(filePath, body, function (error) {
          if (error) {
            console.error('Write Error', error);
            respError(response,'Write Error');
            return;
          }

          // Si c'est uniquement du stockage, on s'arrete la
          if (op != 'build') {
            response.writeHead(200, {
              'Content-Type': 'application/json'
            });
            response.end(JSON.stringify({ status: 'ok' }), 'utf-8');
            return;
          }

          // Si on a une commande build

          // Appeler RASM avec le fichier passé en parametre
          // Renvoyer le résultat de RASM:
          // fichier bin, dsk ou sna, ou message d'erreur
          // TODO: On utilise -oa, mais on pourrait controler les noms
          // pour dispatcher dans différents répertoires
          var options = '-oa -eo'; // eo: si dsk, alors insere le fichier
          // Chaine renvoyée par Rasm. Surtout si le code d'erreur est !=0
          var resStr = "";
          var outputType = 'bin';
          var outputFile = '';
          var cmd = "../bin/rasm " + fname + " " + options;
          console.error('exec command', cmd);
          var child = exec(cmd, { cwd: "./rasm_output/" });
          child.stdout.on('data', function (data) {
            console.error('std:', data);
            resStr += data;

          });


          child.stderr.on('data', function (data) {
            console.error('err:', data);


            resStr += data;
          });

          child.on('close', function (code) {
            resArr = resStr.split('\n');
            regex = new RegExp(fname, 'g');
            let filtres = [];
            // On cherche a recuperer le nom du fichier généré
            // Avec des chaines comme:
            outputType = 'bin';
            typeStrings = [
              ['bin', 'Write binary file '],
              ['dsk', 'Write edsk file '],
              ['sna', 'Write snapshot v3 file '],
              ['sna', 'Write snapshot v2 file ']
            ]

            for (j = 0; j < resArr.length; j++) {
              pline = resArr[j];
              for (var i = 0; i < typeStrings.length; i++) {
                binstr = typeStrings[i][1];
                var i0 = pline.indexOf(binstr);

                if (i0 >= 0) {
                  outputType = typeStrings[i][0];
                  var subs = pline.substr(i0 + binstr.length);
                  // On récupere le nom de fichier qui commence en i0+binstr.lengh, et qui va jusqu'au prochain espace ou retour chariot
                  outputFile = subs.split(' ')[0];
                }
              }

              // Filtre la sortie (code ansi)
              let o = pline.replace(/.\[[0-9]+m/g, '');
              //  Remplace le nom du fichier
              o = o.replace(fname, "source");
              if (o.length>0)
                filtres.push(o);

            }

            var pckt = {
              status: code,
              output: outputFile,
              outputType: outputType,
              stdout: filtres,
              src: fname,
              date: Date.now()
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

    // Requete GET?
    if (request.method == 'GET') {
      var filePath = './index.html';
      // Empecher de remonter, request.url ne doit pas contenir de ".."
      // if (request.url.indexOf('..')>-1)
      // Cas spéciaux, pour récuperer des fichiers particulier (ico)
      // ou la liste des fichiers (*.asm...)
      var p = request.url.split('?');
      var fname = p[0]; //.substr(1);

      if (request.url.length > 1)
        filePath = './rasm_output' + fname;

      console.error(fname, filePath);

      var extname = path.extname(filePath);
      var contentType = 'text/html';
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
        case '.wasm':
          contentType = 'application/wasm';
          break;
        case '.dsk':
        case '.bin':
        case '.sna':
          contentType = 'application/octet-stream';
          break;
      }

      fs.readFile(filePath, function (error, content) {
        if (error) {
          if (error.code == 'ENOENT') {
            respError(response);
          } else {
            response.writeHead(500);
            response.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            response.end();
          }
        } else {
          response.writeHead(200, {
            'Content-Type': contentType
          });
          response.end(content, 'utf-8');
        }
      });

    } // GET

  } catch (e) {
    console.error(e.stack);
  }

}).listen(8125);

console.log('Server running at http://127.0.0.1:8125/');



/*
fs.readFile(filePath, function(error, content) {
  console.error('read',filepath, error);
  if (error) {
    if (error.code == 'ENOENT') {
      respError(response);
    } else {
      response.writeHead(500);
      response.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
      response.end();
    }
  } else {
    console.error('send data');
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream'
    });
    response.end(content, 'utf-8');
  }
});
*/
