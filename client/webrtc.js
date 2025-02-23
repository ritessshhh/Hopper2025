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

let shirtImg = new Image();
shirtImg.onload = () => {
  console.log("Shirt image loaded:", shirtImg.width, shirtImg.height);
};
shirtImg.onerror = (e) => {
  console.log("Failed to load shirt image", e);
};
shirtImg.src = "./images/redpolo.png"

// --- Helper functions for affine transform computation ---

// Invert a 3x3 matrix represented as an array of 9 numbers (row-major order)
function invert3x3(m) {
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (det === 0) return null;
  const invDet = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * invDet,
    (m[2] * m[7] - m[1] * m[8]) * invDet,
    (m[1] * m[5] - m[2] * m[4]) * invDet,
    (m[5] * m[6] - m[3] * m[8]) * invDet,
    (m[0] * m[8] - m[2] * m[6]) * invDet,
    (m[2] * m[3] - m[0] * m[5]) * invDet,
    (m[3] * m[7] - m[4] * m[6]) * invDet,
    (m[1] * m[6] - m[0] * m[7]) * invDet,
    (m[0] * m[4] - m[1] * m[3]) * invDet
  ];
}

// Multiply a 3x3 matrix (as array of 9 numbers) by a 3-element vector.
function multiplyMatrixVector(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
  ];
}

/**
 * Given three source points and three destination points (each as [x, y]),
 * compute the affine transform parameters [a, b, c, d, e, f] so that:
 *
 *   x' = a * x + c * y + e
 *   y' = b * x + d * y + f
 *
 * @param {Array} srcPts - Array of 3 points, each [x, y]
 * @param {Array} dstPts - Array of 3 points, each [x, y]
 * @returns {Array|null}  - Affine parameters [a, b, c, d, e, f] or null if not invertible.
 */
function computeAffineTransform(srcPts, dstPts) {
  // Build matrix X from source points:
  // Each row is [x, y, 1]
  const X = [
    srcPts[0][0], srcPts[0][1], 1,
    srcPts[1][0], srcPts[1][1], 1,
    srcPts[2][0], srcPts[2][1], 1
  ];
  const invX = invert3x3(X);
  if (!invX) return null;

  // For x-coordinates: solve for [a, c, e]
  const dx = [dstPts[0][0], dstPts[1][0], dstPts[2][0]];
  const solX = multiplyMatrixVector(invX, dx);

  // For y-coordinates: solve for [b, d, f]
  const dy = [dstPts[0][1], dstPts[1][1], dstPts[2][1]];
  const solY = multiplyMatrixVector(invX, dy);

  // Return the affine matrix parameters
  // Canvas transform expects: a, b, c, d, e, f where:
  // x' = a*x + c*y + e, y' = b*x + d*y + f.
  return [solX[0], solY[0], solX[1], solY[1], solX[2], solY[2]];
}


// ----------------- getUserMediaSuccess -----------------

function getUserMediaSuccess(stream) {
  localStream = stream;

  // Create a hidden video element for the raw stream.
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

  // Local video element to display the processed stream.
  var localVideo = document.getElementById("localVideo") || document.createElement("video");
  localVideo.autoplay = true;
  localVideo.playsinline = true;
  document.body.appendChild(localVideo);

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

    pose.onResults(function (results) {
      // Draw the raw frame.
      canvasCtx.clearRect(0, 0, processingCanvas.width, processingCanvas.height);
      canvasCtx.drawImage(results.image, 0, 0, processingCanvas.width, processingCanvas.height);

      // Optionally draw pose landmarks.
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

      // Only overlay the shirt if we have both landmarks and the shirt image.
      if (results.poseLandmarks && shirtImg.complete) {
        let frameW = processingCanvas.width;
        let frameH = processingCanvas.height;

        // In MediaPipe Pose JS, landmark indices:
        // Left Shoulder: 11, Right Shoulder: 12, Left Hip: 23.
        let lm = results.poseLandmarks;
        let ls = [lm[11].x * frameW, lm[11].y * frameH];
        let rs = [lm[12].x * frameW, lm[12].y * frameH];
        let lh = [lm[23].x * frameW, lm[23].y * frameH];

        // Define destination points from landmarks.
        let dstPts = [ls, rs, lh];

        // Define source points from the shirt image.
        // Adjust these multipliers as needed for your shirt.
        let shirtW = shirtImg.width;
        let shirtH = shirtImg.height;
        let srcPts = [
          [shirtW * 0.15, shirtH * 0.15],  // left shoulder on shirt image
          [shirtW * 0.85, shirtH * 0.15],  // right shoulder
          [shirtW * 0.25, shirtH * 0.85]   // left hip
        ];

        // Compute the affine transform.
        let t = computeAffineTransform(srcPts, dstPts);
        if (t) {
          // Save the current state.
          canvasCtx.save();
          // Set the transformation matrix.
          canvasCtx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
          // Draw the shirt image.
          canvasCtx.drawImage(shirtImg, 0, 0);
          // Restore the context.
          canvasCtx.restore();
        }
      }
    });

    // Use MediaPipe's Camera utility to process frames.
    const mpCamera = new Camera(rawVideo, {
      onFrame: async () => { await pose.send({ image: rawVideo }); },
      width: processingCanvas.width,
      height: processingCanvas.height
    });
    mpCamera.start();

    // Capture the processed canvas as a stream (30 FPS).
    var processedStream = processingCanvas.captureStream(30);
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

      // "Cheat": Assign the local processed stream to remote video, but flip it.
      remoteVideo.srcObject = localVideo.srcObject;
      remoteVideo.style.transform = "scaleX(-1)";
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