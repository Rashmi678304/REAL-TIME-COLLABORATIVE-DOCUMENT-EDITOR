const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const ACTIONS = require("./Actions");

dotenv.config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Mongoose Schema
const CodeSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  code: { type: String, default: "" },
});

const Code = mongoose.model("Code", CodeSchema);

// Download endpoint
app.get("/download/:roomId", async (req, res) => {
  const { roomId } = req.params;
  try {
    const roomData = await Code.findOne({ roomId });
    if (roomData) {
      res.setHeader("Content-Disposition", "attachment; filename=text.txt");
      res.setHeader("Content-Type", "text/plain");
      res.send(roomData.code);
    } else {
      res.status(404).send("Room not found");
    }
  } catch (err) {
    console.error("Error fetching code:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST"],
  },
});

const userSocketMap = {};

const getAllConnectedClients = (roomId) => {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => ({
      socketId,
      username: userSocketMap[socketId],
    })
  );
};

io.on("connection", (socket) => {
  socket.on(ACTIONS.JOIN, async ({ roomId, username }) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);

    try {
      const existingRoom = await Code.findOne({ roomId });
      if (!existingRoom) {
        await Code.create({ roomId, code: "" });
      }

      const roomData = await Code.findOne({ roomId });
      const code = roomData?.code || "";

      socket.emit(ACTIONS.CODE_CHANGE, { code });

      const clients = getAllConnectedClients(roomId);
      clients.forEach(({ socketId }) => {
        io.to(socketId).emit(ACTIONS.JOINED, {
          clients,
          username,
          socketId: socket.id,
        });
      });
    } catch (err) {
      console.error("Error retrieving room data:", err);
    }
  });

  socket.on(ACTIONS.CODE_CHANGE, async ({ roomId, code }) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });

    try {
      await Code.findOneAndUpdate(
        { roomId },
        { code },
        { upsert: true, new: true }
      );
    } catch (err) {
      console.error("Error saving code:", err);
    }
  });

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    rooms.forEach((roomId) => {
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });

    delete userSocketMap[socket.id];
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
