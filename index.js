import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import Pocketbase from "pocketbase";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const pb = new Pocketbase(process.env.PB_URI);
const server = http.createServer(app);
const io = new Server(server, {
  cors: true,
});

app.use(cors());

let connections = 0;
const rooms = {};
const takenPlayers = {};
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
const turn = {};
/* Turn Example
{
  "room1": 0,
}
*/
io.on("connection", (socket) => {
  console.log("A user connected");
  connections++;

  // Sign in as User
  socket.on("signIn", (username) => {
    console.log(`User signed in: ${username}`);
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

    // Enter the user's room
    socket.join(roomId);
    socket.roomId = roomId;
    console.log(`${socket.username} joined room: ${roomId}`);

    // Check if the room already existed, else make it a new array
    if (!rooms[roomId]) {
      rooms[roomId] = [
        {
          username: socket.username,
          id: socket.id,
          team: [],
          connected: true,
          admin: false,
        },
      ];
      // Add create new TakenPlayers array
      takenPlayers[roomId] = [];
      turn[roomId] = 0;
    } else {
      // Check if user is already in the room
      if (rooms[roomId].find((user) => user.username === socket.username)) {
        console.log("User already in room");
        rooms[roomId].forEach((user) => {
          if (user.username === socket.username) {
            user.connected = true;
            user.id = socket.id;
          }
        });
        socket.emit("reconnect", [socket.username, socket.id]);
      } else {
        // Add user to the room
        rooms[roomId].push({
          username: socket.username,
          id: socket.id,
          team: [],
          connected: true,
          admin: false,
        });
      }
    }
    console.log(rooms[roomId]);
    // Tell the user everyone in the room!
    socket.emit("connected", rooms[roomId]);
    // Broadcast to the room that a new user has joined
    socket.to(roomId).emit("userJoined", [socket.username, socket.id]);
  });

  // Handle user disconnect
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.username}`);
    // Verify the room exists (for debugging);
    if (!rooms[socket.roomId]) {
      console.log("Room does not exist");
      return;
    }
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

  // Handle Starting the draft
  socket.on("startDraft", () => {
    // Verify the status of the draft
    pb.collection("fantasyLeagues")
      .getOne(socket.roomId)
      .then((league) => {
        if (league.status === "drafting") {
          // Set the user as an admin
          rooms[socket.roomId].forEach((user) => {
            if (user.id === socket.id) {
              user.admin = true;
            }
          });
          // Broadcast to the room that the draft has started
          io.to(socket.roomId).emit("draftStarted");
          // Set the turn to the first user
          turn[socket.roomId] = 0;
          io.to(socket.roomId).emit(
            "currentTurn",
            rooms[socket.roomId][0].username
          );
        } else {
          console.log("Draft is not set");
        }
      });
  });

  // Handle Picking a player
  socket.on("pickPlayer", (player) => {
    // Verify the player is still available
    if (takenPlayers[socket.roomId].includes(player)) {
      console.log("Player is already taken");
      return;
    }
    // Check if it's the user's turn based on the websocket
    if (rooms[socket.roomId][turn[socket.roomId]].id !== socket.id) {
      console.log("Not your turn");
      return;
    }
    // Add the player to the user's team
    rooms[socket.roomId][turn[socket.roomId]].team.push(player);
    // Add the player to the takenPlayers array
    takenPlayers[socket.roomId].push(player);
    // Broadcast to the room that the player has been picked
    io.to(socket.roomId).emit("playerPicked", player);
    // Increment the turn
    turn[socket.roomId]++;
    if (turn[socket.roomId] >= rooms[socket.roomId].length) {
      turn[socket.roomId] = 0;
    }
    // Broadcast to the room the current turn
    io.to(socket.roomId).emit(
      "currentTurn",
      rooms[socket.roomId][turn[socket.roomId]].username
    );
  });
});

// Connect to the Database Instance and Start up
pb.admins
  .authWithPassword(process.env.PB_USERNAME, process.env.PB_PASSWORD)
  .then(() => {
    console.log("Connected to Pocketbase!");
    server.listen(process.env.PORT, () => {
      console.log(`WebSocket server listening on *: ${process.env.PORT}`);
    });
  })
  .catch(() => {
    console.log("Failed to connecto to Pocketbase :(");
  });
