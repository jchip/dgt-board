"use strict";
const path = require("path");
const ChessGame = require("./lib/chess-game");
const Board = require("./lib/Board");
const UserPlayer = require("./lib/user-player");
const EnginePlayer = require("./lib/engine-player");
const { Engine } = require("node-uci");

async function connectDgtBoard() {
  const board = new Board("COM5");
  return new Promise(resolve => {
    board.once("ready", () => {
      console.log("board ready - serial no:", board.serialNo, "version:", board.versionNo);
      console.log("current positions");
      console.log(board.ascii().join("\n"));
      resolve(board);
    });
  });
}

async function createStockFishEngine() {
  const engine = new Engine(path.join(__dirname, "stockfish_10_x64_bmi2.exe"));
  await engine.init();
  await engine.isready();
  return engine;
}

async function startChess() {
  const board = await connectDgtBoard();
  const game = new ChessGame({ board });
  game.newGame(async color => {
    console.log("initializing player", color);
    if (color === "white") {
      return new UserPlayer({ color, game, board });
    } else if (color === "black") {
      const engine = await createStockFishEngine();
      return new EnginePlayer({ color, game, board, engine });
    }
  });
}

startChess();
