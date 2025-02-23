var localVideo, localStream;
var remoteVideo;
var yourConn;
var serverConnection;
var connectionState;

var name;
var connectedUser;

var peerConnectionConfig = {
  'iceServers': [
    { 'urls': 'stun:stun.stunprotocol.org:3478' },
    { 'urls': 'stun:stun.l.google.com:19302' }
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
var loginBtn = document.querySelector('#loginBtn');
var callToUsernameInput = document.querySelector('#callToUsernameInput');
var callBtn = document.querySelector('#callBtn');
var hangUpBtn = document.querySelector('#hangUpBtn');
var answerBtn = document.querySelector('#answerBtn');
var declineBtn = document.querySelector('#declineBtn');

// Login when the user clicks the button 
loginBtn.addEventListener("click", function () {
  name = usernameInput.value;
  usernameShow.innerHTML = "Hello, " + name;
  if (name.length > 0) {
    send({ type: "login", name: name });
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
  if (!success) {
    alert("Ooops...try a different username");
  } else {
    console.log('All available users', allUsers);
    updateUserList(allUsers);

    // Use the existing video elements.
    localVideo = document.getElementById('localVideo');
    remoteVideo = document.getElementById('remoteVideo');
    document.getElementById('myName').hidden = true;
    document.getElementById('otherElements').hidden = false;

    var constraints = { video: true, audio: true };
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
  // Save the raw camera stream.
  localStream = stream;

  // Create a hidden video element to play the raw stream.
  var rawVideo = document.createElement('video');
  rawVideo.setAttribute('playsinline', '');
  rawVideo.muted = true;
  rawVideo.srcObject = stream;
  rawVideo.style.display = 'none';
  document.body.appendChild(rawVideo);
  rawVideo.play();

  // Create a canvas to process the raw stream.
  var processingCanvas = document.createElement('canvas');
  var canvasCtx = processingCanvas.getContext('2d');

  // When rawVideo metadata is ready, set canvas size and start processing.
  rawVideo.onloadedmetadata = function () {
    processingCanvas.width = rawVideo.videoWidth;
    processingCanvas.height = rawVideo.videoHeight;

    // Initialize MediaPipe Pose.
    const pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    // Process each frame: clear canvas, draw raw image, then overlay landmarks.
    pose.onResults(function (results) {
      canvasCtx.clearRect(0, 0, processingCanvas.width, processingCanvas.height);
      canvasCtx.drawImage(results.image, 0, 0, processingCanvas.width, processingCanvas.height);
      if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, Pose.POSE_CONNECTIONS, {
          color: '#00FF00',
          lineWidth: 4
        });
        drawLandmarks(canvasCtx, results.poseLandmarks, {
          color: '#FF0000',
          lineWidth: 2
        });
      }
    });

    // Use MediaPipe's Camera utility to continuously process frames.
    const mpCamera = new Camera(rawVideo, {
      onFrame: async () => { await pose.send({ image: rawVideo }); },
      width: processingCanvas.width,
      height: processingCanvas.height
    });
    mpCamera.start();

    // Capture a new stream from the processing canvas (this stream shows the landmarks).
    var processedStream = processingCanvas.captureStream(30); // 30 FPS

    // Use the processed stream for local display.
    localVideo.srcObject = processedStream;
    localVideo.play();

    // Set up the WebRTC connection to broadcast the processed stream.
    yourConn = new RTCPeerConnection(peerConnectionConfig);
    console.log('connection state inside getUserMedia', yourConn.connectionState);
    yourConn.onicecandidate = function (event) {
      if (event.candidate) {
        send({ type: "candidate", candidate: event.candidate });
      }
    };
    yourConn.ontrack = gotRemoteStream;
    yourConn.addStream(processedStream);
  };
}

callBtn.addEventListener("click", function () {
  var callToUsername = document.getElementById('callToUsernameInput').value;
  if (callToUsername.length > 0) {
    connectedUser = callToUsername;
    yourConn.createOffer(function (offer) {
      send({ type: "offer", offer: offer });
      yourConn.setLocalDescription(offer);
    }, function (error) {
      alert("Error when creating an offer: " + error);
    });
    document.getElementById('callOngoing').style.display = 'block';
    document.getElementById('callInitiator').style.display = 'none';
  } else {
    alert("Username can't be blank!");
  }
});

function gotMessageFromServer(message) {
  var data = JSON.parse(message.data);
  switch (data.type) {
    case "login":
      handleLogin(data.success, data.allUsers);
      break;
    case "updateUsers":
      updateUserList(data.allUsers);
      break;
    case "offer":
      handleOffer(data.offer, data.name);
      break;
    case "answer":
      handleAnswer(data.answer);
      break;
    case "candidate":
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
  if (connectedUser) { msg.name = connectedUser; }
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
      send({ type: "answer", answer: answer });
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
  remoteVideo.srcObject = event.streams[0];
}

function errorHandler(error) {
  console.log(error);
}

function handleAnswer(answer) {
  yourConn.setRemoteDescription(new RTCSessionDescription(answer));
}

function handleCandidate(candidate) {
  yourConn.addIceCandidate(new RTCIceCandidate(candidate));
}

hangUpBtn.addEventListener("click", function () {
  send({ type: "leave" });
  handleLeave();
  document.getElementById('callOngoing').style.display = 'none';
  document.getElementById('callInitiator').style.display = 'block';
});

function handleLeave() {
  connectedUser = null;
  remoteVideo.srcObject = null;
  yourConn.close();
  yourConn.onicecandidate = null;
  yourConn.onaddstream = null;
}