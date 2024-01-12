import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: true,
});

app.use(cors());

let connections = 0;
const users = [];
const rooms = {};
/* Rooms Example
{
  "room1": [{
    name: "User1",
    id: "socketId1"
    team: [],
    connected: true
  }],
}
*/
io.on("connection", (socket) => {
  console.log("A user connected");
  connections++;

  // Sign in as User
  socket.on("signIn", (username) => {
    console.log(`User signed in: ${username}`);
    users.push(username);
    socket.username = username;
    socket.emit("signedIn", username);
  });

  // Join a room
  socket.on("joinRoom", (roomId) => {
    // Verify user has logged in
    if (!socket.username) {
      console.log("User has not logged in");
      socket.emit("notSignedIn");
      return;
    }
    socket.join(roomId);
    socket.roomId = roomId;
    console.log(`${socket.username} joined room: ${roomId}`);

    // Check if the room already existed, else make it a new array
    if (!rooms[roomId]) {
      rooms[roomId] = [socket.username];
    } else {
      // Check if user is already in the room
      if (rooms[roomId].find((user) => user.username === socket.username)) {
        console.log("User already in room");
        socket.emit("reconnect", socket.id);
        return;
      } else {
        // Add user to the room
        rooms[roomId].push({
          username: socket.username,
          id: socket.id,
          team: [],
          connected: true,
        });
      }
    }
    // Tell the user everyone in the room!
    socket.emit("connected", rooms[roomId]);
    // Broadcast to the room that a new user has joined
    socket.to(roomId).emit("userJoined", [socket.username, socket.id]);
  });

  // Handle a message sent to the room
  socket.on("sendMessage", (roomId, message) => {
    // Broadcast the message to the room
    io.to(roomId).emit("receiveMessage", message);
  });

  // Handle user disconnect
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.username}`);
    io.to(socket.roomId).emit("userLeft", socket.username);
    // Set the user's connected status to false
    rooms[socket.roomId].forEach((user) => {
      if (user.id === socket.id) {
        user.connected = false;
      }
    });
    connections--;
    // You can also handle leaving the room if needed
  });
});

server.listen(3001, () => {
  console.log("WebSocket server listening on *:3001");
});
