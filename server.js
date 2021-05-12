const fs = require("fs");

const LATENCY_PERIOD_MS = 2000;
let pingStartTime = null;

const httpsServer = require("https").createServer(
	{
		key: fs.readFileSync("certs/private.key"),
		cert: fs.readFileSync("certs/certificate.crt"),
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

io.on("connection", (socket) => {
	console.log("User connected", socket.id);

	socket.on("note_on", (data) => {
		console.log("Received note on", data);
		socket.broadcast.emit("note_on", data);
	});

	socket.on("note_off", (data) => {
		console.log("Received note off", data);
		socket.broadcast.emit("note_off", data);
	});

	socket.on("disconnect", (reason) => {
		console.log("Client disconnected");
	});

	socket.on("pong", () => {
		const now = Date.now();
		const latency = now - pingStartTime;
		socket.emit("latency", latency);
	});
});

setInterval(() => {
	pingStartTime = Date.now();
	io.emit("ping");
}, LATENCY_PERIOD_MS);

httpsServer.listen(5000, () => {
	console.log("Server started");
});
