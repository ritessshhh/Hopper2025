const HTTPS_PORT = process.env.PORT || 8443;

const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;

// Yes, TLS is required
const serverConfig = {
   key: fs.readFileSync('key.pem'),
   cert: fs.readFileSync('cert.pem'),
};

// All connected users
var users = {};
var allUsers = [];

// ----------------------------------------------------------------------------------------

const path = require('path');
// Create a server for the client HTML page
const handleRequest = function (request, response) {
   console.log('request received: ' + request.url);

   if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(fs.readFileSync('client/index.html'));
   } else if (request.url === '/webrtc.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript' });
      response.end(fs.readFileSync('client/webrtc.js'));
   } else if (request.url.startsWith('/images/')) {
      // Determine the file's extension to set the correct content-type
      let ext = path.extname(request.url);
      let contentType = 'image/png'; // default
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.gif') contentType = 'image/gif';
      
      // Adjust the path if your images are stored under a specific directory, e.g., 'client/images'
      let filePath = path.join('client', request.url);
      fs.readFile(filePath, function(err, data) {
         if (err) {
            response.writeHead(404);
            response.end('File not found');
         } else {
            response.writeHead(200, { 'Content-Type': contentType });
            response.end(data);
         }
      });
   }
};

const httpsServer = https.createServer(serverConfig, handleRequest);
httpsServer.listen(HTTPS_PORT, '0.0.0.0');

// ----------------------------------------------------------------------------------------

// Create a server for handling WebSocket calls
const wss = new WebSocketServer({ server: httpsServer });

wss.on('connection', function (ws) {
   ws.on('message', function (message) {

      var data;
      try {
         data = JSON.parse(message);
      } catch (e) {
         console.log("Invalid JSON");
         data = {};
      }

      console.log('received data:', data);

      switch (data.type) {
         // When a user tries to login
         case "login":
            console.log("User logged", data.name);

            if (users[data.name]) {
               sendTo(ws, {
                  type: "login",
                  success: false
               });
            } else {
               console.log('Saving user connection on the server');
               users[data.name] = ws;
               if (allUsers.indexOf(data.name) === -1) {
                  allUsers.push(data.name);
               }

               ws.name = data.name;

               sendTo(ws, {
                  type: "login",
                  success: true,
                  allUsers: allUsers
               });

               // Broadcast the updated user list to all connected clients
               broadcastUserList();
            }
            break;

         case "offer":
            console.log("Sending offer to: ", data.name);
            var conn = users[data.name];
            if (conn != null) {
               ws.otherName = data.name;
               sendTo(conn, {
                  type: "offer",
                  offer: data.offer,
                  name: ws.name
               });
            }
            break;

         case "answer":
            console.log("Sending answer to: ", data.name);
            var conn = users[data.name];
            if (conn != null) {
               ws.otherName = data.name;
               sendTo(conn, {
                  type: "answer",
                  answer: data.answer
               });
            }
            break;

         case "candidate":
            console.log("Sending candidate to:", data.name);
            var conn = users[data.name];
            if (conn != null) {
               sendTo(conn, {
                  type: "candidate",
                  candidate: data.candidate
               });
            }
            break;

         case "leave":
            console.log("Disconnecting from", data.name);
            var conn = users[data.name];
            if (conn) {
               conn.otherName = null;
               sendTo(conn, {
                  type: "leave"
               });
            }
            break;

         default:
            sendTo(ws, {
               type: "error",
               message: "Command not found: " + data.type
            });
            break;
      }
   });

   ws.on("close", function () {
      if (ws.name) {
         // Remove the user from the server records
         delete users[ws.name];
         // Remove the user from the user list
         allUsers = allUsers.filter(function (user) {
            return user !== ws.name;
         });
         // Broadcast updated user list
         broadcastUserList();

         if (ws.otherName) {
            console.log("Disconnecting from ", ws.otherName);
            var conn = users[ws.otherName];
            if (conn != null) {
               sendTo(conn, {
                  type: "leave"
               });
            }
         }
      }
   });
});

function sendTo(connection, message) {
   connection.send(JSON.stringify(message));
}

function broadcastUserList() {
   var updateMsg = {
      type: "updateUsers",
      allUsers: allUsers
   };
   for (var user in users) {
      sendTo(users[user], updateMsg);
   }
}

console.log('Server running. Visit https://localhost:' + HTTPS_PORT + ' in Firefox/Chrome.\n\n\
Some important notes:\n\
  * Note the HTTPS; there is no HTTP -> HTTPS redirect.\n\
  * You\'ll also need to accept the invalid TLS certificate.\n\
  * Some browsers or OSs may not allow the webcam to be used by multiple pages at once. You may need to use two different browsers or machines.\n'
);