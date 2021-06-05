require("dotenv").config();

const fs = require("fs");

const LATENCY_PERIOD_MS = 2000;
let pingStartTime = null;

const httpsServer = require("https").createServer(
  {
    key: fs.readFileSync("certs/key.pem"),
    cert: fs.readFileSync("certs/cert.pem"),
  },
  (req, res) => {
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
);

const io = require("socket.io")(httpsServer);
if (process.env.REDIS_HOST) {
  const redis = require("socket.io-redis");
  io.adapter(redis({ host: process.env.REDIS_HOST, port: 6379 }));
}

function getRoomId(socket) {
  for (const roomId of socket.rooms)
    if (roomId != null && roomId != socket.id) return roomId;
}

io.on("connection", (socket) => {
  socket.on("note_on", (data) => {
    const roomId = getRoomId(socket);
    socket.to(roomId).emit("note_on", { ...data, username: socket.username });
  });

  socket.on("note_off", (data) => {
    const roomId = getRoomId(socket);
    socket.to(roomId).emit("note_off", { ...data, username: socket.username });
  });

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
});

setInterval(() => {
  pingStartTime = Date.now();
  io.emit("ping");
}, LATENCY_PERIOD_MS);

const port = process.argv[2];
httpsServer.listen(port, () => {
  console.log("Server started on port", port);
});
