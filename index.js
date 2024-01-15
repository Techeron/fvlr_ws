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
/* Rooms Example
{
  "room1": [{
    name: "User1",
    teamname: "Team1",
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
  socket.on("signIn", (params) => {
    console.log(`User signed in: ${params[0]} - ${params}`);
    socket.username = params[0];
    socket.teamname = params[1];
    socket.emit("signedIn", params);
  });

  // Turns
  socket.on("getTurn", () => {
    if (!rooms[socket.roomId]) {
      console.log("Room does not exist");
      return;
    }
    socket.emit(
      "currentTurn",
      // Current Room      Team Object of current turn      username
      rooms[socket.roomId].teams[rooms[socket.roomId].turn].username
    );
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
      rooms[roomId] = {
        turn: 0,
        takenPlayers: [],
        teams: [
          {
            username: socket.username,
            teamname: socket.teamname,
            id: socket.id,
            team: [],
            connected: true,
            admin: false,
          },
        ],
      };
    }
    const user = rooms[roomId].teams.find(
      (user) => user.username === socket.username
    );
    if (user) {
      console.log("User already in room");
      user.connected = true;
      user.id = socket.id;
      socket.emit("reconnect", [socket.username, socket.id]);
    } else {
      // Add user to the room
      rooms[roomId].teams.push({
        username: socket.username,
        teamname: socket.teamname,
        id: socket.id,
        team: [],
        connected: true,
        admin: false,
      });
    }
    console.log(rooms[roomId]);
    // Tell the user everyone in the room!
    socket.emit("connected", rooms[roomId]);
    // Broadcast to the room that a new user has joined
    socket
      .to(roomId)
      .emit("userJoined", [socket.username, socket.teamname, socket.id]);
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
    rooms[socket.roomId].teams.forEach((user) => {
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
          rooms[socket.roomId].teams.forEach((user) => {
            if (user.id === socket.id) {
              user.admin = true;
            }
          });
          // Broadcast to the room that the draft has started
          io.to(socket.roomId).emit("draftStarted");
          // Set the turn to the first user
          rooms[socket.roomId].turn = 0;
          io.to(socket.roomId).emit(
            "currentTurn",
            rooms[socket.roomId].teams[0].username
          );
        } else {
          console.log("Draft is not set");
        }
      });
  });

  // Handle Player Removal
  socket.on("removePlayer", (pid) => {
    // Get the user from the socket.id
    const user = rooms[socket.roomId].teams.find(
      (user) => user.id === socket.id
    );
    // Remove the player from their team
    user.team = user.team.filter((p) => p !== pid);
    // Remove the player from the takenPlayers array
    rooms[socket.roomId].takenPlayers = rooms[
      socket.roomId
    ].takenPlayers.filter((p) => p !== pid);
    // Broadcast to the room that the player has been removed
    io.to(socket.roomId).emit("playerRemoved", {
      id: socket.id,
      pid,
    });
  });

  // Handle Picking a player
  socket.on("pickPlayer", (player) => {
    // Verify the player is still available
    console.log(rooms[socket.roomId].takenPlayers);
    if (rooms[socket.roomId].takenPlayers.includes(player)) {
      console.log("Player is already taken");
      return;
    }
    // Check if it's the user's turn based on the websocket
    else if (
      rooms[socket.roomId].teams[rooms[socket.roomId].turn].id !== socket.id
    ) {
      console.log("Not your turn");
      return;
    }

    // Conditions below here trigger a turn change

    // Check if user has already picked 5 players
    else if (
      rooms[socket.roomId].teams[rooms[socket.roomId].turn].team.length >= 5
    ) {
      console.log("You already have 5 players");
    }

    // Add the player to the user's team
    else {
      rooms[socket.roomId].teams[rooms[socket.roomId].turn].team.push(player);
      // Add the player to the takenPlayers array
      rooms[socket.roomId].takenPlayers.push(player);
      // Broadcast to the room that the player has been picked
      io.to(socket.roomId).emit("playerPicked", player);
    }

    const StartingTurn = Number(rooms[socket.roomId].turn);

    // Increment the turn
    rooms[socket.roomId].turn++;
    if (rooms[socket.roomId].turn >= rooms[socket.roomId].teams.length) {
      rooms[socket.roomId].turn = 0;
    }
    // If the next team has 5 players, itterate through
    while (
      rooms[socket.roomId].teams[rooms[socket.roomId].turn].team.length >= 5
    ) {
      rooms[socket.roomId].turn++;
      if (rooms[socket.roomId].turn >= rooms[socket.roomId].teams.length) {
        rooms[socket.roomId].turn = 0;
      }
      // If the turn has gone all the way around, break
      if (rooms[socket.roomId].turn === StartingTurn) {
        break;
      }
    }

    // Broadcast to the room if draft is over
    if (
      rooms[socket.roomId].turn === StartingTurn &&
      rooms[socket.roomId].teams[StartingTurn].team.length >= 5
    ) {
      console.log(StartingTurn + "|" + rooms[socket.roomId].turn);
      io.to(socket.roomId).emit("draftEnded");
    }
    // Broadcast to the room the current turn
    io.to(socket.roomId).emit(
      "currentTurn",
      rooms[socket.roomId].teams[rooms[socket.roomId].turn].username
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
