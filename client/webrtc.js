// -------------------------------------------------------
// 1) Setup shirt selection data here (or hard-code in HTML)
// -------------------------------------------------------
const availableShirts = [
  { src: "./images/redpolo.png", label: "Red Polo" },
  { src: "./images/ABC.png", label: "Blue Polo" },
  { src: "./images/Christopher-Nolan.png", label: "Yellow T-shirt" },
  { src: "none", label: "None" }
];

// We'll track the currently selected shirt path (or "none")
let selectedShirtSrc = "none";

// Generate clickable shirt options in the grid:
window.addEventListener("DOMContentLoaded", () => {
  const shirtGrid = document.getElementById("shirtGrid");
  availableShirts.forEach((shirt) => {
    const div = document.createElement("div");
    div.className = "shirt-option";
    div.dataset.src = shirt.src;

    if (shirt.src === "none") {
      // "None" box
      div.textContent = "None";
    } else {
      // Show image + a small label
      const img = document.createElement("img");
      img.src = shirt.src;
      const lbl = document.createElement("div");
      lbl.style.fontSize = "12px";
      lbl.textContent = shirt.label;

      div.appendChild(img);
      div.appendChild(lbl);
    }

    div.addEventListener("click", () => {
      selectedShirtSrc = shirt.src;
      // Optional: highlight the selected div
      document.querySelectorAll(".shirt-option").forEach((el) => {
        el.style.borderColor = "transparent";
      });
      div.style.borderColor = "#007bff";
    });

    shirtGrid.appendChild(div);
  });
});

// -------------------------------------------------------
// 2) Signaling + WebRTC
// -------------------------------------------------------
var localVideo, localStream;
var remoteVideo;
var yourConn;
var serverConnection;
var name;
var connectedUser;

// ICE servers
var peerConnectionConfig = {
  iceServers: [
    { urls: "stun:stun.stunprotocol.org:3478" },
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

serverConnection = new WebSocket("wss://" + window.location.hostname + ":8443");
serverConnection.onopen = function () {
  console.log("Connected to the signaling server");
};
serverConnection.onmessage = gotMessageFromServer;
serverConnection.onerror = function (err) {
  console.log("Got error", err);
};

// Hide call interface until login
document.getElementById("otherElements").hidden = true;

var usernameInput = document.querySelector("#usernameInput");
var usernameShow = document.querySelector("#showLocalUserName");
var showAllUsers = document.querySelector("#allUsers");
var loginBtn = document.querySelector("#loginBtn");
var callToUsernameInput = document.querySelector("#callToUsernameInput");
var callBtn = document.querySelector("#callBtn");
var hangUpBtn = document.querySelector("#hangUpBtn");
var answerBtn = document.querySelector("#answerBtn");
var declineBtn = document.querySelector("#declineBtn");

// When the user clicks "Save" to log in
loginBtn.addEventListener("click", function () {
  name = usernameInput.value.trim();
  if (name.length > 0) {
    // Attempt to login via signaling
    send({ type: "login", name: name });
  }
});

// If login is successful on the server side
function handleLogin(success, allUsers) {
  if (!success) {
    alert("Oops...try a different username");
  } else {
    console.log("All available users", allUsers);
    updateUserList(allUsers);

    usernameShow.innerHTML = "Hello, " + name;

    // Switch UI
    document.getElementById("myName").hidden = true;
    document.getElementById("otherElements").hidden = false;

    // Setup local and remote video
    localVideo = document.getElementById("localVideo");
    remoteVideo = document.getElementById("remoteVideo");

    // Get camera + audio
    var constraints = { video: true, audio: true };
    if (navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia(constraints)
        .then(getUserMediaSuccess)
        .catch(errorHandler);
    } else {
      alert("Your browser does not support getUserMedia API");
    }
  }
}

// Render the user list in the side panel
function updateUserList(users) {
  showAllUsers.innerHTML = "";
  users.forEach(function (user) {
    var li = document.createElement("li");
    li.textContent = user;
    showAllUsers.appendChild(li);
  });
}

// ---------------------------------------
// 3) Pose & Affine transform logic
// ---------------------------------------
// We reuse one Image() object for the chosen shirt
let shirtImg = new Image();

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
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */
function computeAffineTransform(srcPts, dstPts) {
  // Build matrix X from source points: each row is [x, y, 1]
  const X = [
    srcPts[0][0], srcPts[0][1], 1,
    srcPts[1][0], srcPts[1][1], 1,
    srcPts[2][0], srcPts[2][1], 1
  ];
  const invX = invert3x3(X);
  if (!invX) return null;

  // Solve for x-coordinates => [a, c, e]
  const dx = [dstPts[0][0], dstPts[1][0], dstPts[2][0]];
  const solX = multiplyMatrixVector(invX, dx);

  // Solve for y-coordinates => [b, d, f]
  const dy = [dstPts[0][1], dstPts[1][1], dstPts[2][1]];
  const solY = multiplyMatrixVector(invX, dy);

  // Return [a, b, c, d, e, f] for canvas transform
  return [solX[0], solY[0], solX[1], solY[1], solX[2], solY[2]];
}

// ---------------------------------------
// 4) getUserMediaSuccess
// ---------------------------------------
function getUserMediaSuccess(stream) {
  localStream = stream;

  // Create a hidden video element for the raw stream
  var rawVideo = document.createElement("video");
  rawVideo.setAttribute("playsinline", "");
  rawVideo.muted = true;
  rawVideo.srcObject = stream;
  rawVideo.style.display = "none";
  document.body.appendChild(rawVideo);
  rawVideo.play();

  // Create a canvas to process the raw stream
  var processingCanvas = document.createElement("canvas");
  var canvasCtx = processingCanvas.getContext("2d");

  // Local video element to display the processed stream
  var localVideo = document.getElementById("localVideo");
  localVideo.autoplay = true;
  localVideo.playsinline = true;

  rawVideo.onloadedmetadata = function () {
    processingCanvas.width = rawVideo.videoWidth;
    processingCanvas.height = rawVideo.videoHeight;

    // Initialize MediaPipe Pose
    const pose = new Pose({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    // Listen for results
    pose.onResults(function (results) {
      // 1) Draw the raw camera frame
      canvasCtx.clearRect(0, 0, processingCanvas.width, processingCanvas.height);
      canvasCtx.drawImage(results.image, 0, 0, processingCanvas.width, processingCanvas.height);

      // 2) Optionally draw pose landmarks
      if (results.poseLandmarks) {
        // drawConnectors(canvasCtx, results.poseLandmarks, Pose.POSE_CONNECTIONS, {
        //   color: "#00FF00",
        //   lineWidth: 4
        // });
        // drawLandmarks(canvasCtx, results.poseLandmarks, {
        //   color: "#FF0000",
        //   lineWidth: 2
        // });
      }

      // 3) Overlay the selected shirt if user did NOT choose "None"
      if (results.poseLandmarks && selectedShirtSrc !== "none") {
        // If the shirt image is not yet set to the newly-selected path, do so now
        if (shirtImg.src !== selectedShirtSrc) {
          shirtImg.src = selectedShirtSrc;
        }

        // Make sure the shirt is actually loaded before drawing
        if (shirtImg.complete) {
          let frameW = processingCanvas.width;
          let frameH = processingCanvas.height;

          // Landmark indices: left shoulder (11), right shoulder (12), left hip (23)
          let lm = results.poseLandmarks;
          let ls = [lm[11].x * frameW, lm[11].y * frameH];
          let rs = [lm[12].x * frameW, lm[12].y * frameH];
          let lh = [lm[23].x * frameW, lm[23].y * frameH];

          let dstPts = [ls, rs, lh];

          // Source points from the shirt image (tweak as needed)
          let w = shirtImg.width;
          let h = shirtImg.height;
          let srcPts = [
            [w * 0.15, h * 0.15], // approximate left shoulder
            [w * 0.85, h * 0.15], // approximate right shoulder
            [w * 0.25, h * 0.85]  // approximate left hip
          ];

          let t = computeAffineTransform(srcPts, dstPts);
          if (t) {
            canvasCtx.save();
            canvasCtx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
            canvasCtx.drawImage(shirtImg, 0, 0);
            canvasCtx.restore();
          }
        }
      }
    });

    // Use MediaPipe's Camera utility to process frames
    const mpCamera = new Camera(rawVideo, {
      onFrame: async () => {
        await pose.send({ image: rawVideo });
      },
      width: processingCanvas.width,
      height: processingCanvas.height
    });
    mpCamera.start();

    // Capture the processed canvas as a new stream (30 FPS)
    var processedStream = processingCanvas.captureStream(30);
    localVideo.srcObject = processedStream;
    localVideo.play();

    // Set up WebRTC
    yourConn = new RTCPeerConnection(peerConnectionConfig);
    yourConn.onicecandidate = function (event) {
      if (event.candidate) {
        send({ type: "candidate", candidate: event.candidate });
      }
    };
    yourConn.ontrack = gotRemoteStream;

    // Add the processed (overlaid) video track + original mic track
    // If you want the original audio track from 'stream':
    const videoTrack = processedStream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      // Make a new stream with processed video + original audio
      const combinedStream = new MediaStream([videoTrack, audioTrack]);
      yourConn.addStream(combinedStream);
    } else {
      // Fallback if no audio track
      yourConn.addStream(processedStream);
    }
  };
}

// -------------------------------------------------------
// 5) Call / Answer events
// -------------------------------------------------------
callBtn.addEventListener("click", function () {
  var callToUsername = callToUsernameInput.value.trim();
  if (callToUsername.length > 0) {
    connectedUser = callToUsername;
    yourConn.createOffer().then(
      (offer) => {
        yourConn.setLocalDescription(offer);
        send({ type: "offer", offer: offer });
      },
      (error) => {
        alert("Error when creating an offer: " + error);
      }
    );
    document.getElementById("callOngoing").style.display = "block";
    document.getElementById("callInitiator").style.display = "none";
  } else {
    alert("Username can't be blank!");
  }
});

answerBtn.addEventListener("click", function () {
  document.getElementById("callReceiver").style.display = "none";
  document.getElementById("callOngoing").style.display = "block";
});

declineBtn.addEventListener("click", function () {
  document.getElementById("callInitiator").style.display = "block";
  document.getElementById("callReceiver").style.display = "none";
});

hangUpBtn.addEventListener("click", function () {
  send({ type: "leave" });
  handleLeave();
  document.getElementById("callOngoing").style.display = "none";
  document.getElementById("callInitiator").style.display = "block";
});

// -------------------------------------------------------
// 6) WebSocket message handling
// -------------------------------------------------------
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
}

function send(msg) {
  if (connectedUser) {
    msg.name = connectedUser;
  }
  serverConnection.send(JSON.stringify(msg));
}

function handleOffer(offer, name) {
  connectedUser = name;
  yourConn.setRemoteDescription(new RTCSessionDescription(offer));
  document.getElementById("callInitiator").style.display = "none";
  document.getElementById("callReceiver").style.display = "block";

  answerBtn.onclick = function () {
    yourConn.createAnswer().then(
      (answer) => {
        yourConn.setLocalDescription(answer);
        send({ type: "answer", answer: answer });
      },
      (error) => {
        alert("Error when creating an answer");
      }
    );

    document.getElementById("callReceiver").style.display = "none";
    document.getElementById("callOngoing").style.display = "block";
  };
}

function handleAnswer(answer) {
  yourConn.setRemoteDescription(new RTCSessionDescription(answer));
}

function handleCandidate(candidate) {
  yourConn.addIceCandidate(new RTCIceCandidate(candidate));
}

function handleLeave() {
  connectedUser = null;
  remoteVideo.srcObject = null;
  yourConn.close();
  yourConn.onicecandidate = null;
  yourConn.onaddstream = null;
}

// General error handler
function errorHandler(error) {
  console.log(error);
}