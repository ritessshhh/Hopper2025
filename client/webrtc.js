var localVideo;
var localStream;
var remoteVideo;
var yourConn;
var uuid;
var serverConnection;
var connectionState;

var name;
var connectedUser;

var peerConnectionConfig = {
  'iceServers': [
    { 'urls': 'stun:stun.stunprotocol.org:3478' },
    { 'urls': 'stun:stun.l.google.com:19302' },
  ]
};

// Connect to the signaling server
serverConnection = new WebSocket('wss://' + window.location.hostname + ':8443');

serverConnection.onopen = function () {
  console.log("Connected to the signaling server");
};

serverConnection.onmessage = gotMessageFromServer;

// Hide call interface until login
document.getElementById('otherElements').hidden = true;

var usernameInput = document.querySelector('#usernameInput');
var usernameShow = document.querySelector('#showLocalUserName');
var showAllUsers = document.querySelector('#allUsers');
var remoteUsernameShow = document.querySelector('#showRemoteUserName'); // (Unused but declared)
var loginBtn = document.querySelector('#loginBtn');
var callToUsernameInput = document.querySelector('#callToUsernameInput');
var callBtn = document.querySelector('#callBtn');
var hangUpBtn = document.querySelector('#hangUpBtn');
var answerBtn = document.querySelector('#answerBtn');
var declineBtn = document.querySelector('#declineBtn');

// Login when the user clicks the button 
loginBtn.addEventListener("click", function (event) {
  name = usernameInput.value;
  usernameShow.innerHTML = "Hello, " + name;
  if (name.length > 0) {
    send({
      type: "login",
      name: name
    });
  }
});

function updateUserList(users) {
  showAllUsers.innerHTML = "";
  users.forEach(function (user) {
    var li = document.createElement("li");
    li.textContent = user;
    showAllUsers.appendChild(li);
  });
}



function handleLogin(success, allUsers) {
  if (success === false) {
    alert("Ooops...try a different username");
  } else {
    console.log('All available users', allUsers);
    updateUserList(allUsers); // Update the list as <li> elements

    localVideo = document.getElementById('localVideo');
    remoteVideo = document.getElementById('remoteVideo');
    document.getElementById('myName').hidden = true;
    document.getElementById('otherElements').hidden = false;

    var constraints = {
      video: true,
      audio: true
    };

    if (navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia(constraints)
        .then(getUserMediaSuccess)
        .catch(errorHandler);
    } else {
      alert('Your browser does not support getUserMedia API');
    }
  }
}


function getUserMediaSuccess(stream) {
  localStream = stream;
  localVideo.srcObject = stream;
  yourConn = new RTCPeerConnection(peerConnectionConfig);

  connectionState = yourConn.connectionState;
  console.log('connection state inside getUserMedia', connectionState);

  yourConn.onicecandidate = function (event) {
    console.log('onicecandidate event', event.candidate);
    if (event.candidate) {
      send({
        type: "candidate",
        candidate: event.candidate
      });
    }
  };

  yourConn.ontrack = gotRemoteStream;
  yourConn.addStream(localStream);
}

callBtn.addEventListener("click", function () {
  console.log('Call button clicked');
  var callToUsername = document.getElementById('callToUsernameInput').value;

  if (callToUsername.length > 0) {
    connectedUser = callToUsername;
    console.log('Calling', connectedUser);
    console.log('Creating offer to', connectedUser);

    console.log('Connection state before call:', yourConn.connectionState);
    console.log('Signaling state before call:', yourConn.signalingState);

    yourConn.createOffer(function (offer) {
      send({
        type: "offer",
        offer: offer
      });
      yourConn.setLocalDescription(offer);
    }, function (error) {
      alert("Error when creating an offer: " + error);
      console.log("Error when creating an offer", error);
    });
    document.getElementById('callOngoing').style.display = 'block';
    document.getElementById('callInitiator').style.display = 'none';

  } else {
    alert("Username can't be blank!");
  }
});

function gotMessageFromServer(message) {
  console.log("Got message", message.data);
  var data = JSON.parse(message.data);

  switch (data.type) {
    case "login":
      handleLogin(data.success, data.allUsers);
      break;
    case "updateUsers":
      // When the server sends an updated list, refresh the user list on this client
      updateUserList(data.allUsers);
      break;
    case "offer":
      console.log('Received offer');
      handleOffer(data.offer, data.name);
      break;
    case "answer":
      console.log('Received answer');
      handleAnswer(data.answer);
      break;
    case "candidate":
      console.log('Received candidate');
      handleCandidate(data.candidate);
      break;
    case "leave":
      handleLeave();
      break;
    default:
      break;
  }

  serverConnection.onerror = function (err) {
    console.log("Got error", err);
  };
}


function send(msg) {
  if (connectedUser) {
    msg.name = connectedUser;
  }
  console.log('Sending message:', msg);
  serverConnection.send(JSON.stringify(msg));
}

function handleOffer(offer, name) {
  document.getElementById('callInitiator').style.display = 'none';
  document.getElementById('callReceiver').style.display = 'block';

  answerBtn.addEventListener("click", function () {
    connectedUser = name;
    yourConn.setRemoteDescription(new RTCSessionDescription(offer));

    yourConn.createAnswer(function (answer) {
      yourConn.setLocalDescription(answer);
      send({
        type: "answer",
        answer: answer
      });
    }, function (error) {
      alert("Error when creating an answer");
    });
    document.getElementById('callReceiver').style.display = 'none';
    document.getElementById('callOngoing').style.display = 'block';
  });

  declineBtn.addEventListener("click", function () {
    document.getElementById('callInitiator').style.display = 'block';
    document.getElementById('callReceiver').style.display = 'none';
  });
}

function gotRemoteStream(event) {
  console.log('Got remote stream');
  remoteVideo.srcObject = event.streams[0];
}

function errorHandler(error) {
  console.log(error);
}

function handleAnswer(answer) {
  console.log('Received answer: ', answer);
  yourConn.setRemoteDescription(new RTCSessionDescription(answer));
}

function handleCandidate(candidate) {
  yourConn.addIceCandidate(new RTCIceCandidate(candidate));
}

hangUpBtn.addEventListener("click", function () {
  send({
    type: "leave"
  });
  handleLeave();
  document.getElementById('callOngoing').style.display = 'none';
  document.getElementById('callInitiator').style.display = 'block';
});

function handleLeave() {
  connectedUser = null;
  remoteVideo.srcObject = null;
  console.log('Connection state before leaving:', yourConn.connectionState);
  console.log('Signaling state before leaving:', yourConn.signalingState);
  yourConn.close();
  yourConn.onicecandidate = null;
  yourConn.onaddstream = null;
  console.log('Call ended');
}