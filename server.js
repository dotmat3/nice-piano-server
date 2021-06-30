require("dotenv").config();
const fs = require("fs");
const http = require("http");
const https = require("https");
const socketio = require("socket.io");
const AWS = require("aws-sdk");

const LATENCY_PERIOD_MS = 2000;
let pingStartTime = null;

function handleRequest(req, res) {
  fs.readFile(__dirname + req.url, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end(JSON.stringify(err));
      return;
    }
    res.writeHead(200);
    res.end(data);
  });
}

const webServer = process.env.USE_HTTPS
  ? https.createServer(
      {
        key: fs.readFileSync("certs/key.pem"),
        cert: fs.readFileSync("certs/cert.pem"),
      },
      handleRequest
    )
  : http.createServer({}, handleRequest);

const io = socketio(webServer);
if (process.env.REDIS_HOST) {
  const redis = require("socket.io-redis");
  io.adapter(redis({ host: process.env.REDIS_HOST, port: 6379 }));
}

const db = new AWS.DynamoDB.DocumentClient({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },
});

function getRoomId(socket) {
  for (const roomId of socket.rooms)
    if (roomId != null && roomId != socket.id) return roomId;
}

io.on("connection", (socket) => {
  // Room events handling
  socket.on("disconnecting", () => {
    socket.roomLeft = getRoomId(socket);
  });

  socket.on("disconnect", (reason) => {
    io.to(socket.roomLeft).emit("userDisconnected", socket.username);
  });

  socket.on("pong", () => {
    const now = Date.now();
    const latency = now - pingStartTime;
    const roomId = getRoomId(socket);
    io.to(roomId).emit("latency", { username: socket.username, latency });
  });

  socket.on("joinRoom", (data) => {
    const { roomId, username } = data;
    socket.username = username;
    socket.join(roomId);

    io.to(roomId).emit("newUser", socket.username);
    const roomClients = io.of("/").adapter.rooms.get(roomId);
    for (const socketId of roomClients) {
      const socket = io.of("/").sockets.get(socketId);
      io.to(socket.id).emit("newUser", socket.username);
    }
  });

  // Piano handling
  socket.on("note_on", (data) => {
    const roomId = getRoomId(socket);
    socket.to(roomId).emit("note_on", { ...data, username: socket.username });
  });

  socket.on("note_off", (data) => {
    const roomId = getRoomId(socket);
    socket.to(roomId).emit("note_off", { ...data, username: socket.username });
  });

  // Database handling
  socket.on("getRecordings", async () => {
    if (!process.env.AWS_ACCESS_KEY_ID)
      return socket.emit("recordingsList", []);
    const username = socket.username;

    db.query(
      {
        TableName: process.env.DYNAMO_DB_TABLE,
        ExpressionAttributeValues: { ":u": username },
        KeyConditionExpression: "username = :u",
      },
      (err, data) => {
        if (data) socket.emit("recordingsList", data.Items);
        else socket.emit("recordingsList", []);
      }
    );
  });

  socket.on("saveRecording", (recording) => {
    if (!process.env.AWS_ACCESS_KEY_ID) return socket.emit("recordingSaved");

    const username = socket.username;
    db.put(
      {
        TableName: process.env.DYNAMO_DB_TABLE,
        Item: { ...recording, username },
      },
      (err) => {
        if (err) socket.emit("recordingSaveError", err.message);
        else socket.emit("recordingSaved");
      }
    );
  });

  socket.on("updateRecordingName", ({ name, recordingTime }) => {
    if (!process.env.AWS_ACCESS_KEY_ID) return socket.emit("recordingUpdated");

    const username = socket.username;
    db.update(
      {
        TableName: process.env.DYNAMO_DB_TABLE,
        Key: { username, recordingTime },
        UpdateExpression: "set #n = :n",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: {
          ":n": name,
        },
      },
      (err) => {
        if (err) socket.emit("recordingUpdateError", err.message);
        else socket.emit("recordingUpdated");
      }
    );
  });

  socket.on("deleteRecording", (recordingTime) => {
    if (!process.env.AWS_ACCESS_KEY_ID) return socket.emit("recordingDeleted");

    const username = socket.username;
    db.delete(
      {
        TableName: process.env.DYNAMO_DB_TABLE,
        Key: { username, recordingTime },
      },
      (err) => {
        if (err) socket.emit("recordingDeleteError", err.message);
        else socket.emit("recordingDeleted");
      }
    );
  });
});

setInterval(() => {
  pingStartTime = Date.now();
  io.of("/").sockets.forEach((socket) => socket.emit("ping"));
}, LATENCY_PERIOD_MS);

const port = process.argv[2];
webServer.listen(port, () => {
  console.log(
    (process.env.USE_HTTPS ? "HTTPS" : "HTTP") + " server started on port",
    port
  );
});
